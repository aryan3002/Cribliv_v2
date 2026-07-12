# Owner Listing Mobile Maya, Photo Upload, and Location Design

**Date:** 2026-07-12
**Status:** Approved
**Scope:** `apps/web` owner property listing wizard and the owner photo validation path in `apps/api`

## Objective

Keep the owner listing form usable throughout the mobile flow, make iPhone photo uploads reliable, and make locality selection place the map pin automatically.

## Current Root Causes

### Maya

`VoiceCoPilot` is mounted for the entire listing wizard. At the existing responsive breakpoint, CSS converts the desktop side panel into a fixed bottom drawer. Its initial `drawerCollapsed` state is `false`, so the large drawer opens on page load and covers the form.

The visual drawer state and the realtime voice-session state are currently represented separately, but the mobile UI does not use that separation well.

### Photos

The API photo storage service allows JPEG, PNG, and WebP by default. HEIC and HEIF are rejected during presign validation. The web client uploads the original file directly to Azure, so it does not normalize iPhone formats or reduce large image dimensions.

The current progress values are fixed stages rather than actual transferred-byte progress. A failed upload remains visible, but there is no direct retry action and raw HTTP failures reach the tile caption.

### Location

The wizard already has a locality search input, Google Places suggestions, place details lookup, automatic map movement, and a draggable pin. However, Places initialization is asynchronous and the current hook silently returns when the service is not ready. Missing keys, initialization failures, no results, and place-detail failures also degrade to an unexplained manual field.

## Maya Mobile Experience

### Responsive Behavior

- Desktop keeps the existing side-panel experience.
- At the existing overlay breakpoint, Maya starts as a small fixed bubble instead of an expanded drawer.
- The bubble is offset from the viewport edge and the wizard reserves enough bottom space that it cannot cover the Back, Next, or Submit controls.
- Tapping the bubble opens Maya's compact mobile tray.
- The tray has no backdrop or focus trap. The listing page remains scrollable.
- The open tray uses a bounded height and the page reserves matching bottom space, allowing all fields and navigation controls to scroll above it.
- Tapping or focusing the listing form, step indicator, or navigation controls collapses the tray without consuming the user's intended action.

### Session Lifecycle

Visual collapse must not stop or recreate the realtime session.

- Starting Maya opens the tray and starts the existing realtime client.
- Minimizing or auto-collapsing Maya changes presentation only.
- An active voice session continues while the bubble is collapsed.
- The session ends only when the user chooses **End conversation**, the existing session timeout fires, authentication is lost, or an unrecoverable realtime error ends it.
- The collapsed bubble visibly distinguishes ready, connecting, listening, thinking, speaking, and error states.
- The bubble exposes an accessible status label so an active microphone is never hidden from assistive technology.

### Auto-Collapse

- When Maya transitions from speaking to listening or idle after a response, the mobile tray collapses to the bubble.
- It does not collapse while the user is actively typing in Maya's text fallback.
- It does not stop the microphone or realtime client.
- The user can immediately reopen the same session by tapping the bubble.

## Photo Preparation and Upload

### Accepted Inputs

The file picker and drop handler accept:

- JPEG/JPG
- PNG
- HEIC
- HEIF
- WebP

MIME type and filename extension are both considered because iOS may provide an empty or inconsistent `File.type`.

### Client Normalization

Add a focused `listing-photo` utility that prepares files before they enter the upload queue.

1. Detect the input format.
2. Decode HEIC/HEIF with a browser-compatible HEIC decoder.
3. Apply image orientation during decoding.
4. Resize large images to a maximum 2560-pixel long edge.
5. Encode the upload file as JPEG at approximately 0.82 quality.
6. Reject the prepared file only if it is empty, cannot be decoded, or still exceeds the configured 10 MB upload limit.

The selected tile is created immediately and shows a preparing state while conversion/compression runs. The preview switches to the prepared JPEG when ready.

Normalization gives Azure one predictable content type and extension while still supporting all required input formats.

### Upload Transport

- Replace the direct `fetch` PUT with an `XMLHttpRequest` transport so `upload.onprogress` reports transferred bytes.
- Progress covers preparation, presign, Azure transfer, and completion without moving backward.
- Preserve the existing parallel upload limit.
- Each explicit retry requests a fresh presigned URL and reuses the prepared file.
- The original selection and preview stay in the grid after failure.
- Removing a tile revokes all object URLs owned by that tile.

### Retry and Errors

Failed tiles display a **Retry upload** action.

Errors are mapped to actionable copy:

- Unsupported or undecodable image: ask the owner to choose another image or export it as JPEG.
- File too large after compression: explain the 10 MB limit.
- Offline/network interruption: ask the owner to check connectivity and retry.
- Expired or rejected Azure URL: say the upload link expired and retry will create a new one.
- API authentication failure: ask the owner to log in again.
- Storage or completion failure: explain that the photo was retained and can be retried.

Raw HTTP status text is not shown to the owner. Diagnostic status information may still be logged through existing telemetry.

### API Validation

Because uploads are normalized to JPEG before presign, the storage API continues to persist only web-safe JPEG, PNG, and WebP blobs. Raw HEIC and HEIF blobs are not added to the storage allowlist because they would not display consistently on public listing pages. The owner listing wizard supports HEIC and HEIF as input formats and sends the prepared JPEG MIME type, size, and file bytes to the existing API and Azure flow.

## Property Location

### Search Flow

- Locality remains a text search field, not a select.
- Typing two or more characters starts debounced Places Autocomplete restricted to India.
- Suggestions show locality/area and the supporting address.
- Selecting a suggestion:
  - stores the locality name;
  - updates the city from the selected place when it matches a supported city;
  - stores latitude and longitude;
  - centers and zooms the map;
  - drops a draggable pin.
- The owner only drags or clicks the map when the suggested point needs adjustment.

### Resilience

- Places readiness is explicit. Input typed before initialization is retried once the service becomes ready.
- Loading, no-results, unavailable, and details-failure states are visible near the field.
- If Places is unavailable, manual locality entry and map clicking remain available.
- A failed place-details lookup does not silently imply that a pin was set.
- Manual changes to the locality clear stale coordinates and the pinned badge.
- Selecting a valid suggestion replaces a stale city rather than preserving an inconsistent city/locality pair.

## Component Boundaries

### `MobileMayaShell`

Owns expanded/collapsed presentation, auto-collapse rules, responsive rendering, status bubble accessibility, and form-interaction collapse. It does not own the realtime client.

### `VoiceCoPilot`

Continues to own the realtime client and capture feed. It reports agent state to the shell and renders its existing content inside the desktop panel or mobile tray.

### `listing-photo`

Pure format detection and preparation functions plus an upload transport wrapper. These functions can be tested without the full wizard.

### `PhotosStep` and `PhotoGrid`

Render preparing/uploading/error states and invoke select, upload, retry, remove, and reorder callbacks. They do not implement conversion or network transport.

### `useGooglePlaces`

Owns loader readiness, prediction requests, place details, and explicit error/loading states. `LocationStep` owns form and map updates.

## Testing

### Unit and Component Tests

- Maya is collapsed initially at the mobile breakpoint.
- Opening and collapsing Maya does not toggle `voiceActive`.
- speaking-to-listening collapses the tray while retaining the session.
- Form interaction collapses the tray and still focuses/clicks the intended control.
- The bubble exposes active listening/speaking status.
- HEIC/HEIF detection works with MIME types and filename fallbacks.
- Prepared files are JPEG and obey dimension/size constraints.
- XHR progress updates the matching tile.
- Failed photos remain visible and Retry calls upload with the prepared file.
- Error mapping never exposes a raw `Photo upload failed (HTTP ...)` message.
- A selected Place updates locality, city, coordinates, map center, and pin.
- A query entered before Places readiness runs when initialization completes.
- Unavailable and no-results states preserve manual entry and map pinning.

### API Tests

- Presign validation accepts the prepared JPEG and existing configured web-safe MIME types.
- Presign validation continues to reject raw HEIC/HEIF blobs, proving that normalization happens before the storage boundary.
- Existing size, ownership, idempotency, and completed-blob checks remain enforced.

### Browser Verification

Use Playwright with an iPhone-sized viewport to verify:

- Maya never opens automatically.
- The bubble and open tray do not make Back, Next, or Submit unreachable.
- Active voice status remains visible after auto-collapse.
- A failed upload retains its tile and can be retried.
- Location selection places the pin.
- The complete owner listing flow remains usable across all six steps.

## Acceptance Criteria

1. On mobile, the listing wizard loads with only the Maya bubble visible.
2. Maya opens only after an explicit tap.
3. Maya auto-collapses after responding without ending the active session.
4. The active session ends only through user action, existing timeout, auth loss, or unrecoverable error.
5. Form fields and wizard navigation remain operable while Maya exists or is active.
6. JPEG, PNG, HEIC, HEIF, and WebP selections produce uploadable listing photos.
7. Upload progress reflects actual transferred bytes.
8. Failed photos remain selected and provide Retry upload.
9. Owners see actionable errors rather than raw HTTP errors.
10. Selecting a locality suggestion automatically moves the map and drops the pin.
11. Manual locality and pin entry remain available when Places is unavailable.
12. Desktop listing behavior does not regress.

## Out of Scope

- Redesigning Maya's conversation model or backend timeout policy.
- Changing desktop Maya into a bubble.
- Moving all uploads through the API server.
- Replacing Google Maps or Google Places.
- Changing listing database location fields or public location privacy behavior.
