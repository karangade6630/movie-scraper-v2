import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import initSqlJs from "sql.js";
import * as cheerio from "cheerio";
import { HttpsProxyAgent } from 'https-proxy-agent';

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
let BASE_URL = 'https://new3.movies4u.clinic/';
const linkCache = new Map<string, string>();

app.use(express.json());

let isScraping = false;
let scrapingStatus = { 
    fullScrape: { message: "Idle", progress: 0 },
    monitoring: { message: "Idle", progress: 0 }
};
let currentFullScrapePage = 1;
let isFullScrapeDone = false;

app.post("/api/scraper/toggle", (req, res) => {
    isScraping = !isScraping;
    scrapingStatus = { 
        fullScrape: { message: isScraping ? "Idle" : "Idle", progress: 0 },
        monitoring: { message: isScraping ? "Idle" : "Idle", progress: 0 }
    };
    res.json({ isScraping });
});

app.get("/api/scraper/status", (req, res) => {
    res.json(scrapingStatus);
});

async function processMovies(scraped: any[], isMonitoring: boolean = false) {
    for (const m of scraped) {
        // Fetch movies with the same title to ensure exact match
        const existing = dbAll("SELECT title FROM movies WHERE title = ?", [m.title]);
        
        // Check for exact title match (JS side)
        const exists = existing.length > 0 && existing.some((row: any) => row.title === m.title);
        
        if (!exists) {
            if (isMonitoring) {
                scrapingStatus.monitoring = { message: `Adding: ${m.title}`, progress: 50 };
            } else {
                scrapingStatus.fullScrape = { message: `Processing: ${m.title}`, progress: 50 };
            }
            try {
                const links = await scrapeMovieDetail(m.detail_url);
                dbRun(
                    `INSERT INTO movies (title, release_year, quality, poster_url, links, page_num, scraped_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
                    [m.title, m.release_year, m.quality, m.poster_url, JSON.stringify(links), m.page_num]
                );
            } catch (e) {
                console.error(`Failed to scrape details for ${m.title}:`, e);
            }
        }
    }
}

async function runFullScrapeLoop() {
    while (true) {
        if (isScraping) {
            try {
                if (isFullScrapeDone) {
                    // Optionally reset or just wait
                    scrapingStatus.fullScrape = { message: "Full Scrape Done.", progress: 100 };
                    await new Promise(r => setTimeout(r, 60000));
                    continue;
                }
                scrapingStatus.fullScrape = { message: `Full Scrape: Page ${currentFullScrapePage}...`, progress: Math.min(90, (currentFullScrapePage * 10)) };
                const scraped = await scrapePage(currentFullScrapePage);
                if (scraped.length === 0) {
                    isFullScrapeDone = true;
                    scrapingStatus.fullScrape = { message: "Full Scrape Done.", progress: 100 };
                } else {
                    await processMovies(scraped, false);
                    currentFullScrapePage++;
                }
            } catch (e) {
                console.error("Error in full scrape:", e);
                scrapingStatus.fullScrape = { message: `Error: ${e}`, progress: 0 };
                await new Promise(r => setTimeout(r, 60000)); // Wait on error
            }
        }
        await new Promise(r => setTimeout(r, 5000)); // Throttle
    }
}

async function runMonitoringLoop() {
    while (true) {
        if (isScraping) {
            try {
                scrapingStatus.monitoring = { message: "Monitoring Page 1...", progress: 100 };
                const scraped = await scrapePage(1);
                await processMovies(scraped, true);
                scrapingStatus.monitoring = { message: "Monitoring (Waiting for next check)...", progress: 100 };
            } catch (e) {
                console.error("Error in monitoring scrape:", e);
                scrapingStatus.monitoring = { message: `Error: ${e}`, progress: 0 };
            }
        } else {
            scrapingStatus.monitoring = { message: "Idle", progress: 0 };
        }
        await new Promise(r => setTimeout(r, 60000)); // Check every minute
    }
}

async function startContinuousScraping() {
    console.log("Continuous scraping engine initialized.");
    runFullScrapeLoop();
    runMonitoringLoop();
}

// SQLite Database Setup using sql.js
let db: any = null;
const dbPath = path.join(process.cwd(), "database.sqlite");

async function initDatabase() {
  try {
    const SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
      const filebuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(filebuffer);
    } else {
      db = new SQL.Database();
    }
    
    db.run(`
      CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        release_year TEXT,
        quality TEXT,
        poster_url TEXT,
        links TEXT,
        page_num INTEGER,
        scraped_at TEXT
      );
      CREATE TABLE IF NOT EXISTS proxies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        latency INTEGER,
        last_checked TEXT
      );
    `);
    saveDatabase();
    console.log("SQLite database initialized successfully.");
  } catch (err) {
    console.error("Failed to initialize SQLite database:", err);
  }
}

async function scrapeMovieDetail(detailUrl: string) {
  const links: { quality: string; links: { text: string; url: string }[] }[] = [];
  try {
    const response = await fetch(detailUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    const html = await response.text();
    let $ = cheerio.load(html);

    // 1. Try to find link to m4ulinks.site or similar
    const $m4uLink = $("a").filter((_, el) => $(el).attr("href")?.includes("m4ulinks.site") || false);
    const m4uUrl = $m4uLink.attr("href");

    if (m4uUrl) {
      const m4uResponse = await fetchWithRetry(m4uUrl, {}, 2, true);
      const m4uHtml = await m4uResponse.text();
      $ = cheerio.load(m4uHtml);
    }

    // 2. Robust approach: find all Hub-Cloud links, resolve them, then associate with nearest header
    const hubLinks = $("a").filter((_, el) => {
        const url = $(el).attr("href") || "";
        return url.includes("hubcloud");
    }).toArray();
    
    // Process Hub-Cloud links in parallel
    const linkResolutions = hubLinks.map(async (el) => {
        const $a = $(el);
        const originalUrl = $a.attr("href") || "";
        const linkText = $a.text().trim() || "Download";
        
        const finalUrl = await robustFetchPixeldrainLink(originalUrl);

        return { $a, linkText, finalUrl };
    });
    
    const results = await Promise.allSettled(linkResolutions);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.finalUrl) {
          const { $a, linkText, finalUrl } = result.value;
          
          // Find the closest preceding header
          let $prev = $a.parent();
          let $header = $prev.prevAll("h2, h3, h4, h5, strong").first();
          
          // Traverse up if not found in immediate parent
          while (!$header.length && $prev.length && !$prev.is("body")) {
              $prev = $prev.parent();
              $header = $prev.prevAll("h2, h3, h4, h5, strong").first();
          }
          
          const quality = $header.length > 0 ? $header.text().trim() : "General";
          
          // Add to links array
          let qualityEntry = links.find(l => l.quality === quality);
          if (!qualityEntry) {
            qualityEntry = { quality: quality, links: [] };
            links.push(qualityEntry);
          }
          qualityEntry.links.push({ text: linkText, url: finalUrl });
      }
    }
  } catch (err) {
    console.error(`Error scraping detail: ${detailUrl}`, err);
  }
  return links;
}

// Helper to fetch with retries
async function fetchWithRetry(url: string, options: any = {}, retries = 2, useProxy = false): Promise<Response> {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            
            const fetchOptions: any = {
                ...options,
                headers: { 
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    ...options.headers
                },
                signal: controller.signal as any
            };

            if (useProxy) {
                const proxy = dbAll("SELECT url FROM proxies WHERE latency IS NOT NULL ORDER BY RANDOM() LIMIT 1")[0];
                if (proxy) {
                    console.log(`Using proxy: ${proxy.url}`);
                    // @ts-ignore
                    fetchOptions.agent = new HttpsProxyAgent(`http://${proxy.url}`);
                }
            }
            
            const response = await fetch(url, fetchOptions);
            clearTimeout(timeout);
            
            if (response.ok) return response;
            throw new Error(`HTTP error! status: ${response.status}`);
        } catch (e) {
            if (i === retries) throw e;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    throw new Error("Max retries exceeded");
}

// Robustly extract Pixeldrain link following the site flow
async function robustFetchPixeldrainLink(url: string): Promise<string> {
    const cachedUrl = linkCache.get(url);
    if (cachedUrl) return cachedUrl;

    try {
        // Step 1: Fetch Main Page
        const hubResponse = await fetchWithRetry(url, {}, 2, true);
        let html = await hubResponse.text();
        
        // Step 2: Check for "Generate" flow
        let $ = cheerio.load(html);
        const $generateBtn = $("#download, a:contains('Generate'), a:contains('Go to download')");
        
        if ($generateBtn.length > 0) {
            const rawGenerateUrl = $generateBtn.attr("href");
            if (rawGenerateUrl) {
                const generateUrl = new URL(rawGenerateUrl, url).href;
                const finalResponse = await fetchWithRetry(generateUrl, {}, 2, true);
                html = await finalResponse.text();
                // const htmlContent = `<!-- paste your HTML string here -->`;

// Extract the URL assigned to the `pxl` variable

            }
        }

        // Step 3: Extract from JS variable
        const match = html.match(/var\s+pxl\s*=\s*["']([^"']+)["']/);
        
        if (match && match[1]) {
            const finalUrl = match[1].replace("/u/", "/api/file/");
            linkCache.set(url, finalUrl);
            return finalUrl;
        }

        return null; // Return null instead of throwing or original URL
    } catch (e) {
        console.error(`Failed to resolve Pixeldrain link for ${url}:`, e);
        return null; // Return null on failure
    }
}


function saveDatabase() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

// Helper to run query and return all objects
function dbAll(query: string, params: any[] = []) {
  if (!db) return [];
  const stmt = db.prepare(query);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper to run execute
function dbRun(query: string, params: any[] = []) {
  if (!db) return;
  db.run(query, params);
  saveDatabase();
}

async function fetchAndRefreshProxies() {
    console.log("Refreshing proxies...");
    try {
        const res = await fetch('https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all');
        const text = await res.text();
        const proxies = text.split('\r\n').filter(p => p.length > 5);
        
        for (const proxyUrl of proxies) {
            db.run("INSERT OR IGNORE INTO proxies (url, last_checked) VALUES (?, ?)", [proxyUrl, new Date().toISOString()]);
        }
        saveDatabase();
    } catch (e) {
        console.error("Error fetching proxies:", e);
    }
}

async function testProxyLatency(proxyUrl: string) {
    const start = Date.now();
    try {
        const agent = new HttpsProxyAgent(`http://${proxyUrl}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        
        const res = await fetch('https://www.cloudflare.com', {
            // @ts-ignore
            agent: agent,
            signal: controller.signal
        });
        clearTimeout(timeout);
        
        if (res.ok) {
            const latency = Date.now() - start;
            dbRun("UPDATE proxies SET latency = ?, last_checked = ? WHERE url = ?", [latency, new Date().toISOString(), proxyUrl]);
            return latency;
        }
    } catch (e) {
        console.error(`Proxy test failed for ${proxyUrl}:`, e);
        dbRun("UPDATE proxies SET latency = NULL, last_checked = ? WHERE url = ?", [new Date().toISOString(), proxyUrl]);
    }
    return null;
}

setInterval(fetchAndRefreshProxies, 60 * 60 * 1000); // 1 hour

// Scrape movies4u.clinic for a given page
async function scrapePage(pageNum: number) {
  const url = pageNum === 1 
    ? BASE_URL 
    : `${BASE_URL.replace(/\/$/, '')}/page/${pageNum}/`;
  
  const response = await fetchWithRetry(url, {}, 2, true);

  if (!response.ok) {
    throw new Error(`Failed to fetch page ${pageNum}: HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const movies: Array<{
    title: string;
    release_year: string;
    quality: string;
    poster_url: string;
    detail_url: string;
    page_num: number;
  }> = [];

  // Common selectors for WordPress movie themes (item, article, post, etc.)
  // Let's check common elements on movies4u.clinic or similar sites:
  // Usually <article>, .item, .movies, .box, .poster, etc.
  const selectors = "article, .item, .movies-item, .post, .box, .search-item";
  
  $(selectors).each((_, el) => {
    const $el = $(el);
    
    // Title
    let title = $el.find("h2, h3, .title, a.title, .movie-title, h1").first().text().trim();
    if (!title) {
      title = $el.find("img").attr("alt") || $el.find("a").attr("title") || "";
    }
    title = title.replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;

    // Link (Video Source URL or Detail URL)
    let videoUrl = $el.find("a").attr("href") || "";
    if (videoUrl && !videoUrl.startsWith("http")) {
      videoUrl = `${BASE_URL.replace(/\/$/, '')}${videoUrl.startsWith("/") ? "" : "/"}${videoUrl}`;
    }

    // Poster Image
    let posterUrl = $el.find("img").attr("data-src") || $el.find("img").attr("src") || "";
    if (posterUrl && posterUrl.startsWith("//")) {
      posterUrl = `https:${posterUrl}`;
    } else if (posterUrl && !posterUrl.startsWith("http")) {
      posterUrl = `${BASE_URL.replace(/\/$/, '')}${posterUrl}`;
    }

    // Quality (e.g. Web-DL, HDRip, 1080p, 4K, BluRay)
    let quality = $el.find(".quality, .rip, .badge, .quality-tag, span.quality").text().trim();
    if (!quality) {
      // Try to detect quality from text
      const fullText = $el.text();
      const matchQ = fullText.match(/(WEB-DL|HDRip|BluRay|CAM|HD|4K|1080p|720p)/i);
      quality = matchQ ? matchQ[0] : "Web-DL";
    }

    // Release Year
    let releaseYear = $el.find(".year, .date").text().trim();
    if (!releaseYear) {
      const matchY = title.match(/\b(19\d\d|20\d\d)\b/) || $el.text().match(/\b(19\d\d|20\d\d)\b/);
      releaseYear = matchY ? matchY[1] : "2024";
    } else {
      const matchY = releaseYear.match(/\b(19\d\d|20\d\d)\b/);
      releaseYear = matchY ? matchY[1] : "2024";
    }

    // Clean title from year if present
    title = title.replace(/\(\d{4}\)/, "").trim();

    if (title && !movies.some(m => m.title.toLowerCase() === title.toLowerCase())) {
      movies.push({
        title,
        release_year: releaseYear,
        quality: quality.toUpperCase(),
        poster_url: posterUrl || "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=500&auto=format&fit=crop&q=60",
        detail_url: videoUrl || "https://new2.movies4u.clinic/",
        page_num: pageNum
      });
    }
  });

  // Fallback if specific selectors didn't match enough items
  if (movies.length === 0) {
    $("a").each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href") || "";
      const text = $a.text().trim();
      const $img = $a.find("img");
      if ($img.length > 0 && text.length > 3 && (href.includes("/movie/") || href.includes("/watch/") || href.length > 10)) {
        let posterUrl = $img.attr("data-src") || $img.attr("src") || "";
        if (posterUrl && !posterUrl.startsWith("http")) posterUrl = `${BASE_URL.replace(/\/$/, '')}${posterUrl}`;
        let title = text.replace(/\s+/g, " ").trim();
        let videoUrl = href.startsWith("http") ? href : `${BASE_URL.replace(/\/$/, '')}${href}`;
        const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/) || ["2024"];
        const cleanTitle = title.replace(/\(\d{4}\)/, "").trim();

        if (cleanTitle && !movies.some(m => m.title.toLowerCase() === cleanTitle.toLowerCase())) {
          movies.push({
            title: cleanTitle,
            release_year: yearMatch[1] || yearMatch[0],
            quality: "WEB-DL",
            poster_url: posterUrl || "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=500&auto=format&fit=crop&q=60",
            detail_url: videoUrl,
            page_num: pageNum
          });
        }
      }
    });
  }

  return movies;
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Get all movies or filter by search / page range
app.get("/api/movies", (req, res) => {
  console.log("GET /api/movies called with query:", req.query);
  try {
    const { search, quality, pageMin, pageMax, pageNum } = req.query;
    
    let query = "SELECT * FROM movies WHERE 1=1";
    const params: any[] = [];

    if (search && typeof search === "string") {
      query += " AND (title LIKE ? OR release_year LIKE ? OR quality LIKE ?)";
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    if (quality && typeof quality === "string" && quality !== "ALL") {
      query += " AND quality = ?";
      params.push(quality);
    }

    if (pageMin && !isNaN(Number(pageMin))) {
      query += " AND page_num >= ?";
      params.push(Number(pageMin));
    }

    if (pageMax && !isNaN(Number(pageMax))) {
      query += " AND page_num <= ?";
      params.push(Number(pageMax));
    }

    const pageNumFilter = pageNum ? parseInt(pageNum as string) : null;
    if (pageNumFilter && !isNaN(pageNumFilter)) {
      query += " AND page_num = ?";
      params.push(pageNumFilter);
    }

    query += " ORDER BY id DESC";

    const movies = dbAll(query, params);
    res.json({ success: true, count: movies.length, movies, total: movies.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get raw database content
app.get("/api/db-dump", (req, res) => {
  try {
    const movies = dbAll("SELECT * FROM movies");
    res.json({ success: true, movies });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/proxies", (req, res) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const proxies = dbAll("SELECT * FROM proxies ORDER BY latency ASC LIMIT ? OFFSET ?", [limit, offset]);
        const total = dbAll("SELECT COUNT(*) as count FROM proxies")[0].count;
        res.json({ success: true, proxies, total, page, limit });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post("/api/proxies/refresh", async (req, res) => {
    await fetchAndRefreshProxies();
    res.json({ success: true });
});

app.post("/api/proxies/test", async (req, res) => {
    try {
        const { url } = req.body;
        const latency = await testProxyLatency(url);
        res.json({ success: true, latency });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Scrape range of pages (e.g., page 1 to 3)
app.post("/api/scrape", async (req, res) => {
  try {
    const { startPage = 1, endPage = 1 } = req.body;
    const start = Math.max(1, Number(startPage));
    const end = Math.max(start, Number(endPage));

    let totalScraped = 0;
    const errors: string[] = [];
    const allMovieData: any[] = [];

    // Parallel processing pages
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    
    await Promise.all(pages.map(async (p) => {
      try {
        const scraped = await scrapePage(p);
        for (const m of scraped) {
          const existing = dbAll("SELECT id FROM movies WHERE title = ? AND page_num = ?", [m.title, m.page_num]);
          if (existing.length === 0) {
            const links = await scrapeMovieDetail(m.detail_url);
            dbRun(
              `INSERT INTO movies (title, release_year, quality, poster_url, links, page_num, scraped_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
              [m.title, m.release_year, m.quality, m.poster_url, JSON.stringify(links), m.page_num]
            );
            totalScraped++;
          }
        }
      } catch (err: any) {
        console.error(`Error scraping page ${p}:`, err.message);
        errors.push(`Page ${p}: ${err.message}`);
      }
    }));

    const allMovies = dbAll("SELECT * FROM movies ORDER BY id DESC");
    res.json({
      success: true,
      newScraped: totalScraped,
      totalCount: allMovies.length,
      errors: errors.length > 0 ? errors : undefined,
      movies: allMovies
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete all movies
app.delete("/api/movies", (req, res) => {
  try {
    console.log("Received DELETE request to /api/movies");
    dbRun("DELETE FROM movies");
    dbRun("DELETE FROM sqlite_sequence WHERE name='movies'");
    res.json({ success: true, message: "All movies cleared from database." });
  } catch (err: any) {
    console.error("Error clearing database:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function startServer() {
  await initDatabase();
  startContinuousScraping();

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const listenOnPort = (port: number) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${port}`);
    });

    server.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        console.warn(`Port ${port} is already in use, trying ${port + 1}...`);
        server.close(() => {
          listenOnPort(port + 1);
        });
      } else {
        console.error("Server failed to start:", error);
        process.exit(1);
      }
    });
  };

  listenOnPort(DEFAULT_PORT);
}

startServer();
