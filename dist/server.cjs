var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express2 = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_vite = require("vite");

// src/db.ts
var import_mongodb = require("mongodb");
var import_dotenv = __toESM(require("dotenv"), 1);
import_dotenv.default.config();
var uri = process.env.MONGODB_URI;
var client = null;
var db = null;
function matchesQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;
  return Object.entries(query).every(([key, cond]) => {
    if (key === "$or") return cond.some((q) => matchesQuery(doc, q));
    if (key === "$and") return cond.every((q) => matchesQuery(doc, q));
    const val = doc[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$in" in cond) return cond.$in.includes(val);
      if ("$ne" in cond) return val !== cond.$ne;
      return true;
    }
    return val === cond;
  });
}
var InMemoryCollection = class {
  constructor() {
    this.data = [];
  }
  find(query = {}, options) {
    let results = this.data.filter((d) => matchesQuery(d, query));
    return {
      sort: () => ({
        skip: () => ({
          limit: () => ({
            toArray: async () => results
          }),
          toArray: async () => results
        }),
        toArray: async () => results
      }),
      toArray: async () => results,
      countDocuments: async () => results.length,
      limit: () => ({ toArray: async () => results })
    };
  }
  async findOne(query) {
    return this.data.find((d) => matchesQuery(d, query)) || null;
  }
  async insertOne(doc) {
    this.data.push(doc);
    return { insertedId: doc._id || doc.id };
  }
  async insertMany(docs) {
    this.data.push(...docs);
    return { insertedCount: docs.length };
  }
  async updateOne(query, update, options) {
    const item = await this.findOne(query);
    if (item && update.$set) {
      Object.assign(item, update.$set);
    } else if (!item && options?.upsert) {
      const newDoc = { ...query._id ? { _id: query._id } : {}, ...update.$set };
      this.data.push(newDoc);
    }
    return { modifiedCount: item ? 1 : 0 };
  }
  async findOneAndUpdate(query, update, options) {
    let item = await this.findOne(query);
    if (!item && options?.upsert) {
      item = { ...query._id ? { _id: query._id } : {}, seq: 0 };
      this.data.push(item);
    }
    if (item && update.$inc) {
      for (const key of Object.keys(update.$inc)) {
        item[key] = (item[key] || 0) + update.$inc[key];
      }
    }
    return item;
  }
  async deleteMany(query = {}) {
    const count = this.data.length;
    this.data = [];
    return { deletedCount: count };
  }
  async countDocuments(query = {}) {
    return this.data.length;
  }
  async distinct(field) {
    const values = new Set(this.data.map((d) => d[field]).filter((v) => v !== void 0));
    return Array.from(values);
  }
  aggregate(pipeline) {
    return {
      toArray: async () => this.data
    };
  }
};
var mockMovies = new InMemoryCollection();
var mockProxies = new InMemoryCollection();
var mockSeen = new InMemoryCollection();
var mockCounters = new InMemoryCollection();
var MockDb = class {
  collection(name) {
    if (name === "movies") return mockMovies;
    if (name === "proxies") return mockProxies;
    if (name === "seen_links") return mockSeen;
    if (name === "counters") return mockCounters;
    return new InMemoryCollection();
  }
};
var mockDbInstance = new MockDb();
async function connectToDatabase() {
  if (db) return db;
  if (!uri || !uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://") || uri.includes("<username>") || uri.includes("<password>")) {
    console.warn("WARNING: MONGODB_URI is missing, invalid, or contains placeholders. Using in-memory fallback store.");
    return null;
  }
  try {
    client = new import_mongodb.MongoClient(uri, {
      tls: true,
      serverSelectionTimeoutMS: 5e3,
      connectTimeoutMS: 5e3,
      socketTimeoutMS: 15e3
    });
    await client.connect();
    db = client.db("movie_scraper");
    console.log("Connected to MongoDB successfully");
    return db;
  } catch (err) {
    console.error("Failed to connect to MongoDB, using in-memory fallback:", err);
    return null;
  }
}
function getMoviesCollection() {
  if (!db) return mockMovies;
  return db.collection("movies");
}
function getProxiesCollection() {
  if (!db) return mockProxies;
  return db.collection("proxies");
}
function getSeenLinksCollection() {
  if (!db) return mockSeen;
  return db.collection("seen_links");
}
function getCountersCollection() {
  if (!db) return mockCounters;
  return db.collection("counters");
}

// server.ts
var cheerio2 = __toESM(require("cheerio"), 1);
var import_https_proxy_agent = require("https-proxy-agent");

// src/scrapeUtils.ts
var cheerio = __toESM(require("cheerio"), 1);
function siteLabel(host) {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "";
}
function isSameSite(url, baseUrl) {
  try {
    const a = new URL(url);
    const b = new URL(baseUrl);
    if (a.hostname.toLowerCase() === b.hostname.toLowerCase()) return true;
    return siteLabel(a.hostname) === siteLabel(b.hostname);
  } catch {
    return false;
  }
}
function resolveUrl(href, base) {
  if (!href) return "";
  const h = href.trim();
  if (!h || h.startsWith("#") || /^(javascript|mailto|tel|data|blob):/i.test(h)) return "";
  try {
    const u = new URL(h, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    u.hash = "";
    return u.href;
  } catch {
    return "";
  }
}
function rebaseToSite(url, baseUrl) {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    if (u.hostname !== b.hostname && siteLabel(u.hostname) === siteLabel(b.hostname)) {
      u.hostname = b.hostname;
      u.protocol = b.protocol;
      u.port = b.port;
      return u.href;
    }
    return url;
  } catch {
    return url;
  }
}
var NON_DETAIL_PATH = /^\/(page\/\d+|category|categories|tag|tags|genre|genres|year|years|quality|qualities|author|search|feed|comments|wp-[a-z]+|how-to-download|dmca|contact|contact-us|about|about-us|privacy-policy|disclaimer|request|telegram|join|login|register|sitemap)(\/|$)/i;
function isDetailUrl(url, baseUrl) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (!isSameSite(url, baseUrl)) return false;
  const path2 = u.pathname.replace(/\/+$/, "");
  if (!path2) return false;
  if (/(^|&)s=/.test(u.search.replace(/^\?/, ""))) return false;
  if (NON_DETAIL_PATH.test(path2)) return false;
  if (/\.(jpe?g|png|gif|webp|svg|css|js|ico|xml|txt|json|php|zip|rar)$/i.test(path2)) return false;
  return true;
}
var FALLBACK_POSTER = "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=500&auto=format&fit=crop&q=60";
var CARD_SELECTORS = "article, .item, .movies-item, .post, .box, .search-item";
function pickDetailLink($, el, baseUrl) {
  const $el = $(el);
  const groups = [
    "a[rel~=bookmark]",
    "h1 a, h2 a, h3 a, h4 a, .title a, a.title, .entry-title a, .post-title a, .movie-title a",
    "a:has(img)",
    "a"
  ];
  for (const sel of groups) {
    const anchors = $el.find(sel).toArray();
    for (const a of anchors) {
      const url = resolveUrl($(a).attr("href"), baseUrl);
      if (url && isDetailUrl(url, baseUrl)) {
        return { url, text: $(a).text().replace(/\s+/g, " ").trim() };
      }
    }
  }
  return null;
}
function parseListingPage(html, baseUrl, pageNum) {
  const $ = cheerio.load(html);
  const movies = [];
  const seenUrls = /* @__PURE__ */ new Set();
  const push = (m) => {
    if (seenUrls.has(m.detail_url)) return;
    if (movies.some((x) => x.title.toLowerCase() === m.title.toLowerCase())) return;
    seenUrls.add(m.detail_url);
    movies.push(m);
  };
  $(CARD_SELECTORS).each((_, el) => {
    const $el = $(el);
    const link = pickDetailLink($, el, baseUrl);
    if (!link) return;
    let title = $el.find("h2, h3, .title, a.title, .movie-title, h1").first().text().trim();
    if (!title) title = $el.find("img").first().attr("alt") || $el.find("a[title]").first().attr("title") || link.text || "";
    title = title.replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;
    const $img = $el.find("img").first();
    let posterUrl = resolveUrl($img.attr("data-src") || $img.attr("data-lazy-src") || $img.attr("src"), baseUrl);
    let quality = $el.find(".quality, .rip, .badge, .quality-tag, span.quality").text().trim();
    if (!quality) {
      const m = $el.text().match(/(WEB-DL|HDRip|BluRay|CAM|HD|4K|1080p|720p)/i);
      quality = m ? m[0] : "Web-DL";
    }
    let releaseYear = $el.find(".year, .date").text().trim();
    const yearRe = /\b(19\d\d|20\d\d)\b/;
    if (!releaseYear) {
      const m = title.match(yearRe) || $el.text().match(yearRe);
      releaseYear = m ? m[1] : "2024";
    } else {
      const m = releaseYear.match(yearRe);
      releaseYear = m ? m[1] : "2024";
    }
    title = title.replace(/\(\d{4}\)/, "").replace(/\s+/g, " ").trim();
    if (!title) return;
    push({
      title,
      release_year: releaseYear,
      quality: quality.toUpperCase(),
      poster_url: posterUrl || FALLBACK_POSTER,
      detail_url: link.url,
      page_num: pageNum
    });
  });
  if (movies.length === 0) {
    $("a").each((_, el) => {
      const $a = $(el);
      const url = resolveUrl($a.attr("href"), baseUrl);
      const $img = $a.find("img").first();
      const text = ($a.text().trim() || $img.attr("alt") || $a.attr("title") || "").replace(/\s+/g, " ").trim();
      if (!url || !isDetailUrl(url, baseUrl) || $img.length === 0 || text.length < 3) return;
      const yearMatch = text.match(/\b(19\d\d|20\d\d)\b/);
      push({
        title: text.replace(/\(\d{4}\)/, "").trim(),
        release_year: yearMatch ? yearMatch[1] : "2024",
        quality: "WEB-DL",
        poster_url: resolveUrl($img.attr("data-src") || $img.attr("src"), baseUrl) || FALLBACK_POSTER,
        detail_url: url,
        page_num: pageNum
      });
    });
  }
  return movies;
}
var STOP = /* @__PURE__ */ new Set(["the", "a", "an", "of", "and", "in", "on", "to", "full", "movie", "hindi", "dual", "audio", "web", "dl", "org"]);
function titleTokens(t) {
  return (t || "").toLowerCase().replace(/\b(480p|720p|1080p|2160p|4k|hdr|hdrip|web-dl|webrip|bluray|cam|hd|hindi|english|dual audio|multi audio|dubbed|full movie|batch|zip)\b/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w));
}
function scoreTitleMatch(wanted, candidate) {
  const w = titleTokens(wanted);
  if (w.length === 0) return 0;
  const c = new Set(titleTokens(candidate));
  const hit = w.filter((x) => c.has(x)).length;
  let score = hit / w.length;
  const extra = Math.max(0, c.size - w.length);
  score -= Math.min(0.2, extra * 0.03);
  return Math.max(0, Math.min(1, score));
}
function pickBestMatch(wantedTitle, wantedYear, candidates, minScore = 0.6) {
  let best = null;
  for (const c of candidates) {
    let s = scoreTitleMatch(wantedTitle, c.title);
    if (wantedYear && c.title.includes(wantedYear)) s += 0.05;
    if (s >= minScore && (!best || s > best.score)) best = { ...c, score: s };
  }
  return best;
}
var M4U_RE = /m4u-?links/i;
var FILE_HOST_RE = /hubcloud|gdflix|pixeldrain|hubdrive|hubcdn|gdtot|filepress|gofile\.io|drive\.google\.com|mega\.nz/i;
var IGNORED_HOST_RE = /(^|\.)(t\.me|telegram\.(me|org|dog)|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|youtu\.be|tinyurl\.com|bit\.ly|wa\.me|whatsapp\.com|gravatar\.com|wp\.com|wordpress\.org|schema\.org|w3\.org|googletagmanager\.com|google-analytics\.com|googleapis\.com|gstatic\.com|cloudflare\.com|disqus\.com)$/i;
var DOWNLOADISH_RE = /download|480p|720p|1080p|2160p|4k|links?\b|get\s+(it|file)|watch|episode|batch|zip/i;
var QUALITY_CTX_RE = /\b(480p|720p|1080p|2160p|4k)\b|season|episode|batch|zip/i;
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
var URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>\\)]+/gi;
function urlsOnElement($, el, base) {
  const $el = $(el);
  const out = [];
  const attrs = ["href", "data-href", "data-url", "data-link", "data-redirect", "data-target-url", "data-src-url"];
  for (const a of attrs) {
    const u = resolveUrl($el.attr(a), base);
    if (u) out.push(u);
  }
  const onclick = $el.attr("onclick") || "";
  for (const m of onclick.match(URL_IN_TEXT_RE) || []) {
    const u = resolveUrl(m.replace(/['"]+$/, ""), base);
    if (u) out.push(u);
  }
  return out;
}
function contextHeaderFor($, el, ownText = "") {
  const clean = (s) => s.replace(/\s+/g, " ").trim();
  if (QUALITY_CTX_RE.test(ownText)) return clean(ownText);
  const sel = "h1, h2, h3, h4, h5, h6, p, strong, b, div.badge, div.alert, span";
  let first = "";
  let node = $(el);
  for (let depth = 0; depth < 6 && node.length; depth++) {
    const prevs = node.prevAll(sel).toArray();
    for (const p of prevs) {
      const t = clean($(p).text());
      if (!t) continue;
      if (QUALITY_CTX_RE.test(t)) return t.slice(0, 300);
      if (!first) first = t.slice(0, 300);
    }
    node = node.parent();
  }
  return first;
}
function contentRoot($) {
  const root = $("article .entry-content, .entry-content, .post-content, .single-content, article, main, #content, .content").filter((_, e) => $(e).find("a").length > 0).first();
  return root.length ? root : $("body");
}
function dedupe(list) {
  const seen = /* @__PURE__ */ new Set();
  return list.filter((l) => seen.has(l.url) ? false : (seen.add(l.url), true));
}
function urlsFromRawHtml(html) {
  const out = /* @__PURE__ */ new Set();
  const unescaped = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  for (const m2 of unescaped.match(URL_IN_TEXT_RE) || []) out.add(m2.replace(/[.,;'"]+$/, ""));
  const b64 = /atob\(\s*["']([A-Za-z0-9+/=_-]{16,})["']\s*\)/g;
  let m;
  while (m = b64.exec(html)) {
    try {
      const dec = Buffer.from(m[1], "base64").toString("utf8");
      for (const u of dec.match(URL_IN_TEXT_RE) || []) out.add(u);
    } catch {
    }
  }
  return [...out];
}
function collect($, html, pageUrl, accept, scope, allowRawFallback = true) {
  const found = [];
  const anchors = (scope ? scope.find("a, button, [data-href], [data-url], [data-link], [onclick]") : $("a, button, [data-href], [data-url], [data-link], [onclick]")).toArray();
  for (const el of anchors) {
    const $el = $(el);
    if ($el.closest("nav, footer, aside, #comments, .comments, .sidebar, .widget").length) continue;
    const text = $el.text().replace(/\s+/g, " ").trim();
    for (const url of urlsOnElement($, el, pageUrl)) {
      if (!accept(url)) continue;
      const isZip = $el.hasClass("btn-zip") || /zip|batch/i.test(text) || /zip|batch/i.test(url);
      found.push({ url, text, header: contextHeaderFor($, el, text), isZip });
    }
  }
  if (found.length === 0 && allowRawFallback) {
    const $c = cheerio.load(html);
    $c("nav, footer, aside, #comments, .comments, .sidebar, .widget").remove();
    for (const raw of urlsFromRawHtml($c.html())) {
      const url = resolveUrl(raw, pageUrl);
      if (url && accept(url)) found.push({ url, text: "", header: "", isZip: /zip|batch/i.test(url) });
    }
  }
  return dedupe(found);
}
function findM4uLinks($, html, pageUrl) {
  return collect($, html, pageUrl, (u) => M4U_RE.test(u) && !isSameSite(u, pageUrl));
}
function findFileLinks($, html, pageUrl) {
  return collect($, html, pageUrl, (u) => FILE_HOST_RE.test(hostOf(u)) || /pixeldrain\.(com|dev)/i.test(u));
}
function findExternalDownloadCandidates($, pageUrl) {
  const found = [];
  const root = contentRoot($);
  root.find("a").each((_, el) => {
    const $el = $(el);
    if ($el.closest("header, footer, nav, aside, .sidebar, #comments, .comments, .related, .widget").length) return;
    const text = $el.text().replace(/\s+/g, " ").trim();
    const url = resolveUrl($el.attr("href"), pageUrl);
    if (!url || isSameSite(url, pageUrl)) return;
    const host = hostOf(url);
    if (IGNORED_HOST_RE.test(host) || FILE_HOST_RE.test(host)) return;
    if (!DOWNLOADISH_RE.test(text) && !DOWNLOADISH_RE.test(contextHeaderFor($, el))) return;
    found.push({ url, text, header: contextHeaderFor($, el, text), isZip: /zip|batch/i.test(text) });
  });
  return dedupe(found);
}
function findRedirect(html, pageUrl) {
  const meta = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i);
  if (meta) {
    const u = resolveUrl(meta[1], pageUrl);
    if (u) return u;
  }
  const js = html.match(/(?:window\.)?location(?:\.href)?\s*(?:=|\.replace\(|\.assign\()\s*["']([^"']+)["']/i);
  if (js) {
    const u = resolveUrl(js[1], pageUrl);
    if (u && u !== pageUrl) return u;
  }
  return "";
}
function isChallengePage(html) {
  return /<title>\s*(just a moment|attention required|access denied|checking your browser)/i.test(html) || /cf-browser-verification|challenge-platform|cf_chl_opt/i.test(html);
}
function sampleExternalLinks($, pageUrl, limit = 12) {
  const out = [];
  $("a").each((_, el) => {
    const u = resolveUrl($(el).attr("href"), pageUrl);
    if (u && !out.includes(u)) out.push(u);
  });
  return out.slice(0, limit);
}
function qualityFromContext(ctx) {
  if (/2160p|4k/i.test(ctx)) return "4K / 2160P";
  if (/1080p/i.test(ctx)) return "1080P";
  if (/720p/i.test(ctx)) return "720P";
  if (/480p/i.test(ctx)) return "480P";
  return "General";
}

// src/seenLinks.ts
var import_express = __toESM(require("express"), 1);
var seenLinksRouter = import_express.default.Router();
seenLinksRouter.get("/", async (req, res) => {
  try {
    const col = getSeenLinksCollection();
    const docs = await col.find({}).toArray();
    const links = docs.map((d) => d.url);
    const last_updated = docs.length > 0 ? docs[docs.length - 1].last_updated || /* @__PURE__ */ new Date() : /* @__PURE__ */ new Date();
    res.json({
      success: true,
      links,
      count: links.length,
      last_updated: new Date(last_updated).toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
seenLinksRouter.post("/", async (req, res) => {
  const { link } = req.body;
  if (typeof link !== "string" || !link.trim()) {
    return res.status(400).json({ success: false, error: "Invalid link" });
  }
  const trimmed = link.trim();
  try {
    const col = getSeenLinksCollection();
    await col.updateOne(
      { url: trimmed },
      { $set: { url: trimmed, last_updated: /* @__PURE__ */ new Date() } },
      { upsert: true }
    );
    const count = await col.countDocuments();
    res.json({
      success: true,
      message: "Link added",
      link: trimmed,
      count,
      last_updated: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
seenLinksRouter.delete("/", async (req, res) => {
  try {
    const col = getSeenLinksCollection();
    await col.deleteMany({});
    res.json({ success: true, message: "All seen links cleared" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
var seenLinks_default = seenLinksRouter;

// server.ts
var app = (0, import_express2.default)();
app.use(import_express2.default.json());
var DEFAULT_PORT = Number(process.env.PORT) || 3e3;
var BASE_URL = process.env.SITE_URL || "https://new2.movies4u.garden/";
var isScraping = false;
var scrapingStatus = {
  fullScrape: { message: "Idle", progress: 0 },
  monitoring: { message: "Idle", progress: 0 }
};
var currentFullScrapePage = 1;
var isFullScrapeDone = false;
var processingTitles = /* @__PURE__ */ new Set();
app.post("/api/scraper/toggle", (req, res) => {
  isScraping = !isScraping;
  scrapingStatus = {
    fullScrape: { message: isScraping ? "Idle" : "Idle", progress: 0 },
    monitoring: { message: isScraping ? "Idle" : "Idle", progress: 0 }
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
function cleanMovieTitle(rawTitle) {
  let t = rawTitle || "";
  t = t.replace(/\b(480p|720p|1080p|2160p|4k|hdr|hdrip|web-dl|bluray|cam|hd|hindi|english|dual audio|multi audio|org\.?|dubbed|full movie|batch|zip|uplay)\b/gi, "");
  t = t.replace(/[\(\[\{\}\|]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[\-\s]+$/, "").trim();
  return t.toLowerCase() || rawTitle.toLowerCase().trim();
}
async function processMovies(scraped, isMonitoring = false) {
  for (const m of scraped) {
    if (!isScraping) break;
    const normalizedTitle = m.title.replace(/\s+/g, " ").trim();
    const cleanedTitle = cleanMovieTitle(normalizedTitle);
    const pageNum = m.page_num || currentFullScrapePage;
    if (!isMonitoring) {
      scrapingStatus.fullScrape = {
        message: `Processing Page ${pageNum}: ${normalizedTitle}`,
        progress: Math.min(95, pageNum * 5)
      };
    } else {
      scrapingStatus.monitoring = {
        message: `Adding: ${normalizedTitle}`,
        progress: 50
      };
    }
    if (processingTitles.has(normalizedTitle) || processingTitles.has(cleanedTitle)) continue;
    if (!isDetailUrl(m.detail_url, BASE_URL)) {
      console.warn(`[scrape] Skipping "${normalizedTitle}": no valid detail URL (got "${m.detail_url}")`);
      continue;
    }
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
          detail_url: m.detail_url,
          links,
          page_num: pageNum,
          scraped_at: (/* @__PURE__ */ new Date()).toISOString(),
          priority: 0
        });
      } catch (e) {
        console.error(`Failed to scrape details for ${normalizedTitle}:`, e);
      } finally {
        processingTitles.delete(normalizedTitle);
        processingTitles.delete(cleanedTitle);
      }
    } else {
      processingTitles.add(normalizedTitle);
      processingTitles.add(cleanedTitle);
      try {
        const links = await scrapeMovieDetail(m.detail_url);
        const existingLinksStr = JSON.stringify(exists.links || []);
        const newLinksStr = JSON.stringify(links);
        if (!isDetailUrl(exists.detail_url, BASE_URL)) {
          await moviesCol.updateOne({ _id: exists._id }, { $set: { detail_url: m.detail_url } });
        }
        if (links.length > 0 && newLinksStr !== existingLinksStr) {
          if (!isMonitoring) {
            scrapingStatus.fullScrape = {
              message: `Updating New Episodes/Links for Page ${pageNum}: ${normalizedTitle}`,
              progress: Math.min(95, pageNum * 5)
            };
          }
          await moviesCol.updateOne(
            { _id: exists._id },
            {
              $set: {
                links,
                quality: m.quality || exists.quality,
                poster_url: m.poster_url || exists.poster_url,
                scraped_at: (/* @__PURE__ */ new Date()).toISOString()
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
          scrapingStatus.fullScrape = {
            message: "Full Scrape Done.",
            progress: 100
          };
          await new Promise((r) => setTimeout(r, 6e4));
          continue;
        }
        scrapingStatus.fullScrape = {
          message: `Full Scrape: Scraping Page ${currentFullScrapePage}...`,
          progress: Math.min(90, currentFullScrapePage * 10)
        };
        const scraped = await scrapePage(currentFullScrapePage);
        if (scraped.length === 0) {
          isFullScrapeDone = true;
          scrapingStatus.fullScrape = {
            message: "Full Scrape Done.",
            progress: 100
          };
        } else {
          scrapingStatus.fullScrape = {
            message: `Full Scrape: Processing Page ${currentFullScrapePage} (${scraped.length} items)`,
            progress: Math.min(90, currentFullScrapePage * 10)
          };
          await processMovies(scraped, false);
          currentFullScrapePage++;
        }
      } catch (e) {
        console.error("Error in full scrape:", e);
        scrapingStatus.fullScrape = { message: `Error: ${e}`, progress: 0 };
        await new Promise((r) => setTimeout(r, 6e4));
      }
    }
    await new Promise((r) => setTimeout(r, 5e3));
  }
}
async function runMonitoringLoop() {
  while (true) {
    if (isScraping) {
      try {
        scrapingStatus.monitoring = {
          message: "Monitoring Page 1...",
          progress: 100
        };
        const scraped = await scrapePage(1);
        await processMovies(scraped, true);
        scrapingStatus.monitoring = {
          message: "Monitoring (Waiting for next check)...",
          progress: 100
        };
      } catch (e) {
        console.error("Error in monitoring scrape:", e);
        scrapingStatus.monitoring = { message: `Error: ${e}`, progress: 0 };
      }
    } else {
      scrapingStatus.monitoring = { message: "Idle", progress: 0 };
    }
    await new Promise((r) => setTimeout(r, 6e4));
  }
}
async function startContinuousScraping() {
  console.log("Continuous scraping engine initialized.");
  runFullScrapeLoop();
  runMonitoringLoop();
}
async function getCounterCol() {
  return getCountersCollection();
}
async function initCounter() {
  try {
    const counterCol = await getCounterCol();
    const exists = await counterCol.findOne({ _id: "movieId" });
    if (!exists) {
      const moviesCol = getMoviesCollection();
      const maxMovie = await moviesCol.findOne({}, { sort: { id: -1 } });
      const maxId = maxMovie && typeof maxMovie.id === "number" ? maxMovie.id : 0;
      await counterCol.updateOne(
        { _id: "movieId" },
        { $set: { seq: maxId } },
        { upsert: true }
      );
      console.log(`Initialized movieId counter to ${maxId}`);
    }
  } catch (err) {
    console.error("Failed to initialize movie counter:", err);
  }
}
async function getNextMovieId() {
  const counterCol = await getCounterCol();
  const result = await counterCol.findOneAndUpdate(
    { _id: "movieId" },
    { $inc: { seq: 1 } },
    { returnDocument: "after", upsert: true }
  );
  return result && typeof result.seq === "number" ? result.seq : Date.now();
}
var hubOptionsCache = /* @__PURE__ */ new Map();
async function resolveHubCloudDirectLinks(hubUrl, preferredServer = "pixeldrain") {
  try {
    let opts = hubOptionsCache.get(hubUrl);
    if (!opts) {
      opts = { hubUrl };
      const hubResponse = await fetchWithRetry(hubUrl, {}, 2, false);
      const html = await hubResponse.text();
      const $ = cheerio2.load(html);
      const pxlDirectMatch = html.match(/var\s+pxl\s*=\s*["']([^"']+)["']/);
      if (pxlDirectMatch && pxlDirectMatch[1]) {
        opts.pixeldrain = pxlDirectMatch[1].replace("/u/", "/api/file/");
      }
      if (!opts.pixeldrain) {
        $("a").each((_, a) => {
          const href = $(a).attr("href") || "";
          if (/pixeldrain\.(com|dev)/i.test(href)) {
            opts.pixeldrain = href.replace("/u/", "/api/file/");
          }
        });
      }
      const $generateBtn = $(
        "#download, a:contains('Generate Direct Download Link'), a:contains('Generate'), a:contains('Go to download')"
      );
      let rawGenUrl = $generateBtn.attr("href");
      if (rawGenUrl) {
        const genUrl = rawGenUrl.startsWith("http") ? rawGenUrl : new URL(rawGenUrl, hubUrl).href;
        const genRes = await fetchWithRetry(genUrl, { headers: { Referer: hubUrl } }, 2, false);
        if (genRes.ok) {
          const genHtml = await genRes.text();
          const $g = cheerio2.load(genHtml);
          if (!opts.pixeldrain) {
            const pxlGenMatch = genHtml.match(/var\s+pxl\s*=\s*["']([^"']+)["']/);
            if (pxlGenMatch && pxlGenMatch[1]) {
              opts.pixeldrain = pxlGenMatch[1].replace("/u/", "/api/file/");
            }
          }
          $g("a").each((_, a) => {
            const text = $g(a).text().trim();
            const href = $g(a).attr("href") || "";
            if (href.startsWith("http") && !href.includes("google.com") && !href.includes("t.me") && !href.includes("tinyurl") && !href.includes("one.one.one.one")) {
              if (/pixeldrain\.(com|dev)/i.test(href) && !opts.pixeldrain) {
                opts.pixeldrain = href.replace("/u/", "/api/file/");
              } else if (!opts.fsl && (/FSL Server|Cloudflare|r2\.cloudflarestorage/i.test(text) || href.includes("r2.cloudflarestorage.com"))) {
                opts.fsl = href;
              } else if (!opts.tenGbps && (/10Gbps|gpdl\.hubcloud/i.test(text) || href.includes("gpdl.hubcloud"))) {
                opts.tenGbps = href;
              } else if (!opts.direct && /Fast Server|Direct Download|Download Server/i.test(text)) {
                opts.direct = { text: text || "Direct Server", url: href };
              }
            }
          });
        }
      }
      hubOptionsCache.set(hubUrl, opts);
    }
    const allAlts = [];
    if (opts.pixeldrain) allAlts.push({ text: "Pixeldrain", url: opts.pixeldrain });
    if (opts.fsl) allAlts.push({ text: "FSL Server", url: opts.fsl });
    if (opts.tenGbps) allAlts.push({ text: "10Gbps Server", url: opts.tenGbps });
    if (opts.direct) allAlts.push({ text: opts.direct.text, url: opts.direct.url });
    allAlts.push({ text: "HubCloud DD", url: hubUrl });
    const pref = (preferredServer || "pixeldrain").toLowerCase();
    let selected = null;
    if (pref.includes("fsl") && opts.fsl) {
      selected = { text: "FSL Server", url: opts.fsl };
    } else if (pref.includes("10g") && opts.tenGbps) {
      selected = { text: "10Gbps Server", url: opts.tenGbps };
    } else if (pref.includes("hub") && hubUrl) {
      selected = { text: "HubCloud DD", url: hubUrl };
    } else if (pref.includes("pixel") && opts.pixeldrain) {
      selected = { text: "Pixeldrain", url: opts.pixeldrain };
    }
    if (!selected) {
      if (opts.pixeldrain) selected = { text: "Pixeldrain", url: opts.pixeldrain };
      else if (opts.fsl) selected = { text: "FSL Server", url: opts.fsl };
      else if (opts.tenGbps) selected = { text: "10Gbps Server", url: opts.tenGbps };
      else if (opts.direct) selected = { text: opts.direct.text, url: opts.direct.url };
      else selected = { text: "HubCloud DD", url: hubUrl };
    }
    return [{ ...selected, alternatives: allAlts }];
  } catch (err) {
    console.error(`Failed to resolve direct links for HubCloud ${hubUrl}:`, err);
    return [{ text: "HubCloud DD", url: hubUrl, alternatives: [{ text: "HubCloud DD", url: hubUrl }] }];
  }
}
async function fetchPage(url, referer) {
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...referer ? { Referer: referer } : {}
      }
    },
    2,
    false
  );
  return { html: await res.text(), finalUrl: res.url || url };
}
async function loadIntermediate(url, referer) {
  let current = url;
  let from = referer;
  let pageTitle = "";
  for (let hop = 0; hop <= 2; hop++) {
    const { html, finalUrl } = await fetchPage(current, from);
    const $ = cheerio2.load(html);
    if (hop === 0) pageTitle = $("title").text().trim();
    if (isChallengePage(html)) console.warn(`[scrape] ${current} returned an anti-bot challenge page`);
    const files = findFileLinks($, html, finalUrl);
    if (files.length > 0) return { files, pageTitle };
    const next = findRedirect(html, finalUrl);
    if (!next || next === current) break;
    from = finalUrl;
    current = next;
  }
  return { files: [], pageTitle };
}
async function scrapeMovieDetail(detailUrl, preferredServer = "pixeldrain") {
  const qualityGroups = /* @__PURE__ */ new Map();
  const pref = (preferredServer || "pixeldrain").toLowerCase();
  const getScore = (label) => {
    const t = label.toLowerCase();
    if (pref.includes("fsl") && (t.includes("fsl") || t.includes("direct"))) return 100;
    if (pref.includes("10g") && t.includes("10gbps")) return 100;
    if (pref.includes("pixel") && t.includes("pixel")) return 100;
    if (pref.includes("gdflix") && t.includes("gdflix")) return 100;
    if (pref.includes("hub") && t.includes("hub")) return 100;
    if (t.includes("pixel")) return 90;
    if (t.includes("fsl") || t.includes("r2")) return 80;
    if (t.includes("10gbps") || t.includes("10g")) return 70;
    if (t.includes("direct")) return 60;
    if (t.includes("hub")) return 50;
    return 10;
  };
  function addLink(quality, text, url, alternatives = []) {
    if (!url) return;
    const cleanQ = quality.trim() || "General";
    if (!qualityGroups.has(cleanQ)) {
      qualityGroups.set(cleanQ, []);
    }
    const group = qualityGroups.get(cleanQ);
    const epMatch = text.match(/^(Ep\s*\d+|Batch\s*Zip)/i);
    if (epMatch) {
      const epPrefix = epMatch[1].toLowerCase();
      const existingIdx = group.findIndex((l) => l.text.toLowerCase().startsWith(epPrefix));
      if (existingIdx !== -1) {
        const existing = group[existingIdx];
        const mergedAlts = [
          ...existing.alternatives || [{ text: existing.text, url: existing.url }],
          ...alternatives || [],
          { text, url }
        ].filter((a, idx, arr) => arr.findIndex((x) => x.url === a.url) === idx);
        if (getScore(text) > getScore(existing.text)) {
          group[existingIdx] = { text, url, alternatives: mergedAlts };
        } else {
          group[existingIdx].alternatives = mergedAlts;
        }
        return;
      }
    } else {
      if (group.length > 0) {
        const existing = group[0];
        const mergedAlts = [
          ...existing.alternatives || [{ text: existing.text, url: existing.url }],
          ...alternatives || [],
          { text, url }
        ].filter((a, idx, arr) => arr.findIndex((x) => x.url === a.url) === idx);
        if (getScore(text) > getScore(existing.text)) {
          group[0] = { text, url, alternatives: mergedAlts };
        } else {
          group[0].alternatives = mergedAlts;
        }
        return;
      }
    }
    const initialAlts = alternatives.length > 0 ? alternatives : [{ text, url }];
    group.push({ text, url, alternatives: initialAlts });
  }
  try {
    if (!isDetailUrl(detailUrl, BASE_URL)) {
      throw new Error(
        `"${detailUrl}" is not a movie detail page (homepage, listing or foreign URL) - refusing to scrape it`
      );
    }
    const { html, finalUrl } = await fetchPage(detailUrl);
    console.log(`[DEBUG] Scraped detail page: ${detailUrl}, HTML length: ${html.length}`);
    if (isChallengePage(html)) {
      console.warn(`[scrape] ${detailUrl} returned an anti-bot challenge page - links cannot be read from it`);
    }
    const $main = cheerio2.load(html);
    const m4uFound = findM4uLinks($main, html, finalUrl);
    console.log(`[DEBUG] Total unique m4ulinks found: ${m4uFound.length}`);
    const directFiles = m4uFound.length === 0 ? findFileLinks($main, html, finalUrl) : [];
    let intermediates = m4uFound.map((f) => ({
      url: f.url,
      contextHeader: f.header || f.text,
      label: "M4ULinks"
    }));
    if (m4uFound.length === 0 && directFiles.length === 0) {
      const generic = findExternalDownloadCandidates($main, finalUrl);
      console.log(`[DEBUG] No m4ulinks or direct file links; generic external download candidates: ${generic.length}`);
      if (generic.length === 0) {
        console.log("[DEBUG] Sample links on page:", sampleExternalLinks($main, finalUrl));
      }
      intermediates = generic.map((f) => ({
        url: f.url,
        contextHeader: f.header || f.text,
        label: new URL(f.url).hostname.replace(/^www\./, "")
      }));
    }
    const processFiles = async (files, ctxHeader, pageTitle) => {
      const sections = [];
      for (const f of files) {
        const href = f.url;
        let header = f.header.replace(/\s+/g, " ").trim();
        if (!header) header = ctxHeader || pageTitle || "Download";
        let sec = sections.find((s) => s.headerText === header);
        if (!sec) {
          sec = { headerText: header, isZipBatch: f.isZip };
          sections.push(sec);
        }
        if (/pixeldrain/i.test(href)) sec.pixeldrainUrl = href;
        else if (/hubcloud/i.test(href)) sec.hubCloudUrl = href;
        else if (/gdflix/i.test(href)) sec.gdFlixUrl = href;
        else if (!sec.otherUrl) sec.otherUrl = { url: href, host: new URL(href).hostname.replace(/^www\./, "") };
      }
      for (const sec of sections) {
        const quality = qualityFromContext(`${ctxHeader} ${pageTitle} ${sec.headerText}`);
        let labelPrefix = "";
        const epMatch = sec.headerText.match(/episode[s\s:]*(\d+)/i) || sec.headerText.match(/ep[s\s:]*(\d+)/i);
        if (epMatch) {
          labelPrefix = `Ep ${epMatch[1].padStart(2, "0")}`;
        } else if (sec.isZipBatch || /batch|zip/i.test(sec.headerText)) {
          labelPrefix = "Batch Zip";
        }
        const secAlts = [];
        if (sec.pixeldrainUrl) {
          secAlts.push({
            text: labelPrefix ? `${labelPrefix} (Pixeldrain)` : "Pixeldrain",
            url: sec.pixeldrainUrl.replace("/u/", "/api/file/")
          });
        }
        if (sec.gdFlixUrl) {
          secAlts.push({
            text: labelPrefix ? `${labelPrefix} (GDFlix)` : "GDFlix",
            url: sec.gdFlixUrl
          });
        }
        let resolvedSuccess = false;
        if (pref.includes("gdflix") && sec.gdFlixUrl) {
          resolvedSuccess = true;
          addLink(quality, labelPrefix ? `${labelPrefix} (GDFlix)` : "GDFlix", sec.gdFlixUrl, secAlts);
        } else if (pref.includes("pixel") && sec.pixeldrainUrl) {
          resolvedSuccess = true;
          const cleanPxl = sec.pixeldrainUrl.replace("/u/", "/api/file/");
          addLink(quality, labelPrefix ? `${labelPrefix} (Pixeldrain)` : "Pixeldrain", cleanPxl, secAlts);
        } else if (sec.hubCloudUrl) {
          const directLinks = await resolveHubCloudDirectLinks(sec.hubCloudUrl, preferredServer);
          if (directLinks.length > 0) {
            resolvedSuccess = true;
            const dl = directLinks[0];
            const finalLabel = labelPrefix ? `${labelPrefix} (${dl.text})` : dl.text;
            const combinedAlts = [
              ...secAlts,
              ...(dl.alternatives || []).map((a) => ({
                text: labelPrefix ? `${labelPrefix} (${a.text})` : a.text,
                url: a.url
              }))
            ].filter((a, idx, arr) => arr.findIndex((x) => x.url === a.url) === idx);
            addLink(quality, finalLabel, dl.url, combinedAlts);
          }
        } else if (sec.pixeldrainUrl) {
          resolvedSuccess = true;
          const cleanPxl = sec.pixeldrainUrl.replace("/u/", "/api/file/");
          addLink(quality, labelPrefix ? `${labelPrefix} (Pixeldrain)` : "Pixeldrain", cleanPxl, secAlts);
        }
        if (!resolvedSuccess && sec.gdFlixUrl) {
          resolvedSuccess = true;
          addLink(quality, labelPrefix ? `${labelPrefix} (GDFlix)` : "GDFlix", sec.gdFlixUrl, secAlts);
        }
        if (!resolvedSuccess && sec.otherUrl) {
          const t = labelPrefix ? `${labelPrefix} (${sec.otherUrl.host})` : sec.otherUrl.host;
          addLink(quality, t, sec.otherUrl.url, [{ text: t, url: sec.otherUrl.url }]);
        }
      }
    };
    if (intermediates.length > 0) {
      for (const entry of intermediates) {
        try {
          console.log(`Scraping ${entry.label} page: ${entry.url}`);
          const { files, pageTitle } = await loadIntermediate(entry.url, finalUrl);
          if (files.length > 0) {
            await processFiles(files, entry.contextHeader, pageTitle);
          } else {
            console.warn(`[scrape] No file-host links readable on ${entry.url}; keeping the link itself`);
            const quality = qualityFromContext(`${entry.contextHeader} ${pageTitle}`);
            addLink(quality, entry.label, entry.url, [{ text: entry.label, url: entry.url }]);
          }
        } catch (e) {
          console.error(`Error scraping ${entry.label} page ${entry.url}:`, e);
        }
      }
    } else if (directFiles.length > 0) {
      await processFiles(directFiles, "", $main("title").text().trim());
    } else {
      console.log(`No download links found on ${detailUrl}`);
    }
  } catch (err) {
    console.error(`Error scraping detail: ${detailUrl}`, err);
    throw err;
  }
  const links = [];
  qualityGroups.forEach((groupLinks, quality) => {
    links.push({ quality, links: groupLinks });
  });
  return links;
}
async function fetchWithRetry(url, options = {}, retries = 2, useProxy = false) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12e3);
      const fetchOptions = {
        ...options,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          ...options.headers
        },
        signal: controller.signal
      };
      if (useProxy) {
        try {
          const proxiesCol = getProxiesCollection();
          const randomProxyArr = await proxiesCol.aggregate([
            { $match: { latency: { $ne: null } } },
            { $sample: { size: 1 } }
          ]).toArray();
          const proxy = randomProxyArr[0];
          if (proxy) {
            fetchOptions.agent = new import_https_proxy_agent.HttpsProxyAgent(`http://${proxy.url}`);
          }
        } catch {
        }
      }
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeout);
      if (response.ok) return response;
      throw new Error(`HTTP error! status: ${response.status}`);
    } catch (e) {
      if (useProxy && i === 0) {
        useProxy = false;
        continue;
      }
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("Max retries exceeded");
}
async function fetchAndRefreshProxies() {
  console.log("Refreshing proxies...");
  try {
    const res = await fetch(
      "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all"
    );
    const text = await res.text();
    const proxies = text.split("\r\n").filter((p) => p.length > 5);
    if (proxies.length > 0) {
      const proxiesCol = getProxiesCollection();
      await proxiesCol.deleteMany({});
      const docs = proxies.map((url) => ({
        url: url.trim(),
        latency: null,
        last_checked: (/* @__PURE__ */ new Date()).toISOString()
      }));
      await proxiesCol.insertMany(docs, { ordered: false });
      console.log(
        `Successfully refreshed proxies. Overwrote DB with ${proxies.length} new proxies.`
      );
    }
  } catch (e) {
    console.error("Error fetching proxies:", e);
  }
}
async function testProxyLatency(proxyUrl) {
  const start = Date.now();
  try {
    const agent = new import_https_proxy_agent.HttpsProxyAgent(`http://${proxyUrl}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5e3);
    const res = await fetch("https://www.cloudflare.com", {
      // @ts-ignore
      agent,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const latency = Date.now() - start;
      await getProxiesCollection().updateOne(
        { url: proxyUrl },
        { $set: { latency, last_checked: (/* @__PURE__ */ new Date()).toISOString() } }
      );
      return latency;
    }
  } catch (e) {
    console.error(`Proxy test failed for ${proxyUrl}:`, e);
    await getProxiesCollection().updateOne(
      { url: proxyUrl },
      { $set: { latency: null, last_checked: (/* @__PURE__ */ new Date()).toISOString() } }
    );
  }
  return null;
}
setInterval(fetchAndRefreshProxies, 5 * 60 * 1e3);
async function scrapePage(pageNum) {
  const url = pageNum === 1 ? BASE_URL : `${BASE_URL.replace(/\/$/, "")}/page/${pageNum}/`;
  const response = await fetchWithRetry(url, {}, 2, true);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch page ${pageNum}: HTTP ${response.status} ${response.statusText}`
    );
  }
  const html = await response.text();
  const movies = parseListingPage(html, response.url || url, pageNum);
  console.log(`[DEBUG] Listing page ${pageNum}: ${movies.length} movies with valid detail URLs`);
  if (movies.length === 0 && isChallengePage(html)) {
    console.warn(`[scrape] Listing page ${pageNum} returned an anti-bot challenge page`);
  }
  return movies;
}
function deduplicateMovieLinks(linksRaw, preferredServer = "pixeldrain") {
  let groups = [];
  try {
    groups = typeof linksRaw === "string" ? JSON.parse(linksRaw) : linksRaw;
  } catch {
    return "[]";
  }
  if (!Array.isArray(groups)) return "[]";
  const result = [];
  const pref = (preferredServer || "pixeldrain").toLowerCase();
  const getScore = (label) => {
    const t = (label || "").toLowerCase();
    if (pref.includes("fsl") && (t.includes("fsl") || t.includes("direct"))) return 100;
    if (pref.includes("10g") && t.includes("10gbps")) return 100;
    if (pref.includes("pixel") && t.includes("pixel")) return 100;
    if (pref.includes("gdflix") && t.includes("gdflix")) return 100;
    if (pref.includes("hub") && t.includes("hub")) return 100;
    if (t.includes("pixel")) return 90;
    if (t.includes("fsl") || t.includes("r2")) return 80;
    if (t.includes("10gbps") || t.includes("10g")) return 70;
    if (t.includes("direct")) return 60;
    if (t.includes("hub")) return 50;
    return 10;
  };
  for (const g of groups) {
    if (!g || !Array.isArray(g.links)) continue;
    const epMap = /* @__PURE__ */ new Map();
    let movieLink = null;
    for (const link of g.links) {
      if (!link || !link.url) continue;
      const epMatch = link.text.match(/^(Ep\s*\d+|Batch\s*Zip)/i);
      if (epMatch) {
        const epKey = epMatch[1].toLowerCase();
        const existing = epMap.get(epKey);
        const mergedAlts = [
          ...existing?.alternatives || (existing ? [{ text: existing.text, url: existing.url }] : []),
          ...link.alternatives || [],
          { text: link.text, url: link.url }
        ].filter((a, idx, arr) => arr.findIndex((x) => x.url === a.url) === idx);
        if (!existing || getScore(link.text) > getScore(existing.text)) {
          epMap.set(epKey, { ...link, alternatives: mergedAlts });
        } else {
          epMap.set(epKey, { ...existing, alternatives: mergedAlts });
        }
      } else {
        const mergedAlts = [
          ...movieLink?.alternatives || (movieLink ? [{ text: movieLink.text, url: movieLink.url }] : []),
          ...link.alternatives || [],
          { text: link.text, url: link.url }
        ].filter((a, idx, arr) => arr.findIndex((x) => x.url === a.url) === idx);
        if (!movieLink || getScore(link.text) > getScore(movieLink.text)) {
          movieLink = { ...link, alternatives: mergedAlts };
        } else {
          movieLink = { ...movieLink, alternatives: mergedAlts };
        }
      }
    }
    const cleanLinks = [];
    if (movieLink) {
      cleanLinks.push(movieLink);
    }
    epMap.forEach((val) => cleanLinks.push(val));
    if (cleanLinks.length > 0) {
      result.push({
        quality: g.quality,
        links: cleanLinks
      });
    }
  }
  return JSON.stringify(result);
}
app.use("/api/seen-links", seenLinks_default);
app.get("/api/config", (req, res) => {
  res.json({ siteUrl: BASE_URL });
});
app.get("/api/movies", async (req, res) => {
  try {
    const { search, quality, pageMin, pageMax, pageNum, page, limit, preferredServer } = req.query;
    const pageFilter = parseInt(page) || 1;
    const limitFilter = parseInt(limit) || 30;
    const skip = (pageFilter - 1) * limitFilter;
    const filter = {};
    if (search && typeof search === "string") {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { title: regex },
        { release_year: regex },
        { quality: regex }
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
    const pageNumFilter = pageNum ? parseInt(pageNum) : null;
    if (pageNumFilter && !isNaN(pageNumFilter)) {
      filter.page_num = pageNumFilter;
    }
    const moviesCol = getMoviesCollection();
    const matchingCount = await moviesCol.countDocuments(filter);
    const movies = await moviesCol.find(filter).sort({ priority: -1, id: -1 }).skip(skip).limit(limitFilter).toArray();
    const globalPref = preferredServer || "pixeldrain";
    const mappedMovies = movies.map((m) => ({
      ...m,
      preferred_server: m.preferred_server || globalPref,
      links: deduplicateMovieLinks(m.links, m.preferred_server || globalPref)
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
      matchingCount,
      pages: sortedPages,
      qualities: sortedQualities
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/movies-to-download", async (req, res) => {
  try {
    const filter = {};
    const moviesCol = getMoviesCollection();
    const matchingCount = await moviesCol.countDocuments(filter);
    const movies = await moviesCol.find(filter).sort({ priority: -1, id: -1 }).toArray();
    const globalPref = req.query.preferredServer || "pixeldrain";
    const mappedMovies = movies.map((m) => ({
      ...m,
      preferred_server: m.preferred_server || globalPref,
      links: deduplicateMovieLinks(m.links, m.preferred_server || globalPref)
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
      matchingCount,
      pages: sortedPages,
      qualities: sortedQualities
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.patch("/api/movies/:id/priority", async (req, res) => {
  try {
    const { id } = req.params;
    const { priority } = req.body;
    const pValue = Number(priority) || 0;
    await getMoviesCollection().updateOne(
      { id: Number(id) },
      { $set: { priority: pValue } }
    );
    res.json({
      success: true,
      message: `Movie #${id} priority updated to ${pValue}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
async function searchDetailUrl(movie) {
  const base = BASE_URL.replace(/\/$/, "");
  const cleaned = cleanMovieTitle(movie.title);
  const queries = Array.from(
    new Set([cleaned, cleaned.split(" ").filter((w) => w.length > 2).slice(0, 3).join(" ")].filter(Boolean))
  );
  for (const q of queries) {
    try {
      const searchUrl = `${base}/?s=${encodeURIComponent(q)}`;
      const { html, finalUrl } = await fetchPage(searchUrl);
      const candidates = parseListingPage(html, finalUrl, 0).map((m) => ({ title: m.title, url: m.detail_url }));
      const best = pickBestMatch(movie.title, movie.release_year, candidates);
      if (best) return best.url;
    } catch (e) {
      console.error(`[resolve] HTML search for "${q}" failed:`, e.message);
    }
    try {
      const api = `${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10&_fields=link,title`;
      const { html } = await fetchPage(api);
      const posts = JSON.parse(html);
      const candidates = posts.map((p) => ({ title: cheerio2.load(`<i>${p.title?.rendered || ""}</i>`)("i").text(), url: resolveUrl(p.link, base) })).filter((c) => c.url && isDetailUrl(c.url, BASE_URL));
      const best = pickBestMatch(movie.title, movie.release_year, candidates);
      if (best) return best.url;
    } catch {
    }
  }
  return "";
}
async function resolveMovieDetailUrl(movie) {
  const stored = movie.detail_url ? rebaseToSite(movie.detail_url, BASE_URL) : "";
  if (stored && isDetailUrl(stored, BASE_URL)) return stored;
  console.warn(`[resolve] Stored detail_url "${movie.detail_url}" is not a movie page for "${movie.title}" - searching the site`);
  const found = await searchDetailUrl(movie);
  if (found) {
    console.log(`[resolve] "${movie.title}" -> ${found}`);
    return found;
  }
  throw new Error(`Could not find the detail page for "${movie.title}" on ${BASE_URL}`);
}
app.post("/api/movies/:id/fetch-links", async (req, res) => {
  try {
    const { id } = req.params;
    const { preferredServer } = req.body || {};
    const moviesCol = getMoviesCollection();
    const movie = await moviesCol.findOne({ id: Number(id) });
    if (!movie) {
      return res.status(404).json({ success: false, error: "Movie not found" });
    }
    const chosenPref = preferredServer || movie.preferred_server || "pixeldrain";
    const targetUrl = await resolveMovieDetailUrl(movie);
    const links = await scrapeMovieDetail(targetUrl, chosenPref);
    if (links.length === 0) {
      await moviesCol.updateOne({ id: Number(id) }, { $set: { detail_url: targetUrl } });
      return res.status(404).json({
        success: false,
        error: `No download links found on ${targetUrl}${(movie.links || []).length ? " (existing links kept)" : ""}`
      });
    }
    await moviesCol.updateOne(
      { id: Number(id) },
      {
        $set: {
          detail_url: targetUrl,
          links,
          preferred_server: chosenPref,
          scraped_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      }
    );
    const updated = await moviesCol.findOne({ id: Number(id) });
    res.json({
      success: true,
      movie: {
        ...updated,
        links: deduplicateMovieLinks(updated.links, chosenPref)
      },
      links: deduplicateMovieLinks(links, chosenPref)
    });
  } catch (err) {
    console.error("Error fetching links for movie:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.patch("/api/movies/:id/preferred-server", async (req, res) => {
  try {
    const { id } = req.params;
    const { preferredServer } = req.body;
    const moviesCol = getMoviesCollection();
    const movie = await moviesCol.findOne({ id: Number(id) });
    if (!movie) {
      return res.status(404).json({ success: false, error: "Movie not found" });
    }
    const chosenPref = preferredServer || "pixeldrain";
    const dedupedStr = deduplicateMovieLinks(movie.links, chosenPref);
    const dedupedParsed = JSON.parse(dedupedStr);
    await moviesCol.updateOne(
      { id: Number(id) },
      { $set: { preferred_server: chosenPref, links: dedupedParsed } }
    );
    const updated = await moviesCol.findOne({ id: Number(id) });
    res.json({
      success: true,
      movie: {
        ...updated,
        preferred_server: chosenPref,
        links: dedupedStr
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/movies/:id/select-server", async (req, res) => {
  try {
    const { id } = req.params;
    const { quality, targetServerText, targetUrl } = req.body;
    const moviesCol = getMoviesCollection();
    const movie = await moviesCol.findOne({ id: Number(id) });
    if (!movie) {
      return res.status(404).json({ success: false, error: "Movie not found" });
    }
    let groups = [];
    try {
      groups = typeof movie.links === "string" ? JSON.parse(movie.links) : movie.links;
    } catch {
      groups = [];
    }
    const updatedGroups = groups.map((g) => {
      if (g.quality.toUpperCase() === quality.toUpperCase()) {
        const newLinks = g.links.map((link) => {
          const currentAlts = link.alternatives || [{ text: link.text, url: link.url }];
          return {
            ...link,
            text: targetServerText,
            url: targetUrl,
            alternatives: currentAlts
          };
        });
        return { ...g, links: newLinks };
      }
      return g;
    });
    await moviesCol.updateOne(
      { id: Number(id) },
      { $set: { links: updatedGroups } }
    );
    const updated = await moviesCol.findOne({ id: Number(id) });
    res.json({
      success: true,
      movie: {
        ...updated,
        links: JSON.stringify(updatedGroups)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.put("/api/movies/:id/links", async (req, res) => {
  try {
    const { id } = req.params;
    const { links } = req.body;
    let parsedLinks = links;
    if (typeof links === "string") {
      try {
        parsedLinks = JSON.parse(links);
      } catch {
        parsedLinks = [];
      }
    }
    const moviesCol = getMoviesCollection();
    await moviesCol.updateOne(
      { id: Number(id) },
      { $set: { links: parsedLinks } }
    );
    res.json({
      success: true,
      message: "Movie links updated successfully",
      links: deduplicateMovieLinks(parsedLinks)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/movies/batch-fetch-links", async (req, res) => {
  try {
    const { ids, preferredServer } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: "No movie IDs provided" });
    }
    const chosenPref = preferredServer || "pixeldrain";
    const moviesCol = getMoviesCollection();
    let updatedCount = 0;
    for (const id of ids) {
      const movie = await moviesCol.findOne({ id: Number(id) });
      if (movie) {
        try {
          const targetUrl = await resolveMovieDetailUrl(movie);
          const links = await scrapeMovieDetail(targetUrl, chosenPref);
          if (links.length === 0) {
            await moviesCol.updateOne({ id: Number(id) }, { $set: { detail_url: targetUrl } });
            console.warn(`[batch] No links found for movie #${id} on ${targetUrl}; existing links kept`);
            continue;
          }
          await moviesCol.updateOne(
            { id: Number(id) },
            {
              $set: {
                detail_url: targetUrl,
                links,
                preferred_server: chosenPref,
                scraped_at: (/* @__PURE__ */ new Date()).toISOString()
              }
            }
          );
          updatedCount++;
        } catch (e) {
          console.error(`Failed to batch fetch links for movie #${id}:`, e);
        }
      }
    }
    const allMovies = await moviesCol.find({ id: { $in: ids.map(Number) } }).toArray();
    const mappedMovies = allMovies.map((m) => ({
      ...m,
      links: deduplicateMovieLinks(m.links, m.preferred_server || chosenPref)
    }));
    res.json({ success: true, updatedCount, movies: mappedMovies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/db-dump", async (req, res) => {
  try {
    const movies = await getMoviesCollection().find({}).toArray();
    const mappedMovies = movies.map((m) => ({
      ...m,
      links: deduplicateMovieLinks(m.links)
    }));
    res.json({ success: true, movies: mappedMovies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get("/api/proxies", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const proxiesCol = getProxiesCollection();
    const proxies = await proxiesCol.find({}).sort({ latency: 1 }).skip(offset).limit(limit).toArray();
    const total = await proxiesCol.countDocuments();
    res.json({ success: true, proxies, total, page, limit });
  } catch (err) {
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
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post("/api/scrape", async (req, res) => {
  try {
    const { startPage = 1, endPage = 1 } = req.body;
    const start = Math.max(1, Number(startPage));
    const end = Math.max(start, Number(endPage));
    let totalScraped = 0;
    const errors = [];
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const moviesCol = getMoviesCollection();
    await Promise.all(
      pages.map(async (p) => {
        try {
          const scraped = await scrapePage(p);
          for (const m of scraped) {
            try {
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
                  detail_url: m.detail_url,
                  links,
                  page_num: m.page_num,
                  scraped_at: (/* @__PURE__ */ new Date()).toISOString(),
                  priority: 0
                });
                totalScraped++;
              } else {
                const links = await scrapeMovieDetail(m.detail_url, "pixeldrain");
                const existingLinksStr = JSON.stringify(existing.links || []);
                const newLinksStr = JSON.stringify(links);
                if (!isDetailUrl(existing.detail_url, BASE_URL)) {
                  await moviesCol.updateOne({ _id: existing._id }, { $set: { detail_url: m.detail_url } });
                }
                if (links.length > 0 && newLinksStr !== existingLinksStr) {
                  await moviesCol.updateOne(
                    { _id: existing._id },
                    {
                      $set: {
                        links,
                        quality: m.quality || existing.quality,
                        poster_url: m.poster_url || existing.poster_url,
                        scraped_at: (/* @__PURE__ */ new Date()).toISOString()
                      }
                    }
                  );
                  totalScraped++;
                }
              }
            } catch (movieErr) {
              console.error(`Failed to process "${m.title}":`, movieErr.message);
              errors.push(`${m.title}: ${movieErr.message}`);
            }
          }
        } catch (err) {
          console.error(`Error scraping page ${p}:`, err.message);
          errors.push(`Page ${p}: ${err.message}`);
        }
      })
    );
    const allMovies = await moviesCol.find({}).sort({ id: 1 }).toArray();
    const mappedMovies = allMovies.map((m) => ({
      ...m,
      links: deduplicateMovieLinks(m.links)
    }));
    res.json({
      success: true,
      newScraped: totalScraped,
      totalCount: mappedMovies.length,
      errors: errors.length > 0 ? errors : void 0,
      movies: mappedMovies
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.delete("/api/movies", async (req, res) => {
  try {
    console.log("Received DELETE request to /api/movies");
    await getMoviesCollection().deleteMany({});
    await getSeenLinksCollection().deleteMany({});
    currentFullScrapePage = 1;
    isFullScrapeDone = false;
    const counterCol = await getCountersCollection();
    await counterCol.updateOne(
      { _id: "movieId" },
      { $set: { seq: 0 } },
      { upsert: true }
    );
    res.json({ success: true, message: "All movies and seen links cleared. Scraper reset to page 1 and index 1." });
  } catch (err) {
    console.error("Error clearing database:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
async function startServer() {
  await connectToDatabase();
  await initCounter();
  startContinuousScraping();
  app.all("/api/*", (req, res) => {
    res.status(404).json({ success: false, error: "API endpoint not found" });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express2.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  const listenOnPort = (port) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${port}`);
    });
    server.on("error", (error) => {
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
//# sourceMappingURL=server.cjs.map
