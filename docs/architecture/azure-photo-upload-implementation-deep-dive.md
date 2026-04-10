# Azure Photo Upload Implementation Deep Dive

Date: 2026-04-10

## 1. Summary

This document captures the full implementation that moved photo uploads from a placeholder/stub flow to a production-ready Azure Blob flow with direct browser upload, server-side validation, and reliable search/photo rendering.

Primary outcomes:

- Real SAS upload URLs from API (no placeholder URLs)
- Real browser PUT upload to Azure Blob before completion is accepted
- Server-side blob existence/type/size verification before DB write
- Idempotent and conflict-safe upload lifecycle
- Scalable client upload concurrency with retries
- Photo URL normalization for search and similar listing cards
- CSP fix for Azure Blob upload endpoint connectivity

## 2. What Was Broken Before

## 2.1 Presign endpoint was a stub

`presign` returned fake upload URLs, so it was not integrated to real cloud storage.

## 2.2 Frontend marked uploads complete without uploading bytes

The wizard called `presign` and then `complete`, but did not upload the file body to the returned URL.

## 2.3 Read-path mismatch risk

Search/listing cards expected photo URLs, but DB stored blob paths. Without URL mapping, rendering could break.

## 2.4 Security/reliability gaps

- Weak enforcement of content type and size
- No server-side blob existence check in completion
- Potential duplicate client upload ID collisions

## 3. Architecture Implemented

## 3.1 Upload sequence

1. Frontend requests `presign` with metadata.
2. API validates metadata and ownership, returns SAS upload URL + canonical blob path.
3. Frontend performs direct `PUT` to Azure Blob.
4. Frontend calls `complete` only after successful `PUT`.
5. API validates blob presence and constraints, then inserts `listing_photos` rows.

## 3.2 Read sequence

- API maps stored `blob_path` to absolute URL using configured public base.
- Search/similar listing responses return renderable `cover_photo` URLs.

## 4. Backend Core Logic

## 4.1 New storage service

File: `apps/api/src/modules/owner/azure-blob-photo-storage.service.ts`

Core responsibilities:

- Parse Azure storage configuration from either connection string or account/key.
- Build Blob client with retry options.
- Enforce upload policy:
  - Allowed MIME types
  - Max file size
- Generate secure write-only SAS URLs (`sp=cw`, HTTPS-only, short TTL).
- Generate canonical blob names per listing and upload ID.
- Validate uploaded blob before completion:
  - Blob exists
  - Content type allowed
  - Content length valid
- Resolve photo public base URL for read mapping.

Notable decisions:

- SAS start time is backdated by 5 minutes to reduce clock-skew issues.
- Blob names are sanitized and include timestamp + random suffix for uniqueness.
- Strict listing prefix check ensures a blob path cannot be reused across listings.

## 4.2 Owner module wiring

File: `apps/api/src/modules/owner/owner.module.ts`

Change:

- Registered `AzureBlobPhotoStorageService` as a provider in the owner module.

## 4.3 Presign flow hardening

File: `apps/api/src/modules/owner/owner.service.ts`
Function: `presignPhotos(...)`

Enhancements:

- Validates non-empty file list.
- Caps batch size to 30 files.
- Rejects duplicate `client_upload_id` within same request.
- Validates content type and size via storage service policy.
- Preserves idempotent behavior (`owner:{listingId}:photos/presign`).
- Verifies listing ownership before issuing URLs.
- Returns real SAS upload URL and canonical blob path.

## 4.4 Completion flow hardening

File: `apps/api/src/modules/owner/owner.service.ts`
Function: `completePhotos(...)`

Enhancements:

- Validates non-empty file list.
- Rejects missing `client_upload_id`/`blob_path`.
- Rejects duplicate `client_upload_id` in request.
- Enforces max one cover photo in request.
- Preserves idempotency (`owner:{listingId}:photos/complete`).
- Verifies listing ownership.
- Validates each blob in Azure before DB insert.
- Clears previous cover if new cover is set.
- Clamps `sort_order` into a safe smallint range.
- Keeps duplicate conflict semantics via unique `(listing_id, client_upload_id)`.

## 4.5 Search response URL mapping

File: `apps/api/src/modules/search/search.service.ts`

Enhancements:

- Added `resolvePhotoPublicBaseUrl()` and `toPhotoUrl(...)`.
- Search and similar listing outputs now map `blob_path` to browser-usable URL.
- Handles cases where value is already absolute URL.

## 4.6 Dependency addition

File: `apps/api/package.json`

Added:

- `@azure/storage-blob`

## 5. Frontend Core Logic

## 5.1 Real upload in wizard

File: `apps/web/app/[locale]/owner/listings/new/page.tsx`
Function: `uploadFile(...)`

Enhancements:

- Calls `presignListingPhotos` to get SAS URL.
- Performs actual `PUT` to Azure Blob with required headers:
  - `x-ms-blob-type: BlockBlob`
  - `Content-Type`
- Retries transient failures (408, 429, 5xx), up to 3 attempts.
- Calls `completeListingPhotos` only after successful upload.
- Marks upload state and progress transitions carefully.

## 5.2 Bounded concurrency

File: `apps/web/app/[locale]/owner/listings/new/page.tsx`
Function: `uploadAllPending()`

Enhancement:

- Uses worker-pool concurrency (`MAX_PARALLEL_UPLOADS`) for scalable multi-file upload.

## 5.3 Stronger upload IDs

File: `apps/web/components/listing-wizard/types.ts`
Function: `generateClientUploadId(file)`

Enhancement:

- Uses `name + size + lastModified + random suffix` to reduce collisions.

## 6. CSP vs CORS Production Issue

Reported runtime error:

- Browser blocked `fetch` to Azure Blob with message: violates document Content Security Policy.

Important distinction:

- CORS: server-side browser permission model for cross-origin requests.
- CSP: page policy that can block requests before CORS is even evaluated.

You had CORS configured on Azure correctly, but CSP in web app did not allow Blob upload endpoints in `connect-src`.

### 6.1 Fix applied

File: `apps/web/next.config.mjs`

Changes:

- Extended CSP `connect-src` to allow Azure Blob upload hosts:
  - `https://*.blob.core.windows.net`
- Included optional origins derived from:
  - `PHOTO_PUBLIC_BASE_URL`
  - `AZURE_STORAGE_ACCOUNT_NAME`
- Kept API, websocket, speech, and Azure OpenAI origins intact.

### 6.2 Why this resolves your error

Direct SAS upload uses browser `fetch` to `https://<account>.blob.core.windows.net/...`.
If that host is absent from `connect-src`, the browser blocks it immediately with the exact error you saw.

### 6.3 Required action after this config change

Restart the Next.js web server so updated headers/CSP are applied.

## 7. Reliability and Safety Controls Added

- Metadata validation before presign
- Blob validation before complete
- Idempotent presign and complete responses
- Duplicate upload ID conflict handling
- Safe sort order normalization
- Cover-photo consistency behavior (clear old cover on new cover)
- Retry and concurrency on client upload path

## 8. File-by-File Change Log

Created:

- `apps/api/src/modules/owner/azure-blob-photo-storage.service.ts`
- `docs/architecture/azure-photo-service-handoff.md`
- `docs/architecture/azure-photo-upload-implementation-deep-dive.md`

Updated:

- `apps/api/package.json`
- `apps/api/src/modules/owner/owner.module.ts`
- `apps/api/src/modules/owner/owner.service.ts`
- `apps/api/src/modules/search/search.service.ts`
- `apps/web/app/[locale]/owner/listings/new/page.tsx`
- `apps/web/components/listing-wizard/types.ts`
- `apps/web/next.config.mjs`

## 9. Validation Performed

- API and web typechecks were run and fixed to green.
- Azure photo env vars required by this flow were verified present in environment.

## 10. Remaining Recommended Hardening

1. Add DB-level partial unique index for single cover photo per listing:
   - `UNIQUE (listing_id) WHERE is_cover = true`
2. Add integration tests for:
   - blob missing at complete
   - unsupported blob content type
   - oversized blob rejection
3. Add operational monitoring for upload failure codes and retry rates.

## 11. Quick Troubleshooting Checklist

If upload still fails after CSP fix:

1. Restart web server (required for Next header changes).
2. In browser devtools, inspect response headers and confirm CSP `connect-src` contains `https://*.blob.core.windows.net`.
3. Confirm API `presign` returns an Azure Blob URL (not placeholder).
4. Confirm SAS token is not expired (`st`/`se` window valid).
5. Confirm Azure CORS on Blob service includes your exact origin and `PUT,OPTIONS`.
6. Confirm request includes `x-ms-blob-type: BlockBlob`.

## 12. Post-Incident Stabilization (2026-04-10)

After a production-like validation pass, additional hardening was applied:

1. Blob CORS was reconfigured and validated directly via Azure CLI.
2. Search service in-memory fallback was restored so non-DB mode returns active listings instead of empty results.
3. STT error mapping was improved to preserve upstream structured error codes (stable API error contract).
4. Search routing tests were updated for async route behavior and deterministic AI stubs.

Files updated in this stabilization pass:

- `apps/api/src/modules/search/search.service.ts`
- `apps/api/src/modules/owner/owner.capture.service.ts`
- `apps/api/test/search-routing.test.ts`

## 13. Validation Matrix (Executed)

Infrastructure/runtime checks:

- Azure Blob preflight (`OPTIONS`) from `http://localhost:3000`: `200 OK` with `Access-Control-Allow-Origin` present.
- Real SAS upload probe (`PUT`) with required headers: `201 Created`.

Build and static checks:

- `pnpm --filter @cribliv/api typecheck`: pass
- `pnpm --filter @cribliv/web typecheck`: pass

Backend tests:

- Targeted previously failing suites:
  - `test/search-routing.test.ts`: pass
  - `test/phase1.integration.test.ts`: pass
  - `test/owner-capture.integration.test.ts`: pass
- Full API suite:
  - `35 passed, 0 failed`

## 14. Operational Note

If browser still shows CORS/CSP failures after these fixes:

1. Restart web dev server to apply CSP header changes.
2. Hard refresh browser.
3. Ensure the request origin exactly matches one of Blob CORS allowed origins.
4. Confirm you are using a fresh SAS URL (not expired).
