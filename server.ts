import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import {
  connectToDatabase,
  getDb,
  getMoviesCollection,
  getProxiesCollection,
  getCountersCollection,
  getSeenLinksCollection,
} from "./src/db.ts";
import * as cheerio from "cheerio";
import { HttpsProxyAgent } from "https-proxy-agent";

const app = express();
app.use(express.json());
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
let BASE_URL = process.env.SITE_URL || 'https://new5.movies4u.clinic/';
const linkCache = new Map<string, string>();

import seenLinksRouter from "./src/seenLinks.ts";

let isScraping = false;
let scrapingStatus = {
  fullScrape: { message: "Idle", progress: 0 },
  monitoring: { message: "Idle", progress: 0 },
};
let currentFullScrapePage = 1;
let isFullScrapeDone = false;
const processingTitles = new Set<string>();

app.post("/api/scraper/toggle", (req, res) => {
  isScraping = !isScraping;
  scrapingStatus = {
    fullScrape: { message: isScraping ? "Idle" : "Idle", progress: 0 },
    monitoring: { message: isScraping ? "Idle" : "Idle", progress: 0 },
  };
  if (isScraping) {
    currentFullScrapePage = 1;
    isFullScrapeDone = false;
  }
  if (!isScraping) processingTitles.clear();
  res.json({ isScraping });
});

app.get("/api/scraper/status", (req, res) => {
  res.json(scrapingStatus);
});

function cleanMovieTitle(rawTitle: string): string {
  let t = rawTitle || "";
  t = t.replace(/\b(480p|720p|1080p|2160p|4k|hdr|hdrip|web-dl|bluray|cam|hd|hindi|english|dual audio|multi audio|org\.?|dubbed|full movie|batch|zip|uplay)\b/gi, "");
  t = t.replace(/[\(\[\{\}\|]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[\-\s]+$/, "").trim();
  return t.toLowerCase() || rawTitle.toLowerCase().trim();
}

async function processMovies(scraped: any[], isMonitoring: boolean = false) {
  for (const m of scraped) {
    if (!isScraping) break;

    // Normalize the title: trim, remove extra spaces
    const normalizedTitle = m.title.replace(/\s+/g, " ").trim();
    const cleanedTitle = cleanMovieTitle(normalizedTitle);
    const pageNum = m.page_num || currentFullScrapePage;

    if (!isMonitoring) {
      scrapingStatus.fullScrape = {
        message: `Processing Page ${pageNum}: ${normalizedTitle}`,
        progress: Math.min(95, pageNum * 5),
      };
    } else {
      scrapingStatus.monitoring = {
        message: `Adding: ${normalizedTitle}`,
        progress: 50,
      };
    }

    if (processingTitles.has(normalizedTitle) || processingTitles.has(cleanedTitle)) continue;

    // Check if the movie already exists in MongoDB by detail_url, title, or cleaned_title
    const moviesCol = getMoviesCollection();
    const exists = await moviesCol.findOne({
      $or: [
        { detail_url: m.detail_url },
        { title: normalizedTitle },
        { cleaned_title: cleanedTitle }
      ]
    });

    if (!exists) {
      processingTitles.add(normalizedTitle);
      processingTitles.add(cleanedTitle);
      try {
        const links = await scrapeMovieDetail(m.detail_url);

        const nextId = await getNextMovieId();

        await moviesCol.insertOne({
          id: nextId,
          title: normalizedTitle,
          cleaned_title: cleanedTitle,
          release_year: m.release_year,
          quality: m.quality,
          poster_url: m.poster_url,
          links: links,
          page_num: pageNum,
          scraped_at: new Date().toISOString(),
          priority: 0,
        });
      } catch (e) {
        console.error(`Failed to scrape details for ${normalizedTitle}:`, e);
      } finally {
        processingTitles.delete(normalizedTitle);
        processingTitles.delete(cleanedTitle);
      }
    } else {
      // If movie already exists, check if new links/episodes have been added
      processingTitles.add(normalizedTitle);
      processingTitles.add(cleanedTitle);
      try {
        const links = await scrapeMovieDetail(m.detail_url);
        const existingLinksStr = JSON.stringify(exists.links || []);
        const newLinksStr = JSON.stringify(links);

        if (newLinksStr !== existingLinksStr) {
          if (!isMonitoring) {
            scrapingStatus.fullScrape = {
              message: `Updating New Episodes/Links for Page ${pageNum}: ${normalizedTitle}`,
              progress: Math.min(95, pageNum * 5),
            };
          }
          await moviesCol.updateOne(
            { _id: exists._id },
            { 
              $set: { 
                links: links, 
                quality: m.quality || exists.quality,
                poster_url: m.poster_url || exists.poster_url,
                scraped_at: new Date().toISOString() 
              } 
            }
          );
        }
      } catch (e) {
        console.error(`Failed to update links for ${normalizedTitle}:`, e);
      } finally {
        processingTitles.delete(normalizedTitle);
        processingTitles.delete(cleanedTitle);
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
          scrapingStatus.fullScrape = {
            message: "Full Scrape Done.",
            progress: 100,
          };
          await new Promise((r) => setTimeout(r, 60000));
          continue;
        }
        scrapingStatus.fullScrape = {
          message: `Full Scrape: Scraping Page ${currentFullScrapePage}...`,
          progress: Math.min(90, currentFullScrapePage * 10),
        };
        const scraped = await scrapePage(currentFullScrapePage);
        if (scraped.length === 0) {
          isFullScrapeDone = true;
          scrapingStatus.fullScrape = {
            message: "Full Scrape Done.",
            progress: 100,
          };
        } else {
          scrapingStatus.fullScrape = {
            message: `Full Scrape: Processing Page ${currentFullScrapePage} (${scraped.length} items)`,
            progress: Math.min(90, currentFullScrapePage * 10),
          };
          await processMovies(scraped, false);
          currentFullScrapePage++;
        }
      } catch (e) {
        console.error("Error in full scrape:", e);
        scrapingStatus.fullScrape = { message: `Error: ${e}`, progress: 0 };
        await new Promise((r) => setTimeout(r, 60000)); // Wait on error
      }
    }
    await new Promise((r) => setTimeout(r, 5000)); // Throttle
  }
}

async function runMonitoringLoop() {
  while (true) {
    if (isScraping) {
      try {
        scrapingStatus.monitoring = {
          message: "Monitoring Page 1...",
          progress: 100,
        };
        const scraped = await scrapePage(1);
        await processMovies(scraped, true);
        scrapingStatus.monitoring = {
          message: "Monitoring (Waiting for next check)...",
          progress: 100,
        };
      } catch (e) {
        console.error("Error in monitoring scrape:", e);
        scrapingStatus.monitoring = { message: `Error: ${e}`, progress: 0 };
      }
    } else {
      scrapingStatus.monitoring = { message: "Idle", progress: 0 };
    }
    await new Promise((r) => setTimeout(r, 60000)); // Check every minute
  }
}

async function startContinuousScraping() {
  console.log("Continuous scraping engine initialized.");
  runFullScrapeLoop();
  runMonitoringLoop();
}

// Typed interface for counters collection to allow string _id
interface CounterDoc {
  _id: string;
  seq: number;
}

// Auto-increment atomic ID helper for parallel scraping
async function getCounterCol() {
  return getCountersCollection();
}

async function initCounter() {
  try {
    const counterCol = await getCounterCol();
    const exists = await counterCol.findOne({ _id: "movieId" } as any);
    if (!exists) {
      const moviesCol = getMoviesCollection();
      const maxMovie = await moviesCol.findOne({}, { sort: { id: -1 } });
      const maxId =
        maxMovie && typeof maxMovie.id === "number" ? maxMovie.id : 0;
      await counterCol.updateOne(
        { _id: "movieId" } as any,
        { $set: { seq: maxId } },
        { upsert: true },
      );
      console.log(`Initialized movieId counter to ${maxId}`);
    }
  } catch (err) {
    console.error("Failed to initialize movie counter:", err);
  }
}

async function getNextMovieId(): Promise<number> {
  const counterCol = await getCounterCol();
  const result = await counterCol.findOneAndUpdate(
    { _id: "movieId" } as any,
    { $inc: { seq: 1 } },
    { returnDocument: "after", upsert: true },
  );
  return result && typeof result.seq === "number" ? result.seq : Date.now();
}

async function scrapeMovieDetail(detailUrl: string) {
  const links: { quality: string; links: { text: string; url: string }[] }[] = [];
  
  function addLink(quality: string, text: string, url: string) {
    if (!url) return;
    let qualityEntry = links.find((l) => l.quality === quality);
    if (!qualityEntry) {
      qualityEntry = { quality: quality, links: [] };
      links.push(qualityEntry);
    }
    if (!qualityEntry.links.some((l) => l.url === url)) {
      qualityEntry.links.push({ text, url });
    }
  }

  try {
    const response = await fetch(detailUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    const html = await response.text();
    const $main = cheerio.load(html);

    // Find all unique m4ulinks.site URLs on the detail page
    const m4uUrls: string[] = [];
    $main("a").each((_, el) => {
      const href = $main(el).attr("href") || "";
      if (href.includes("m4ulinks.site") && !m4uUrls.includes(href)) {
        m4uUrls.push(href);
      }
    });

    async function processCheerioDoc($doc: any) {
      const hubLinks = $doc("a")
        .filter((_, el) => {
          const url = $doc(el).attr("href") || "";
          return url.includes("hubcloud");
        })
        .toArray();

      const linkResolutions = hubLinks.map(async (el) => {
        const $a = $doc(el);
        const originalUrl = $a.attr("href") || "";
        let linkText = $a.text().trim() || "Download";

        if (
          $a.hasClass("btn-zip") ||
          linkText.toUpperCase().includes("ZIP") ||
          linkText.toUpperCase().includes("BATCH")
        ) {
          linkText = linkText || "BATCH/ZIP";
        }

        const finalUrl = await robustFetchPixeldrainLink(originalUrl);
        return { $a, linkText, finalUrl };
      });

      const results = await Promise.allSettled(linkResolutions);

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.finalUrl) {
          const { $a, linkText, finalUrl } = result.value;

          let $prev = $a.parent();
          let $header = $prev.prevAll("h2, h3, h4, h5, strong").first();

          while (!$header.length && $prev.length && !$prev.is("body")) {
            $prev = $prev.parent();
            $header = $prev.prevAll("h2, h3, h4, h5, strong").first();
          }

          let quality = $header.length > 0 ? $header.text().trim() : "General";
          quality = quality.replace(/^[\s\W]+/g, "").trim();
          if (!quality) quality = "General";

          addLink(quality, linkText, finalUrl);
        }
      }
    }

    if (m4uUrls.length > 0) {
      for (const m4uUrl of m4uUrls) {
        try {
          console.log(`Scraping unique m4ulinks page: ${m4uUrl}`);
          const m4uResponse = await fetchWithRetry(m4uUrl, {}, 2, true);
          const m4uHtml = await m4uResponse.text();
          const $m4u = cheerio.load(m4uHtml);
          await processCheerioDoc($m4u);
        } catch (e) {
          console.error(`Error scraping m4ulinks page ${m4uUrl}:`, e);
        }
      }
    } else {
      await processCheerioDoc($main);
    }
  } catch (err) {
    console.error(`Error scraping detail: ${detailUrl}`, err);
  }
  return links;
}

// Helper to fetch with retries
async function fetchWithRetry(
  url: string,
  options: any = {},
  retries = 2,
  useProxy = false,
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const fetchOptions: any = {
        ...options,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          ...options.headers,
        },
        signal: controller.signal as any,
      };

      if (useProxy) {
        const proxiesCol = getProxiesCollection();
        const randomProxyArr = await proxiesCol
          .aggregate([
            { $match: { latency: { $ne: null } } },
            { $sample: { size: 1 } },
          ])
          .toArray();
        const proxy = randomProxyArr[0];
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
      await new Promise((r) => setTimeout(r, 2000));
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
    const $generateBtn = $(
      "#download, a:contains('Generate'), a:contains('Go to download')",
    );

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

async function fetchAndRefreshProxies() {
  console.log("Refreshing proxies...");
  try {
    const res = await fetch(
      "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
    );
    const text = await res.text();
    const proxies = text.split("\r\n").filter((p) => p.length > 5);

    if (proxies.length > 0) {
      const proxiesCol = getProxiesCollection();
      await proxiesCol.deleteMany({});

      const docs = proxies.map((url) => ({
        url: url.trim(),
        latency: null,
        last_checked: new Date().toISOString(),
      }));
      await proxiesCol.insertMany(docs, { ordered: false });
      console.log(
        `Successfully refreshed proxies. Overwrote DB with ${proxies.length} new proxies.`,
      );
    }
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

    const res = await fetch("https://www.cloudflare.com", {
      // @ts-ignore
      agent: agent,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const latency = Date.now() - start;
      await getProxiesCollection().updateOne(
        { url: proxyUrl },
        { $set: { latency, last_checked: new Date().toISOString() } },
      );
      return latency;
    }
  } catch (e) {
    console.error(`Proxy test failed for ${proxyUrl}:`, e);
    await getProxiesCollection().updateOne(
      { url: proxyUrl },
      { $set: { latency: null, last_checked: new Date().toISOString() } },
    );
  }
  return null;
}

setInterval(fetchAndRefreshProxies, 5 * 60 * 1000); // 5 minutes

// Scrape movies4u.clinic for a given page
async function scrapePage(pageNum: number) {
  const url =
    pageNum === 1
      ? BASE_URL
      : `${BASE_URL.replace(/\/$/, "")}/page/${pageNum}/`;

  const response = await fetchWithRetry(url, {}, 2, true);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch page ${pageNum}: HTTP ${response.status} ${response.statusText}`,
    );
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
    let title = $el
      .find("h2, h3, .title, a.title, .movie-title, h1")
      .first()
      .text()
      .trim();
    if (!title) {
      title = $el.find("img").attr("alt") || $el.find("a").attr("title") || "";
    }
    title = title.replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;

    // Link (Video Source URL or Detail URL)
    let videoUrl = $el.find("a").attr("href") || "";
    if (videoUrl && !videoUrl.startsWith("http")) {
      videoUrl = `${BASE_URL.replace(/\/$/, "")}${videoUrl.startsWith("/") ? "" : "/"}${videoUrl}`;
    }

    // Poster Image
    let posterUrl =
      $el.find("img").attr("data-src") || $el.find("img").attr("src") || "";
    if (posterUrl && posterUrl.startsWith("//")) {
      posterUrl = `https:${posterUrl}`;
    } else if (posterUrl && !posterUrl.startsWith("http")) {
      posterUrl = `${BASE_URL.replace(/\/$/, "")}${posterUrl}`;
    }

    // Quality (e.g. Web-DL, HDRip, 1080p, 4K, BluRay)
    let quality = $el
      .find(".quality, .rip, .badge, .quality-tag, span.quality")
      .text()
      .trim();
    if (!quality) {
      // Try to detect quality from text
      const fullText = $el.text();
      const matchQ = fullText.match(
        /(WEB-DL|HDRip|BluRay|CAM|HD|4K|1080p|720p)/i,
      );
      quality = matchQ ? matchQ[0] : "Web-DL";
    }

    // Release Year
    let releaseYear = $el.find(".year, .date").text().trim();
    if (!releaseYear) {
      const matchY =
        title.match(/\b(19\d\d|20\d\d)\b/) ||
        $el.text().match(/\b(19\d\d|20\d\d)\b/);
      releaseYear = matchY ? matchY[1] : "2024";
    } else {
      const matchY = releaseYear.match(/\b(19\d\d|20\d\d)\b/);
      releaseYear = matchY ? matchY[1] : "2024";
    }

    // Clean title from year if present
    title = title.replace(/\(\d{4}\)/, "").trim();

    if (
      title &&
      !movies.some((m) => m.title.toLowerCase() === title.toLowerCase())
    ) {
      movies.push({
        title,
        release_year: releaseYear,
        quality: quality.toUpperCase(),
        poster_url:
          posterUrl ||
          "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=500&auto=format&fit=crop&q=60",
        detail_url: videoUrl || "https://new2.movies4u.clinic/",
        page_num: pageNum,
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
      if (
        $img.length > 0 &&
        text.length > 3 &&
        (href.includes("/movie/") ||
          href.includes("/watch/") ||
          href.length > 10)
      ) {
        let posterUrl = $img.attr("data-src") || $img.attr("src") || "";
        if (posterUrl && !posterUrl.startsWith("http"))
          posterUrl = `${BASE_URL.replace(/\/$/, "")}${posterUrl}`;
        let title = text.replace(/\s+/g, " ").trim();
        let videoUrl = href.startsWith("http")
          ? href
          : `${BASE_URL.replace(/\/$/, "")}${href}`;
        const yearMatch = title.match(/\b(19\d\d|20\d\d)\b/) || ["2024"];
        const cleanTitle = title.replace(/\(\d{4}\)/, "").trim();

        if (
          cleanTitle &&
          !movies.some(
            (m) => m.title.toLowerCase() === cleanTitle.toLowerCase(),
          )
        ) {
          movies.push({
            title: cleanTitle,
            release_year: yearMatch[1] || yearMatch[0],
            quality: "WEB-DL",
            poster_url:
              posterUrl ||
              "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=500&auto=format&fit=crop&q=60",
            detail_url: videoUrl,
            page_num: pageNum,
          });
        }
      }
    });
  }

  return movies;
}

// API Routes
app.use("/api/seen-links", seenLinksRouter);

// Get all movies or filter by search / page range
app.get("/api/movies", async (req, res) => {
  console.log("GET /api/movies called with query:", req.query);
  try {
    const { search, quality, pageMin, pageMax, pageNum, page, limit } =
      req.query;

    const pageFilter = parseInt(page as string) || 1;
    const limitFilter = parseInt(limit as string) || 30;
    const skip = (pageFilter - 1) * limitFilter;

    const filter: any = {};

    if (search && typeof search === "string") {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { title: regex },
        { release_year: regex },
        { quality: regex },
      ];
    }

    if (quality && typeof quality === "string" && quality !== "ALL") {
      filter.quality = quality;
    }

    if (pageMin && !isNaN(Number(pageMin))) {
      filter.page_num = filter.page_num || {};
      filter.page_num.$gte = Number(pageMin);
    }

    if (pageMax && !isNaN(Number(pageMax))) {
      filter.page_num = filter.page_num || {};
      filter.page_num.$lte = Number(pageMax);
    }

    const pageNumFilter = pageNum ? parseInt(pageNum as string) : null;
    if (pageNumFilter && !isNaN(pageNumFilter)) {
      filter.page_num = pageNumFilter;
    }

    const moviesCol = getMoviesCollection();
    const matchingCount = await moviesCol.countDocuments(filter);

    const movies = await moviesCol
      .find(filter)
      .sort({ priority: -1, id: -1 }) // Prioritized first, and latest scraped first
      .skip(skip)
      .limit(limitFilter)
      .toArray();

    const mappedMovies = movies.map((m: any) => ({
      ...m,
      links: typeof m.links === "string" ? m.links : JSON.stringify(m.links),
    }));

    const totalCount = await moviesCol.countDocuments({});
    const pagesList = await moviesCol.distinct("page_num");
    const sortedPages = pagesList.sort((a, b) => Number(a) - Number(b));
    const qualitiesList = await moviesCol.distinct("quality");
    const sortedQualities = qualitiesList.sort();

    res.json({
      success: true,
      count: mappedMovies.length,
      movies: mappedMovies,
      total: totalCount,
      matchingCount: matchingCount,
      pages: sortedPages,
      qualities: sortedQualities,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/movies-to-download", async (req, res) => {
  console.log("GET /api/movies called with query:", req.query);
  try {
    const filter: any = {};

    const moviesCol = getMoviesCollection();
    const matchingCount = await moviesCol.countDocuments(filter);

    const movies = await moviesCol
      .find(filter)
      .sort({ priority: -1, id: -1 }) // Prioritized first, and latest scraped first
      // .skip(skip)
      // .limit(limitFilter)
      .toArray();

    const mappedMovies = movies.map((m: any) => ({
      ...m,
      links: typeof m.links === "string" ? m.links : JSON.stringify(m.links),
    }));

    const totalCount = await moviesCol.countDocuments({});
    const pagesList = await moviesCol.distinct("page_num");
    const sortedPages = pagesList.sort((a, b) => Number(a) - Number(b));
    const qualitiesList = await moviesCol.distinct("quality");
    const sortedQualities = qualitiesList.sort();

    res.json({
      success: true,
      count: mappedMovies.length,
      movies: mappedMovies,
      total: totalCount,
      matchingCount: matchingCount,
      pages: sortedPages,
      qualities: sortedQualities,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update priority for a specific movie
app.patch("/api/movies/:id/priority", async (req, res) => {
  try {
    const { id } = req.params;
    const { priority } = req.body;
    const pValue = Number(priority) || 0;

    await getMoviesCollection().updateOne(
      { id: Number(id) },
      { $set: { priority: pValue } },
    );
    res.json({
      success: true,
      message: `Movie #${id} priority updated to ${pValue}`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get raw database content
app.get("/api/db-dump", async (req, res) => {
  try {
    const movies = await getMoviesCollection().find({}).toArray();
    const mappedMovies = movies.map((m: any) => ({
      ...m,
      links: typeof m.links === "string" ? m.links : JSON.stringify(m.links),
    }));
    res.json({ success: true, movies: mappedMovies });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/proxies", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const proxiesCol = getProxiesCollection();
    const proxies = await proxiesCol
      .find({})
      .sort({ latency: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const total = await proxiesCol.countDocuments();
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

    // Parallel processing pages
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    const moviesCol = getMoviesCollection();

    await Promise.all(
      pages.map(async (p) => {
        try {
          const scraped = await scrapePage(p);
          for (const m of scraped) {
            const normalizedTitle = m.title.replace(/\s+/g, " ").trim();
            const cleanedTitle = cleanMovieTitle(normalizedTitle);
            const existing = await moviesCol.findOne({
              $or: [
                { detail_url: m.detail_url },
                { title: normalizedTitle },
                { cleaned_title: cleanedTitle }
              ]
            });
            if (!existing) {
              const links = await scrapeMovieDetail(m.detail_url);
              const nextId = await getNextMovieId();

              await moviesCol.insertOne({
                id: nextId,
                title: normalizedTitle,
                cleaned_title: cleanedTitle,
                release_year: m.release_year,
                quality: m.quality,
                poster_url: m.poster_url,
                links: links,
                page_num: m.page_num,
                scraped_at: new Date().toISOString(),
                priority: 0,
              });
              totalScraped++;
            } else {
              // Check if new links/episodes have been added
              const links = await scrapeMovieDetail(m.detail_url);
              const existingLinksStr = JSON.stringify(existing.links || []);
              const newLinksStr = JSON.stringify(links);
              if (newLinksStr !== existingLinksStr) {
                await moviesCol.updateOne(
                  { _id: existing._id },
                  { 
                    $set: { 
                      links: links, 
                      quality: m.quality || existing.quality,
                      poster_url: m.poster_url || existing.poster_url,
                      scraped_at: new Date().toISOString() 
                    } 
                  }
                );
                totalScraped++;
              }
            }
          }
        } catch (err: any) {
          console.error(`Error scraping page ${p}:`, err.message);
          errors.push(`Page ${p}: ${err.message}`);
        }
      }),
    );

    const allMovies = await moviesCol.find({}).sort({ id: 1 }).toArray();
    const mappedMovies = allMovies.map((m: any) => ({
      ...m,
      links: typeof m.links === "string" ? m.links : JSON.stringify(m.links),
    }));

    res.json({
      success: true,
      newScraped: totalScraped,
      totalCount: mappedMovies.length,
      errors: errors.length > 0 ? errors : undefined,
      movies: mappedMovies,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete all movies, seen links, and reset scraper state & ID counter
app.delete("/api/movies", async (req, res) => {
  try {
    console.log("Received DELETE request to /api/movies");
    await getMoviesCollection().deleteMany({});
    await getSeenLinksCollection().deleteMany({});
    currentFullScrapePage = 1;
    isFullScrapeDone = false;
    const counterCol = await getCountersCollection();
    await counterCol.updateOne(
      { _id: "movieId" } as any,
      { $set: { seq: 0 } },
      { upsert: true }
    );
    res.json({ success: true, message: "All movies and seen links cleared. Scraper reset to page 1 and index 1." });
  } catch (err: any) {
    console.error("Error clearing database:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

async function startServer() {
  await connectToDatabase();
  await initCounter();
  startContinuousScraping();

  // API 404 fallback to return JSON instead of HTML
  app.all("/api/*", (req, res) => {
    res.status(404).json({ success: false, error: "API endpoint not found" });
  });

  // Vite middleware for development or static in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
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
