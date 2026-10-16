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
import {
  isDetailUrl,
  rebaseToSite,
  parseListingPage,
  pickBestMatch,
  findM4uLinks,
  findFileLinks,
  findExternalDownloadCandidates,
  findRedirect,
  isChallengePage,
  sampleExternalLinks,
  qualityFromContext,
  resolveUrl,
  type FoundLink,
} from "./src/scrapeUtils.ts";

const app = express();
app.use(express.json());
const DEFAULT_PORT = Number(process.env.PORT) || 3000;
let BASE_URL = process.env.SITE_URL || 'https://new2.movies4u.garden/';
const linkCache = new Map<string, { text: string; url: string }[]>();

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

    if (!isDetailUrl(m.detail_url, BASE_URL)) {
      console.warn(`[scrape] Skipping "${normalizedTitle}": no valid detail URL (got "${m.detail_url}")`);
      continue;
    }

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
          detail_url: m.detail_url,
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

        // repair a previously stored bad detail_url (e.g. the homepage)
        if (!isDetailUrl(exists.detail_url, BASE_URL)) {
          await moviesCol.updateOne({ _id: exists._id }, { $set: { detail_url: m.detail_url } });
        }

        if (links.length > 0 && newLinksStr !== existingLinksStr) {
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

// Extract direct download links from HubCloud generator flow with customizable server priority (Pixeldrain by default)
interface HubCloudOptions {
  pixeldrain?: string;
  fsl?: string;
  tenGbps?: string;
  direct?: { text: string; url: string };
  hubUrl: string;
}
const hubOptionsCache = new Map<string, HubCloudOptions>();

async function resolveHubCloudDirectLinks(
  hubUrl: string,
  preferredServer: string = "pixeldrain",
): Promise<{ text: string; url: string; alternatives?: { text: string; url: string }[] }[]> {
  try {
    let opts = hubOptionsCache.get(hubUrl);

    if (!opts) {
      opts = { hubUrl };
      const hubResponse = await fetchWithRetry(hubUrl, {}, 2, false);
      const html = await hubResponse.text();
      const $ = cheerio.load(html);

      // Check if Pixeldrain is directly present in HubCloud HTML
      const pxlDirectMatch = html.match(/var\s+pxl\s*=\s*["']([^"']+)["']/);
      if (pxlDirectMatch && pxlDirectMatch[1]) {
        opts.pixeldrain = pxlDirectMatch[1].replace("/u/", "/api/file/");
      }

      if (!opts.pixeldrain) {
        $("a").each((_, a) => {
          const href = $(a).attr("href") || "";
          if (/pixeldrain\.(com|dev)/i.test(href)) {
            opts!.pixeldrain = href.replace("/u/", "/api/file/");
          }
        });
      }

      // Check generator button
      const $generateBtn = $(
        "#download, a:contains('Generate Direct Download Link'), a:contains('Generate'), a:contains('Go to download')",
      );
      let rawGenUrl = $generateBtn.attr("href");

      if (rawGenUrl) {
        const genUrl = rawGenUrl.startsWith("http") ? rawGenUrl : new URL(rawGenUrl, hubUrl).href;
        const genRes = await fetchWithRetry(genUrl, { headers: { Referer: hubUrl } }, 2, false);
        if (genRes.ok) {
          const genHtml = await genRes.text();
          const $g = cheerio.load(genHtml);

          if (!opts.pixeldrain) {
            const pxlGenMatch = genHtml.match(/var\s+pxl\s*=\s*["']([^"']+)["']/);
            if (pxlGenMatch && pxlGenMatch[1]) {
              opts.pixeldrain = pxlGenMatch[1].replace("/u/", "/api/file/");
            }
          }

          $g("a").each((_, a) => {
            const text = $g(a).text().trim();
            const href = $g(a).attr("href") || "";
            if (
              href.startsWith("http") &&
              !href.includes("google.com") &&
              !href.includes("t.me") &&
              !href.includes("tinyurl") &&
              !href.includes("one.one.one.one")
            ) {
              if (/pixeldrain\.(com|dev)/i.test(href) && !opts!.pixeldrain) {
                opts!.pixeldrain = href.replace("/u/", "/api/file/");
              } else if (!opts!.fsl && (/FSL Server|Cloudflare|r2\.cloudflarestorage/i.test(text) || href.includes("r2.cloudflarestorage.com"))) {
                opts!.fsl = href;
              } else if (!opts!.tenGbps && (/10Gbps|gpdl\.hubcloud/i.test(text) || href.includes("gpdl.hubcloud"))) {
                opts!.tenGbps = href;
              } else if (!opts!.direct && /Fast Server|Direct Download|Download Server/i.test(text)) {
                opts!.direct = { text: text || "Direct Server", url: href };
              }
            }
          });
        }
      }

      hubOptionsCache.set(hubUrl, opts);
    }

    // Build all available alternatives
    const allAlts: { text: string; url: string }[] = [];
    if (opts.pixeldrain) allAlts.push({ text: "Pixeldrain", url: opts.pixeldrain });
    if (opts.fsl) allAlts.push({ text: "FSL Server", url: opts.fsl });
    if (opts.tenGbps) allAlts.push({ text: "10Gbps Server", url: opts.tenGbps });
    if (opts.direct) allAlts.push({ text: opts.direct.text, url: opts.direct.url });
    allAlts.push({ text: "HubCloud DD", url: hubUrl });

    // Pick strictly ONE single link according to user preferredServer
    const pref = (preferredServer || "pixeldrain").toLowerCase();
    let selected: { text: string; url: string } | null = null;

    if (pref.includes("fsl") && opts.fsl) {
      selected = { text: "FSL Server", url: opts.fsl };
    } else if (pref.includes("10g") && opts.tenGbps) {
      selected = { text: "10Gbps Server", url: opts.tenGbps };
    } else if (pref.includes("hub") && hubUrl) {
      selected = { text: "HubCloud DD", url: hubUrl };
    } else if (pref.includes("pixel") && opts.pixeldrain) {
      selected = { text: "Pixeldrain", url: opts.pixeldrain };
    }

    // Priority fallback if preferred wasn't found: Pixeldrain > FSL > 10Gbps > Direct > HubCloud
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

async function fetchPage(url: string, referer?: string): Promise<{ html: string; finalUrl: string }> {
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(referer ? { Referer: referer } : {}),
      },
    },
    2,
    false,
  );
  return { html: await res.text(), finalUrl: res.url || url };
}

// Load a link-locker page and return the file-host links on it, following meta/JS redirects (max 2 hops).
async function loadIntermediate(
  url: string,
  referer: string,
): Promise<{ files: FoundLink[]; pageTitle: string }> {
  let current = url;
  let from = referer;
  let pageTitle = "";
  for (let hop = 0; hop <= 2; hop++) {
    const { html, finalUrl } = await fetchPage(current, from);
    const $ = cheerio.load(html);
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

async function scrapeMovieDetail(detailUrl: string, preferredServer: string = "pixeldrain") {
  const qualityGroups: Map<string, { text: string; url: string; alternatives?: { text: string; url: string }[] }[]> = new Map();

  const pref = (preferredServer || "pixeldrain").toLowerCase();

  const getScore = (label: string) => {
    const t = label.toLowerCase();
    if (pref.includes("fsl") && (t.includes("fsl") || t.includes("direct"))) return 100;
    if (pref.includes("10g") && t.includes("10gbps")) return 100;
    if (pref.includes("pixel") && t.includes("pixel")) return 100;
    if (pref.includes("gdflix") && t.includes("gdflix")) return 100;
    if (pref.includes("hub") && t.includes("hub")) return 100;

    // Default priority: Pixeldrain > FSL > 10Gbps > Direct > HubCloud > GDFlix
    if (t.includes("pixel")) return 90;
    if (t.includes("fsl") || t.includes("r2")) return 80;
    if (t.includes("10gbps") || t.includes("10g")) return 70;
    if (t.includes("direct")) return 60;
    if (t.includes("hub")) return 50;
    return 10;
  };

  function addLink(
    quality: string,
    text: string,
    url: string,
    alternatives: { text: string; url: string }[] = [],
  ) {
    if (!url) return;
    const cleanQ = quality.trim() || "General";
    if (!qualityGroups.has(cleanQ)) {
      qualityGroups.set(cleanQ, []);
    }
    const group = qualityGroups.get(cleanQ)!;

    const epMatch = text.match(/^(Ep\s*\d+|Batch\s*Zip)/i);

    if (epMatch) {
      const epPrefix = epMatch[1].toLowerCase();
      const existingIdx = group.findIndex((l) => l.text.toLowerCase().startsWith(epPrefix));
      if (existingIdx !== -1) {
        const existing = group[existingIdx];
        const mergedAlts = [
          ...(existing.alternatives || [{ text: existing.text, url: existing.url }]),
          ...(alternatives || []),
          { text, url },
        ].filter((a, idx, arr) => arr.findIndex((x) => x.url === a.url) === idx);

        if (getScore(text) > getScore(existing.text)) {
          group[existingIdx] = { text, url, alternatives: mergedAlts };
        } else {
          group[existingIdx].alternatives = mergedAlts;
        }
        return;
      }
    } else {
      // Movie quality level: STRICTLY MAINTAIN 1 LINK PER QUALITY!
      if (group.length > 0) {
        const existing = group[0];
        const mergedAlts = [
          ...(existing.alternatives || [{ text: existing.text, url: existing.url }]),
          ...(alternatives || []),
          { text, url },
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
    // Never scrape the homepage / a listing / a foreign URL as if it were a movie page.
    if (!isDetailUrl(detailUrl, BASE_URL)) {
      throw new Error(
        `"${detailUrl}" is not a movie detail page (homepage, listing or foreign URL) - refusing to scrape it`,
      );
    }

    const { html, finalUrl } = await fetchPage(detailUrl);
    console.log(`[DEBUG] Scraped detail page: ${detailUrl}, HTML length: ${html.length}`);
    if (isChallengePage(html)) {
      console.warn(`[scrape] ${detailUrl} returned an anti-bot challenge page - links cannot be read from it`);
    }
    const $main = cheerio.load(html);

    // 1) the link-locker (m4ulinks.<any tld>) links
    const m4uFound = findM4uLinks($main, html, finalUrl);
    console.log(`[DEBUG] Total unique m4ulinks found: ${m4uFound.length}`);

    // 2) file-host links placed directly on the movie page
    const directFiles = m4uFound.length === 0 ? findFileLinks($main, html, finalUrl) : [];

    // 3) the locker changed name? fall back to external "Download ..." links in the post content
    let intermediates: { url: string; contextHeader: string; label: string }[] = m4uFound.map((f) => ({
      url: f.url,
      contextHeader: f.header || f.text,
      label: "M4ULinks",
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
        label: new URL(f.url).hostname.replace(/^www\./, ""),
      }));
    }

    interface SectionItem {
      headerText: string;
      pixeldrainUrl?: string;
      hubCloudUrl?: string;
      gdFlixUrl?: string;
      otherUrl?: { url: string; host: string };
      isZipBatch: boolean;
    }

    // Turn a flat list of file-host links into quality groups (shared by every discovery path)
    const processFiles = async (files: FoundLink[], ctxHeader: string, pageTitle: string) => {
      const sections: SectionItem[] = [];

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

        // Gather all available alternatives for this section
        const secAlts: { text: string; url: string }[] = [];
        if (sec.pixeldrainUrl) {
          secAlts.push({
            text: labelPrefix ? `${labelPrefix} (Pixeldrain)` : "Pixeldrain",
            url: sec.pixeldrainUrl.replace("/u/", "/api/file/"),
          });
        }
        if (sec.gdFlixUrl) {
          secAlts.push({
            text: labelPrefix ? `${labelPrefix} (GDFlix)` : "GDFlix",
            url: sec.gdFlixUrl,
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
          // HubCloud resolution (picks best server matching preferredServer)
          const directLinks = await resolveHubCloudDirectLinks(sec.hubCloudUrl, preferredServer);
          if (directLinks.length > 0) {
            resolvedSuccess = true;
            const dl = directLinks[0];
            const finalLabel = labelPrefix ? `${labelPrefix} (${dl.text})` : dl.text;
            const combinedAlts = [
              ...secAlts,
              ...(dl.alternatives || []).map((a) => ({
                text: labelPrefix ? `${labelPrefix} (${a.text})` : a.text,
                url: a.url,
              })),
            ].filter((a, idx, arr) => arr.findIndex((x) => x.url === a.url) === idx);
            addLink(quality, finalLabel, dl.url, combinedAlts);
          }
        } else if (sec.pixeldrainUrl) {
          resolvedSuccess = true;
          const cleanPxl = sec.pixeldrainUrl.replace("/u/", "/api/file/");
          addLink(quality, labelPrefix ? `${labelPrefix} (Pixeldrain)` : "Pixeldrain", cleanPxl, secAlts);
        }

        // Fallback: GDFlix only if primary not resolved
        if (!resolvedSuccess && sec.gdFlixUrl) {
          resolvedSuccess = true;
          addLink(quality, labelPrefix ? `${labelPrefix} (GDFlix)` : "GDFlix", sec.gdFlixUrl, secAlts);
        }
        // Any other supported host (hubdrive, filepress, gofile, ...)
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
            // Could not read the locker page (JS-only / blocked): keep the locker URL itself so the
            // user still gets a working link instead of "not found".
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

  const links: { quality: string; links: { text: string; url: string; alternatives?: { text: string; url: string }[] }[] }[] = [];
  qualityGroups.forEach((groupLinks, quality) => {
    links.push({ quality, links: groupLinks });
  });

  return links;
}

// Helper to fetch with retries and direct fallback
async function fetchWithRetry(
  url: string,
  options: any = {},
  retries = 2,
  useProxy = false,
): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

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
        try {
          const proxiesCol = getProxiesCollection();
          const randomProxyArr = await proxiesCol
            .aggregate([
              { $match: { latency: { $ne: null } } },
              { $sample: { size: 1 } },
            ])
            .toArray();
          const proxy = randomProxyArr[0];
          if (proxy) {
            // @ts-ignore
            fetchOptions.agent = new HttpsProxyAgent(`http://${proxy.url}`);
          }
        } catch {
          // ignore proxy error
        }
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeout);

      if (response.ok) return response;
      throw new Error(`HTTP error! status: ${response.status}`);
    } catch (e) {
      if (useProxy && i === 0) {
        // Retry immediately direct without proxy
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
  const movies = parseListingPage(html, response.url || url, pageNum);
  console.log(`[DEBUG] Listing page ${pageNum}: ${movies.length} movies with valid detail URLs`);
  if (movies.length === 0 && isChallengePage(html)) {
    console.warn(`[scrape] Listing page ${pageNum} returned an anti-bot challenge page`);
  }
  return movies;
}

function deduplicateMovieLinks(linksRaw: any, preferredServer: string = "pixeldrain"): string {
  let groups: { quality: string; links: any[] }[] = [];
  try {
    groups = typeof linksRaw === "string" ? JSON.parse(linksRaw) : linksRaw;
  } catch {
    return "[]";
  }
  if (!Array.isArray(groups)) return "[]";

  const result: { quality: string; links: any[] }[] = [];
  const pref = (preferredServer || "pixeldrain").toLowerCase();

  const getScore = (label: string) => {
    const t = (label || "").toLowerCase();
    if (pref.includes("fsl") && (t.includes("fsl") || t.includes("direct"))) return 100;
    if (pref.includes("10g") && t.includes("10gbps")) return 100;
    if (pref.includes("pixel") && t.includes("pixel")) return 100;
    if (pref.includes("gdflix") && t.includes("gdflix")) return 100;
    if (pref.includes("hub") && t.includes("hub")) return 100;

    // Default priority: Pixeldrain > FSL > 10Gbps > Direct > HubCloud > GDFlix
    if (t.includes("pixel")) return 90;
    if (t.includes("fsl") || t.includes("r2")) return 80;
    if (t.includes("10gbps") || t.includes("10g")) return 70;
    if (t.includes("direct")) return 60;
    if (t.includes("hub")) return 50;
    return 10;
  };

  for (const g of groups) {
    if (!g || !Array.isArray(g.links)) continue;

    const epMap = new Map<string, any>();
    let movieLink: any = null;

    for (const link of g.links) {
      if (!link || !link.url) continue;
      const epMatch = link.text.match(/^(Ep\s*\d+|Batch\s*Zip)/i);

      if (epMatch) {
        const epKey = epMatch[1].toLowerCase();
        const existing = epMap.get(epKey);
        const mergedAlts = [
          ...(existing?.alternatives || (existing ? [{ text: existing.text, url: existing.url }] : [])),
          ...(link.alternatives || []),
          { text: link.text, url: link.url },
        ].filter((a: any, idx: number, arr: any[]) => arr.findIndex((x: any) => x.url === a.url) === idx);

        if (!existing || getScore(link.text) > getScore(existing.text)) {
          epMap.set(epKey, { ...link, alternatives: mergedAlts });
        } else {
          epMap.set(epKey, { ...existing, alternatives: mergedAlts });
        }
      } else {
        const mergedAlts = [
          ...(movieLink?.alternatives || (movieLink ? [{ text: movieLink.text, url: movieLink.url }] : [])),
          ...(link.alternatives || []),
          { text: link.text, url: link.url },
        ].filter((a: any, idx: number, arr: any[]) => arr.findIndex((x: any) => x.url === a.url) === idx);

        if (!movieLink || getScore(link.text) > getScore(movieLink.text)) {
          movieLink = { ...link, alternatives: mergedAlts };
        } else {
          movieLink = { ...movieLink, alternatives: mergedAlts };
        }
      }
    }

    const cleanLinks: any[] = [];
    if (movieLink) {
      cleanLinks.push(movieLink);
    }
    epMap.forEach((val) => cleanLinks.push(val));

    if (cleanLinks.length > 0) {
      result.push({
        quality: g.quality,
        links: cleanLinks,
      });
    }
  }

  return JSON.stringify(result);
}

// API Routes
app.use("/api/seen-links", seenLinksRouter);

app.get("/api/config", (req, res) => {
  res.json({ siteUrl: BASE_URL });
});

// Get all movies or filter by search / page range
app.get("/api/movies", async (req, res) => {
  try {
    const { search, quality, pageMin, pageMax, pageNum, page, limit, preferredServer } =
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
      .sort({ priority: -1, id: -1 })
      .skip(skip)
      .limit(limitFilter)
      .toArray();

    const globalPref = (preferredServer as string) || "pixeldrain";

    const mappedMovies = movies.map((m: any) => ({
      ...m,
      preferred_server: m.preferred_server || globalPref,
      links: deduplicateMovieLinks(m.links, m.preferred_server || globalPref),
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
  try {
    const filter: any = {};
    const moviesCol = getMoviesCollection();
    const matchingCount = await moviesCol.countDocuments(filter);

    const movies = await moviesCol
      .find(filter)
      .sort({ priority: -1, id: -1 })
      .toArray();

    const globalPref = (req.query.preferredServer as string) || "pixeldrain";

    const mappedMovies = movies.map((m: any) => ({
      ...m,
      preferred_server: m.preferred_server || globalPref,
      links: deduplicateMovieLinks(m.links, m.preferred_server || globalPref),
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

// Find a movie's detail page by searching the site (HTML search first, WordPress REST as a fallback).
async function searchDetailUrl(movie: any): Promise<string> {
  const base = BASE_URL.replace(/\/$/, "");
  const cleaned = cleanMovieTitle(movie.title);
  const queries = Array.from(
    new Set([cleaned, cleaned.split(" ").filter((w) => w.length > 2).slice(0, 3).join(" ")].filter(Boolean)),
  );

  for (const q of queries) {
    try {
      const searchUrl = `${base}/?s=${encodeURIComponent(q)}`;
      const { html, finalUrl } = await fetchPage(searchUrl);
      const candidates = parseListingPage(html, finalUrl, 0).map((m) => ({ title: m.title, url: m.detail_url }));
      const best = pickBestMatch(movie.title, movie.release_year, candidates);
      if (best) return best.url;
    } catch (e) {
      console.error(`[resolve] HTML search for "${q}" failed:`, (e as Error).message);
    }
    try {
      const api = `${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10&_fields=link,title`;
      const { html } = await fetchPage(api);
      const posts = JSON.parse(html) as { link: string; title: { rendered: string } }[];
      const candidates = posts
        .map((p) => ({ title: cheerio.load(`<i>${p.title?.rendered || ""}</i>`)("i").text(), url: resolveUrl(p.link, base) }))
        .filter((c) => c.url && isDetailUrl(c.url, BASE_URL));
      const best = pickBestMatch(movie.title, movie.release_year, candidates);
      if (best) return best.url;
    } catch {
      // REST API disabled / blocked - ignore
    }
  }
  return "";
}

// Return a *valid* detail-page URL for a stored movie, repairing bad ones (homepage, category,
// old domain) by searching the site by title. Throws if none can be found.
async function resolveMovieDetailUrl(movie: any): Promise<string> {
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

// On-demand fetch/refresh links for all qualities of a single movie with server preference
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
      // keep whatever we already had; only repair the detail URL
      await moviesCol.updateOne({ id: Number(id) }, { $set: { detail_url: targetUrl } });
      return res.status(404).json({
        success: false,
        error: `No download links found on ${targetUrl}${(movie.links || []).length ? " (existing links kept)" : ""}`,
      });
    }

    await moviesCol.updateOne(
      { id: Number(id) },
      {
        $set: {
          detail_url: targetUrl,
          links: links,
          preferred_server: chosenPref,
          scraped_at: new Date().toISOString(),
        },
      }
    );

    const updated = await moviesCol.findOne({ id: Number(id) });
    res.json({
      success: true,
      movie: {
        ...updated,
        links: deduplicateMovieLinks(updated.links, chosenPref),
      },
      links: deduplicateMovieLinks(links, chosenPref),
    });
  } catch (err: any) {
    console.error("Error fetching links for movie:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update preferred server selection for a movie and re-deduplicate active links
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
        links: dedupedStr,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Switch active server for a specific quality in a movie from alternatives
app.put("/api/movies/:id/select-server", async (req, res) => {
  try {
    const { id } = req.params;
    const { quality, targetServerText, targetUrl } = req.body;
    const moviesCol = getMoviesCollection();
    const movie = await moviesCol.findOne({ id: Number(id) });
    if (!movie) {
      return res.status(404).json({ success: false, error: "Movie not found" });
    }

    let groups: any[] = [];
    try {
      groups = typeof movie.links === "string" ? JSON.parse(movie.links) : movie.links;
    } catch {
      groups = [];
    }

    const updatedGroups = groups.map((g: any) => {
      if (g.quality.toUpperCase() === quality.toUpperCase()) {
        const newLinks = g.links.map((link: any) => {
          // Update the active text & url to the target server
          const currentAlts = link.alternatives || [{ text: link.text, url: link.url }];
          return {
            ...link,
            text: targetServerText,
            url: targetUrl,
            alternatives: currentAlts,
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
        links: JSON.stringify(updatedGroups),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update or manually add/edit links for a movie
app.put("/api/movies/:id/links", async (req, res) => {
  try {
    const { id } = req.params;
    const { links } = req.body;
    let parsedLinks: any = links;
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
      links: deduplicateMovieLinks(parsedLinks),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Batch fetch links for selected movies with preferredServer option
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
                links: links,
                preferred_server: chosenPref,
                scraped_at: new Date().toISOString(),
              },
            }
          );
          updatedCount++;
        } catch (e) {
          console.error(`Failed to batch fetch links for movie #${id}:`, e);
        }
      }
    }

    const allMovies = await moviesCol.find({ id: { $in: ids.map(Number) } }).toArray();
    const mappedMovies = allMovies.map((m: any) => ({
        ...m,
        links: deduplicateMovieLinks(m.links, m.preferred_server || chosenPref)
    }));

    res.json({ success: true, updatedCount, movies: mappedMovies });
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
      links: deduplicateMovieLinks(m.links),
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
                links: links,
                page_num: m.page_num,
                scraped_at: new Date().toISOString(),
                priority: 0,
              });
              totalScraped++;
            } else {
              // Check if new links/episodes have been added
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
           } catch (movieErr: any) {
            console.error(`Failed to process "${m.title}":`, movieErr.message);
            errors.push(`${m.title}: ${movieErr.message}`);
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
      links: deduplicateMovieLinks(m.links),
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
