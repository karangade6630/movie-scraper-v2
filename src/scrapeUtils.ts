/**
 * Pure, network-free scraping helpers (cheerio only) so they can be unit tested.
 *
 * Everything here exists to make link discovery resilient to the things that
 * kept breaking the scraper:
 *   - the listing page giving us a non-detail URL (homepage / category / ad)
 *   - the site changing domain (movies4u.clinic -> movies4u.garden -> ...)
 *   - the intermediate shortener (m4ulinks.*) changing TLD or how it is linked
 *     (relative href, data-href, onclick, inline script, base64)
 */
import * as cheerio from "cheerio";

export type CheerioAPI = cheerio.CheerioAPI;

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** "new2.movies4u.garden" -> "movies4u" (the part that stays stable across TLD/sub-domain changes) */
export function siteLabel(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "";
}

export function isSameSite(url: string, baseUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(baseUrl);
    if (a.hostname.toLowerCase() === b.hostname.toLowerCase()) return true;
    return siteLabel(a.hostname) === siteLabel(b.hostname);
  } catch {
    return false;
  }
}

/** Resolve any href (relative, protocol-relative, absolute) to an absolute http(s) URL without #hash. "" if unusable. */
export function resolveUrl(href: string | undefined | null, base: string): string {
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

/** Point a URL that belongs to this site at the *current* host (handles domain rotation). */
export function rebaseToSite(url: string, baseUrl: string): string {
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

// Paths on the site that are listings / utility pages, never a single movie page.
const NON_DETAIL_PATH =
  /^\/(page\/\d+|category|categories|tag|tags|genre|genres|year|years|quality|qualities|author|search|feed|comments|wp-[a-z]+|how-to-download|dmca|contact|contact-us|about|about-us|privacy-policy|disclaimer|request|telegram|join|login|register|sitemap)(\/|$)/i;

/** True only for a URL that looks like one specific movie/series page on this site. */
export function isDetailUrl(url: string, baseUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (!isSameSite(url, baseUrl)) return false;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path) return false; // homepage
  if (/(^|&)s=/.test(u.search.replace(/^\?/, ""))) return false; // search results
  if (NON_DETAIL_PATH.test(path)) return false;
  if (/\.(jpe?g|png|gif|webp|svg|css|js|ico|xml|txt|json|php|zip|rar)$/i.test(path)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Listing page parsing
// ---------------------------------------------------------------------------

export interface ListedMovie {
  title: string;
  release_year: string;
  quality: string;
  poster_url: string;
  detail_url: string;
  page_num: number;
}

const FALLBACK_POSTER =
  "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=500&auto=format&fit=crop&q=60";

const CARD_SELECTORS = "article, .item, .movies-item, .post, .box, .search-item";

/**
 * Pick the link of a listing card that actually points to the movie page.
 * Preference order: rel=bookmark, title/heading link, poster link, any other link.
 * Never returns the homepage or a category/tag/search URL.
 */
export function pickDetailLink($: CheerioAPI, el: any, baseUrl: string): { url: string; text: string } | null {
  const $el = $(el);
  const groups = [
    "a[rel~=bookmark]",
    "h1 a, h2 a, h3 a, h4 a, .title a, a.title, .entry-title a, .post-title a, .movie-title a",
    "a:has(img)",
    "a",
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

export function parseListingPage(html: string, baseUrl: string, pageNum: number): ListedMovie[] {
  const $ = cheerio.load(html);
  const movies: ListedMovie[] = [];
  const seenUrls = new Set<string>();

  const push = (m: ListedMovie) => {
    if (seenUrls.has(m.detail_url)) return;
    if (movies.some((x) => x.title.toLowerCase() === m.title.toLowerCase())) return;
    seenUrls.add(m.detail_url);
    movies.push(m);
  };

  $(CARD_SELECTORS).each((_, el) => {
    const $el = $(el);
    const link = pickDetailLink($, el, baseUrl);
    if (!link) return; // no usable movie link => not a movie card (nav, widget, ad...)

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
      page_num: pageNum,
    });
  });

  // Fallback: bare <a><img></a> grids
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
        page_num: pageNum,
      });
    });
  }

  return movies;
}

// ---------------------------------------------------------------------------
// Title matching (used when we have to search the site for a movie)
// ---------------------------------------------------------------------------

const STOP = new Set(["the", "a", "an", "of", "and", "in", "on", "to", "full", "movie", "hindi", "dual", "audio", "web", "dl", "org"]);

export function titleTokens(t: string): string[] {
  return (t || "")
    .toLowerCase()
    .replace(/\b(480p|720p|1080p|2160p|4k|hdr|hdrip|web-dl|webrip|bluray|cam|hd|hindi|english|dual audio|multi audio|dubbed|full movie|batch|zip)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** 0..1 — share of the wanted title's words that appear in the candidate (+ year bonus). */
export function scoreTitleMatch(wanted: string, candidate: string): number {
  const w = titleTokens(wanted);
  if (w.length === 0) return 0;
  const c = new Set(titleTokens(candidate));
  const hit = w.filter((x) => c.has(x)).length;
  let score = hit / w.length;
  // penalise very long candidates that merely contain our words (e.g. "X 2 / X 3 collection")
  const extra = Math.max(0, c.size - w.length);
  score -= Math.min(0.2, extra * 0.03);
  return Math.max(0, Math.min(1, score));
}

export function pickBestMatch(
  wantedTitle: string,
  wantedYear: string | undefined,
  candidates: { title: string; url: string }[],
  minScore = 0.6,
): { title: string; url: string; score: number } | null {
  let best: { title: string; url: string; score: number } | null = null;
  for (const c of candidates) {
    let s = scoreTitleMatch(wantedTitle, c.title);
    if (wantedYear && c.title.includes(wantedYear)) s += 0.05;
    if (s >= minScore && (!best || s > best.score)) best = { ...c, score: s };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Download link discovery
// ---------------------------------------------------------------------------

/** the intermediate "link locker" site (any TLD) */
export const M4U_RE = /m4u-?links/i;
/** hosts we can use as final / near-final download targets */
export const FILE_HOST_RE = /hubcloud|gdflix|pixeldrain|hubdrive|hubcdn|gdtot|filepress|gofile\.io|drive\.google\.com|mega\.nz/i;
/** hosts that are never download links (social, ads, trackers, assets) */
const IGNORED_HOST_RE =
  /(^|\.)(t\.me|telegram\.(me|org|dog)|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|youtu\.be|tinyurl\.com|bit\.ly|wa\.me|whatsapp\.com|gravatar\.com|wp\.com|wordpress\.org|schema\.org|w3\.org|googletagmanager\.com|google-analytics\.com|googleapis\.com|gstatic\.com|cloudflare\.com|disqus\.com)$/i;
const DOWNLOADISH_RE = /download|480p|720p|1080p|2160p|4k|links?\b|get\s+(it|file)|watch|episode|batch|zip/i;
const QUALITY_CTX_RE = /\b(480p|720p|1080p|2160p|4k)\b|season|episode|batch|zip/i;

export interface FoundLink {
  url: string;
  text: string;
  /** closest heading/paragraph above the link (usually "Download 720p ...") */
  header: string;
  isZip: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>\\)]+/gi;

/** every URL an element might be carrying: href, data-* attributes, onclick */
function urlsOnElement($: CheerioAPI, el: any, base: string): string[] {
  const $el = $(el);
  const out: string[] = [];
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

/** nearest preceding heading-ish text for a link, preferring one that mentions a quality/season/episode */
export function contextHeaderFor($: CheerioAPI, el: any, ownText = ""): string {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
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

/** Remove chrome that never holds download links so generic matching doesn't pick up nav/ads/comments. */
function contentRoot($: CheerioAPI) {
  const root =
    $("article .entry-content, .entry-content, .post-content, .single-content, article, main, #content, .content")
      .filter((_, e) => $(e).find("a").length > 0)
      .first();
  return root.length ? root : $("body");
}

function dedupe(list: FoundLink[]): FoundLink[] {
  const seen = new Set<string>();
  return list.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

/** URLs hidden in raw HTML / inline JS (escaped slashes, JSON, base64) that no <a> tag exposes */
export function urlsFromRawHtml(html: string): string[] {
  const out = new Set<string>();
  const unescaped = html.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  for (const m of unescaped.match(URL_IN_TEXT_RE) || []) out.add(m.replace(/[.,;'"]+$/, ""));
  const b64 = /atob\(\s*["']([A-Za-z0-9+/=_-]{16,})["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = b64.exec(html))) {
    try {
      const dec = Buffer.from(m[1], "base64").toString("utf8");
      for (const u of dec.match(URL_IN_TEXT_RE) || []) out.add(u);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

function collect(
  $: CheerioAPI,
  html: string,
  pageUrl: string,
  accept: (url: string) => boolean,
  scope?: any,
  allowRawFallback = true,
): FoundLink[] {
  const found: FoundLink[] = [];
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

/** Intermediate link-locker URLs (m4ulinks.<any tld>) on a movie page. */
export function findM4uLinks($: CheerioAPI, html: string, pageUrl: string): FoundLink[] {
  return collect($, html, pageUrl, (u) => M4U_RE.test(u) && !isSameSite(u, pageUrl));
}

/** File-host links (hubcloud / gdflix / pixeldrain / ...) on any page. */
export function findFileLinks($: CheerioAPI, html: string, pageUrl: string): FoundLink[] {
  return collect($, html, pageUrl, (u) => FILE_HOST_RE.test(hostOf(u)) || /pixeldrain\.(com|dev)/i.test(u));
}

/**
 * Fallback for when the link-locker changes name: external "Download ..." style links inside
 * the main content (excluding socials, trackers, same-site links and known file hosts).
 */
export function findExternalDownloadCandidates($: CheerioAPI, pageUrl: string): FoundLink[] {
  const found: FoundLink[] = [];
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

/** meta-refresh / JS redirects used by link-locker pages */
export function findRedirect(html: string, pageUrl: string): string {
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

export function isChallengePage(html: string): boolean {
  return (
    /<title>\s*(just a moment|attention required|access denied|checking your browser)/i.test(html) ||
    /cf-browser-verification|challenge-platform|cf_chl_opt/i.test(html)
  );
}

/** Short list of the external links on a page, for diagnostics when nothing is found. */
export function sampleExternalLinks($: CheerioAPI, pageUrl: string, limit = 12): string[] {
  const out: string[] = [];
  $("a").each((_, el) => {
    const u = resolveUrl($(el).attr("href"), pageUrl);
    if (u && !out.includes(u)) out.push(u);
  });
  return out.slice(0, limit);
}

export function qualityFromContext(ctx: string): string {
  if (/2160p|4k/i.test(ctx)) return "4K / 2160P";
  if (/1080p/i.test(ctx)) return "1080P";
  if (/720p/i.test(ctx)) return "720P";
  if (/480p/i.test(ctx)) return "480P";
  return "General";
}
