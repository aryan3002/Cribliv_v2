# v1 → v2 cribliv.com Cutover — Master Runbook

- **Date:** 2026-07-11
- **Status:** Runbook — execute this week
- **Owner:** Aryan (all prod-touching steps; sandbox is blocked from prod writes)
- **Decisions locked (2026-07-11):** data migration **already done on prod** · timeline **this week** · **free launch first** (no paywall) · free-launch mechanic = **grant generous free credits** (keep the callback model, reversible)

This is the single ordered plan that ties together the three existing workstreams so nothing is missed at the flip. It does **not** re-document them — it references and sequences them:

- Data migration: [`RUNBOOK-v1-migration-prod.md`](../RUNBOOK-v1-migration-prod.md) — **done**, kept for the verify SELECT + rollback.
- SEO-safe launch procedure: [`specs/2026-07-04-cutover-seo-runbook-design.md`](2026-07-04-cutover-seo-runbook-design.md).
- Migration internals: [`specs/2026-07-08-v1-v2-listing-migration-design.md`](2026-07-08-v1-v2-listing-migration-design.md).

**Risk level:** LOW-MEDIUM. v1's SEO footprint is tiny (374 clicks/3mo, 62% brand). The real risk isn't SEO — it's **v2 serving real users for the first time** (real OTP login, no dead-end paywall, worker alive). The gates in §1 cover that.

---

## 0. Current state (grounded 2026-07-11)

| Piece                                                                             | State                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| v2 data migration (**87** listings: 67 flats + 20 PGs, photos→Azure, PostGIS geo) | ✅ done on prod                                                        |
| Migration `0052_v1_migration_map` (301 source)                                    | ✅ applied on prod                                                     |
| SEO indexing/measurement code (slice 2)                                           | ✅ merged, dormant behind `FF_SEO_INDEXING` / `FF_SEO_GSC`             |
| Contact-unlock monetization                                                       | ✅ merged, flag **ON** by default (callback model)                     |
| Misspelling/alias 301s                                                            | ✅ live in `apps/web/next.config.mjs`                                  |
| **v1 301 redirect map** (`/properties/…`, `/pgs/…` → v2)                          | ⛔ **not built** — this runbook §3                                     |
| **Free-launch credit lever**                                                      | ⛔ **not built** — signup grant hardcoded to 2 (`auth.service.ts:242`) |
| **`cribliv-worker`**                                                              | ⚠️ stale June image, 10-char OpenAI key, `FF_SEO_BLOG` off             |
| **GCP service account** (GSC/Indexing API)                                        | ⚠️ not created                                                         |
| **`OTP_PROVIDER=d7` on prod**                                                     | ❓ must verify (§1)                                                    |

---

## 1. Gates — must be true before the DNS flip

- [ ] **G1 — Real login works.** Prod `cribliv-api` has `OTP_PROVIDER=d7` + a valid `D7_KEY`. On `mock`, **real users cannot log in.** Verify by sending yourself an OTP to a real number on the v2 (vercel.app) site end-to-end.
- [ ] **G2 — No dead-end paywall.** The free-credit lever (§4) is shipped and `SIGNUP_FREE_CREDITS` is set high in prod. Confirm a fresh signup gets the large balance and can unlock/callback without ever seeing a payment wall (Razorpay is intentionally not wired for launch).
- [ ] **G3 — Redirects deployed.** The v1 301 map (§3) is merged and live on the v2 deployment (dormant until DNS points at it).
- [ ] **G4 — Worker alive.** `cribliv-worker` redeployed with current image + real OpenAI `key1` + `SEO_BLOG_TIMEOUT_MS=90000`. Embeddings/AI-ranking depend on it.
- [ ] **G5 — Data sanity.** Migration verify SELECT holds the invariant `map == listings, fakes == 0, geo ≈ listings` (currently **87** = 67 flats + 20 PGs), and the **5 flagged duplicate flats** (Parag Road, Rashmi Khand, LDA Sector-F, Takrohi×3) are hidden/merged in v2 admin.

G3 + G4 are code/deploy tasks (§3, §4). G1, G2, G5 are prod verification you run.

---

## 2. Phase 0 — Pre-flight (today, read-only, ~1 hr)

1. **Re-verify migration** (read-only prod psql — safe):
   ```bash
   psql "$PROD_DATABASE_URL" -c "
     SELECT (SELECT count(*) FROM v1_migration_map) map,
            (SELECT count(*) FROM listings) listings,
            (SELECT count(*) FROM listings WHERE id NOT IN (SELECT v2_listing_id FROM v1_migration_map)) fakes,
            (SELECT count(*) FROM listing_locations WHERE geo_point IS NOT NULL) geo;"
   ```
   Expect the invariant `map == listings, fakes == 0, geo ≈ listings` (currently `87 / 87 / 0 / ≈87`).
2. **Spot-check 4–5 migrated pages** on the current v2 (vercel.app): photos load (Azure), map pins render (PostGIS), amenities render, contact reveal/callback works. **Include a Gurugram and a Varanasi listing** — confirm their detail pages resolve (the migrated set isn't Lucknow-only, and their redirect targets in §3 depend on those routes working).
3. **Hide/merge the 5 duplicate flats** (G5) in v2 admin.
4. **G1 login test** — real OTP to a real phone.
5. **Sitemap** — `GET /sitemap_index.xml` on v2 returns 200 with URLs.

---

## 3. Phase 1 — Build + ship the v1 301 redirect map (code)

**Why:** v1's ranked URLs are `cribliv.com/properties/<slug>-<24hexId>` and `cribliv.com/pgs/<…-id>` / `/pgs/<id>`. `v1_migration_map` stores `v1_id` (the 24-hex Mongo ObjectId) + `v2_listing_id`, so redirects match on the **trailing ObjectId**, not the slug.

**Approach (recommended): data-driven middleware, not a hand-curated list.**

1. **Generate `apps/web/lib/v1-redirects.generated.json`** from prod (you run a read-only SELECT, commit the JSON). Shape:
   ```json
   { "<v1_id>": { "t": "listing"|"pg", "id": "<v2-uuid>", "city": "<city-slug>" } }
   ```
   Reads all 87 rows of `v1_migration_map` (not just the GSC-ranked ones, so every old deep link resolves), joined to each listing's **city** for the PG target. ⚠️ The migrated set spans **Gurugram / Lucknow / Varanasi**, so the city segment is real, not cosmetic — the exact city-slug source (a join from the listing's location to the `cities` table) is resolved against the live schema during implementation; do **not** hardcode `lucknow`.
2. **Extend `apps/web/middleware.ts`:** before the locale/role logic, if the path matches `^/(properties|pgs)/`, extract the trailing `[a-f0-9]{24}`, look it up in the generated JSON:
   - hit, `listing` → **301** `/en/listing/<id>`
   - hit, `pg` → **301** `/en/pg/<city>/<id>`
   - miss → **301** category fallback `/en/city/lucknow`
     Extend the middleware `matcher` to include `/properties/:path*` and `/pgs/:path*` (currently un-prefixed paths bypass it).
3. **Verify:** the **GSC Pages export is already in hand** — `~/Downloads/cribliv/Pages.csv` (63 indexed pages, **58 currently 404** on v1 → the map is what recovers that equity). `curl -I` every ranked old URL → expect `301` → v2 `200`. No 404s on the top pages.
4. PR → squash-merge → confirm Vercel deploys. Dormant until DNS flips.

**Alternative considered:** static `redirects()` entries in `next.config.mjs` for ~32 GSC URLs. Rejected — brittle (misses un-ranked deep links, hardcodes slugs). The middleware+JSON covers all 87 by stable ID.

---

## 4. Phase 2 — Infra readiness (parallel with §3)

- [ ] **Free-credit lever (code, G2).** Env-ify the signup grant: `auth.service.ts:242` `VALUES ($1::uuid, 2, 2)` → read `SIGNUP_FREE_CREDITS` (default 2) for both columns. Set `SIGNUP_FREE_CREDITS` high in prod (e.g. 999) at launch; dial back to the intended value the day Razorpay goes live. Small PR alongside §3.
- [ ] **Redeploy `cribliv-worker`** (G4): current image, real OpenAI `key1` (84-char, not the 10-char placeholder), `SEO_BLOG_TIMEOUT_MS=90000`, correct flags.
- [ ] **GCP service account** (can trail cutover by ~1 day): create SA → enable Search Console API + Indexing API → add the SA email as a **user on the cribliv.com GSC Domain property** → stage prod env `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL=sc-domain:cribliv.com`, `GOOGLE_INDEXING_DAILY_QUOTA=200`.
- [ ] **Pre-cutover indexability:** confirm the current vercel.app deploy is `noindex` / canonical'd to cribliv.com so it isn't indexed as a duplicate before the flip.

---

## 5. Phase 3 — Cutover day (ordered — do NOT reorder)

1. **Point cribliv.com at v2** (DNS / Vercel domain → v2 production deployment). Redirects (§3) are already live on that deployment.
2. **Homepage 200** — `https://cribliv.com/` serves v2 and is **not** redirected (protects 62% brand traffic).
3. **Spot-check redirects** — `curl -I` the top ~10 v1 URLs → `301` → correct v2 `200`.
4. **Submit sitemap** — GSC → Sitemaps → `https://cribliv.com/sitemap_index.xml`.
5. **Flip `FF_SEO_INDEXING`** → the Indexing API drains the high-value queue.
6. **Flip `FF_SEO_GSC`** → the first weekly poll seeds `keyword_rankings`.
7. **Request indexing** for the homepage + top pages via GSC URL Inspection.

- **Keep v1 deployable ~2 weeks** — DNS reverts to v1 instantly if something is badly wrong.

---

## 6. Phase 4 — Post-cutover (first 2–4 weeks)

- **GSC Coverage:** temporary dip → recovery as v2 URLs index. A _permanent_ drop on an old top URL = a redirect gap → fix that redirect.
- **404 watch:** GSC → Pages → "Not found (404)" on old `/properties/*`, `/pgs/*`.
- **Rankings:** brand queries hold; migrated PG pages retain/gain position (`keyword_rankings` / admin Search Performance).
- **Monetization (separate, later):** when Razorpay prod env + product sign-off are ready, dial `SIGNUP_FREE_CREDITS` back and turn payments live per the lead-monetization program. This is deliberately _out_ of the cutover.

---

## 7. Rollback

- **Fast path:** revert DNS to v1 (keep v1 deployable ~2 weeks). Redirects and flags are additive and don't touch v1.
- **Flags:** `FF_SEO_INDEXING` / `FF_SEO_GSC` are independently switchable off.
- **Credits:** `SIGNUP_FREE_CREDITS` is a single env — lower it anytime.
- **Data:** the migration is the risky irreversible piece and it's already done + verified; `v1_migration_map` is the record of exactly what was created (see the migration runbook's rollback section).

---

## 8. Success criteria

Brand traffic uninterrupted · real users log in via D7 OTP · no dead-end paywall (generous free credits) · the ~5–10 ranked v1 URLs 301 to live v2 pages (no 404s) · sitemap submitted + coverage climbing within 1–2 weeks · worker alive (embeddings/ranking/blog) · v1 retained as rollback for 2 weeks.

---

## 9. What I build vs what you run

- **I build (PRs):** §3 v1 301 redirect middleware + generator, §4 `SIGNUP_FREE_CREDITS` env lever. Both small; go through writing-plans → PR → your squash-merge.
- **You run (prod, sandbox-blocked):** all env changes (`OTP`, `SIGNUP_FREE_CREDITS`, GSC), worker redeploy, the read-only SELECTs, DNS flip, flag flips, GSC actions.

---

## 10. Housekeeping (not cutover-blocking, but do it)

- [ ] **Rotate the v1 Mongo password** — it was exposed in chat during the migration. v1's Mongo is decommissioned at cutover anyway, but rotate it now regardless.
- [ ] **Add Varanasi to `seo_city_config`** before enabling programmatic SEO there (its listings' _detail_ pages already work; this is only for the `/city/varanasi` landing pages).
- [ ] **Merge the migration tooling PR** (#38, if still open) so the migration code + `0052` live on master — not a data blocker (prod is already migrated), just repo hygiene.
