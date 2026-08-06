import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import initSqlJs from "sql.js";
import * as cheerio from "cheerio";

const app = express();
const PORT = 3000;

app.use(express.json());

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
      `);
      saveDatabase();
    }
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
      const m4uResponse = await fetch(m4uUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" },
      });
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
      if (result.status === 'fulfilled') {
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
async function fetchWithRetry(url: string, options: any = {}, retries = 2): Promise<Response> {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(url, {
                ...options,
                headers: { 
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    ...options.headers
                },
                signal: controller.signal as any
            });
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
    if (linkCache.has(url)) return linkCache.get(url)!;

    try {
        // Step 1: Fetch HubCloud Page
        const hubResponse = await fetchWithRetry(url);
        let html = await hubResponse.text();
        let $ = cheerio.load(html);

        // Step 2: Check for "Generate Direct Download Link" button or similar
        const $generateBtn = $("#download, a:contains('Generate')");
        if ($generateBtn.length > 0) {
            const generateUrl = $generateBtn.attr("href");
            if (generateUrl) {
                console.log(`Following generate link: ${generateUrl}`);
                const finalResponse = await fetchWithRetry(generateUrl);
                html = await finalResponse.text();
                $ = cheerio.load(html);
            }
        }

        // Step 3: Find Pixeldrain link
        const pixeldrainRegex = /https?:\/\/(?:www\.)?pixeldrain\.[a-z]+\/u\/([a-zA-Z0-9]+)/i;
        
        // Try regex on HTML
        const match = html.match(pixeldrainRegex);
        if (match) {
            const finalUrl = match[0].replace("/u/", "/api/file/");
            linkCache.set(url, finalUrl);
            return finalUrl;
        }

        // Fallback: Check for links
        const $pxlLink = $("a[href*='pixeldrain.dev/u/']");
        if ($pxlLink.length > 0) {
            const pxlUrl = $pxlLink.attr("href");
            if (pxlUrl) {
                const finalUrl = pxlUrl.replace("/u/", "/api/file/");
                linkCache.set(url, finalUrl);
                return finalUrl;
            }
        }

        console.error(`DEBUG: No Pixeldrain link found for ${url}.`);
        throw new Error("No download link found");
    } catch (e) {
        console.error(`Failed to resolve Pixeldrain link for ${url}:`, e);
        return url; // Return original on failure
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

// Scrape movies4u.clinic for a given page
async function scrapePage(pageNum: number) {
  const url = pageNum === 1 
    ? "https://new2.movies4u.clinic/" 
    : `https://new2.movies4u.clinic/page/${pageNum}/`;
  
  console.log(`Scraping URL: ${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5"
    }
  });

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
      videoUrl = `https://new2.movies4u.clinic${videoUrl.startsWith("/") ? "" : "/"}${videoUrl}`;
    }

    // Poster Image
    let posterUrl = $el.find("img").attr("data-src") || $el.find("img").attr("src") || "";
    if (posterUrl && posterUrl.startsWith("//")) {
      posterUrl = `https:${posterUrl}`;
    } else if (posterUrl && !posterUrl.startsWith("http")) {
      posterUrl = `https://new2.movies4u.clinic${posterUrl}`;
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
        if (posterUrl && !posterUrl.startsWith("http")) posterUrl = `https://new2.movies4u.clinic${posterUrl}`;
        let title = text.replace(/\s+/g, " ").trim();
        let videoUrl = href.startsWith("http") ? href : `https://new2.movies4u.clinic${href}`;
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
  try {
    const { search, quality, pageMin, pageMax } = req.query;
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

    query += " ORDER BY id DESC";

    const movies = dbAll(query, params);
    res.json({ success: true, count: movies.length, movies });
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
    res.json({ success: true, message: "All movies cleared from database." });
  } catch (err: any) {
    console.error("Error clearing database:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function startServer() {
  await initDatabase();

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
