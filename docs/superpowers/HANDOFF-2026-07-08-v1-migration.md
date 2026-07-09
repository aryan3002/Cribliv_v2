# Handoff — 2026-07-08 (v1→v2 migration + SEO/blog state)

Self-contained handoff for a fresh chat. Current focus: **v1→v2 listing migration**
(in the brainstorming→spec phase). Broader SEO/blog program is feature-complete +
deployed. Read the spec at
`docs/superpowers/specs/2026-07-08-v1-v2-listing-migration-design.md` (PR #31).

---

## 🎯 ACTIVE THREAD — v1→v2 listing migration

**Where we are:** spec written + committed (PR #31), **awaiting user review**. Next
step per the brainstorming flow = invoke **`superpowers:writing-plans`** to turn the
spec into an implementation plan, then **build the dry-run script first**
(`scripts/migrate-v1-listings/`, report-only), user runs it, then `--apply`
local→prod. Nothing runs until the user approves + runs it (all writes are theirs).

**v1 source (MongoDB Atlas, DB `test`, cluster `atlas-two13u-shard-0`):** the user
has it open in MongoDB Compass ("CribLiv DB"). **No live URL was given to the
sandbox — by design.** All inspection is the user pasting read-only `mongosh` into
Compass. Collections: `properties` (93 total, **67 verified**), `pgs` (35 total,
**19 verified**), `users` (295), + tours/inquiryforms/saleproperties/etc (out of
scope).

**v1 SCHEMA (discovered — the important part):**

- **`properties`** (→ v2 `flat_house`): `_id`, `userId`, `owner`, `ownerEmail`,
  **`ownerPhone`** (10-digit string, **67/67 verified have it**), address
  (`houseNum`/`society`/`landmark`/`city`/`state`/`country`/`pincode`),
  `bedrooms`/`bathrooms`/`balconies` (num), `furnishing`, `type` ∈
  {Apartment, House/Villa, Independent House, Single Rooms, Villa}, `floor`, `area`,
  `amenities[]`, `expected_rent`, `expected_deposit`, `monthly_main`, `avail_from`
  (Date), `pref_tenant`, `description`, `images[]` (**EMPTY/legacy — ignore**),
  `verified` (bool), `location` = GeoJSON `{type:Point, coordinates:[lng,lat]}`,
  `cityLocation`, **`nameListing`** (title), **`cloudinary_public_ids[]`** (THE
  photos, **67/67**), `createdAt`/`updatedAt`.
- **`pgs`** (→ v2 `pg`): same base + `rooms[]` (`roomNumber`, `beds[{type,count}]`,
  `bathrooms[{type}]`, `kitchens[]`, `balconies[]`, per-room `expected_rent`/
  `expected_deposit`, `floor`, `area`), `amenities[]` (`{amenityName, amenityImages,
_id}`), `services[]`, **NO `ownerPhone`** (0/19), `cloudinary_public_ids` (19/19),
  `type='PG'`.
- **`users`**: `name`, `email`, `verified`, `authenticated`, `userType` — **NO phone**.
- **Cities (verified set):** Gurugram, Lucknow, **`"Lucknow "` (trailing space!)**,
  Varanasi. **Varanasi is NOT in v2's `cities`** → must add.

**Photos:** Cloudinary, cloud name **`dia01qg8p`**. `public_id` format
`cribliv/properties/<v1id>/<file>.png`; URL =
`https://res.cloudinary.com/dia01qg8p/image/upload/<public_id>`. **All 86 verified
have photos.**

**Excel (owner-phone supplement):** `/Users/aryantripathi/Downloads/Cribliv_Property_Location.xlsx`,
sheet **"Property Master"**, ~999 rows. Headers: Property Link, Google Maps Link,
**Property Name** (≈ `nameListing`, the join key), Property Type, **Owner Name**,
**Owner Mobile** (10-digit, stored as float `.0`), Full Address, Rent, Deposit,
Furnished Status, Floor, Notes.

**DECISIONS LOCKED:**

- Scope = **verified only** (67 props + 19 pgs = 86).
- Photos = **COPY to Azure** (not reference) — survives v1 decommission.
- Owner phone = **3-tier**: Mongo `ownerPhone` → Excel by name-match → single
  **"Cribliv Import" owner account** fallback (+ manual-review report).
- **Migration 0051** = new `v1_migration_map` table (v1_id → v2_listing_id +
  owner_source) = idempotency key AND the 301 redirect source.

**OPEN INPUT (non-blocking):** the live **v1 listing URL format** (e.g.
`cribliv.com/property/<id>`) — only needed later to render the 301 map.

**User's last note:** "I think property has owner numbers" — yes, properties are
67/67; the gap is PGs. If the user says PGs now have phones, re-verify:

```js
// paste in Compass mongosh (read-only)
print(
  "props w/ ownerPhone:",
  db.properties.countDocuments({ verified: true, ownerPhone: { $nin: ["", null] } })
);
print(
  "pgs w/ ownerPhone:",
  db.pgs.countDocuments({ verified: true, ownerPhone: { $nin: ["", null] } })
);
```

---

## ✅ DONE + DEPLOYED — SEO blog program ("Cribliv Times")

All merged to master + live (API = Azure Container App `cribliv-api` RG `Cribliv`,
web = Vercel prod `cribliv-v2-web`). Blog is **feature-complete**:

- Engine + CRIBLIV TIMES newspaper front end (#21, #22)
- **Generate a post** button + demo seed (#23) · **Plan topics** autonomous drafting
  - planner/data-quality fixes (#24)
- **Preview** drafts + quality report (#25) · **Edit** drafts — direct + AI-revise (#26)
- **Content → conversion**: matched listings on articles + `?ref=blog-{slug}` →
  clicks→unlocks attribution + "Top converting posts" admin panel (#27)
- **Data Desk charts** — inline SVG rent bar chart baked into data posts (#28)
- Conversion panel **empty-state** always-visible (#29)

**Prod DB at migration `0050`** (`contact_unlocks.source`). Next free = **0051**.

**Critical prod fixes this session (persisted in memory `prod-azure-openai-key-broken`):**

- `cribliv-api` secret `azure-openai-api-key` was a **10-char placeholder → 401**;
  fixed to the resource's real `key1` (84 char) + set **`SEO_BLOG_TIMEOUT_MS=90000`**
  (20s default aborted the big LLM steps). Generation works now.
- **`cribliv-worker` is STILL stale/broken** (June image w/o blog code, `FF_SEO_BLOG`
  off, same 10-char key, no timeout). Autonomous blog won't run until it's redeployed
  - configured — a cutover-time task.

**CI flake:** the `validate` job intermittently fails with
`Cannot find module '@cribliv/shared-types'` (workspace build-order) — harmless
(code is fine), but master occasionally shows red. Worth a real CI fix (build deps
before typecheck).

**Local SEO demo (fully seeded):** `scratchpad/seo-local-demo.sql` populates local
`cribliv_v2` so every SEO admin tab shows data (blog queue all-statuses, Search
Performance rankings+quick-wins+indexing, Programmatic SEO cities, Top converting
posts). Local API on `:4000` (points at local dev DB), web on `:3100` (was killed —
`preview_start "Web (Next.js, alt port)"` to restart). Admin login = phone
`+919999999903` via OTP mock (`/auth/otp/send` returns `dev_otp`; NextAuth callback
`/api/auth/callback/credentials` + localStorage `cribliv:auth-session`).

## Remaining SEO roadmap slices (`docs/superpowers/2026-07-04-seo-program-roadmap.md`)

1–3 done. **4** NCR city data (seeded, enable at cutover). **5** Listing-level SEO
(slugs+FAQ schema+alt text — buildable now, no GSC dep). **6** Market reports (data
moat / backlinks). **7** AEO/llms.txt. **8** Regional/Hindi. **9** Link building.
**10** Topical clustering + internal linking (`BlogEmbeddingService` scaffolded).
**Everything SEO is dormant behind `FF_SEO_*` (off) until the cribliv.com cutover** —
the migration above is a cutover prerequisite (produces the 301 map).

## Constraints (do NOT violate)

- `apps/api/.env` `DATABASE_URL` = **Azure PROD** (`cribliv-db…/cribliv`). Never
  migrate/seed/DB-test against it; the sandbox guard blocks prod writes — **the USER
  runs them** (prepare the command). Read-only prod `psql` SELECTs are fine.
- Local DEV DB `postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2`; TEST
  `…/cribliv_test`. v2 prod users are TEST accounts; real traction is on v1.
- **PR flow:** branch → PR → **squash-merge** (guard blocks direct master push AND
  self-merge — the user clicks merge). Commits end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Mongo (v1):** read-only, user pastes `mongosh` in Compass; never hand a live
  write-capable credential to the sandbox.
- Vercel prod sometimes needs a manual **Promote to Production** after a master merge
  (it auto-deployed for #27 but not #24).

## Memory files (auto-loaded across chats)

`prod-azure-openai-key-broken`, `seo-domain-cutover`, `seo-program-sequencing`,
`cribliv-v2-rebuild-context`, `v2-prod-db-test-accounts`, `api-env-precedence-azure`,
`prefers-pr-flow-for-integration`, + a new `v1-v2-migration` (this thread).
