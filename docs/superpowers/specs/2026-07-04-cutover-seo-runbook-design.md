# v1 → v2 Cutover — SEO Runbook

- **Date:** 2026-07-04
- **Status:** Runbook (execute at cutover, ~mid-July 2026)
- **Context:** v2 (this codebase) fully replaces v1 at **cribliv.com**; the whole v1 catalog (MongoDB) migrates into v2 (Postgres). The cutover is when SEO turns on. See [roadmap](../2026-07-04-seo-program-roadmap.md), [slice-2 spec](2026-07-04-slice2-indexing-measurement-design.md).
- **Risk level:** LOW. v1's footprint is tiny (374 clicks/3mo, 62% brand, 32 indexed pages) — but do these steps anyway; they're cheap and one is irreversible.

---

## 0. The one irreversible prerequisite (lock in NOW, before the migration runs)

> **The data migration MUST persist, for every listing it moves, the old v1 ID/URL → new v2 ID/slug mapping** (e.g. a `migration_url_map(old_path text, old_mongo_id text, new_path text, new_id text)` table or CSV). If the migration runs and discards the MongoDB ObjectIds, the 301 map is **impossible to build** and those rankings die permanently. Trivial to capture during migration, unreconstructable after. **This is the #1 thing to tell whoever builds the migration.**

## 1. What actually carries SEO equity (from v1 GSC)

- **Brand (62% of clicks):** `cribliv`, `cribliv homes` → the homepage. **Protected automatically** as long as the v2 homepage stays at `https://cribliv.com/` (200, not redirected). No action beyond "don't break the homepage."
- **Non-brand (~140 clicks/3mo):** ~5–10 Lucknow PG/property URLs — Dayal Residency + PG-near-Amity/BBD. These are the ones the redirect map must cover:
  - `cribliv.com/properties/<slug>-<mongoId>` (listings)
  - `cribliv.com/pgs/<slug>-<mongoId>` and `cribliv.com/pgs/<mongoId>` (PGs)
- **32 indexed pages total** → the full map is small.

## 2. The 301 redirect map (built from §0's URL map)

Rules, in priority order (all **301 permanent**, host-level on cribliv.com):

| v1 pattern                                     | v2 target                                                         | Source     |
| ---------------------------------------------- | ----------------------------------------------------------------- | ---------- |
| `/` (homepage)                                 | `/` (v2 home) — **no redirect**                                   | keep       |
| `/properties/<…-mongoId>`                      | exact v2 listing `/en/listing/<newId>` if migrated                | §0 URL map |
| `/pgs/<…-mongoId>`, `/pgs/<mongoId>`           | exact v2 PG `/en/pg/<city>/<newId>` if migrated                   | §0 URL map |
| any `/properties/*` / `/pgs/*` with no mapping | category fallback `/en/pg/lucknow` (or `/en/search?city=lucknow`) | fallback   |
| everything else on cribliv.com                 | leave to v2 routing / v2 404                                      | —          |

- **Implementation:** since v2 is on Vercel, use `next.config.mjs` `redirects()` for pattern rules + a generated list (from the §0 URL map) for the exact-ID mappings. For a large map, a lightweight edge/middleware lookup or a `redirects` JSON is fine — but v1 only has ~32 URLs, so a static list is plenty.
- **Locale:** v1 URLs are un-prefixed; v2 is `[locale]`-prefixed. Redirect targets go to `/en/...` (or let the locale middleware add it).
- **Trailing slashes / www:** normalize to one canonical form (v2 already does).

## 3. Pre-cutover checklist (the 1–2 weeks before)

- [ ] **Slice 2 built + merged** (behind flags, all tests green) — the indexing/measurement code, ready to flip on.
- [ ] **§0 URL map exists** from the migration (old→new for every listing).
- [ ] **Redirect map generated** from §0 + the category fallbacks (§2), reviewed.
- [ ] **GCP service account** created, Search Console API + Indexing API enabled, service-account email added as a **user on the cribliv.com GSC property**; JSON key ready for `GSC_SERVICE_ACCOUNT_JSON`.
- [ ] **Env prepared** for prod: `GSC_SITE_URL=sc-domain:cribliv.com`, `GSC_SERVICE_ACCOUNT_JSON`, `GOOGLE_INDEXING_DAILY_QUOTA=200`.
- [ ] **Vercel deploy currently noindexed / canonical'd to cribliv.com** so the vercel.app URL isn't indexed pre-cutover.
- [ ] **v2 sitemap reachable** at `/sitemap_index.xml` on the cutover domain.
- [ ] **Real inventory migrated** so programmatic city/locality pages clear the ≥3-listings bar (this is what makes them index at all).

## 4. Cutover-day runbook (ordered — do NOT reorder)

1. **Deploy v2 to production** on cribliv.com (point the domain at the v2 Vercel deployment).
2. **Redirects live** — the 301 map (§2) is active _at the same time_ as the DNS flip (so no window where old URLs 404).
3. **Homepage 200** — verify `https://cribliv.com/` serves v2 and is not redirected.
4. **Spot-check redirects** — `curl -I` the top ~10 v1 URLs → expect `301` → correct v2 target `200`.
5. **GSC property** — confirm cribliv.com (Domain property) still verified; add the service account as a user if not already.
6. **Submit the sitemap** — GSC → Sitemaps → submit `https://cribliv.com/sitemap_index.xml`.
7. **Flip `FF_SEO_INDEXING`** → the queue drains high-value URLs to the Indexing API.
8. **Flip `FF_SEO_GSC`** → the first weekly poll seeds `keyword_rankings`.
9. **Request indexing** for the homepage + top pages via GSC URL Inspection (manual nudge).

## 5. Post-cutover monitoring (first 2–4 weeks)

- **Coverage** (GSC → Pages): expect a temporary dip then recovery as v2 URLs get indexed. A _permanent_ drop = a redirect gap → fix that redirect.
- **Redirects**: no 404s on the old top URLs (check GSC → Pages → "Not found (404)").
- **Rankings** (`keyword_rankings` / admin Search Performance tab): brand queries hold; the migrated PG pages retain/gain position.
- **Sitemap**: submitted URLs → "Discovered/Indexed" climbing.
- **Rollback:** DNS can revert to v1 quickly if something is badly wrong; keep v1 deployable for ~2 weeks post-cutover as a safety net.

## 6. Success criteria

Brand traffic uninterrupted · the ~5–10 ranking URLs 301 to live v2 pages (no 404s) · sitemap submitted + coverage climbing within 1–2 weeks · `keyword_rankings` populating · programmatic pages beginning to index now that they have real inventory.

## 7. What this runbook is NOT

Not the data migration itself (separate workstream — it only must satisfy §0) and not slice-2's code (see its plan). This is the SEO-safe _launch procedure_ that ties them together.
