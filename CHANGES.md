# Link-finding fix

Symptom: `Scraped detail page: https://new2.movies4u.garden/` -> `m4ulinks found: 0`.
The "detail page" was the **homepage**, so there were never any links to find.

## Root causes
1. `scrapePage` used the first `<a>` in each card (category / tag / ad link) and fell back to `BASE_URL` when none -> homepage stored as `detail_url`.
2. `resolveMovieDetailUrl` accepted any stored `http...` URL, so the bad URL was never repaired; `processMovies` also matched unrelated movies on that shared `detail_url`.
3. `scrapeMovieDetail` only recognised literal `m4ulinks` in `href` (no relative / data-href / onclick / inline-JS, no fallback if the locker is renamed).
4. A failed/empty scrape overwrote good links with `[]`.

## What changed
- `src/scrapeUtils.ts` (new): pure parsing helpers (detail-URL validation, listing parser, locker/file-link discovery, redirects, title matching).
- `server.ts`: uses them; refuses non-detail URLs; self-heals bad `detail_url` by searching the site (HTML search + WP REST); follows meta/JS redirects on locker pages; keeps existing links when a scrape finds nothing; one bad movie no longer aborts a whole page; clear errors surfaced to the UI.
- `src/db.ts`: in-memory fallback now supports `$or` / `$in` and a synchronous `find()` (was returning wrong rows / crashing without MongoDB).
- `debug_links.ts`: `npx tsx debug_links.ts <movie-url>` shows exactly what is found at each hop.
- `tests/`: unit tests + integration test (real server vs mock site). `npm test`.

## After deploying
Existing bad records heal themselves the next time you click "Fetch All Qualities" / batch fetch (they get re-resolved by title).
