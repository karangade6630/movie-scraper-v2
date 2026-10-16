// Runs the REAL server.ts against the mock site and asserts on API results.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const MOCK = 4010, APP = 4020;
process.env.MOCK_PORT = String(MOCK);
const procs = [];
const run = (cmd, args, env = {}) => { const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }); p.out = ""; p.stdout.on("data", d => p.out += d); p.stderr.on("data", d => p.out += d); procs.push(p); return p; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, method = "GET", body) => { const r = await fetch(`http://127.0.0.1:${APP}${path}`, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
const links = m => (typeof m.links === "string" ? JSON.parse(m.links) : m.links);
let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "\n   ", e.message); } };

run("node", ["tests/mock-site.mjs"], { MOCK_PORT: String(MOCK) });
const server = run("node", ["--import", "tsx", "--import", "./tests/seed.ts", "server.ts"], { PORT: String(APP), NODE_ENV: "production", MONGODB_URI: "", SITE_URL: `http://movies4u.test:${MOCK}/` });
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${APP}/api/config`); break; } catch { await sleep(500); } }

try {
  await t("scrape listing: only real detail URLs, linkless card skipped, links extracted", async () => {
    const { json } = await api("/api/scrape", "POST", { startPage: 1, endPage: 1 });
    assert.equal(json.success, true, JSON.stringify(json));
    const all = (await api("/api/movies?limit=100")).json;
    const movies = all.movies || all;
    const byTitle = Object.fromEntries(movies.map(m => [m.title, m]));
    for (const m of movies.filter(x => x.id > 104 || x.id < 101)) assert.notEqual(m.detail_url.replace(/\/$/, ""), `http://movies4u.test:${MOCK}`, `homepage stored for ${m.title}`);
    assert.ok(!byTitle["Card With No Link"], "linkless card should be skipped");
    const rajni = byTitle["Rajni The Jailer 2 Hindi WEB-DL"]; assert.ok(rajni, "rajni missing: " + Object.keys(byTitle));
    const q = links(rajni).map(g => g.quality).sort();
    assert.deepEqual(q, ["1080P", "720P"]);
    const g720 = links(rajni).find(g => g.quality === "720P").links[0];
    assert.match(g720.url, /pixeldrain\.test.*\/api\/file\/r720/);
    const g1080 = links(rajni).find(g => g.quality === "1080P").links[0];
    assert.match(g1080.url, /hub1080/, "hubcloud var pxl should resolve");
    const series = byTitle["Series X Season 1 Hindi"]; assert.ok(series);
    const texts = links(series).flatMap(g => g.links.map(l => l.text));
    assert.ok(texts.some(x => /Ep 01/.test(x)) && texts.some(x => /Ep 02/.test(x)) && texts.some(x => /Batch Zip/.test(x)), texts.join("|"));
    const redir = byTitle["Redirect Movie Hindi"]; assert.ok(redir);
    assert.match(JSON.stringify(links(redir)), /fin/, "meta-refresh locker should be followed");
    assert.deepEqual(links(byTitle["Empty Movie Hindi"] || { links: [] }), []);
  });

  await t("fetch-links heals homepage detail_url (id 101) via site search", async () => {
    const { status, json } = await api("/api/movies/101/fetch-links", "POST", {});
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.movie.detail_url, `http://movies4u.test:${MOCK}/hidden-gem-2026-hindi/`);
    assert.equal(links(json.movie).length, 1);
  });

  await t("fetch-links rebases old-domain URL (id 102)", async () => {
    const { status, json } = await api("/api/movies/102/fetch-links", "POST", {});
    assert.equal(status, 200, JSON.stringify(json));
    assert.ok(json.movie.detail_url.startsWith("http://movies4u.test:"));
    assert.equal(links(json.movie).length, 2);
  });

  await t("fetch-links with no links on page keeps existing links (id 103)", async () => {
    const { status, json } = await api("/api/movies/103/fetch-links", "POST", {});
    assert.equal(status, 404); assert.match(json.error, /No download links found/);
    const m = (await api("/api/movies?limit=100")).json; const mv = (m.movies || m).find(x => x.id === 103);
    assert.match(JSON.stringify(links(mv)), /keep\.me\/1/);
  });

  await t("fetch-links for unfindable movie gives clear error, keeps links (id 104)", async () => {
    const { status, json } = await api("/api/movies/104/fetch-links", "POST", {});
    assert.equal(status, 500); assert.match(json.error, /Could not find the detail page/);
    const m = (await api("/api/movies?limit=100")).json; const mv = (m.movies || m).find(x => x.id === 104);
    assert.match(JSON.stringify(links(mv)), /keep\.me\/2/);
  });

  await t("batch-fetch-links works for a mix", async () => {
    const { json } = await api("/api/movies/batch-fetch-links", "POST", { ids: [101, 102, 103, 104] });
    assert.equal(json.success, true); assert.equal(json.updatedCount, 2, JSON.stringify(json.updatedCount));
  });
} finally {
  procs.forEach(p => p.kill());
  if (failed) { console.log("\n--- server log tail ---\n" + server.out.split("\n").slice(-60).join("\n")); }
  console.log(failed ? `\n${failed} FAILED` : "\nALL INTEGRATION TESTS PASSED");
  process.exit(failed ? 1 : 0);
}
