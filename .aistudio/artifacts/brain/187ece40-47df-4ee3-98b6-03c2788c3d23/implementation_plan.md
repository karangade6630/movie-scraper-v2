# Implementation Plan: Fix Movie Scraper Link Extraction & Single-Server Flow

## Problem Summary
1. **Broken `m4ulinks` Detection**: `server.ts` was hardcoded to check for `m4ulinks.site` URLs. The site currently uses `m4ulinks.sbs` (and other top-level domains), causing zero download links to be detected on movie detail pages.
2. **Outdated HubCloud Extraction**: The scraper previously only looked for `var pxl` (Pixeldrain). HubCloud now generates direct download links via `gamerxyt.com` (`Download [FSL Server]`, `Download [Server : 10Gbps]`, and Cloudflare R2 direct storage links).
3. **Single-Source Resolution Rule**: As requested, for each movie quality/episode, try the primary server (HubCloud direct resolution). If links are found, stop and do not query additional servers. If it fails or returns empty, fall back to the secondary source (GDFlix or the HubCloud direct page). Only one server source per quality/item will be retained.
4. **TV Series Support**: Episodes and batch/zip links should be grouped cleanly by quality (e.g., 480p, 720p, 1080p) with clear episode/batch link badges.
5. **Site Branding & Configuration**: Update the banner in `App.tsx` and header in `Header.tsx` to dynamically reflect `SITE_URL` (`new2.movies4u.garden` instead of hardcoded `new2.movies4u.clinic`) and MongoDB storage. Improve `MovieCard.tsx` link badge styling so labels are not clipped.

---

## Detailed Implementation Steps

### 1. Update Scraper Engine (`server.ts`)
- **Dynamic Site Base URL**: Use `process.env.SITE_URL || "https://new2.movies4u.garden/"` as default.
- **Universal `m4ulinks` Matching**: Detect any intermediate download links matching `/m4ulinks\.[a-z]+/i` or `/m4ulinks/i` on the movie detail page.
- **Single-Server Resolution Flow with Fallback**:
  - For each quality block or episode on the `m4ulinks` page:
    - Attempt primary resolution on HubCloud (`https://hubcloud.*/drive/...`):
      1. Fetch HubCloud page.
      2. If a `Generate Direct Download Link` button exists, fetch the generator URL (e.g. `gamerxyt.com/hubcloud.php?...`) with proper referer headers.
      3. Extract direct download links (`FSL Server`, `10Gbps Server`, direct Cloudflare R2 links, or `var pxl` if present).
      4. If direct download links are found, format and save them immediately; skip secondary servers.
    - If HubCloud resolution fails or produces no links:
      - Attempt fallback to GDFlix (`https://gdflix.*/file/...`) or store the direct HubCloud link with text `"HubCloud DD"`.
- **TV Series & Batch Link Handling**:
  - Extract episode labels (e.g., `Episode 1`, `Episode 2`, `BATCH/ZIP`) and group them under their respective quality headers (e.g., `480p`, `720p`, `1080p`).

### 2. Update UI & MovieCard (`src/components/MovieCard.tsx`, `Header.tsx`, `App.tsx`)
- **`MovieCard.tsx`**:
  - Remove the restrictive `max-w-[60px]` CSS truncation from link badges so full text (e.g. `FSL Server`, `10Gbps`, `Ep 01`, `Zip Batch`) is cleanly visible.
  - Group links logically with distinct badge colors for direct download vs stream vs batch.
- **`Header.tsx` & `App.tsx`**:
  - Dynamically display the current source URL (`new2.movies4u.garden`) and explicitly reference MongoDB storage.
  - Expose the current scraper site domain in the header and banner.

### 3. Verification & Testing
- Run test scrapes on single movies and multi-episode TV series.
- Verify that links are properly parsed, stored in MongoDB, and rendered in the UI with working download URLs.
- Run `npm run lint` and `npm run build` to ensure clean build output.
