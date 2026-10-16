// Usage: npx tsx debug_links.ts <movie-detail-url>
// Prints exactly what the scraper would find on a movie page and on each link-locker page.
import * as cheerio from "cheerio";
import {
  isDetailUrl, findM4uLinks, findFileLinks, findExternalDownloadCandidates,
  findRedirect, isChallengePage, sampleExternalLinks,
} from "./src/scrapeUtils.ts";

const url = process.argv[2] || "https://new2.movies4u.garden/rajni-the-jailer-2-2026-hindi-full-movie/";
const BASE = process.env.SITE_URL || "https://new2.movies4u.garden/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" };

async function get(u: string, referer?: string) {
  const r = await fetch(u, { headers: { ...UA, ...(referer ? { Referer: referer } : {}) } });
  return { status: r.status, html: await r.text(), finalUrl: r.url || u };
}

async function main() {
  console.log("Detail URL valid?", isDetailUrl(url, BASE), url);
  const { status, html, finalUrl } = await get(url);
  console.log(`HTTP ${status}, HTML length ${html.length}, challenge page: ${isChallengePage(html)}`);
  const $ = cheerio.load(html);

  const m4u = findM4uLinks($, html, finalUrl);
  console.log("m4ulinks found:", m4u.length);
  const direct = findFileLinks($, html, finalUrl);
  console.log("direct file-host links:", direct.length);
  const generic = m4u.length || direct.length ? [] : findExternalDownloadCandidates($, finalUrl);
  if (generic.length) console.log("generic external candidates:", generic.map((g) => `${g.url} [${g.text}]`));
  if (!m4u.length && !direct.length && !generic.length) console.log("sample links:", sampleExternalLinks($, finalUrl, 25));

  for (const entry of [...m4u, ...generic]) {
    console.log(`\n-> ${entry.url}  (context: "${entry.header}")`);
    const page = await get(entry.url, finalUrl);
    const $p = cheerio.load(page.html);
    let files = findFileLinks($p, page.html, page.finalUrl);
    if (!files.length) {
      const next = findRedirect(page.html, page.finalUrl);
      if (next) { console.log("   redirect ->", next); const p2 = await get(next, page.finalUrl); files = findFileLinks(cheerio.load(p2.html), p2.html, p2.finalUrl); }
    }
    console.log(`   file links: ${files.length}`);
    files.forEach((f) => console.log(`   - ${f.url}  [${f.text}]  header="${f.header}"`));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
