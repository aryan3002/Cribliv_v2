# Admin Listing & Verification Review Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admin reviewers a full-screen listing review workspace that shows every owner + property field and all photos, plus a secure evidence viewer to watch the liveness video and open the electricity bill — reused across listing review and verification review.

**Architecture:** Add three admin API endpoints (listing detail, verification-attempt detail, secure artifact link) backed by one new `AdminReviewService` and a small `VerificationArtifactSasIssuer`. On the web, add read-only review components under `components/admin/review/`, convert the `ListingReviewTab` and `VerificationTab` from thin drawers to list⇄detail views, and wire a cross-tab `openListingReview` handler in `AdminShell`. Endpoints follow the existing `DatabaseService.isEnabled()` dual-mode pattern; the UI degrades gracefully when photos/verification/PG data are absent.

**Tech Stack:** NestJS (`apps/api`), Next.js 14 App Router (`apps/web`), Postgres, Azure Blob Storage (`@azure/storage-blob`), Vitest + @testing-library/react.

## Global Constraints

- API success responses are wrapped by `ok<T>(data, meta?)` from `apps/api/src/common/response.ts` → `{ data, meta }`. The web `fetchApi<T>` returns `payload.data`.
- Dual-mode: every new endpoint must check `this.database.isEnabled()`; DB path uses `this.database.query<T>(sql, params)` reading `.rows` / `.rowCount ?? 0`. In-memory fallback is best-effort (the in-memory `ListingRecord` has **no photos, no geo, no owner object**; return empty arrays / owner-from-`appState.users.get(ownerUserId)`).
- All new admin endpoints live on `AdminController` (`@Controller("admin")`, `@UseGuards(AuthGuard, RolesGuard)`, `@Roles("admin")`) — no per-route guard changes.
- Owner `phone_e164` is shown **unmasked** (admin-only internal surface).
- Verification artifact links are **read-only** (`BlobSASPermissions.parse("r")`), HTTPS-only, short-TTL (default 600s), scoped to a single server-resolved blob path; the client passes only a `kind` enum, never a path.
- Listing photos stay public-URL served via `toBlobUrl` from `apps/api/src/common/photo-url.ts` (unchanged).
- Web toast signature is `(message: string, tone?: "trust" | "warn" | "danger") => void`.
- Admin CSS tokens: `--ad-text`, `--ad-text-2`, `--ad-text-3`, `--ad-border`, `--ad-surface`, `--ad-brand`, `--ad-brand-soft`, `--ad-trust`, `--ad-warning`, `--ad-warning-soft`, `--ad-danger`, `--ad-danger-soft`, `--ad-radius`, `--ad-radius-sm`. Button classes: `admin-btn`, `admin-btn--primary|--ghost|--danger|--sm`. Root wrapper: `admin-main__section`.
- Test command (api): `pnpm --filter @cribliv/api test`. Test command (web): `pnpm --filter @cribliv/web test`.
- Frequent commits: one per task. TDD: failing test first.

---

## File Structure

**API (`apps/api/src`):**

- Create `modules/admin/admin-review.service.ts` — assembles listing-detail and verification-detail payloads, resolves artifact links (one service, three methods).
- Create `modules/admin/verification-artifact-sas.issuer.ts` — mints read-only SAS URLs against the `verification-artifacts` container.
- Create `modules/admin/__tests__/unit/admin-review.service.test.ts` and `.../verification-artifact-sas.issuer.test.ts`.
- Modify `modules/admin/admin.controller.ts` — add 3 endpoints + 1 constructor param.
- Modify `modules/admin/admin.module.ts` — register 2 providers.
- Modify `modules/admin/__tests__/pg-admin.controller.integration.test.ts` — extend the positional-arg constructor list.

**Web (`apps/web`):**

- Modify `lib/admin-api.ts` — add detail VMs + 3 fetchers.
- Create `components/admin/review/PhotoGallery.tsx`, `OwnerTrustCard.tsx`, `PropertySpecs.tsx`, `PgDetailsBlock.tsx`, `LocationBlock.tsx`, `VerificationEvidence.tsx`, `DecisionBar.tsx`, `ListingReviewWorkspace.tsx`, `VerificationReviewView.tsx`.
- Create matching tests under `components/admin/review/__tests__/`.
- Modify `components/admin/tabs/ListingReviewTab.tsx`, `components/admin/tabs/VerificationTab.tsx`, `components/admin/shell/AdminShell.tsx`.

---

## Task 1: `VerificationArtifactSasIssuer`

Mints a read-only, short-TTL SAS URL for a blob in the `verification-artifacts` container, mirroring `apps/api/src/modules/rent-agreement/downloads/azure-sas-issuer.ts`. Returns `null` when Azure is not configured (graceful local/dev).

**Files:**

- Create: `apps/api/src/modules/admin/verification-artifact-sas.issuer.ts`
- Test: `apps/api/src/modules/admin/__tests__/unit/verification-artifact-sas.issuer.test.ts`

**Interfaces:**

- Produces: `class VerificationArtifactSasIssuer { issue(blobPath: string, ttlSeconds?: number): { url: string; expiresAt: string } | null }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/admin/__tests__/unit/verification-artifact-sas.issuer.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VerificationArtifactSasIssuer } from "../../verification-artifact-sas.issuer";

const ENV_KEYS = [
  "AZURE_STORAGE_ACCOUNT_NAME",
  "AZURE_STORAGE_ACCOUNT_KEY",
  "AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS"
];

describe("VerificationArtifactSasIssuer", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns a read-only https SAS url scoped to the container + blob", () => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = "acct";
    process.env.AZURE_STORAGE_ACCOUNT_KEY = "dGVzdGtleQ=="; // valid base64
    process.env.AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS = "verification-artifacts";
    const issuer = new VerificationArtifactSasIssuer();
    const out = issuer.issue("listing-1/verification/video_liveness/clip-9.mp4", 600);
    expect(out).not.toBeNull();
    expect(out!.url).toContain(
      "https://acct.blob.core.windows.net/verification-artifacts/listing-1/verification/video_liveness/clip-9.mp4?"
    );
    expect(out!.url).toContain("sig=");
    expect(out!.url).toContain("sp=r"); // read-only permission
    expect(typeof out!.expiresAt).toBe("string");
  });

  it("returns null when storage credentials are absent", () => {
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const issuer = new VerificationArtifactSasIssuer();
    expect(issuer.issue("x/y.mp4")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- verification-artifact-sas.issuer`
Expected: FAIL — cannot find module `../../verification-artifact-sas.issuer`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/modules/admin/verification-artifact-sas.issuer.ts
import { Injectable } from "@nestjs/common";
import {
  BlobSASPermissions,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from "@azure/storage-blob";

function parseConnStringAccount(raw: string | undefined) {
  const values = new Map<string, string>();
  for (const part of (raw ?? "").split(";")) {
    const entry = part.trim();
    if (!entry.includes("=")) continue;
    const [key, ...rest] = entry.split("=");
    values.set(key.toLowerCase(), rest.join("="));
  }
  return {
    accountName: (values.get("accountname") ?? "").trim(),
    accountKey: (values.get("accountkey") ?? "").trim()
  };
}

/**
 * Mints read-only, short-lived SAS URLs for verification artifacts (liveness
 * video / electricity bill) stored in the private verification-artifacts
 * container. Mirrors rent-agreement/downloads/azure-sas-issuer.ts.
 */
@Injectable()
export class VerificationArtifactSasIssuer {
  private readonly accountName: string;
  private readonly accountKey: string;
  private readonly containerName: string;

  constructor() {
    const conn = parseConnStringAccount(process.env.AZURE_STORAGE_CONNECTION_STRING);
    this.accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim() || conn.accountName;
    this.accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY?.trim() || conn.accountKey;
    this.containerName =
      process.env.AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS?.trim() ||
      "verification-artifacts";
  }

  issue(blobPath: string, ttlSeconds = 600): { url: string; expiresAt: string } | null {
    if (!this.accountName || !this.accountKey || !blobPath) return null;
    const credential = new StorageSharedKeyCredential(this.accountName, this.accountKey);
    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + ttlSeconds * 1000);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse("r"),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn
      },
      credential
    ).toString();
    const url =
      `https://${this.accountName}.blob.core.windows.net/` +
      `${this.containerName}/${blobPath}?${sas}`;
    return { url, expiresAt: expiresOn.toISOString() };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- verification-artifact-sas.issuer`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/verification-artifact-sas.issuer.ts apps/api/src/modules/admin/__tests__/unit/verification-artifact-sas.issuer.test.ts
git commit -m "feat(api): read-only SAS issuer for verification artifacts"
```

---

## Task 2: `AdminReviewService.getListingDetail`

Assembles the full listing-detail payload. Runs an ordered sequence of queries so the unit test can drive `database.query` with `mockResolvedValueOnce` in that exact order.

**Files:**

- Create: `apps/api/src/modules/admin/admin-review.service.ts`
- Test: `apps/api/src/modules/admin/__tests__/unit/admin-review.service.test.ts`

**Interfaces:**

- Consumes: `DatabaseService.query`, `AppStateService`, `VerificationArtifactSasIssuer` (Task 1), `toBlobUrl` (`apps/api/src/common/photo-url.ts`).
- Produces:
  - `class AdminReviewService`
  - `getListingDetail(listingId: string): Promise<AdminListingDetail | null>`
  - Type `AdminListingDetail` (exported) with fields: `listing`, `location`, `owner`, `photos`, `pg`, `verification` (see code).

Query order for `getListingDetail` (DB mode):

1. main row (listing + location + city + locality + owner columns)
2. owner aggregates (active listings, report_count)
3. photos
4. pg_details (only if `listing_type === "pg"`)
5. pg_room_types (only if `listing_type === "pg"`)
6. verification attempts (latest per type)

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/admin/__tests__/unit/admin-review.service.test.ts
import { describe, expect, it, vi } from "vitest";
import { AdminReviewService } from "../../admin-review.service";

function makeService(queryImpl: ReturnType<typeof vi.fn>) {
  const database = { isEnabled: () => true, query: queryImpl } as any;
  const appState = { listings: new Map(), users: new Map() } as any;
  const sas = {
    issue: vi.fn(() => ({ url: "https://x", expiresAt: "2026-01-01T00:00:00.000Z" }))
  } as any;
  return new AdminReviewService(database, appState, sas);
}

describe("AdminReviewService.getListingDetail", () => {
  it("assembles listing + owner + photos + verification for a flat_house listing", async () => {
    const query = vi
      .fn()
      // 1. main row
      .mockResolvedValueOnce({
        rows: [
          {
            id: "L1",
            listing_type: "flat_house",
            title_en: "2BHK",
            title_hi: null,
            description_en: "nice",
            description_hi: null,
            status: "pending_review",
            verification_status: "pending",
            monthly_rent: 32000,
            security_deposit: 160000,
            available_from: "2026-08-01",
            furnishing: "semi_furnished",
            bhk: 2,
            bathrooms: 2,
            area_sqft: 1100,
            preferred_tenant: "family",
            whatsapp_available: true,
            amenities: ["Parking", "Lift"],
            rules: { smoking: false },
            created_at: "2026-07-12T10:00:00.000Z",
            address_line1: "142, 5th Cross",
            landmark: "Forum Mall",
            pincode: "560034",
            lat: 12.93,
            lng: 77.62,
            masked_address: "Koramangala, Bengaluru",
            locality_name: "Koramangala",
            city_slug: "bengaluru",
            city_name: "Bengaluru",
            owner_id: "O1",
            owner_name: "Ramesh Kumar",
            owner_phone: "+919876543210",
            owner_whatsapp: true,
            owner_language: "hi",
            owner_role: "owner",
            owner_blocked: false,
            owner_created_at: "2024-07-01T00:00:00.000Z"
          }
        ],
        rowCount: 1
      })
      // 2. owner aggregates
      .mockResolvedValueOnce({ rows: [{ active_listings: 4, report_count: 0 }], rowCount: 1 })
      // 3. photos
      .mockResolvedValueOnce({
        rows: [
          {
            blob_path: "L1/cover.jpg",
            is_cover: true,
            sort_order: 0,
            moderation_status: "approved"
          }
        ],
        rowCount: 1
      })
      // 4. verification attempts
      .mockResolvedValueOnce({
        rows: [
          {
            id: "V1",
            verification_type: "video_liveness",
            result: "manual_review",
            liveness_score: 82,
            address_match_score: null,
            threshold: 85,
            artifact_paths: ["L1/verification/video_liveness/clip.mp4"],
            created_at: "2026-07-12T10:05:00.000Z",
            provider: "mock",
            provider_result_code: "LOW_CONFIDENCE",
            review_reason: "score below threshold"
          }
        ],
        rowCount: 1
      });

    const svc = makeService(query);
    const detail = await svc.getListingDetail("L1");

    expect(detail).not.toBeNull();
    expect(detail!.listing.title_en).toBe("2BHK");
    expect(detail!.owner).toMatchObject({
      name: "Ramesh Kumar",
      phone: "+919876543210",
      active_listings: 4,
      report_count: 0
    });
    expect(detail!.photos).toHaveLength(1);
    expect(detail!.photos[0].is_cover).toBe(true);
    expect(detail!.pg).toBeNull();
    expect(detail!.verification).toHaveLength(1);
    expect(detail!.verification[0]).toMatchObject({
      attempt_id: "V1",
      kind: "video_liveness",
      liveness_score: 82,
      threshold: 85,
      artifact_available: true
    });
    // flat_house: no pg queries (main, owner-agg, photos, verification = 4 calls)
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("returns null when the listing does not exist", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const svc = makeService(query);
    expect(await svc.getListingDetail("missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- admin-review.service`
Expected: FAIL — cannot find module `../../admin-review.service`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/modules/admin/admin-review.service.ts
import { Inject, Injectable } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { toBlobUrl } from "../../common/photo-url";
import { VerificationArtifactSasIssuer } from "./verification-artifact-sas.issuer";

export interface AdminListingPhoto {
  url: string | null;
  is_cover: boolean;
  sort_order: number;
  moderation_status: string;
}

export interface AdminReviewOwner {
  id: string;
  name: string | null;
  phone: string | null;
  whatsapp_opt_in: boolean;
  preferred_language: string | null;
  role: string;
  is_blocked: boolean;
  member_since: string | null;
  active_listings: number;
  report_count: number;
}

export interface AdminReviewEvidence {
  attempt_id: string;
  kind: string; // verification_type
  result: string;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
  created_at: string;
}

export interface AdminListingDetail {
  listing: Record<string, unknown>;
  location: Record<string, unknown> | null;
  owner: AdminReviewOwner;
  photos: AdminListingPhoto[];
  pg: { details: Record<string, unknown> | null; rooms: Record<string, unknown>[] } | null;
  verification: AdminReviewEvidence[];
}

@Injectable()
export class AdminReviewService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(VerificationArtifactSasIssuer)
    private readonly sas: VerificationArtifactSasIssuer
  ) {}

  async getListingDetail(listingId: string): Promise<AdminListingDetail | null> {
    if (!this.database.isEnabled()) {
      return this.getListingDetailInMemory(listingId);
    }

    const main = await this.database.query<any>(
      `
      SELECT
        l.id::text, l.listing_type::text, l.title_en, l.title_hi,
        l.description_en, l.description_hi, l.status::text, l.verification_status::text,
        l.monthly_rent, l.security_deposit, l.available_from::text, l.furnishing::text,
        l.bhk, l.bathrooms, l.area_sqft, l.preferred_tenant::text, l.whatsapp_available,
        l.amenities, l.rules, l.created_at::text,
        ll.address_line1, ll.landmark, ll.pincode, ll.lat, ll.lng, ll.masked_address,
        loc.name_en AS locality_name, c.slug AS city_slug, c.name_en AS city_name,
        u.id::text AS owner_id, u.full_name AS owner_name, u.phone_e164 AS owner_phone,
        u.whatsapp_opt_in AS owner_whatsapp, u.preferred_language::text AS owner_language,
        u.role::text AS owner_role, u.is_blocked AS owner_blocked, u.created_at::text AS owner_created_at
      FROM listings l
      LEFT JOIN listing_locations ll ON ll.listing_id = l.id
      LEFT JOIN cities c ON c.id = ll.city_id
      LEFT JOIN localities loc ON loc.id = ll.locality_id
      JOIN users u ON u.id = l.owner_user_id
      WHERE l.id = $1::uuid
      `,
      [listingId]
    );
    const row = main.rows[0];
    if (!row) return null;

    const agg = await this.database.query<{ active_listings: number; report_count: number }>(
      `
      SELECT
        count(*) FILTER (WHERE status = 'active')::int AS active_listings,
        COALESCE(sum(report_count)::int, 0) AS report_count
      FROM listings WHERE owner_user_id = $1::uuid
      `,
      [row.owner_id]
    );

    const photos = await this.database.query<any>(
      `
      SELECT blob_path, is_cover, sort_order, moderation_status::text
      FROM listing_photos
      WHERE listing_id = $1::uuid AND moderation_status != 'rejected'
      ORDER BY is_cover DESC, sort_order ASC, created_at ASC
      `,
      [listingId]
    );

    let pg: AdminListingDetail["pg"] = null;
    if (row.listing_type === "pg") {
      const details = await this.database.query<any>(
        `
        SELECT total_beds, occupancy_type::text, gender_policy::text, tenant_type::text,
               food_included, curfew_time::text, attached_bathroom, notice_period_days,
               lock_in_months, electricity_mode::text, meals, house_rules, amenities
        FROM pg_details WHERE listing_id = $1::uuid
        `,
        [listingId]
      );
      const rooms = await this.database.query<any>(
        `
        SELECT sharing::text, ac, bathroom_kind::text, furnishing::text,
               monthly_rent_paise, vacancy_count, available_from::text
        FROM pg_room_types WHERE listing_id = $1::uuid
        ORDER BY monthly_rent_paise ASC
        `,
        [listingId]
      );
      pg = { details: details.rows[0] ?? null, rooms: rooms.rows };
    }

    const attempts = await this.database.query<any>(
      `
      SELECT DISTINCT ON (va.verification_type)
        va.id::text AS id, va.verification_type::text AS verification_type, va.result::text AS result,
        va.liveness_score, va.address_match_score, va.threshold, va.artifact_paths,
        va.created_at::text AS created_at,
        vpl.provider, vpl.provider_result_code, vpl.review_reason
      FROM verification_attempts va
      LEFT JOIN LATERAL (
        SELECT provider, provider_result_code, review_reason
        FROM verification_provider_logs
        WHERE attempt_id = va.id ORDER BY created_at DESC LIMIT 1
      ) vpl ON true
      WHERE va.listing_id = $1::uuid
      ORDER BY va.verification_type, va.created_at DESC
      `,
      [listingId]
    );

    return {
      listing: {
        id: row.id,
        listing_type: row.listing_type,
        title_en: row.title_en,
        title_hi: row.title_hi,
        description_en: row.description_en,
        description_hi: row.description_hi,
        status: row.status,
        verification_status: row.verification_status,
        monthly_rent: row.monthly_rent,
        security_deposit: row.security_deposit,
        available_from: row.available_from,
        furnishing: row.furnishing,
        bhk: row.bhk,
        bathrooms: row.bathrooms,
        area_sqft: row.area_sqft,
        preferred_tenant: row.preferred_tenant,
        whatsapp_available: row.whatsapp_available,
        amenities: row.amenities ?? [],
        rules: row.rules ?? {},
        created_at: row.created_at
      },
      location: {
        address_line1: row.address_line1,
        landmark: row.landmark,
        pincode: row.pincode,
        lat: row.lat,
        lng: row.lng,
        masked_address: row.masked_address,
        locality_name: row.locality_name,
        city_slug: row.city_slug,
        city_name: row.city_name
      },
      owner: {
        id: row.owner_id,
        name: row.owner_name,
        phone: row.owner_phone,
        whatsapp_opt_in: Boolean(row.owner_whatsapp),
        preferred_language: row.owner_language,
        role: row.owner_role,
        is_blocked: Boolean(row.owner_blocked),
        member_since: row.owner_created_at,
        active_listings: agg.rows[0]?.active_listings ?? 0,
        report_count: agg.rows[0]?.report_count ?? 0
      },
      photos: photos.rows.map((p) => ({
        url: toBlobUrl(p.blob_path),
        is_cover: Boolean(p.is_cover),
        sort_order: p.sort_order,
        moderation_status: p.moderation_status
      })),
      pg,
      verification: attempts.rows.map((a) => this.toEvidence(a))
    };
  }

  private toEvidence(a: any): AdminReviewEvidence {
    const paths = Array.isArray(a.artifact_paths) ? a.artifact_paths : [];
    return {
      attempt_id: a.id,
      kind: a.verification_type,
      result: a.result,
      liveness_score: a.liveness_score,
      address_match_score: a.address_match_score,
      threshold: Number(a.threshold),
      provider: a.provider ?? null,
      provider_result_code: a.provider_result_code ?? null,
      review_reason: a.review_reason ?? null,
      artifact_available: paths.length > 0,
      created_at: a.created_at
    };
  }

  private getListingDetailInMemory(listingId: string): AdminListingDetail | null {
    const l = this.appState.listings.get(listingId);
    if (!l) return null;
    const u = this.appState.users.get(l.ownerUserId);
    return {
      listing: {
        id: l.id,
        listing_type: l.listingType,
        title_en: l.title,
        title_hi: null,
        description_en: null,
        description_hi: null,
        status: l.status,
        verification_status: l.verificationStatus,
        monthly_rent: l.monthlyRent,
        security_deposit: null,
        available_from: null,
        furnishing: l.furnishing ?? null,
        bhk: null,
        bathrooms: null,
        area_sqft: null,
        preferred_tenant: null,
        whatsapp_available: false,
        amenities: l.amenities ?? [],
        rules: {},
        created_at: new Date(l.createdAt).toISOString()
      },
      location: { city_name: l.city ?? null, locality_name: l.locality ?? null } as any,
      owner: {
        id: l.ownerUserId,
        name: (u as any)?.full_name ?? null,
        phone: (u as any)?.phone ?? null,
        whatsapp_opt_in: Boolean((u as any)?.whatsapp_opt_in),
        preferred_language: (u as any)?.preferred_language ?? null,
        role: (u as any)?.role ?? "owner",
        is_blocked: false,
        member_since: null,
        active_listings: 0,
        report_count: 0
      },
      photos: [],
      pg: null,
      verification: []
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- admin-review.service`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/admin-review.service.ts apps/api/src/modules/admin/__tests__/unit/admin-review.service.test.ts
git commit -m "feat(api): AdminReviewService.getListingDetail assembles full review payload"
```

---

## Task 3: `AdminReviewService.getVerificationDetail`

Single-attempt detail: attempt fields + provider log + listing summary (title, address) + owner summary + the `artifact_available` flag.

**Files:**

- Modify: `apps/api/src/modules/admin/admin-review.service.ts`
- Test: `apps/api/src/modules/admin/__tests__/unit/admin-review.service.test.ts` (add a describe block)

**Interfaces:**

- Produces: `getVerificationDetail(attemptId: string): Promise<AdminVerificationDetail | null>` and exported `interface AdminVerificationDetail`.

- [ ] **Step 1: Write the failing test** (append to the existing test file)

```ts
describe("AdminReviewService.getVerificationDetail", () => {
  it("returns attempt + listing summary + owner summary", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          id: "V1",
          listing_id: "L1",
          user_id: "O1",
          verification_type: "video_liveness",
          result: "manual_review",
          liveness_score: 82,
          address_match_score: null,
          threshold: 85,
          artifact_paths: ["L1/verification/video_liveness/clip.mp4"],
          created_at: "2026-07-12T10:05:00.000Z",
          provider: "mock",
          provider_reference: "lv_9",
          provider_result_code: "LOW_CONFIDENCE",
          review_reason: "below",
          retryable: true,
          listing_title: "2BHK",
          listing_address: "142, 5th Cross, Koramangala",
          owner_name: "Ramesh Kumar",
          owner_phone: "+919876543210",
          owner_whatsapp: true,
          owner_created_at: "2024-07-01T00:00:00.000Z"
        }
      ],
      rowCount: 1
    });
    const database = { isEnabled: () => true, query } as any;
    const svc = new (await import("../../admin-review.service")).AdminReviewService(
      database,
      { listings: new Map(), users: new Map() } as any,
      { issue: vi.fn() } as any
    );
    const d = await svc.getVerificationDetail("V1");
    expect(d).not.toBeNull();
    expect(d!.attempt_id).toBe("V1");
    expect(d!.kind).toBe("video_liveness");
    expect(d!.artifact_available).toBe(true);
    expect(d!.listing).toMatchObject({
      id: "L1",
      title: "2BHK",
      address: "142, 5th Cross, Koramangala"
    });
    expect(d!.owner).toMatchObject({ name: "Ramesh Kumar", phone: "+919876543210" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- admin-review.service`
Expected: FAIL — `getVerificationDetail is not a function`.

- [ ] **Step 3: Add the method + type to `admin-review.service.ts`**

Add the interface near the other exports:

```ts
export interface AdminVerificationDetail {
  attempt_id: string;
  kind: string;
  result: string;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_reference: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  retryable: boolean | null;
  artifact_available: boolean;
  created_at: string;
  listing: { id: string | null; title: string | null; address: string | null };
  owner: {
    id: string;
    name: string | null;
    phone: string | null;
    whatsapp_opt_in: boolean;
    member_since: string | null;
  };
}
```

Add the method to the class:

```ts
  async getVerificationDetail(attemptId: string): Promise<AdminVerificationDetail | null> {
    if (!this.database.isEnabled()) return null;
    const res = await this.database.query<any>(
      `
      SELECT
        va.id::text AS id, va.listing_id::text AS listing_id, va.user_id::text AS user_id,
        va.verification_type::text AS verification_type, va.result::text AS result,
        va.liveness_score, va.address_match_score, va.threshold, va.artifact_paths,
        va.created_at::text AS created_at,
        vpl.provider, vpl.provider_reference, vpl.provider_result_code, vpl.review_reason, vpl.retryable,
        COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS listing_title,
        ll.address_line1 AS listing_address,
        u.full_name AS owner_name, u.phone_e164 AS owner_phone,
        u.whatsapp_opt_in AS owner_whatsapp, u.created_at::text AS owner_created_at
      FROM verification_attempts va
      LEFT JOIN LATERAL (
        SELECT provider, provider_reference, provider_result_code, review_reason, retryable
        FROM verification_provider_logs
        WHERE attempt_id = va.id ORDER BY created_at DESC LIMIT 1
      ) vpl ON true
      LEFT JOIN listings l ON l.id = va.listing_id
      LEFT JOIN listing_locations ll ON ll.listing_id = va.listing_id
      JOIN users u ON u.id = va.user_id
      WHERE va.id = $1::uuid
      `,
      [attemptId]
    );
    const a = res.rows[0];
    if (!a) return null;
    const paths = Array.isArray(a.artifact_paths) ? a.artifact_paths : [];
    return {
      attempt_id: a.id,
      kind: a.verification_type,
      result: a.result,
      liveness_score: a.liveness_score,
      address_match_score: a.address_match_score,
      threshold: Number(a.threshold),
      provider: a.provider ?? null,
      provider_reference: a.provider_reference ?? null,
      provider_result_code: a.provider_result_code ?? null,
      review_reason: a.review_reason ?? null,
      retryable: a.retryable ?? null,
      artifact_available: paths.length > 0,
      created_at: a.created_at,
      listing: { id: a.listing_id, title: a.listing_title, address: a.listing_address },
      owner: {
        id: a.user_id,
        name: a.owner_name,
        phone: a.owner_phone,
        whatsapp_opt_in: Boolean(a.owner_whatsapp),
        member_since: a.owner_created_at
      }
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- admin-review.service`
Expected: PASS (3 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/admin-review.service.ts apps/api/src/modules/admin/__tests__/unit/admin-review.service.test.ts
git commit -m "feat(api): AdminReviewService.getVerificationDetail with listing + owner context"
```

---

## Task 4: `AdminReviewService.getVerificationArtifactLink`

Resolves the blob for a requested `kind` from the attempt's own `artifact_paths`, mints a read-only SAS via Task 1, and logs the view via Nest `Logger`. Returns `null` when the attempt/kind/artifact is missing or Azure is unconfigured.

**Files:**

- Modify: `apps/api/src/modules/admin/admin-review.service.ts`
- Test: `apps/api/src/modules/admin/__tests__/unit/admin-review.service.test.ts` (add a describe block)

**Interfaces:**

- Produces: `getVerificationArtifactLink(attemptId: string, kind: string, adminUserId: string): Promise<{ url: string; expires_at: string } | null>`

Kind→blob resolution: an attempt is one `verification_type`; its `artifact_paths[0]` is the blob. The requested `kind` must equal the attempt's `verification_type` (guards against mismatched requests). Accepted kinds: `"video_liveness"`, `"electricity_bill"` (bill attempts have type `electricity_bill_match`; map `electricity_bill` → `electricity_bill_match`).

- [ ] **Step 1: Write the failing test** (append)

```ts
describe("AdminReviewService.getVerificationArtifactLink", () => {
  const attemptRow = {
    verification_type: "video_liveness",
    artifact_paths: ["L1/verification/video_liveness/clip.mp4"]
  };

  it("mints a read-only link for the matching kind", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [attemptRow], rowCount: 1 });
    const database = { isEnabled: () => true, query } as any;
    const sas = {
      issue: vi.fn(() => ({
        url: "https://acct/blob?sig=x",
        expiresAt: "2026-01-01T00:00:00.000Z"
      }))
    };
    const svc = new (await import("../../admin-review.service")).AdminReviewService(
      database,
      { listings: new Map(), users: new Map() } as any,
      sas as any
    );
    const out = await svc.getVerificationArtifactLink("V1", "video_liveness", "ADMIN1");
    expect(sas.issue).toHaveBeenCalledWith("L1/verification/video_liveness/clip.mp4", 600);
    expect(out).toEqual({ url: "https://acct/blob?sig=x", expires_at: "2026-01-01T00:00:00.000Z" });
  });

  it("returns null when the requested kind does not match the attempt", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [attemptRow], rowCount: 1 });
    const database = { isEnabled: () => true, query } as any;
    const sas = { issue: vi.fn() };
    const svc = new (await import("../../admin-review.service")).AdminReviewService(
      database,
      { listings: new Map(), users: new Map() } as any,
      sas as any
    );
    const out = await svc.getVerificationArtifactLink("V1", "electricity_bill", "ADMIN1");
    expect(out).toBeNull();
    expect(sas.issue).not.toHaveBeenCalled();
  });

  it("returns null when the attempt has no artifact", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ verification_type: "video_liveness", artifact_paths: [] }],
      rowCount: 1
    });
    const database = { isEnabled: () => true, query } as any;
    const sas = { issue: vi.fn() };
    const svc = new (await import("../../admin-review.service")).AdminReviewService(
      database,
      { listings: new Map(), users: new Map() } as any,
      sas as any
    );
    expect(await svc.getVerificationArtifactLink("V1", "video_liveness", "ADMIN1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- admin-review.service`
Expected: FAIL — `getVerificationArtifactLink is not a function`.

- [ ] **Step 3: Add the method**

At the top of `admin-review.service.ts`, extend the Nest import and add a Logger field:

```ts
import { Inject, Injectable, Logger } from "@nestjs/common";
```

Add inside the class (before the constructor or as a field):

```ts
  private readonly logger = new Logger(AdminReviewService.name);
  private static readonly KIND_TO_TYPE: Record<string, string> = {
    video_liveness: "video_liveness",
    electricity_bill: "electricity_bill_match"
  };
```

Add the method:

```ts
  async getVerificationArtifactLink(
    attemptId: string,
    kind: string,
    adminUserId: string
  ): Promise<{ url: string; expires_at: string } | null> {
    if (!this.database.isEnabled()) return null;
    const expectedType = AdminReviewService.KIND_TO_TYPE[kind];
    if (!expectedType) return null;

    const res = await this.database.query<{ verification_type: string; artifact_paths: unknown }>(
      `SELECT verification_type::text, artifact_paths FROM verification_attempts WHERE id = $1::uuid`,
      [attemptId]
    );
    const row = res.rows[0];
    if (!row || row.verification_type !== expectedType) return null;

    const paths = Array.isArray(row.artifact_paths) ? (row.artifact_paths as string[]) : [];
    const blobPath = paths[0];
    if (!blobPath) return null;

    const issued = this.sas.issue(blobPath, 600);
    if (!issued) return null;

    this.logger.log(
      `admin ${adminUserId} viewed verification artifact attempt=${attemptId} kind=${kind}`
    );
    return { url: issued.url, expires_at: issued.expiresAt };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- admin-review.service`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/admin-review.service.ts apps/api/src/modules/admin/__tests__/unit/admin-review.service.test.ts
git commit -m "feat(api): AdminReviewService.getVerificationArtifactLink mints scoped read link"
```

---

## Task 5: Wire endpoints into `AdminController` + `AdminModule`

Register the two providers, inject `AdminReviewService` (append last), add three GET endpoints, and update the direct-instantiation integration test's positional args.

**Files:**

- Modify: `apps/api/src/modules/admin/admin.module.ts`
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Modify: `apps/api/src/modules/admin/__tests__/pg-admin.controller.integration.test.ts`

**Interfaces:**

- Consumes: `AdminReviewService` (Tasks 2–4), `VerificationArtifactSasIssuer` (Task 1).
- Produces (HTTP): `GET /admin/review/listings/:listing_id`, `GET /admin/review/verifications/:attempt_id`, `GET /admin/review/verifications/:attempt_id/artifact-link?kind=`.

- [ ] **Step 1: Write the failing test** — extend `makeCtrl()` and add endpoint assertions in `pg-admin.controller.integration.test.ts`

In `makeCtrl()`, add a stub and append it to the constructor arg list (it is the **last** param):

```ts
const review = {
  getListingDetail: vi.fn(async () => ({ listing: { id: "L1" } })),
  getVerificationDetail: vi.fn(async () => ({ attempt_id: "V1" })),
  getVerificationArtifactLink: vi.fn(async () => ({ url: "https://x", expires_at: "t" }))
} as any;

const ctrl = new AdminController(
  appState,
  database,
  notifications,
  analytics,
  ops,
  ownerHealth,
  revenue,
  fraudFeed,
  rentAgreements,
  pgScore,
  pgFunnel,
  pgAnalytics,
  pgProps,
  pgOverrides,
  pgEdit,
  indexing,
  review
);
return { ctrl, pgProps, pgOverrides, pgAnalytics, review };
```

Add tests:

```ts
it("GET review/listings/:id delegates to review.getListingDetail and wraps in ok()", async () => {
  const { ctrl, review } = makeCtrl();
  const res = await ctrl.listingDetail("L1");
  expect(review.getListingDetail).toHaveBeenCalledWith("L1");
  expect(res).toMatchObject({ data: { listing: { id: "L1" } } });
});

it("GET review/verifications/:id/artifact-link passes kind + admin id", async () => {
  const { ctrl, review } = makeCtrl();
  const res = await ctrl.verificationArtifactLink(
    { user: { id: "ADMIN1" } } as any,
    "V1",
    "video_liveness"
  );
  expect(review.getVerificationArtifactLink).toHaveBeenCalledWith("V1", "video_liveness", "ADMIN1");
  expect(res).toMatchObject({ data: { url: "https://x" } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- pg-admin.controller.integration`
Expected: FAIL — `ctrl.listingDetail is not a function` (and constructor arity mismatch).

- [ ] **Step 3: Register providers in `admin.module.ts`**

Add imports and providers:

```ts
import { AdminReviewService } from "./admin-review.service";
import { VerificationArtifactSasIssuer } from "./verification-artifact-sas.issuer";
```

Add to the `providers` array (after `AzureBlobPhotoStorageService`):

```ts
(AzureBlobPhotoStorageService, VerificationArtifactSasIssuer, AdminReviewService);
```

- [ ] **Step 4: Inject + add endpoints in `admin.controller.ts`**

Add the import:

```ts
import { AdminReviewService } from "./admin-review.service";
```

Append the constructor param (after `indexing`):

```ts
    @Inject(IndexingService) private readonly indexing: IndexingService,
    @Inject(AdminReviewService) private readonly review: AdminReviewService
  ) {}
```

Add three endpoints (place them right after the existing `review/listings/:listing_id/decision` block for locality):

```ts
  @Get("review/listings/:listing_id")
  async listingDetail(@Param("listing_id") listingId: string) {
    return ok(await this.review.getListingDetail(listingId));
  }

  @Get("review/verifications/:attempt_id")
  async verificationDetail(@Param("attempt_id") attemptId: string) {
    return ok(await this.review.getVerificationDetail(attemptId));
  }

  @Get("review/verifications/:attempt_id/artifact-link")
  async verificationArtifactLink(
    @Req() req: { user: { id: string } },
    @Param("attempt_id") attemptId: string,
    @Query("kind") kind: string
  ) {
    return ok(await this.review.getVerificationArtifactLink(attemptId, kind, req.user.id));
  }
```

(`@Get`, `@Param`, `@Query`, `@Req`, `ok` are already imported in this controller.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/api test -- pg-admin.controller.integration`
Expected: PASS. Then run the full api suite to confirm nothing else broke:
Run: `pnpm --filter @cribliv/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/admin.module.ts apps/api/src/modules/admin/admin.controller.ts apps/api/src/modules/admin/__tests__/pg-admin.controller.integration.test.ts
git commit -m "feat(api): expose admin listing-detail, verification-detail, artifact-link endpoints"
```

---

## Task 6: Web API client — detail VMs + fetchers

Add typed fetchers to `apps/web/lib/admin-api.ts`. These call the Task 5 endpoints; `fetchApi` already unwraps `.data`.

**Files:**

- Modify: `apps/web/lib/admin-api.ts`
- Test: `apps/web/lib/__tests__/admin-api-review.test.ts`

**Interfaces:**

- Produces: `fetchAdminListingDetail(token, id): Promise<AdminListingDetailVm>`, `fetchAdminVerificationDetail(token, id): Promise<AdminVerificationDetailVm>`, `fetchVerificationArtifactLink(token, attemptId, kind): Promise<{ url: string; expiresAt: string } | null>`, and the VM interfaces mirroring the API shapes (snake_case preserved — these payloads are large; keep server field names to avoid a mapping layer).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/admin-api-review.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, fetchApi: vi.fn() };
});

import { fetchApi } from "../api";
import { fetchAdminListingDetail, fetchVerificationArtifactLink } from "../admin-api";

const mockedFetch = vi.mocked(fetchApi);

describe("admin review api", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetchAdminListingDetail calls the detail endpoint with auth", async () => {
    mockedFetch.mockResolvedValueOnce({ listing: { id: "L1" }, photos: [] } as any);
    const out = await fetchAdminListingDetail("tok", "L1");
    expect(mockedFetch).toHaveBeenCalledWith("/admin/review/listings/L1", {
      headers: { Authorization: "Bearer tok" }
    });
    expect(out.listing.id).toBe("L1");
  });

  it("fetchVerificationArtifactLink passes the kind query param", async () => {
    mockedFetch.mockResolvedValueOnce({ url: "https://x", expires_at: "t" } as any);
    const out = await fetchVerificationArtifactLink("tok", "V1", "video_liveness");
    expect(mockedFetch).toHaveBeenCalledWith(
      "/admin/review/verifications/V1/artifact-link?kind=video_liveness",
      { headers: { Authorization: "Bearer tok" } }
    );
    expect(out?.url).toBe("https://x");
    expect(out?.expiresAt).toBe("t");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- admin-api-review`
Expected: FAIL — exports not found.

- [ ] **Step 3: Add VMs + fetchers to `admin-api.ts`**

```ts
export interface AdminReviewOwnerVm {
  id: string;
  name: string | null;
  phone: string | null;
  whatsapp_opt_in: boolean;
  preferred_language: string | null;
  role: string;
  is_blocked: boolean;
  member_since: string | null;
  active_listings: number;
  report_count: number;
}

export interface AdminListingPhotoVm {
  url: string | null;
  is_cover: boolean;
  sort_order: number;
  moderation_status: string;
}

export interface AdminReviewEvidenceVm {
  attempt_id: string;
  kind: string;
  result: string;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
  created_at: string;
}

export interface AdminListingDetailVm {
  listing: {
    id: string;
    listing_type: "flat_house" | "pg";
    title_en: string | null;
    title_hi: string | null;
    description_en: string | null;
    description_hi: string | null;
    status: string;
    verification_status: string;
    monthly_rent: number | null;
    security_deposit: number | null;
    available_from: string | null;
    furnishing: string | null;
    bhk: number | null;
    bathrooms: number | null;
    area_sqft: number | null;
    preferred_tenant: string | null;
    whatsapp_available: boolean;
    amenities: string[];
    rules: Record<string, unknown>;
    created_at: string;
  };
  location: {
    address_line1?: string | null;
    landmark?: string | null;
    pincode?: string | null;
    lat?: number | null;
    lng?: number | null;
    masked_address?: string | null;
    locality_name?: string | null;
    city_slug?: string | null;
    city_name?: string | null;
  } | null;
  owner: AdminReviewOwnerVm;
  photos: AdminListingPhotoVm[];
  pg: { details: Record<string, unknown> | null; rooms: Record<string, unknown>[] } | null;
  verification: AdminReviewEvidenceVm[];
}

export interface AdminVerificationDetailVm {
  attempt_id: string;
  kind: string;
  result: string;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_reference: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  retryable: boolean | null;
  artifact_available: boolean;
  created_at: string;
  listing: { id: string | null; title: string | null; address: string | null };
  owner: {
    id: string;
    name: string | null;
    phone: string | null;
    whatsapp_opt_in: boolean;
    member_since: string | null;
  };
}

export async function fetchAdminListingDetail(accessToken: string, listingId: string) {
  return fetchApi<AdminListingDetailVm>(`/admin/review/listings/${listingId}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminVerificationDetail(accessToken: string, attemptId: string) {
  return fetchApi<AdminVerificationDetailVm>(`/admin/review/verifications/${attemptId}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchVerificationArtifactLink(
  accessToken: string,
  attemptId: string,
  kind: "video_liveness" | "electricity_bill"
) {
  const res = await fetchApi<{ url: string; expires_at: string } | null>(
    `/admin/review/verifications/${attemptId}/artifact-link?kind=${kind}`,
    { headers: authHeaders(accessToken) }
  );
  return res ? { url: res.url, expiresAt: res.expires_at } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- admin-api-review`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/admin-api.ts apps/web/lib/__tests__/admin-api-review.test.ts
git commit -m "feat(web): admin review detail VMs + fetchers"
```

---

## Task 7: `PhotoGallery` component

Read-only gallery mirroring `PhotosSection`: grid of `<img>` with cover + moderation badges and a click-to-open lightbox. Empty state when no photos.

**Files:**

- Create: `apps/web/components/admin/review/PhotoGallery.tsx`
- Test: `apps/web/components/admin/review/__tests__/PhotoGallery.test.tsx`

**Interfaces:**

- Consumes: `AdminListingPhotoVm[]` (Task 6).
- Produces: `export function PhotoGallery({ photos }: { photos: AdminListingPhotoVm[] })`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/admin/review/__tests__/PhotoGallery.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhotoGallery } from "../PhotoGallery";

describe("PhotoGallery", () => {
  it("renders an empty state with no photos", () => {
    render(<PhotoGallery photos={[]} />);
    expect(screen.getByText(/no photos/i)).toBeInTheDocument();
  });

  it("shows a cover badge and opens the lightbox on click", () => {
    render(
      <PhotoGallery
        photos={[
          {
            url: "https://img/1.jpg",
            is_cover: true,
            sort_order: 0,
            moderation_status: "approved"
          },
          { url: "https://img/2.jpg", is_cover: false, sort_order: 1, moderation_status: "pending" }
        ]}
      />
    );
    expect(screen.getByText("COVER")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    const imgs = screen.getAllByRole("img");
    fireEvent.click(imgs[0]);
    expect(screen.getByTestId("photo-lightbox")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- PhotoGallery`
Expected: FAIL — cannot find module `../PhotoGallery`.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/admin/review/PhotoGallery.tsx
"use client";

import { useState } from "react";
import type { AdminListingPhotoVm } from "../../../lib/admin-api";
import { EmptyState } from "../primitives/EmptyState";

export function PhotoGallery({ photos }: { photos: AdminListingPhotoVm[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const usable = photos.filter((p) => p.url);

  if (usable.length === 0) {
    return <EmptyState title="No photos" hint="This listing has no photos to review." />;
  }

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 8
        }}
      >
        {usable.map((p, i) => (
          <div key={i} style={{ position: "relative", aspectRatio: "4 / 3" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url!}
              alt=""
              loading="lazy"
              onClick={() => setLightbox(p.url)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: "var(--ad-radius-sm)",
                border: p.is_cover ? "2px solid var(--ad-brand)" : "1px solid var(--ad-border)",
                cursor: "zoom-in"
              }}
            />
            {p.is_cover && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                  background: "var(--ad-brand)",
                  borderRadius: 6,
                  padding: "2px 7px"
                }}
              >
                COVER
              </span>
            )}
            {p.moderation_status !== "approved" && (
              <span
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: 6,
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--ad-warning)",
                  background: "var(--ad-warning-soft)",
                  border: "1px solid #FDE68A",
                  borderRadius: 6,
                  padding: "1px 6px"
                }}
              >
                {p.moderation_status}
              </span>
            )}
          </div>
        ))}
      </div>

      {lightbox && (
        <div
          data-testid="photo-lightbox"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.82)",
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            cursor: "zoom-out"
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            style={{ maxWidth: "92vw", maxHeight: "88vh", objectFit: "contain" }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- PhotoGallery`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/review/PhotoGallery.tsx apps/web/components/admin/review/__tests__/PhotoGallery.test.tsx
git commit -m "feat(web): read-only PhotoGallery for listing review"
```

---

## Task 8: Info blocks — `OwnerTrustCard`, `PropertySpecs`, `PgDetailsBlock`, `LocationBlock`

Four presentational blocks. All are pure functions of props (no fetching), tested by rendering with a fixture and asserting text.

**Files:**

- Create: `apps/web/components/admin/review/OwnerTrustCard.tsx`
- Create: `apps/web/components/admin/review/PropertySpecs.tsx`
- Create: `apps/web/components/admin/review/PgDetailsBlock.tsx`
- Create: `apps/web/components/admin/review/LocationBlock.tsx`
- Test: `apps/web/components/admin/review/__tests__/InfoBlocks.test.tsx`

**Interfaces:**

- Consumes: `AdminReviewOwnerVm`, `AdminListingDetailVm["listing"]`, `AdminListingDetailVm["location"]`, `AdminListingDetailVm["pg"]` (Task 6); `LocationMapPicker` (`../pg-properties/LocationMapPicker`); `formatDate`, `formatINRPrecise` (`../../../lib/admin/format`).
- Produces: `OwnerTrustCard({ owner })`, `PropertySpecs({ listing })`, `PgDetailsBlock({ pg })`, `LocationBlock({ location })`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/admin/review/__tests__/InfoBlocks.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../pg-properties/LocationMapPicker", () => ({
  LocationMapPicker: () => <div data-testid="map" />
}));

import { OwnerTrustCard } from "../OwnerTrustCard";
import { PropertySpecs } from "../PropertySpecs";
import { PgDetailsBlock } from "../PgDetailsBlock";
import { LocationBlock } from "../LocationBlock";

const owner = {
  id: "O1",
  name: "Ramesh Kumar",
  phone: "+919876543210",
  whatsapp_opt_in: true,
  preferred_language: "hi",
  role: "owner",
  is_blocked: false,
  member_since: "2024-07-01T00:00:00.000Z",
  active_listings: 4,
  report_count: 0
};

describe("review info blocks", () => {
  it("OwnerTrustCard shows name, phone and counts", () => {
    render(<OwnerTrustCard owner={owner} />);
    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
    expect(screen.getByText("+919876543210")).toBeInTheDocument();
    expect(screen.getByText(/4/)).toBeInTheDocument();
  });

  it("OwnerTrustCard flags a blocked owner", () => {
    render(<OwnerTrustCard owner={{ ...owner, is_blocked: true }} />);
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
  });

  it("PropertySpecs renders rent and bhk", () => {
    render(
      <PropertySpecs
        listing={
          {
            monthly_rent: 32000,
            security_deposit: 160000,
            bhk: 2,
            bathrooms: 2,
            area_sqft: 1100,
            furnishing: "semi_furnished",
            available_from: "2026-08-01",
            preferred_tenant: "family",
            whatsapp_available: true,
            description_en: "nice",
            description_hi: null,
            amenities: ["Parking"],
            rules: { smoking: false }
          } as any
        }
      />
    );
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getByText("Parking")).toBeInTheDocument();
  });

  it("PgDetailsBlock renders room rows", () => {
    render(
      <PgDetailsBlock
        pg={{
          details: { total_beds: 18, gender_policy: "male" },
          rooms: [
            {
              sharing: "double",
              ac: true,
              bathroom_kind: "attached",
              monthly_rent_paise: 950000,
              vacancy_count: 3
            }
          ]
        }}
      />
    );
    expect(screen.getByText(/18/)).toBeInTheDocument();
    expect(screen.getByText(/double/i)).toBeInTheDocument();
  });

  it("LocationBlock renders the address and a map", () => {
    render(
      <LocationBlock
        location={{
          address_line1: "142, 5th Cross",
          city_name: "Bengaluru",
          lat: 12.9,
          lng: 77.6,
          masked_address: "Koramangala"
        }}
      />
    );
    expect(screen.getByText(/142, 5th Cross/)).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- InfoBlocks`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the four components**

```tsx
// apps/web/components/admin/review/OwnerTrustCard.tsx
import type { AdminReviewOwnerVm } from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";
import { formatDate } from "../../../lib/admin/format";

function Row({
  label,
  value,
  danger
}: {
  label: string;
  value: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}
    >
      <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: danger ? "var(--ad-danger)" : "var(--ad-text)",
          textAlign: "right"
        }}
      >
        {value ?? "-"}
      </span>
    </div>
  );
}

export function OwnerTrustCard({ owner }: { owner: AdminReviewOwnerVm }) {
  return (
    <SectionCard title="Owner">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
        <Row label="Name" value={owner.name} />
        <Row
          label="Phone"
          value={
            owner.phone ? (
              <a href={`tel:${owner.phone}`} style={{ color: "var(--ad-trust)" }}>
                {owner.phone}
              </a>
            ) : (
              "-"
            )
          }
        />
        <Row label="WhatsApp" value={owner.whatsapp_opt_in ? "Opted in" : "No"} />
        <Row label="Language" value={owner.preferred_language ?? "-"} />
        <Row
          label="Member since"
          value={owner.member_since ? formatDate(owner.member_since) : "-"}
        />
        <Row label="Active listings" value={String(owner.active_listings)} />
        <Row label="Reports" value={String(owner.report_count)} danger={owner.report_count > 0} />
        {owner.is_blocked && <Row label="Status" value="BLOCKED" danger />}
      </div>
    </SectionCard>
  );
}
```

```tsx
// apps/web/components/admin/review/PropertySpecs.tsx
import type { AdminListingDetailVm } from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";
import { formatDate, formatINRPrecise } from "../../../lib/admin/format";

type Listing = AdminListingDetailVm["listing"];

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        borderBottom: "1px dashed var(--ad-border)",
        padding: "4px 0"
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--ad-text)", textAlign: "right" }}>
        {value ?? "-"}
      </span>
    </div>
  );
}

export function PropertySpecs({ listing }: { listing: Listing }) {
  const amenities = Array.isArray(listing.amenities) ? listing.amenities : [];
  return (
    <SectionCard title="Property details">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
        <Cell
          label="Monthly rent"
          value={listing.monthly_rent != null ? formatINRPrecise(listing.monthly_rent * 100) : "-"}
        />
        <Cell
          label="Deposit"
          value={
            listing.security_deposit != null
              ? formatINRPrecise(listing.security_deposit * 100)
              : "-"
          }
        />
        <Cell label="BHK" value={listing.bhk ?? "-"} />
        <Cell label="Bathrooms" value={listing.bathrooms ?? "-"} />
        <Cell label="Area" value={listing.area_sqft ? `${listing.area_sqft} ft²` : "-"} />
        <Cell label="Furnishing" value={listing.furnishing ?? "-"} />
        <Cell
          label="Available from"
          value={listing.available_from ? formatDate(listing.available_from) : "-"}
        />
        <Cell label="Preferred tenant" value={listing.preferred_tenant ?? "-"} />
        <Cell label="WhatsApp enquiries" value={listing.whatsapp_available ? "Enabled" : "Off"} />
      </div>

      {(listing.description_en || listing.description_hi) && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{ fontSize: 12, fontWeight: 600, color: "var(--ad-text-2)", marginBottom: 4 }}
          >
            Description
          </div>
          <p style={{ fontSize: 13, color: "var(--ad-text-2)", margin: 0 }}>
            {listing.description_en ?? listing.description_hi}
          </p>
        </div>
      )}

      {amenities.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {amenities.map((a) => (
            <span
              key={a}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--ad-brand)",
                background: "var(--ad-brand-soft)",
                borderRadius: 999,
                padding: "2px 9px"
              }}
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
```

```tsx
// apps/web/components/admin/review/PgDetailsBlock.tsx
import type { AdminListingDetailVm } from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";

type Pg = NonNullable<AdminListingDetailVm["pg"]>;

export function PgDetailsBlock({ pg }: { pg: Pg }) {
  const d = (pg.details ?? {}) as Record<string, unknown>;
  const rooms = pg.rooms ?? [];
  const fields: Array<[string, unknown]> = [
    ["Total beds", d.total_beds],
    ["Gender", d.gender_policy],
    ["Tenant type", d.tenant_type],
    ["Food included", d.food_included],
    ["Curfew", d.curfew_time],
    ["Notice period (days)", d.notice_period_days],
    ["Lock-in (months)", d.lock_in_months],
    ["Electricity", d.electricity_mode]
  ];
  return (
    <SectionCard title="PG details">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
        {fields.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              borderBottom: "1px dashed var(--ad-border)",
              padding: "4px 0"
            }}
          >
            <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
            <span style={{ fontSize: 13, color: "var(--ad-text)", textAlign: "right" }}>
              {value === null || value === undefined || value === "" ? "-" : String(value)}
            </span>
          </div>
        ))}
      </div>

      {rooms.length > 0 && (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Sharing", "AC", "Bathroom", "Rent", "Vacancy"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      color: "var(--ad-text-3)",
                      padding: "4px 6px",
                      borderBottom: "1px solid var(--ad-border)"
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rooms.map((r, i) => {
                const room = r as Record<string, unknown>;
                const paise = Number(room.monthly_rent_paise ?? 0);
                return (
                  <tr key={i}>
                    <td style={{ padding: "4px 6px" }}>{String(room.sharing ?? "-")}</td>
                    <td style={{ padding: "4px 6px" }}>{room.ac ? "Yes" : "No"}</td>
                    <td style={{ padding: "4px 6px" }}>{String(room.bathroom_kind ?? "-")}</td>
                    <td style={{ padding: "4px 6px" }}>
                      {paise ? `₹${(paise / 100).toLocaleString("en-IN")}` : "-"}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{String(room.vacancy_count ?? "-")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
```

```tsx
// apps/web/components/admin/review/LocationBlock.tsx
import type { AdminListingDetailVm } from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";
import { LocationMapPicker } from "../pg-properties/LocationMapPicker";

type Loc = NonNullable<AdminListingDetailVm["location"]>;

export function LocationBlock({ location }: { location: Loc | null }) {
  if (!location)
    return (
      <SectionCard title="Location">
        <p style={{ fontSize: 13, color: "var(--ad-text-3)" }}>No location on file.</p>
      </SectionCard>
    );
  const rows: Array<[string, unknown]> = [
    ["Full address", location.address_line1],
    [
      "Locality / City",
      [location.locality_name, location.city_name].filter(Boolean).join(" · ") || null
    ],
    ["Pincode", location.pincode],
    ["Landmark", location.landmark],
    ["Masked (public)", location.masked_address]
  ];
  const lat = typeof location.lat === "number" ? location.lat : null;
  const lng = typeof location.lng === "number" ? location.lng : null;
  return (
    <SectionCard title="Location">
      {lat != null && lng != null && (
        <div style={{ marginBottom: 12 }}>
          <LocationMapPicker lat={lat} lng={lng} height={180} />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
            <span style={{ fontSize: 13, color: "var(--ad-text)", textAlign: "right" }}>
              {value ? String(value) : "-"}
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- InfoBlocks`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/review/OwnerTrustCard.tsx apps/web/components/admin/review/PropertySpecs.tsx apps/web/components/admin/review/PgDetailsBlock.tsx apps/web/components/admin/review/LocationBlock.tsx apps/web/components/admin/review/__tests__/InfoBlocks.test.tsx
git commit -m "feat(web): owner/property/pg/location review blocks"
```

---

## Task 9: `VerificationEvidence` shared viewer

Given an evidence descriptor + a link fetcher, renders the score-vs-threshold meter and a button that lazily fetches the SAS link and shows the video (`<video controls>`) or bill (`<iframe>`/`<img>`). Handles "no artifact" and error states. Used by both the listing workspace and verification view.

**Files:**

- Create: `apps/web/components/admin/review/VerificationEvidence.tsx`
- Test: `apps/web/components/admin/review/__tests__/VerificationEvidence.test.tsx`

**Interfaces:**

- Consumes: `fetchVerificationArtifactLink` (Task 6).
- Produces:
  ```ts
  interface EvidenceItem {
    attempt_id: string;
    kind: string; // "video_liveness" | "electricity_bill_match"
    result: string;
    score: number | null;
    threshold: number;
    provider_result_code: string | null;
    review_reason: string | null;
    artifact_available: boolean;
  }
  function VerificationEvidence({
    accessToken,
    items,
    onToast
  }: {
    accessToken: string;
    items: EvidenceItem[];
    onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
  }): JSX.Element;
  ```
- Helper (exported): `mapEvidence(v: AdminReviewEvidenceVm): EvidenceItem` — flattens a listing-detail evidence row (uses `liveness_score` for video, `address_match_score` for bill).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/admin/review/__tests__/VerificationEvidence.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchVerificationArtifactLink: vi.fn()
}));

import { VerificationEvidence } from "../VerificationEvidence";
import { fetchVerificationArtifactLink } from "../../../../lib/admin-api";

const mockedLink = vi.mocked(fetchVerificationArtifactLink);
const onToast = vi.fn();

describe("VerificationEvidence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the score and a load button, then renders a video on fetch", async () => {
    mockedLink.mockResolvedValueOnce({ url: "https://blob/clip.mp4", expiresAt: "t" });
    render(
      <VerificationEvidence
        accessToken="tok"
        onToast={onToast}
        items={[
          {
            attempt_id: "V1",
            kind: "video_liveness",
            result: "manual_review",
            score: 82,
            threshold: 85,
            provider_result_code: "LOW_CONFIDENCE",
            review_reason: "below",
            artifact_available: true
          }
        ]}
      />
    );
    expect(screen.getByText("82")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /play liveness video/i }));
    await waitFor(() => {
      expect(mockedLink).toHaveBeenCalledWith("tok", "V1", "video_liveness");
      expect(screen.getByTestId("evidence-video")).toBeInTheDocument();
    });
  });

  it("disables loading when no artifact is available", () => {
    render(
      <VerificationEvidence
        accessToken="tok"
        onToast={onToast}
        items={[
          {
            attempt_id: "V2",
            kind: "electricity_bill_match",
            result: "pass",
            score: 91,
            threshold: 85,
            provider_result_code: null,
            review_reason: null,
            artifact_available: false
          }
        ]}
      />
    );
    expect(screen.getByText(/no artifact uploaded/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- VerificationEvidence`
Expected: FAIL — cannot find module `../VerificationEvidence`.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/admin/review/VerificationEvidence.tsx
"use client";

import { useState } from "react";
import { fetchVerificationArtifactLink, type AdminReviewEvidenceVm } from "../../../lib/admin-api";

export interface EvidenceItem {
  attempt_id: string;
  kind: string;
  result: string;
  score: number | null;
  threshold: number;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
}

export function mapEvidence(v: AdminReviewEvidenceVm): EvidenceItem {
  return {
    attempt_id: v.attempt_id,
    kind: v.kind,
    result: v.result,
    score: v.kind === "video_liveness" ? v.liveness_score : v.address_match_score,
    threshold: v.threshold,
    provider_result_code: v.provider_result_code,
    review_reason: v.review_reason,
    artifact_available: v.artifact_available
  };
}

function linkKind(kind: string): "video_liveness" | "electricity_bill" {
  return kind === "video_liveness" ? "video_liveness" : "electricity_bill";
}

function EvidenceCard({
  item,
  accessToken,
  onToast
}: {
  item: EvidenceItem;
  accessToken: string;
  onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isVideo = item.kind === "video_liveness";
  const label = isVideo ? "liveness video" : "electricity bill";
  const below = item.score != null && item.score < item.threshold;

  async function load() {
    setBusy(true);
    try {
      const res = await fetchVerificationArtifactLink(
        accessToken,
        item.attempt_id,
        linkKind(item.kind)
      );
      if (!res) {
        onToast("Artifact link unavailable", "warn");
        return;
      }
      setUrl(res.url);
    } catch {
      onToast("Failed to load artifact", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--ad-border)",
        borderRadius: "var(--ad-radius)",
        padding: 12
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--ad-text-2)",
          textTransform: "capitalize",
          marginBottom: 6
        }}
      >
        {label}
      </div>

      {!item.artifact_available ? (
        <p style={{ fontSize: 12, color: "var(--ad-text-3)", margin: "8px 0" }}>
          No artifact uploaded.
        </p>
      ) : url ? (
        isVideo ? (
          <video
            data-testid="evidence-video"
            src={url}
            controls
            style={{ width: "100%", borderRadius: 6, maxHeight: 320 }}
          />
        ) : (
          <iframe
            data-testid="evidence-bill"
            src={url}
            title="bill"
            style={{
              width: "100%",
              height: 320,
              border: "1px solid var(--ad-border)",
              borderRadius: 6
            }}
          />
        )
      ) : (
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          disabled={busy}
          onClick={load}
        >
          {busy ? "Loading…" : isVideo ? "Play liveness video" : "Open electricity bill"}
        </button>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 8 }}>
        <span style={{ color: "var(--ad-text-3)", width: 54 }}>
          {isVideo ? "Liveness" : "Address"}
        </span>
        <div
          style={{
            flex: 1,
            height: 7,
            background: "var(--ad-surface-2)",
            borderRadius: 4,
            overflow: "hidden"
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${Math.max(0, Math.min(100, item.score ?? 0))}%`,
              background: below ? "var(--ad-warning)" : "var(--ad-trust)"
            }}
          />
        </div>
        <b>{item.score ?? "-"}</b>
      </div>
      <div style={{ fontSize: 11, color: "var(--ad-text-3)", marginTop: 3 }}>
        threshold {item.threshold}
        {below ? " · below" : ""}
        {item.provider_result_code ? ` · ${item.provider_result_code}` : ""}
      </div>
    </div>
  );
}

export function VerificationEvidence({
  accessToken,
  items,
  onToast
}: {
  accessToken: string;
  items: EvidenceItem[];
  onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
}) {
  if (items.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--ad-text-3)" }}>
        No verification submitted for this listing.
      </p>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 10
      }}
    >
      {items.map((it) => (
        <EvidenceCard key={it.attempt_id} item={it} accessToken={accessToken} onToast={onToast} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- VerificationEvidence`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/review/VerificationEvidence.tsx apps/web/components/admin/review/__tests__/VerificationEvidence.test.tsx
git commit -m "feat(web): shared VerificationEvidence viewer with lazy secure links"
```

---

## Task 10: `DecisionBar` component

Sticky reason box + action buttons, parameterized for the two decision sets.

**Files:**

- Create: `apps/web/components/admin/review/DecisionBar.tsx`
- Test: `apps/web/components/admin/review/__tests__/DecisionBar.test.tsx`

**Interfaces:**

- Produces:

  ```ts
  interface DecisionAction {
    key: string;
    label: string;
    variant: "primary" | "danger" | "ghost";
    requiresReason?: boolean;
  }
  function DecisionBar({
    actions,
    busy,
    onDecide
  }: {
    actions: DecisionAction[];
    busy: string | null;
    onDecide: (key: string, reason: string) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/admin/review/__tests__/DecisionBar.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionBar } from "../DecisionBar";

const actions = [
  { key: "pause", label: "Pause", variant: "ghost" as const, requiresReason: true },
  { key: "approve", label: "Approve", variant: "primary" as const }
];

describe("DecisionBar", () => {
  it("passes the typed reason to onDecide", () => {
    const onDecide = vi.fn();
    render(<DecisionBar actions={actions} busy={null} onDecide={onDecide} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onDecide).toHaveBeenCalledWith("approve", "looks good");
  });

  it("disables buttons while busy", () => {
    render(<DecisionBar actions={actions} busy="approve" onDecide={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- DecisionBar`
Expected: FAIL — cannot find module `../DecisionBar`.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/admin/review/DecisionBar.tsx
"use client";

import { useState } from "react";

export interface DecisionAction {
  key: string;
  label: string;
  variant: "primary" | "danger" | "ghost";
  requiresReason?: boolean;
}

export function DecisionBar({
  actions,
  busy,
  onDecide
}: {
  actions: DecisionAction[];
  busy: string | null;
  onDecide: (key: string, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        background: "var(--ad-surface)",
        borderTop: "1px solid var(--ad-border)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
    >
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required for reject / pause / fail)"
        style={{
          width: "100%",
          minHeight: 64,
          padding: 10,
          border: "1px solid var(--ad-border)",
          borderRadius: "var(--ad-radius-sm)",
          fontFamily: "inherit",
          fontSize: 13,
          resize: "vertical"
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`admin-btn admin-btn--${a.variant}`}
            disabled={!!busy}
            onClick={() => onDecide(a.key, reason.trim())}
          >
            {busy === a.key ? "…" : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- DecisionBar`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/review/DecisionBar.tsx apps/web/components/admin/review/__tests__/DecisionBar.test.tsx
git commit -m "feat(web): parameterized DecisionBar for review decisions"
```

---

## Task 11: `ListingReviewWorkspace`

Fetches the listing detail on mount and lays out the two-column workspace: media left, info + evidence + `DecisionBar` right. Emits decisions to a parent callback.

**Files:**

- Create: `apps/web/components/admin/review/ListingReviewWorkspace.tsx`
- Test: `apps/web/components/admin/review/__tests__/ListingReviewWorkspace.test.tsx`

**Interfaces:**

- Consumes: `fetchAdminListingDetail` (Task 6), `PhotoGallery`, `OwnerTrustCard`, `PropertySpecs`, `PgDetailsBlock`, `LocationBlock`, `VerificationEvidence` + `mapEvidence`, `DecisionBar`.
- Produces:

  ```ts
  function ListingReviewWorkspace({
    accessToken,
    listingId,
    onBack,
    onDecide,
    busy,
    onToast
  }: {
    accessToken: string;
    listingId: string;
    onBack: () => void;
    onDecide: (decision: "approve" | "reject" | "pause", reason: string) => void;
    busy: string | null;
    onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/admin/review/__tests__/ListingReviewWorkspace.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminListingDetail: vi.fn()
}));
vi.mock("../../pg-properties/LocationMapPicker", () => ({ LocationMapPicker: () => <div /> }));

import { ListingReviewWorkspace } from "../ListingReviewWorkspace";
import { fetchAdminListingDetail } from "../../../../lib/admin-api";

const mockedDetail = vi.mocked(fetchAdminListingDetail);

const detail = {
  listing: {
    id: "L1",
    listing_type: "flat_house",
    title_en: "2BHK",
    title_hi: null,
    description_en: "nice",
    description_hi: null,
    status: "pending_review",
    verification_status: "pending",
    monthly_rent: 32000,
    security_deposit: 160000,
    available_from: null,
    furnishing: "semi_furnished",
    bhk: 2,
    bathrooms: 2,
    area_sqft: 1100,
    preferred_tenant: "family",
    whatsapp_available: true,
    amenities: ["Parking"],
    rules: {},
    created_at: "2026-07-12T10:00:00.000Z"
  },
  location: { address_line1: "142", city_name: "Bengaluru", lat: null, lng: null },
  owner: {
    id: "O1",
    name: "Ramesh Kumar",
    phone: "+919876543210",
    whatsapp_opt_in: true,
    preferred_language: "hi",
    role: "owner",
    is_blocked: false,
    member_since: null,
    active_listings: 4,
    report_count: 0
  },
  photos: [],
  pg: null,
  verification: []
};

describe("ListingReviewWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and renders owner + title", async () => {
    mockedDetail.mockResolvedValueOnce(detail as any);
    render(
      <ListingReviewWorkspace
        accessToken="tok"
        listingId="L1"
        onBack={vi.fn()}
        onDecide={vi.fn()}
        busy={null}
        onToast={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText("2BHK")).toBeInTheDocument();
      expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- ListingReviewWorkspace`
Expected: FAIL — cannot find module `../ListingReviewWorkspace`.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/admin/review/ListingReviewWorkspace.tsx
"use client";

import { useEffect, useState } from "react";
import { fetchAdminListingDetail, type AdminListingDetailVm } from "../../../lib/admin-api";
import { StatusPill } from "../primitives/StatusPill";
import { PhotoGallery } from "./PhotoGallery";
import { OwnerTrustCard } from "./OwnerTrustCard";
import { PropertySpecs } from "./PropertySpecs";
import { PgDetailsBlock } from "./PgDetailsBlock";
import { LocationBlock } from "./LocationBlock";
import { VerificationEvidence, mapEvidence } from "./VerificationEvidence";
import { DecisionBar } from "./DecisionBar";
import { formatDate } from "../../../lib/admin/format";

const LISTING_ACTIONS = [
  { key: "pause", label: "Pause", variant: "ghost" as const, requiresReason: true },
  { key: "reject", label: "Reject", variant: "danger" as const, requiresReason: true },
  { key: "approve", label: "Approve & publish", variant: "primary" as const }
];

export function ListingReviewWorkspace({
  accessToken,
  listingId,
  onBack,
  onDecide,
  busy,
  onToast
}: {
  accessToken: string;
  listingId: string;
  onBack: () => void;
  onDecide: (decision: "approve" | "reject" | "pause", reason: string) => void;
  busy: string | null;
  onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
}) {
  const [detail, setDetail] = useState<AdminListingDetailVm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAdminListingDetail(accessToken, listingId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && onToast("Failed to load listing", "danger"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, listingId]);

  if (loading)
    return (
      <div style={{ padding: 24, color: "var(--ad-text-3)", fontSize: 13 }}>Loading listing…</div>
    );
  if (!detail)
    return (
      <div style={{ padding: 24, color: "var(--ad-text-3)", fontSize: 13 }}>Listing not found.</div>
    );

  const { listing, owner, photos, pg, location, verification } = detail;

  return (
    <div className="admin-main__section">
      <button
        type="button"
        className="admin-btn admin-btn--ghost admin-btn--sm"
        onClick={onBack}
        style={{ alignSelf: "flex-start" }}
      >
        ← Back to queue
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)",
          gap: 16,
          alignItems: "start"
        }}
      >
        {/* left: media */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PhotoGallery photos={photos} />
          <LocationBlock location={location} />
        </div>

        {/* right: info + decision */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ad-text)" }}>
              {listing.title_en ?? listing.title_hi ?? "Listing"}
            </div>
            {listing.title_hi && listing.title_en && (
              <div style={{ fontSize: 13, color: "var(--ad-text-3)" }}>{listing.title_hi}</div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <StatusPill status={listing.listing_type} tone="muted" noDot />
              <StatusPill status={listing.status} />
              <StatusPill status={listing.verification_status} tone="muted" noDot />
            </div>
            <div style={{ fontSize: 11, color: "var(--ad-text-3)", marginTop: 4 }}>
              Submitted {formatDate(listing.created_at)} · {listing.id}
            </div>
          </div>

          <OwnerTrustCard owner={owner} />
          <PropertySpecs listing={listing} />
          {pg && <PgDetailsBlock pg={pg} />}

          <div>
            <div
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                color: "var(--ad-text-3)",
                fontWeight: 800,
                marginBottom: 6
              }}
            >
              Verification evidence
            </div>
            <VerificationEvidence
              accessToken={accessToken}
              onToast={onToast}
              items={verification.map(mapEvidence)}
            />
          </div>

          <DecisionBar
            actions={LISTING_ACTIONS}
            busy={busy}
            onDecide={(key, reason) => onDecide(key as "approve" | "reject" | "pause", reason)}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- ListingReviewWorkspace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/review/ListingReviewWorkspace.tsx apps/web/components/admin/review/__tests__/ListingReviewWorkspace.test.tsx
git commit -m "feat(web): ListingReviewWorkspace full-screen review layout"
```

---

## Task 12: Convert `ListingReviewTab` to list ⇄ detail

Replace the thin drawer with the workspace. The tab keeps the queue table; clicking a row shows `ListingReviewWorkspace`; decisions call `decideAdminListing`. Accept an `initialListingId` prop so the shell can deep-open (Task 14).

**Files:**

- Modify: `apps/web/components/admin/tabs/ListingReviewTab.tsx`
- Test: `apps/web/components/admin/tabs/__tests__/ListingReviewTab.test.tsx`

**Interfaces:**

- Consumes: `ListingReviewWorkspace` (Task 11), `fetchAdminListings`, `decideAdminListing` (existing).
- Produces: `ListingReviewTab` now accepts `initialListingId?: string | null` in addition to `accessToken`, `onCountChange`, `onToast`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/admin/tabs/__tests__/ListingReviewTab.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminListings: vi.fn(),
  decideAdminListing: vi.fn(),
  fetchAdminListingDetail: vi.fn()
}));
vi.mock("../../pg-properties/LocationMapPicker", () => ({ LocationMapPicker: () => <div /> }));

import { ListingReviewTab } from "../ListingReviewTab";
import { fetchAdminListings, fetchAdminListingDetail } from "../../../../lib/admin-api";

const mockedList = vi.mocked(fetchAdminListings);
const mockedDetail = vi.mocked(fetchAdminListingDetail);

describe("ListingReviewTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the workspace when a row is clicked", async () => {
    mockedList.mockResolvedValueOnce({
      items: [
        {
          id: "L1",
          title: "2BHK",
          listingType: "flat_house",
          status: "pending_review",
          ownerUserId: "O1",
          verificationStatus: "pending",
          createdAt: "2026-07-12T10:00:00.000Z",
          city: "bengaluru",
          monthlyRent: 32000
        }
      ],
      total: 1
    } as any);
    mockedDetail.mockResolvedValueOnce({
      listing: {
        id: "L1",
        listing_type: "flat_house",
        title_en: "2BHK",
        title_hi: null,
        description_en: null,
        description_hi: null,
        status: "pending_review",
        verification_status: "pending",
        monthly_rent: 32000,
        security_deposit: null,
        available_from: null,
        furnishing: null,
        bhk: 2,
        bathrooms: 1,
        area_sqft: null,
        preferred_tenant: null,
        whatsapp_available: false,
        amenities: [],
        rules: {},
        created_at: "2026-07-12T10:00:00.000Z"
      },
      location: null,
      owner: {
        id: "O1",
        name: "Ramesh",
        phone: "+91",
        whatsapp_opt_in: false,
        preferred_language: null,
        role: "owner",
        is_blocked: false,
        member_since: null,
        active_listings: 1,
        report_count: 0
      },
      photos: [],
      pg: null,
      verification: []
    } as any);

    render(<ListingReviewTab accessToken="tok" onToast={vi.fn()} onCountChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("2BHK")).toBeInTheDocument());
    fireEvent.click(screen.getByText("2BHK"));
    await waitFor(() => expect(screen.getByText(/back to queue/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- ListingReviewTab`
Expected: FAIL (current tab renders a Drawer, no "Back to queue").

- [ ] **Step 3: Rewrite the tab**

```tsx
// apps/web/components/admin/tabs/ListingReviewTab.tsx
"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { ListingReviewWorkspace } from "../review/ListingReviewWorkspace";
import {
  decideAdminListing,
  fetchAdminListings,
  type AdminListingVm
} from "../../../lib/admin-api";
import { formatDate, formatINRPrecise } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  initialListingId?: string | null;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

export function ListingReviewTab({ accessToken, initialListingId, onCountChange, onToast }: Props) {
  const [items, setItems] = useState<AdminListingVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "flat_house" | "pg">("all");
  const [activeId, setActiveId] = useState<string | null>(initialListingId ?? null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchAdminListings(accessToken);
      setItems(r.items);
      onCountChange?.(r.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (initialListingId) setActiveId(initialListingId);
  }, [initialListingId]);

  const filtered = filter === "all" ? items : items.filter((i) => i.listingType === filter);

  async function decide(decision: "approve" | "reject" | "pause", reason: string) {
    if (!activeId) return;
    if ((decision === "reject" || decision === "pause") && !reason.trim()) {
      onToast("Reason is required for reject/pause", "warn");
      return;
    }
    setBusy(decision);
    try {
      await decideAdminListing(accessToken, activeId, decision, reason.trim() || undefined);
      onToast(`Listing ${decision}d`, "trust");
      setActiveId(null);
      void load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
  }

  if (activeId) {
    return (
      <ListingReviewWorkspace
        accessToken={accessToken}
        listingId={activeId}
        onBack={() => setActiveId(null)}
        onDecide={decide}
        busy={busy}
        onToast={onToast}
      />
    );
  }

  const columns: Column<AdminListingVm>[] = [
    {
      key: "title",
      header: "Title",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.title}</div>
          <div className="admin-table__id">{r.id.slice(0, 8)}…</div>
        </div>
      ),
      sortValue: (r) => r.title.toLowerCase()
    },
    {
      key: "type",
      header: "Type",
      render: (r) => <StatusPill status={r.listingType} tone="muted" noDot />,
      sortValue: (r) => r.listingType
    },
    { key: "city", header: "City", render: (r) => r.city ?? "-", sortValue: (r) => r.city ?? "" },
    {
      key: "rent",
      header: "Rent",
      align: "right",
      render: (r) => (
        <span className="admin-table__amount">
          {r.monthlyRent ? formatINRPrecise(r.monthlyRent * 100) : "-"}
        </span>
      ),
      sortValue: (r) => r.monthlyRent ?? 0
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill status={r.status} />,
      sortValue: (r) => r.status
    },
    {
      key: "verification",
      header: "Verification",
      render: (r) => <StatusPill status={r.verificationStatus} tone="muted" noDot />,
      sortValue: (r) => r.verificationStatus
    },
    {
      key: "created",
      header: "Submitted",
      align: "right",
      render: (r) => formatDate(r.createdAt),
      sortValue: (r) => r.createdAt
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Listing Review</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading…" : `${filtered.length} pending`}
        </span>
      </div>

      <SectionCard flush>
        <div className="admin-chip-row">
          {(["all", "flat_house", "pg"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="admin-chip"
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "flat_house" ? "Flat / House" : "PG"}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="No listings need review"
            hint="Owners will appear here when they submit."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => setActiveId(r.id)}
          />
        )}
      </SectionCard>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- ListingReviewTab`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/tabs/ListingReviewTab.tsx apps/web/components/admin/tabs/__tests__/ListingReviewTab.test.tsx
git commit -m "feat(web): ListingReviewTab opens full workspace on row click"
```

---

## Task 13: `VerificationReviewView` + convert `VerificationTab`

Add the verification detail view (evidence left, context + decision right) and switch `VerificationTab` from drawer to list ⇄ detail. Add an `onOpenListing` prop to jump to the listing workspace.

**Files:**

- Create: `apps/web/components/admin/review/VerificationReviewView.tsx`
- Modify: `apps/web/components/admin/tabs/VerificationTab.tsx`
- Test: `apps/web/components/admin/review/__tests__/VerificationReviewView.test.tsx`

**Interfaces:**

- Consumes: `fetchAdminVerificationDetail` (Task 6), `VerificationEvidence`, `DecisionBar`, `decideAdminVerification` (existing).
- Produces:
  ```ts
  function VerificationReviewView({
    accessToken,
    attemptId,
    onBack,
    onDecide,
    busy,
    onToast,
    onOpenListing
  }: {
    accessToken: string;
    attemptId: string;
    onBack: () => void;
    onDecide: (decision: "pass" | "fail" | "manual_review", reason: string) => void;
    busy: string | null;
    onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
    onOpenListing?: (listingId: string) => void;
  }): JSX.Element;
  ```
- `VerificationTab` accepts a new optional prop `onOpenListing?: (listingId: string) => void`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/admin/review/__tests__/VerificationReviewView.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminVerificationDetail: vi.fn(),
  fetchVerificationArtifactLink: vi.fn()
}));

import { VerificationReviewView } from "../VerificationReviewView";
import { fetchAdminVerificationDetail } from "../../../../lib/admin-api";

const mockedDetail = vi.mocked(fetchAdminVerificationDetail);

const detail = {
  attempt_id: "V1",
  kind: "video_liveness",
  result: "manual_review",
  liveness_score: 82,
  address_match_score: null,
  threshold: 85,
  provider: "mock",
  provider_reference: "lv_9",
  provider_result_code: "LOW_CONFIDENCE",
  review_reason: "below",
  retryable: true,
  artifact_available: true,
  created_at: "2026-07-12T10:05:00.000Z",
  listing: { id: "L1", title: "2BHK", address: "142, 5th Cross" },
  owner: {
    id: "O1",
    name: "Ramesh Kumar",
    phone: "+919876543210",
    whatsapp_opt_in: true,
    member_since: null
  }
};

describe("VerificationReviewView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders context and calls onOpenListing", async () => {
    mockedDetail.mockResolvedValueOnce(detail as any);
    const onOpenListing = vi.fn();
    render(
      <VerificationReviewView
        accessToken="tok"
        attemptId="V1"
        onBack={vi.fn()}
        onDecide={vi.fn()}
        busy={null}
        onToast={vi.fn()}
        onOpenListing={onOpenListing}
      />
    );
    await waitFor(() => expect(screen.getByText("2BHK")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /open full listing/i }));
    expect(onOpenListing).toHaveBeenCalledWith("L1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- VerificationReviewView`
Expected: FAIL — cannot find module `../VerificationReviewView`.

- [ ] **Step 3: Write `VerificationReviewView`**

```tsx
// apps/web/components/admin/review/VerificationReviewView.tsx
"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminVerificationDetail,
  type AdminVerificationDetailVm
} from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";
import { StatusPill } from "../primitives/StatusPill";
import { VerificationEvidence, type EvidenceItem } from "./VerificationEvidence";
import { DecisionBar } from "./DecisionBar";
import { formatDate } from "../../../lib/admin/format";

const VERIF_ACTIONS = [
  { key: "manual_review", label: "Manual review", variant: "ghost" as const },
  { key: "fail", label: "Fail", variant: "danger" as const, requiresReason: true },
  { key: "pass", label: "Pass", variant: "primary" as const }
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        borderBottom: "1px dashed var(--ad-border)",
        padding: "4px 0"
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--ad-text)", textAlign: "right" }}>
        {value ?? "-"}
      </span>
    </div>
  );
}

export function VerificationReviewView({
  accessToken,
  attemptId,
  onBack,
  onDecide,
  busy,
  onToast,
  onOpenListing
}: {
  accessToken: string;
  attemptId: string;
  onBack: () => void;
  onDecide: (decision: "pass" | "fail" | "manual_review", reason: string) => void;
  busy: string | null;
  onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
  onOpenListing?: (listingId: string) => void;
}) {
  const [detail, setDetail] = useState<AdminVerificationDetailVm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAdminVerificationDetail(accessToken, attemptId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && onToast("Failed to load verification", "danger"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, attemptId]);

  if (loading)
    return (
      <div style={{ padding: 24, color: "var(--ad-text-3)", fontSize: 13 }}>
        Loading verification…
      </div>
    );
  if (!detail)
    return (
      <div style={{ padding: 24, color: "var(--ad-text-3)", fontSize: 13 }}>
        Verification attempt not found.
      </div>
    );

  const evidence: EvidenceItem[] = [
    {
      attempt_id: detail.attempt_id,
      kind: detail.kind,
      result: detail.result,
      score: detail.kind === "video_liveness" ? detail.liveness_score : detail.address_match_score,
      threshold: detail.threshold,
      provider_result_code: detail.provider_result_code,
      review_reason: detail.review_reason,
      artifact_available: detail.artifact_available
    }
  ];

  return (
    <div className="admin-main__section">
      <button
        type="button"
        className="admin-btn admin-btn--ghost admin-btn--sm"
        onClick={onBack}
        style={{ alignSelf: "flex-start" }}
      >
        ← Back to verification queue
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
          gap: 16,
          alignItems: "start"
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: ".06em",
              color: "var(--ad-text-3)",
              fontWeight: 800,
              marginBottom: 8
            }}
          >
            Evidence
          </div>
          <VerificationEvidence accessToken={accessToken} onToast={onToast} items={evidence} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionCard title="What's being verified">
            <Row label="Listing" value={detail.listing.title ?? "-"} />
            <Row label="Address" value={detail.listing.address ?? "-"} />
            <Row label="Type" value={detail.kind.replace(/_/g, " ")} />
            {detail.listing.id && onOpenListing && (
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                style={{ marginTop: 8 }}
                onClick={() => onOpenListing(detail.listing.id!)}
              >
                Open full listing
              </button>
            )}
          </SectionCard>

          <SectionCard title="Owner / submitter">
            <Row label="Name" value={detail.owner.name} />
            <Row
              label="Phone"
              value={
                detail.owner.phone ? (
                  <a href={`tel:${detail.owner.phone}`} style={{ color: "var(--ad-trust)" }}>
                    {detail.owner.phone}
                  </a>
                ) : (
                  "-"
                )
              }
            />
            <Row label="WhatsApp" value={detail.owner.whatsapp_opt_in ? "Opted in" : "No"} />
            <Row
              label="Member since"
              value={detail.owner.member_since ? formatDate(detail.owner.member_since) : "-"}
            />
          </SectionCard>

          <SectionCard title="Provider & attempt data">
            <Row label="Provider" value={detail.provider ?? "-"} />
            <Row label="Provider ref" value={detail.provider_reference ?? "-"} />
            <Row label="Result code" value={detail.provider_result_code ?? "-"} />
            <Row label="Review reason" value={detail.review_reason?.replace(/_/g, " ") ?? "-"} />
            <Row
              label="Retryable"
              value={detail.retryable == null ? "-" : detail.retryable ? "yes" : "no"}
            />
            <Row label="Current result" value={<StatusPill status={detail.result} />} />
            <Row label="Submitted" value={formatDate(detail.created_at)} />
          </SectionCard>

          <DecisionBar
            actions={VERIF_ACTIONS}
            busy={busy}
            onDecide={(key, reason) => onDecide(key as "pass" | "fail" | "manual_review", reason)}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `VerificationTab.tsx` to list ⇄ detail**

Replace the file with the queue table (keep the existing `columns` + `fetchAdminVerifications`) plus detail switching. Full file:

```tsx
// apps/web/components/admin/tabs/VerificationTab.tsx
"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { VerificationReviewView } from "../review/VerificationReviewView";
import {
  decideAdminVerification,
  fetchAdminVerifications,
  type AdminVerificationVm
} from "../../../lib/admin-api";
import { formatDate } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
  onOpenListing?: (listingId: string) => void;
}

export function VerificationTab({ accessToken, onCountChange, onToast, onOpenListing }: Props) {
  const [items, setItems] = useState<AdminVerificationVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "video_liveness" | "electricity_bill_match">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchAdminVerifications(accessToken);
      setItems(r.items);
      onCountChange?.(r.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const filtered = filter === "all" ? items : items.filter((i) => i.verificationType === filter);

  async function decide(decision: "pass" | "fail" | "manual_review", reason: string) {
    if (!activeId) return;
    if (decision === "fail" && !reason.trim()) {
      onToast("Reason is required when failing", "warn");
      return;
    }
    setBusy(decision);
    try {
      await decideAdminVerification(accessToken, activeId, decision, reason.trim() || undefined);
      onToast(`Verification ${decision.replace("_", " ")}`, "trust");
      setActiveId(null);
      void load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
  }

  if (activeId) {
    return (
      <VerificationReviewView
        accessToken={accessToken}
        attemptId={activeId}
        onBack={() => setActiveId(null)}
        onDecide={decide}
        busy={busy}
        onToast={onToast}
        onOpenListing={onOpenListing}
      />
    );
  }

  const columns: Column<AdminVerificationVm>[] = [
    {
      key: "type",
      header: "Type",
      render: (r) => (
        <StatusPill
          status={r.verificationType}
          label={r.verificationType === "video_liveness" ? "Video Liveness" : "Electricity Bill"}
          tone="muted"
          noDot
        />
      ),
      sortValue: (r) => r.verificationType
    },
    {
      key: "user",
      header: "User",
      render: (r) => <span className="admin-table__id">{r.userId.slice(0, 8)}…</span>,
      sortValue: (r) => r.userId
    },
    {
      key: "machine",
      header: "Machine result",
      render: (r) => (r.machineResult ? <StatusPill status={r.machineResult} /> : "-"),
      sortValue: (r) => r.machineResult ?? ""
    },
    {
      key: "result",
      header: "Current",
      render: (r) => <StatusPill status={r.result} />,
      sortValue: (r) => r.result
    },
    {
      key: "scores",
      header: "Scores",
      align: "right",
      render: (r) => (
        <span className="admin-table__amount" style={{ fontSize: 11.5 }}>
          {r.livenessScore != null && `live ${Math.round(r.livenessScore)}`}
          {r.livenessScore != null && r.addressMatchScore != null && " · "}
          {r.addressMatchScore != null && `addr ${Math.round(r.addressMatchScore)}`}
          {r.livenessScore == null && r.addressMatchScore == null && "-"}
        </span>
      )
    },
    {
      key: "reason",
      header: "Review reason",
      render: (r) => (
        <span style={{ color: "var(--ad-text-3)", fontSize: 12 }}>
          {r.reviewReason ? r.reviewReason.replace(/_/g, " ") : "-"}
        </span>
      )
    },
    {
      key: "created",
      header: "Submitted",
      align: "right",
      render: (r) => formatDate(r.createdAt),
      sortValue: (r) => r.createdAt
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Verification Review</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading…" : `${filtered.length} attempts`}
        </span>
      </div>

      <SectionCard flush>
        <div className="admin-chip-row">
          {(["all", "video_liveness", "electricity_bill_match"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="admin-chip"
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "video_liveness" ? "Video Liveness" : "Electricity Bill"}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No verifications waiting" />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => setActiveId(r.id)}
          />
        )}
      </SectionCard>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web test -- VerificationReviewView`
Run: `pnpm --filter @cribliv/web test -- VerificationTab` (if a prior test file exists; otherwise skip)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/admin/review/VerificationReviewView.tsx apps/web/components/admin/tabs/VerificationTab.tsx apps/web/components/admin/review/__tests__/VerificationReviewView.test.tsx
git commit -m "feat(web): verification review view with evidence + listing jump"
```

---

## Task 14: Wire `openListingReview` cross-tab nav in `AdminShell`

Lift a `listingReviewTarget` into shell state; pass `initialListingId` to `ListingReviewTab` and `onOpenListing` to `VerificationTab`, mirroring the existing `onJumpToTab` precedent.

**Files:**

- Modify: `apps/web/components/admin/shell/AdminShell.tsx`
- Test: `apps/web/components/admin/shell/__tests__/AdminShell.crossnav.test.tsx`

**Interfaces:**

- Consumes: `ListingReviewTab` `initialListingId` (Task 12), `VerificationTab` `onOpenListing` (Task 13).
- Produces: shell state `listingReviewTarget` + handler `openListingReview(id)` that sets it and switches to the `"listings"` tab.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/admin/shell/__tests__/AdminShell.crossnav.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the two tabs to tiny stand-ins that exercise the wiring.
vi.mock("../../tabs/VerificationTab", () => ({
  VerificationTab: ({ onOpenListing }: { onOpenListing?: (id: string) => void }) => (
    <button onClick={() => onOpenListing?.("L1")}>jump</button>
  )
}));
vi.mock("../../tabs/ListingReviewTab", () => ({
  ListingReviewTab: ({ initialListingId }: { initialListingId?: string | null }) => (
    <div>listing-tab:{initialListingId ?? "none"}</div>
  )
}));
// Stub the remaining tabs/topbar/sidebar so the shell mounts cheaply.
vi.mock("../AdminSidebar", () => ({
  AdminSidebar: ({ onChange }: { onChange: (t: string) => void }) => (
    <button onClick={() => onChange("verifications")}>go-verif</button>
  )
}));

import { AdminShell } from "../AdminShell";

describe("AdminShell cross-nav", () => {
  beforeEach(() => sessionStorage.clear());

  it("openListingReview switches to the listings tab preselected", async () => {
    render(<AdminShell accessToken="tok" />);
    fireEvent.click(screen.getByText("go-verif"));
    fireEvent.click(await screen.findByText("jump"));
    await waitFor(() => expect(screen.getByText("listing-tab:L1")).toBeInTheDocument());
  });
});
```

> Note: this test mocks `AdminSidebar` and both review tabs. If the shell imports other tabs eagerly that error under jsdom, add matching `vi.mock` stubs for them at the top of the test (one line each). Keep the mocks minimal.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- AdminShell.crossnav`
Expected: FAIL — `onOpenListing`/`initialListingId` not wired (listing tab shows `none`).

- [ ] **Step 3: Wire the shell**

In `apps/web/components/admin/shell/AdminShell.tsx`, add state near the existing `tab` state:

```tsx
const [listingReviewTarget, setListingReviewTarget] = useState<string | null>(null);
```

Add the handler (near `handleCount`):

```tsx
const openListingReview = useCallback((listingId: string) => {
  setListingReviewTarget(listingId);
  setTab("listings");
}, []);
```

Update the `listings` case in the `switch` to pass the target and clear it once consumed:

```tsx
      case "listings":
        return (
          <ListingReviewTab
            key={`li-${k}`}
            accessToken={accessToken}
            initialListingId={listingReviewTarget}
            onCountChange={handleCount("listings")}
            onToast={push}
          />
        );
```

Update the `verifications` case to pass `onOpenListing`:

```tsx
      case "verifications":
        return (
          <VerificationTab
            key={`ve-${k}`}
            accessToken={accessToken}
            onCountChange={handleCount("verifications")}
            onToast={push}
            onOpenListing={openListingReview}
          />
        );
```

Add an effect to clear the one-shot target after switching away from `listings`, so returning to the tab later doesn't force-reopen the old listing:

```tsx
useEffect(() => {
  if (tab !== "listings" && listingReviewTarget) setListingReviewTarget(null);
}, [tab, listingReviewTarget]);
```

(Ensure `useCallback` and `useEffect` are in the React import at the top of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- AdminShell.crossnav`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/shell/AdminShell.tsx apps/web/components/admin/shell/__tests__/AdminShell.crossnav.test.tsx
git commit -m "feat(web): openListingReview cross-tab nav from verification to listing"
```

---

## Task 15: Full verification pass (build, typecheck, lint, tests)

Confirm the whole feature is green end-to-end before handoff.

**Files:** none (verification only).

- [ ] **Step 1: API tests**

Run: `pnpm --filter @cribliv/api test`
Expected: PASS (includes the new SAS issuer, AdminReviewService, and controller integration tests).

- [ ] **Step 2: Web tests**

Run: `pnpm --filter @cribliv/web test`
Expected: PASS (includes all new review component tests).

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck`
Run: `pnpm lint`
Expected: PASS. Fix any type or lint errors surfaced (common: unused imports left in the old `ListingReviewTab`/`VerificationTab` — remove them).

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Manual smoke via the run skill (optional but recommended)**

Start the app, sign in as admin (`+919999999903`), open Listing Review → click a pending listing → confirm the workspace shows photos/owner/property/verification and the decision bar; open Verification → click an attempt → confirm the evidence viewer loads. Use the `/run` skill or the browser-preview verification workflow.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "chore(review): typecheck/lint/build fixes for review redesign"
```

---

## Optional Task 16: Persist artifact-view audit to `admin_actions`

The default plan logs artifact views via Nest `Logger`. To persist them, add an `admin_action_type` enum value and an insert. This requires a DB migration the user runs on prod, so it's optional.

**Files:**

- Create: `infra/migrations/00NN_admin_action_verification_artifact_view.sql` (next number in sequence)
- Modify: `apps/api/src/modules/admin/admin-review.service.ts` — insert into `admin_actions` in `getVerificationArtifactLink`.

- [ ] **Step 1: Migration**

```sql
-- infra/migrations/00NN_admin_action_verification_artifact_view.sql
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'verification_artifact_view';
```

- [ ] **Step 2: Insert on view** (replace the `this.logger.log(...)` call)

```ts
await this.database.query(
  `
      INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, reason, before_state, after_state)
      VALUES ($1::uuid, 'verification', $2::uuid, 'verification_artifact_view', $3, null, null)
      `,
  [adminUserId, attemptId, `kind=${kind}`]
);
```

- [ ] **Step 3: Verify** — extend the Task 4 test's happy-path to assert the insert is called (add a second `mockResolvedValueOnce({ rows: [], rowCount: 0 })` for the insert, and `expect(query).toHaveBeenCalledTimes(2)`).

- [ ] **Step 4: Commit**

```bash
git add infra/migrations apps/api/src/modules/admin/admin-review.service.ts apps/api/src/modules/admin/__tests__/unit/admin-review.service.test.ts
git commit -m "feat(api): persist verification artifact-view audit to admin_actions"
```

---

## Self-Review Notes

- **Spec coverage:** Listing workspace (Tasks 7–12), verification review + evidence viewer (Tasks 9, 13), 3 API endpoints (Tasks 2–5), secure SAS links (Tasks 1, 4), full owner profile (Task 8), cross-nav (Tasks 13–14), dual-mode fallback (Task 2), tests throughout, graceful empty states (Tasks 7, 9, 11). Audit logging via Logger (Task 4) with optional DB persistence (Task 16).
- **Type consistency:** `EvidenceItem` is defined in Task 9 and consumed in Tasks 11/13; `mapEvidence` (Task 9) is used in Task 11; `fetchVerificationArtifactLink` returns `{ url, expiresAt }` (Task 6) consumed in Task 9; `initialListingId` (Task 12) + `onOpenListing` (Task 13) consumed in Task 14. `AdminReviewService` constructor arg order (database, appState, sas) is consistent across Tasks 2–5.
- **In-memory caveat:** the fallback returns empty photos/verification and owner-from-`appState.users`; this is intentional (prod runs on Postgres) and documented in Global Constraints.
