import { test } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import {
  isDetailUrl, rebaseToSite, resolveUrl, parseListingPage, pickBestMatch,
  findM4uLinks, findFileLinks, findExternalDownloadCandidates, findRedirect, isChallengePage,
} from "../src/scrapeUtils.ts";

const BASE = "https://new2.movies4u.garden/";

test("isDetailUrl rejects homepage, hash, listings, search, foreign hosts", () => {
  assert.equal(isDetailUrl("https://new2.movies4u.garden/", BASE), false);
  assert.equal(isDetailUrl("https://new2.movies4u.garden/#content", BASE), false);
  assert.equal(isDetailUrl("https://new2.movies4u.garden/how-to-download/", BASE), false);
  assert.equal(isDetailUrl("https://new2.movies4u.garden/category/bollywood/", BASE), false);
  assert.equal(isDetailUrl("https://new2.movies4u.garden/page/2/", BASE), false);
  assert.equal(isDetailUrl("https://new2.movies4u.garden/?s=rajni", BASE), false);
  assert.equal(isDetailUrl("https://tinyurl.com/xprime4u", BASE), false);
  assert.equal(isDetailUrl("https://t.me/+nOM6ZyXTVos3MGVl", BASE), false);
  assert.equal(isDetailUrl("https://new2.movies4u.garden/rajni-the-jailer-2-2026-hindi-full-movie/", BASE), true);
});

test("domain rotation: old domain URLs are rebased and still valid", () => {
  const old = "https://new2.movies4u.clinic/some-movie-2025-hindi/";
  assert.equal(rebaseToSite(old, BASE), "https://new2.movies4u.garden/some-movie-2025-hindi/");
  assert.equal(isDetailUrl(old, BASE), true);
});

test("resolveUrl handles relative, protocol-relative, junk", () => {
  assert.equal(resolveUrl("/a/b/", BASE), "https://new2.movies4u.garden/a/b/");
  assert.equal(resolveUrl("//m4ulinks.sbs/x", BASE), "https://m4ulinks.sbs/x");
  assert.equal(resolveUrl("#content", BASE), "");
  assert.equal(resolveUrl("javascript:void(0)", BASE), "");
});

// The actual bug: first <a> in the card is NOT the movie page, and a card with no link fell back to the homepage
const LISTING = `
<html><body>
<nav><a href="/">Home</a><a href="/how-to-download/">How</a></nav>
<div class="box"><a href="https://tinyurl.com/xprime4u">Join</a></div>
<article class="post">
  <a href="/category/bollywood/" class="cat">Bollywood</a>
  <a href="https://t.me/+abc"><img src="/ad.png"></a>
  <a href="/rajni-the-jailer-2-2026-hindi-full-movie/"><img data-src="/p1.jpg" alt="x"></a>
  <h2 class="title"><a href="/rajni-the-jailer-2-2026-hindi-full-movie/" rel="bookmark">Rajni The Jailer 2 (2026) Hindi WEB-DL</a></h2>
  <span class="quality">WEB-DL</span>
</article>
<article class="post">
  <h2>Card With No Link At All (2025)</h2>
</article>
<article class="post">
  <a href="https://new2.movies4u.garden/tag/action/">action</a>
  <h3><a href="https://new2.movies4u.garden/second-movie-2024-dual-audio/">Second Movie (2024) Dual Audio</a></h3>
  <img src="//cdn.example.com/p2.jpg">
</article>
</body></html>`;

test("listing: picks the real movie link, never homepage/category/ads, skips linkless cards", () => {
  const movies = parseListingPage(LISTING, BASE, 1);
  assert.deepEqual(movies.map((m) => m.detail_url), [
    "https://new2.movies4u.garden/rajni-the-jailer-2-2026-hindi-full-movie/",
    "https://new2.movies4u.garden/second-movie-2024-dual-audio/",
  ]);
  assert.equal(movies[0].title, "Rajni The Jailer 2 Hindi WEB-DL");
  assert.ok(movies.every((m) => m.detail_url !== BASE));
  assert.equal(movies[1].poster_url, "https://cdn.example.com/p2.jpg");
});

test("pickBestMatch finds the right search result and rejects unrelated ones", () => {
  const cands = [
    { title: "Totally Different Film (2023)", url: "u1" },
    { title: "Rajni The Jailer 2 (2026) Hindi Full Movie", url: "u2" },
  ];
  assert.equal(pickBestMatch("Rajni The Jailer 2", "2026", cands)?.url, "u2");
  assert.equal(pickBestMatch("Nonexistent Thing Here", "2026", cands), null);
});

const page = (inner: string) => `<html><head><title>Movie</title></head><body><nav><a href="https://m4ulinks.fake/nav">decoy in nav</a></nav><article><div class="entry-content">${inner}</div></article><footer><a href="https://t.me/x">tg</a></footer></body></html>`;
function m4u(html: string) { const $ = cheerio.load(html); return findM4uLinks($, html, "https://new2.movies4u.garden/m/").map((f) => f.url); }

test("m4ulinks: found for any TLD, relative/protocol-relative, data-href, onclick, inline JS, base64", () => {
  assert.deepEqual(m4u(page(`<h4>Download 720p</h4><a href="https://m4ulinks.sbs/number/111">720p</a>`)), ["https://m4ulinks.sbs/number/111"]);
  assert.deepEqual(m4u(page(`<a href="//m4ulinks.top/number/2">x</a>`)), ["https://m4ulinks.top/number/2"]);
  assert.deepEqual(m4u(page(`<button data-href="https://m4ulinks.com/number/3">Download</button>`)), ["https://m4ulinks.com/number/3"]);
  assert.deepEqual(m4u(page(`<a href="#" onclick="window.open('https://m4ulinks.co/number/4')">dl</a>`)), ["https://m4ulinks.co/number/4"]);
  assert.deepEqual(m4u(page(`<script>var u="https:\\/\\/m4ulinks.xyz\\/number\\/5";</script>`)), ["https://m4ulinks.xyz/number/5"]);
  const b64 = Buffer.from("https://m4ulinks.in/number/6").toString("base64");
  assert.deepEqual(m4u(page(`<script>location=atob("${b64}")</script>`)), ["https://m4ulinks.in/number/6"]);
});

test("m4ulinks: yields context header for quality detection; no false positives on the exact log page", () => {
  const html = page(`<h4>Download 1080p [2.1GB]</h4><p><a href="https://m4ulinks.sbs/number/9">Download Links</a></p>`);
  const $ = cheerio.load(html);
  const r = findM4uLinks($, html, "https://new2.movies4u.garden/m/");
  assert.match(r[0].header, /1080p/);
  // the page from the user's log (only nav / tinyurl / telegram / how-to) => nothing
  const logPage = `<html><body><a href="#content">c</a><a href="https://new2.movies4u.garden/">h</a><a href="https://tinyurl.com/xprime4u">x</a><a href="https://t.me/+nOM6ZyXTVos3MGVl">t</a><a href="/how-to-download/">h</a></body></html>`;
  assert.equal(m4u(logPage).length, 0);
});

test("file links: hubcloud/gdflix/pixeldrain with sections; zip flag", () => {
  const html = `<body><h3>480p Batch Zip</h3><a class="btn-zip" href="https://hubcloud.foo/drive/aaa">HubCloud</a>
  <h3>Episode 2</h3><a href="https://gdflix.dev/file/bbb">GD</a><a href="https://pixeldrain.com/u/ccc">PX</a></body>`;
  const $ = cheerio.load(html);
  const r = findFileLinks($, html, "https://m4ulinks.sbs/number/1");
  assert.equal(r.length, 3);
  assert.equal(r[0].isZip, true);
  assert.match(r[0].header, /480p/);
  assert.match(r[1].header, /Episode 2/);
});

test("generic fallback: renamed locker is found, nav/social/same-site are not", () => {
  const html = page(`<h4>Download 720p</h4><a href="https://newlocker.xyz/abc">Download Now</a><a href="https://t.me/x">Download via TG</a><a href="/other/">Download other</a>`);
  const $ = cheerio.load(html);
  const r = findExternalDownloadCandidates($, "https://new2.movies4u.garden/m/");
  assert.deepEqual(r.map((x) => x.url), ["https://newlocker.xyz/abc"]);
});

test("redirect + challenge detection", () => {
  assert.equal(findRedirect(`<meta http-equiv="refresh" content="0; url=/next">`, "https://a.com/x"), "https://a.com/next");
  assert.equal(findRedirect(`<script>window.location.href = "https://b.com/z"</script>`, "https://a.com/x"), "https://b.com/z");
  assert.equal(isChallengePage(`<title>Just a moment...</title>`), true);
  assert.equal(isChallengePage(`<title>Movie</title>`), false);
});
