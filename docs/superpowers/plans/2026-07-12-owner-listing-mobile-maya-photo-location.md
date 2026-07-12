# Owner Listing Mobile Maya, Photo Upload, and Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile owner listing wizard continuously usable by replacing Maya's default expanded drawer with a stateful bubble, normalizing iPhone photos before reliable uploads, and making locality search reliably place the map pin.

**Architecture:** Keep realtime voice ownership in `VoiceCoPilot`, but move mobile presentation state into a focused `MobileMayaShell`. Put photo format detection, conversion, compression, XHR transport, and error mapping in `lib/listing-photo.ts`, then let the wizard only coordinate queue state. Strengthen `useGooglePlaces` with explicit readiness/error state and let `LocationStep` remain the owner of form and map mutations.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest/Testing Library, Playwright, Google Maps JavaScript API, Azure Blob SAS upload, `heic2any`.

## Global Constraints

- Mobile visual collapse must never stop or recreate an active realtime voice session.
- Voice ends only by explicit user action, existing timeout, auth loss, or unrecoverable realtime error.
- Desktop Maya remains a side panel.
- Accepted listing photo inputs are JPEG/JPG, PNG, HEIC, HEIF, and WebP.
- Prepared listing uploads are JPEG, at most 2560 pixels on the long edge, approximately 0.82 quality, and at most 10 MB.
- Failed photo selections remain visible and retry with a fresh presigned URL.
- Raw HTTP upload errors are never displayed to owners.
- Locality selection updates locality, supported city, coordinates, map center, and draggable pin.
- Manual locality entry and map click remain available when Places is unavailable.

---

### Task 1: Mobile Maya Shell

**Files:**

- Create: `apps/web/components/listing-wizard/MobileMayaShell.tsx`
- Create: `apps/web/components/listing-wizard/__tests__/MobileMayaShell.test.tsx`
- Modify: `apps/web/components/listing-wizard/VoiceCoPilot.tsx`
- Modify: `apps/web/components/listing-wizard/index.ts`
- Modify: `apps/web/components/listing-wizard/concierge.css`
- Modify: `apps/web/app/[locale]/owner/listings/new/page.tsx`

**Interfaces:**

- Consumes: `RealtimeAgentState`, `voiceActive`, and the rendered copilot content.
- Produces:
  - `MobileMayaShell({ agentState, voiceActive, expanded, onExpandedChange, children })`
  - `VoiceCoPilot` callback `onAgentStateChange?: (state: RealtimeAgentState) => void`
  - Separate `mayaExpanded` presentation state in the wizard page.

- [ ] **Step 1: Write failing shell tests**

Cover these behaviors:

```tsx
it("renders a collapsed Maya bubble by default");
it("opens the tray without toggling the voice session");
it("auto-collapses after speaking returns to listening");
it("shows listening status on the collapsed bubble");
```

Use a controlled harness whose `voiceActive` remains `true` while `expanded` changes.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/web test -- components/listing-wizard/__tests__/MobileMayaShell.test.tsx
```

Expected: FAIL because `MobileMayaShell` does not exist.

- [ ] **Step 3: Implement the mobile shell**

Implement a fixed bubble plus compact tray:

```ts
interface MobileMayaShellProps {
  agentState: RealtimeAgentState;
  voiceActive: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: React.ReactNode;
}
```

Track the previous agent state. When the previous state is `"speaking"` and the next state is `"listening"` or `"idle"`, call `onExpandedChange(false)`. Do not call the voice toggle.

Add status copy for ready, connecting, listening, thinking, speaking, ended, and error. Render active status through both visible styling and an accessible label.

- [ ] **Step 4: Report realtime state without changing ownership**

Add `onAgentStateChange` to `VoiceCoPilotProps` and invoke it whenever `agentState` changes. Remove the existing `drawerCollapsed` state and drawer handle from `VoiceCoPilot`; the shell owns presentation only.

- [ ] **Step 5: Wire the shell into the owner wizard**

Add `mayaExpanded` and `mayaAgentState` to the wizard page. On mobile, the shell starts collapsed. Clicking the existing header **Talk to Maya** command starts voice and expands the tray. Collapsing through the shell leaves `voiceActive` unchanged.

Add a capturing `pointerdown`/`focusin` handler on the form column that collapses the tray while allowing the original interaction to continue.

- [ ] **Step 6: Add responsive CSS**

Keep `.cz-copilot` as the desktop side panel. Under `max-width: 1100px`, render:

```css
.cz-maya-mobile__bubble {
  position: fixed;
  right: 16px;
  bottom: calc(20px + env(safe-area-inset-bottom));
}
.cz-maya-mobile__tray {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom));
  max-height: min(62vh, 520px);
  overflow-y: auto;
}
```

Ensure the bubble is below no navigation control and the form column has enough bottom padding to scroll controls above the tray.

- [ ] **Step 7: Run tests and verify GREEN**

Run the shell test and existing listing wizard component tests. Expected: PASS.

---

### Task 2: Listing Photo Preparation and Upload Primitives

**Files:**

- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/lib/listing-photo.ts`
- Create: `apps/web/lib/__tests__/listing-photo.test.ts`

**Interfaces:**

- Produces:

```ts
type ListingPhotoKind = "jpeg" | "png" | "webp" | "heic" | "heif";

detectListingPhotoKind(file: Pick<File, "name" | "type">): ListingPhotoKind | null;

prepareListingPhoto(file: File): Promise<File>;

uploadBlobWithProgress(input: {
  url: string;
  file: Blob;
  contentType: string;
  onProgress: (percent: number) => void;
}): Promise<void>;

friendlyPhotoUploadError(error: unknown): string;
```

- [ ] **Step 1: Install HEIC decoder**

Run:

```bash
pnpm --filter @cribliv/web add heic2any
```

Expected: `apps/web/package.json` and `pnpm-lock.yaml` include `heic2any`.

- [ ] **Step 2: Write failing utility tests**

Cover MIME and extension detection, including empty iOS MIME types:

```ts
expect(detectListingPhotoKind(file("IMG_1.HEIC", ""))).toBe("heic");
expect(detectListingPhotoKind(file("room.heif", "image/heif"))).toBe("heif");
expect(detectListingPhotoKind(file("room.gif", "image/gif"))).toBeNull();
```

Mock image decode/encode boundaries to prove the prepared result is `image/jpeg`, never exceeds 2560 pixels on the long edge, and rejects output above 10 MB.

Mock `XMLHttpRequest` to prove progress events are forwarded and HTTP/network failures reject with typed internal errors. Prove `friendlyPhotoUploadError` never returns `Photo upload failed (HTTP ...)`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/web test -- lib/__tests__/listing-photo.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement format detection and normalization**

Use MIME first and extension fallback. Dynamically import `heic2any` only for HEIC/HEIF. Decode the resulting browser-safe blob, calculate constrained dimensions, draw to a canvas, and encode JPEG at qualities `0.82`, `0.72`, then `0.62` until the output is at most 10 MB.

Return a `File` with a `.jpg` filename, `image/jpeg` type, and the original `lastModified`.

- [ ] **Step 5: Implement XHR upload and error mapping**

Map XHR transfer progress to integer percentages. Treat 2xx as success. Retain internal status codes for mapping:

```ts
class ListingPhotoUploadError extends Error {
  kind: "network" | "expired" | "rejected" | "storage";
  status?: number;
}
```

Return actionable copy for unsupported image, decode failure, too large, network interruption, expired SAS, auth failure, and storage failure.

- [ ] **Step 6: Run utility tests and verify GREEN**

Expected: all listing-photo tests pass.

---

### Task 3: Integrate Photo Preparation, Progress, and Retry

**Files:**

- Modify: `apps/web/components/listing-wizard/types.ts`
- Modify: `apps/web/components/listing-wizard/PhotosStep.tsx`
- Modify: `apps/web/components/listing-wizard/PhotoGrid.tsx`
- Modify: `apps/web/components/listing-wizard/__tests__/PhotoGrid.test.tsx`
- Modify: `apps/web/app/[locale]/owner/listings/new/page.tsx`
- Modify: `apps/web/components/listing-wizard/concierge.css`
- Modify: `apps/web/tests/photo-upload.spec.ts`

**Interfaces:**

- Extend `UploadFile.status` with `"preparing"`.
- Add `originalFile?: File`.
- Add `onRetry(clientUploadId: string)` from `PhotosStep` to `PhotoGrid`.

- [ ] **Step 1: Write failing component tests**

Add tests proving:

```tsx
it("shows preparing state");
it("keeps a failed tile and renders Retry upload");
it("calls onRetry with the failed tile id");
```

- [ ] **Step 2: Run tests and verify RED**

Expected: retry UI and preparing status are missing.

- [ ] **Step 3: Prepare selected files**

In `onFilesSelected`, add each accepted selection immediately with `status: "preparing"` and its original preview. Run `prepareListingPhoto` asynchronously, replace `file` and preview with the JPEG, then set `status: "pending"`. Unsupported or failed preparation becomes `status: "error"` with friendly copy.

Duplicate detection uses the original file identity so conversion does not hide duplicates.

- [ ] **Step 4: Use real transfer progress**

Presign with the prepared JPEG type and size. Replace Azure `fetch` PUT with `uploadBlobWithProgress`. Map transfer progress into the 20-85 range, then completion to 100.

- [ ] **Step 5: Add retry**

`retryUpload(id)` changes only that failed prepared tile to pending and calls `uploadFile`, which always obtains a fresh presigned URL. Preparation failures retry preparation from `originalFile`; transfer failures reuse the prepared JPEG.

- [ ] **Step 6: Update upload UI and copy**

Change picker copy to `JPG, PNG, HEIC, HEIF, WebP · up to 10 MB each`. Add an explicit Retry upload button that does not start a drag. Keep remove and reorder behavior.

- [ ] **Step 7: Add E2E retry coverage**

Route the first Azure PUT to fail and the second to succeed. Verify the tile remains, shows human copy without raw HTTP text, and completes after Retry upload.

- [ ] **Step 8: Run component and photo E2E tests**

Expected: PASS.

---

### Task 4: Resilient Locality Search and Automatic Pin

**Files:**

- Modify: `apps/web/lib/google-places.ts`
- Create: `apps/web/lib/__tests__/google-places.test.tsx`
- Modify: `apps/web/components/listing-wizard/LocationStep.tsx`
- Create: `apps/web/components/listing-wizard/__tests__/LocationStep.test.tsx`
- Modify: `apps/web/components/listing-wizard/concierge.css`

**Interfaces:**

- Extend `useGooglePlaces` return value:

```ts
{
  ready: boolean;
  enabled: boolean;
  loading: boolean;
  error: "unavailable" | "request_failed" | null;
  noResults: boolean;
}
```

- [ ] **Step 1: Write failing hook and component tests**

Prove a query typed before readiness executes after Places initializes. Prove unavailable and zero-results states are exposed.

Mock `useGooglePlaces` in `LocationStep` tests and prove selecting a suggestion writes locality, replaces an inconsistent supported city, writes coordinates, and calls map pin placement.

- [ ] **Step 2: Run tests and verify RED**

Expected: readiness/error state and retry behavior are absent.

- [ ] **Step 3: Harden Places initialization**

Store the latest requested query. Once `AutocompleteService` is ready, automatically execute that pending query. Catch loader failures and expose `error: "unavailable"`. Set `noResults` only after a completed request returns no matches.

- [ ] **Step 4: Harden selection**

Expose a details-loading state. If details fail, keep the locality text but show a message that no pin was placed. For successful details, update the supported city even when another city was previously selected, then place and pan the pin.

- [ ] **Step 5: Add visible fallback states**

Render compact field help for loading, no results, unavailable/manual fallback, and details failure. Keep map click and drag active.

- [ ] **Step 6: Run location tests and verify GREEN**

Expected: hook and component tests pass.

---

### Task 5: Mobile End-to-End Verification

**Files:**

- Create: `apps/web/tests/owner-listing-mobile-regressions.spec.ts`
- Modify only if verification finds a defect in an already scoped file.

- [ ] **Step 1: Add mobile regression test**

Use an iPhone-sized viewport. Verify:

```ts
await expect(page.getByRole("button", { name: /open maya/i })).toBeVisible();
await expect(page.getByRole("complementary", { name: /voice concierge/i })).not.toBeVisible();
```

Open Maya, interact with a form field, verify Maya collapses and the field receives input. Navigate every wizard step and verify Back/Next/Submit remain reachable.

- [ ] **Step 2: Run targeted web unit tests**

Run:

```bash
pnpm --filter @cribliv/web test -- \
  components/listing-wizard/__tests__/MobileMayaShell.test.tsx \
  components/listing-wizard/__tests__/PhotoGrid.test.tsx \
  components/listing-wizard/__tests__/LocationStep.test.tsx \
  lib/__tests__/listing-photo.test.ts \
  lib/__tests__/google-places.test.tsx
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run API photo tests**

Run:

```bash
pnpm --filter @cribliv/api test -- owner-photos
```

Expected: PASS.

- [ ] **Step 4: Run typecheck and build**

Run:

```bash
pnpm --filter @cribliv/web typecheck
pnpm --filter @cribliv/api typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 5: Run Playwright mobile and photo suites**

Run:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web exec playwright test \
  tests/owner-listing-mobile-regressions.spec.ts \
  tests/photo-upload.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Inspect mobile screenshots**

Capture the collapsed bubble and expanded tray at approximately 390x844. Confirm no field, Back/Next/Submit control, or photo retry action is occluded.

- [ ] **Step 7: Completion audit**

Re-read all 12 acceptance criteria in the design spec and point each one to a passing unit test, E2E assertion, build output, or screenshot inspection. Do not mark complete while any criterion lacks direct evidence.
