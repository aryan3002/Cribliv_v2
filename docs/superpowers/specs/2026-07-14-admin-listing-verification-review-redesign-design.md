# Admin Listing & Verification Review Redesign — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Author:** Aryan + Claude

## 1. Problem

The admin review surfaces are effectively blind. A reviewer approves or rejects a
property, and passes or fails a verification, without being able to see the thing
they are judging.

- **Listing Review** (`apps/web/components/admin/tabs/ListingReviewTab.tsx`): the
  go-live moderation gate. Clicking a queue row opens a drawer that shows only
  `Type`, `City`, `Rent`, `Status`, `Verification` badge, `Submitted` date, and a
  reason box. **No photos, no owner identity (just a truncated UUID), no
  description, no bedrooms/bathrooms/area, no amenities, no address, no map, no PG
  details.** The backing query (`GET /admin/review/listings`) does not even fetch
  them.
- **Verification Review** (`apps/web/components/admin/tabs/VerificationTab.tsx`):
  shows scores like "liveness 82" and "address match 91" but provides **no way to
  watch the liveness video or open the electricity bill**, and no property/owner
  context. The reviewer decides pass/fail on a number alone.

All the underlying data already exists in the database (listings, listing_photos,
listing_locations, pg_details, pg_room_types, users, verification_attempts with
`artifact_paths`). It is simply never fetched or rendered in these two surfaces.

## 2. Goals

1. A **full-screen listing review workspace** that shows _everything_ about a
   listing and its owner on one screen, for both `flat_house` and `pg` listings,
   with the existing Approve / Reject / Pause decision.
2. A **secure verification evidence viewer**: the reviewer can watch the liveness
   video and open the electricity bill inline, alongside scores-vs-threshold and
   the property/owner the evidence belongs to.
3. Reuse the evidence viewer in **both** the listing workspace (embedded) and the
   **verification review** (dedicated, with Pass / Fail / Manual-review).
4. Full owner profile: real name, phone, WhatsApp, language, member-since, other
   listings, report/health signals, blocked flag.
5. Graceful empty states when photos, verification, or PG data are absent.

## 3. Non-goals

- **No editing** of listing or owner data from the review surfaces. Review is
  read-and-decide only; the PG management console
  (`components/admin/pg-properties/*`) remains the edit tool.
- No new owner-level KYC or email fields — they do not exist in the data model
  (owner verification is per-listing). We surface only real, existing signals.
- No changes to the owner-facing verification submission flow
  (`apps/api/src/modules/verification/*`).
- No Aadhaar / eKYC work (stubbed, out of scope).
- Listing photos remain public-URL served (as today); we do not move them behind
  SAS. Only the private verification artifacts get short-lived links.

## 4. Layout (approved: Option B — full-screen workspace)

Both surfaces render as a **view swap within the existing tab**, not a new
Next.js route. `AdminShell` is tab-state driven; each tab gets a `list` mode
(the current queue table) and a `detail` mode (the workspace). A Back control
returns to the queue.

### 4.1 Listing review workspace

Two columns + a sticky decision bar.

- **Left (media):**
  - Photo gallery — cover + thumbnails, lightbox, per-photo `moderation_status`
    badge (approved / pending / rejected).
  - Location — map pin (lat/lng), full address, locality + city, pincode,
    landmark, and the masked public address.
- **Right (info, scrolls):**
  - Header — title (EN + HI), `listing_type` + `status` + `verification_status`
    badges, submitted date, copyable listing id.
  - **Owner trust card** — avatar, `full_name`, tap-to-call `phone_e164`,
    WhatsApp opt-in, `preferred_language`, member-since (`created_at`),
    active-listings count, report count, owner-health, `is_blocked` flag (red),
    "open owner" drill-down.
  - **Property details** — `monthly_rent`, `security_deposit`, `bhk`,
    `bathrooms`, `area_sqft`, `furnishing`, `available_from`, `preferred_tenant`,
    `whatsapp_available`.
  - Description (EN + HI toggle).
  - Amenities (chips) + rules.
  - **PG block** (only when `listing_type = 'pg'`) — `total_beds`,
    `gender_policy`, meals, curfew, notice/lock-in, electricity mode, and a
    room-types table (sharing / AC / bathroom / rent / vacancy).
  - **Verification evidence** (embedded `VerificationEvidence`) — the listing's
    latest attempt per type, with secure play-video / open-bill + score meters.
- **Sticky decision bar** — reason textarea (required for reject/pause) + Pause /
  Reject / Approve. Unchanged semantics from today; still writes `admin_actions`
  and notifies the owner.

### 4.2 Verification review view

Two columns + sticky decision bar.

- **Left:** the evidence, large — secure video player, or the bill (PDF/image)
  with zoom, depending on `verification_type`. Plus the machine score with the
  threshold marked (red line at 85 default).
- **Right:** "what's being verified" (linked listing + address, with a link that
  opens the listing workspace), owner/submitter summary, provider & attempt data
  (`provider`, `provider_reference`, `provider_result_code`, `review_reason`,
  `retryable`, current result, submitted), and the Manual-review / Fail / Pass
  decision (reason required on fail). Unchanged decision semantics.

## 5. API changes (`apps/api/src/modules/admin/admin.controller.ts`)

All new endpoints stay under the controller's existing `@Roles("admin")` guard
and follow the `DatabaseService.isEnabled()` dual-mode pattern (DB query when
enabled, `AppStateService` fallback otherwise — best-effort for in-memory).

### 5.1 `GET /admin/review/listings/:listing_id` — full detail

Returns the full review payload:

- **listing:** id, listing_type, title_en/hi, description_en/hi, status,
  verification_status, monthly_rent, security_deposit, available_from,
  furnishing, bhk, bathrooms, area_sqft, preferred_tenant, whatsapp_available,
  amenities, rules, created_at.
- **location:** address_line1, landmark, pincode, lat, lng, masked_address,
  locality name, city slug/name (join `listing_locations` + `localities` +
  `cities`).
- **photos:** `[{ blob_path→url (toBlobUrl), is_cover, sort_order,
moderation_status }]`, ordered `is_cover DESC, sort_order`.
- **owner:** full_name, phone_e164, whatsapp_opt_in, preferred_language, role,
  is_blocked, created_at (member_since), active_listings_count, report_count
  (sum of `listings.report_count` for the owner; reuse the owner-health query
  shape). Phone is **unmasked** — admin-only internal surface.
- **pg** (when pg): pg_details fields + `pg_room_types` rows.
- **verification:** the latest `verification_attempt` per type for this listing,
  each with `id`, `verification_type`, `result`, `liveness_score` /
  `address_match_score`, `threshold`, provider log fields, and an
  `artifact` descriptor `{ kind, available: boolean }` (never the raw blob path).

### 5.2 `GET /admin/review/verifications/:attempt_id` — attempt detail

The queue already returns most attempt fields (§`verificationQueue`). This adds a
single-attempt fetch that also joins a **listing summary** (title, address) and an
**owner summary** (name, phone, whatsapp, member-since) plus the `artifact`
descriptor, so the verification view has full context without N calls.

### 5.3 `GET /admin/review/verifications/:attempt_id/artifact-link?kind=video_liveness|electricity_bill` — secure link

Mirrors the existing `rent-agreements/:id/download-link` precedent.

- Loads the attempt, reads its `artifact_paths`, and selects the blob for the
  requested `kind`. **The client never supplies a blob path** — only a kind that
  is resolved server-side against the attempt's own records. Reject if the attempt
  has no artifact of that kind (404).
- Mints a **read-only** (`BlobSASPermissions.parse("r")`), HTTPS-only SAS on the
  `verification-artifacts` container for that exact blob, TTL default 10 minutes
  (env-config; reuse a constant), using `StorageSharedKeyCredential` exactly as
  `azure-blob-photo-storage.service.ts` does. Returns `{ url, expires_at }`.
- **Audit-logs** each mint into `admin_actions`
  (`action = 'verification_artifact_view'`, target = attempt, metadata = kind).
- Dual-mode: when Azure is not configured (local/in-memory), return the local
  artifact URL / a not-available marker so the UI degrades gracefully.

The listing workspace's embedded evidence viewer calls the **same** endpoint via
the attempt id it received in §5.1, so there is one link-minting path.

## 6. Web changes

### 6.1 `apps/web/lib/admin-api.ts`

Add typed clients + VMs: `fetchAdminListingDetail(token, id)`,
`fetchAdminVerificationDetail(token, id)`,
`fetchVerificationArtifactLink(token, attemptId, kind)`, with
`AdminListingDetailVm`, `AdminVerificationDetailVm`, `AdminOwnerSummaryVm`,
`AdminListingPhotoVm`, `AdminVerificationEvidenceVm`, `ArtifactLinkVm`.

### 6.2 New read-only review components — `apps/web/components/admin/review/`

Mirror the styling/patterns of the existing PG sections
(`components/admin/pg-properties/tabs/*`) but purpose-built read-only components
so they serve both listing types and stay small and single-purpose:

- `ListingReviewWorkspace.tsx` — two-column layout + `DecisionBar`.
- `PhotoGallery.tsx` — gallery, lightbox, moderation badges.
- `OwnerTrustCard.tsx` — owner profile block.
- `PropertySpecs.tsx` — specs grid + description + amenities/rules.
- `PgDetailsBlock.tsx` — PG details + room-types table (rendered only for pg).
- `LocationBlock.tsx` — address rows + map (reuse the map approach used by
  `pg-properties/LocationMapPicker.tsx` / public listing detail; coords +
  "open in maps" fallback).
- `VerificationEvidence.tsx` — **shared** viewer: video `<video>` player / bill
  (`<img>` or PDF `<iframe>`) that lazily fetches the SAS link on demand, score
  meters with threshold marker, provider result. Handles "no artifact" and
  "no attempt" empty states.
- `DecisionBar.tsx` — reason textarea + action buttons, parameterized for the two
  action sets (approve/reject/pause vs pass/fail/manual_review).
- `VerificationReviewView.tsx` — verification detail view composing
  `VerificationEvidence` + context + `DecisionBar`.

### 6.3 Tab changes

- `ListingReviewTab.tsx` — keep the queue table; on row click, switch to
  `detail` mode rendering `ListingReviewWorkspace` (replaces today's Drawer).
  Decisions call the existing `decideAdminListing`.
- `VerificationTab.tsx` — keep the queue; on row click, render
  `VerificationReviewView`. Decisions call the existing `decideAdminVerification`.
- `AdminShell.tsx` — expose a lightweight `openListingReview(listingId)` handler
  passed to `VerificationTab` so the "open full listing" link switches to the
  Listing Review tab preselected on that listing.

## 7. Security & privacy

- All endpoints admin-only (existing `@Roles("admin")`).
- Owner `phone_e164` shown unmasked (admin internal surface; matches user
  decision "full owner profile").
- Verification artifacts: read-only, HTTPS-only, short-TTL SAS, scoped to a single
  server-resolved blob; client cannot request an arbitrary path; every mint is
  audit-logged.
- Listing photos remain public URLs (unchanged from tenant/owner behavior).
- No personal data placed in query strings beyond the opaque `kind` enum.

## 8. Testing

- **API integration** (Vitest, following `apps/api/.../__tests__` patterns):
  listing-detail and verification-detail endpoints in DB and in-memory modes;
  artifact-link happy path, wrong-kind 404, foreign-attempt rejection, read-only
  permission, audit row written.
- **Web** (following `components/admin/__tests__` patterns): workspace renders all
  sections from a VM including the PG block for pg listings and its absence for
  flat_house; evidence viewer lazy-loads the link and shows empty states; decision
  flows call the right API.

## 9. Rollout

Admin-only internal tool with a small blast radius and graceful empty states, so
it ships **unflagged** behind existing admin auth. When Azure artifact storage or
verification data is absent (e.g. local/dev), the evidence viewer degrades to a
clear "not available" state rather than erroring.

## 10. Assumptions

- SAS TTL default 10 minutes (env-configurable).
- Owner phone unmasked for admins.
- In-memory fallback is best-effort; production runs with Postgres + Azure.
- Reuse an existing map rendering approach rather than introducing a new map dep.
- `verification_attempts.artifact_paths` reliably records the video/bill blob
  path(s) per the current upload/complete flow; the artifact-link endpoint keys
  off those records.
