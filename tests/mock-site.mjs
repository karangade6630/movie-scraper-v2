// Mock of movies4u + link locker + file hosts, all served from one port under different hostnames.
import http from "node:http";
const PORT = Number(process.env.MOCK_PORT || 4010);
const S = `http://movies4u.test:${PORT}`;
const M = `http://m4ulinks.test:${PORT}`;
const H = `http://hubcloud.test:${PORT}`;
const G = `http://gdflix.test:${PORT}`;
const P = `http://pixeldrain.test:${PORT}`;

const nav = `<nav><a href="/">Home</a><a href="/how-to-download/">How</a><a href="https://tinyurl.com/xprime4u">Join</a><a href="https://t.me/+abc">Telegram</a></nav>`;
const wrap = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${nav}${body}<footer><a href="https://t.me/+abc">tg</a></footer></body></html>`;

const card = (title, href, extra = "") => `<article class="post">${extra}<a href="/category/bollywood/">Bollywood</a>${href ? `<h2 class="title"><a href="${href}" rel="bookmark">${title}</a></h2>` : `<h2>${title}</h2>`}<img data-src="/p.jpg"></article>`;

const listing = (q) => {
  const all = [
    card("Rajni The Jailer 2 (2026) Hindi WEB-DL", "/rajni-the-jailer-2-2026-hindi-full-movie/"),
    card("Card With No Link (2026)", null),
    card("Series X Season 1 (2026) Hindi", "/series-x-season-1-2026-hindi/"),
    card("Empty Movie (2026) Hindi", "/empty-movie-2026-hindi/"),
    card("Redirect Movie (2026) Hindi", "/redirect-movie-2026-hindi/"),
  ];
  if (q === null) return all.join("");
  const t = q.toLowerCase();
  const res = [];
  if (t.includes("hidden")) res.push(card("Hidden Gem (2026) Hindi", `${S}/hidden-gem-2026-hindi/`));
  if (t.includes("rajni")) res.push(card("Rajni The Jailer 2 (2026) Hindi WEB-DL", "/rajni-the-jailer-2-2026-hindi-full-movie/"));
  res.push(card("Totally Unrelated Film (2020)", "/unrelated-2020/"));
  return res.join("");
};

const q = (h, href, label = "Download Links") => `<h4>${h}</h4><p><a href="${href}">${label}</a></p>`;
const pages = {
  "/rajni-the-jailer-2-2026-hindi-full-movie/": wrap("Rajni", `<article><div class="entry-content">
      ${q("Download 720p [1.2GB]", `//m4ulinks.test:${PORT}/number/720`)}
      ${q("Download 1080p [2.4GB]", `${M}/number/1080`)}</div></article>`),
  "/hidden-gem-2026-hindi/": wrap("Hidden Gem", `<article><div class="entry-content">${q("Download 720p", `${M}/number/720`)}</div></article>`),
  "/series-x-season-1-2026-hindi/": wrap("Series X", `<article><div class="entry-content">${q("Download 720p", `${M}/number/series`)}</div></article>`),
  "/empty-movie-2026-hindi/": wrap("Empty", `<article><div class="entry-content"><p>Coming soon</p></div></article>`),
  "/redirect-movie-2026-hindi/": wrap("Redirect", `<article><div class="entry-content">${q("Download 480p", `${M}/number/redir`)}</div></article>`),
  "/number/720": wrap("Rajni 720p", `<h3>720p</h3><a href="${H}/drive/r720">HubCloud</a><a href="${G}/file/r720">GDFlix</a><a href="${P}/u/r720">Pixeldrain</a>`),
  "/number/1080": wrap("Rajni 1080p", `<h3>1080p</h3><a href="${H}/drive/r1080">HubCloud</a>`),
  "/number/series": wrap("Series X 720p", `<h3>Episode 1</h3><a href="${P}/u/e1">PX</a><h3>Episode 2</h3><a href="${P}/u/e2">PX</a><h3>Batch Zip</h3><a class="btn-zip" href="${P}/u/zip">PX</a>`),
  "/number/redir": `<html><head><meta http-equiv="refresh" content="0; url=/number/final"></head><body>Redirecting</body></html>`,
  "/number/final": wrap("Final 480p", `<h3>480p</h3><a href="${P}/u/fin">PX</a>`),
  "/drive/r1080": wrap("hub", `<script>var pxl = "${P}/u/hub1080";</script>`),
  "/drive/r720": wrap("hub", `<p>no direct</p>`),
};

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let body = pages[u.pathname];
  if (u.pathname === "/") body = u.searchParams.has("s") ? wrap("Search", listing(u.searchParams.get("s"))) : wrap("Home", listing(null));
  if (u.pathname.startsWith("/page/")) body = wrap("Home", "");
  if (u.pathname.startsWith("/wp-json")) { res.writeHead(404); return res.end("{}"); }
  if (!body) { res.writeHead(404, { "content-type": "text/html" }); return res.end("nf"); }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(body);
}).listen(PORT, () => console.log("mock site on", PORT));
