# Maya Voice Map — Slice 1 "The Reflex Map" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an on-device, zero-LLM voice layer on Cribliv's map: hold an orb, speak a rental query, and the camera flies to the locality while matching pins brighten, non-matching pins fade, and a bottom sheet answers truthfully — including a struck chip + demand-capture for anything the map can't filter.

**Architecture:** A **pure intent core** (`parseQuery` + area resolution + pin partition + negotiation arithmetic — all unit-tested in jsdom, no React/network) feeds a **thin UI layer** (voice dock, bottom sheet, cards) that drives the map through a new **imperative camera controller** and the existing reducer. The map instance already exists in `map-view.tsx` local state; we thread it into a context. Non-matching pins fade via a new `highlightedPinIds` reducer channel. Demand capture (the product's core telemetry) writes to a new public `demand_signals` endpoint.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Web Speech API (on-device, free), Google Maps JS SDK (already loaded), NestJS + Postgres (dual-mode) for demand capture, Vitest (web unit + api), existing `MapStateProvider` reducer, `framer-motion` (already in tree, but guarded for the preview freeze).

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-07-18-maya-voice-map-design.md`. **Every task implicitly includes these.**

- **Flag:** `ff_maya_voice_map` (web: `NEXT_PUBLIC_FF_MAYA_VOICE_MAP`) / `FF_MAYA_VOICE_MAP` (api). **Defaults OFF on both sides.** Web gate must default OFF (avoids the render-but-404 owner-page bug).
- **i18n:** every user-facing string goes in `apps/web/lib/i18n.ts` with **both `en` and `hi`** (the `Dictionary` type makes `hi` required). Keep Maya's printed lines short — the map is the response.
- **Truthful count (hard rule):** Maya may print a definite count / "that's everything" **only** when `returnedPinCount < 500` (`isComplete`). Otherwise "at least N". At ~95 city-wide listings `isComplete` is always true today.
- **Honesty prohibitions (hard):** never print "below market" as fact (it is viewport-relative, `useMapPins.ts:78-84`); never print synthetic demand counts (`GET /map/seekers` returns `source:"estimated"`).
- **Slice-1 filter matrix:** server = `bhk`/`max_rent`/`listing_type`/`verified_only`/`near_metro`; client post-filter = `min_rent`/`locality`/`furnishing`; struck + 🔔 = `amenity`. **No API change to the search endpoint.**
- **Audience:** anonymous seeker. On-device speech only — **no new unauthenticated server audio cost**. Phone captured only at 🔔/unlock.
- **Verification reality:** the local Browser preview renders **no map markers**, freezes framer-motion, caps width <900px. Correctness is proven by **jsdom unit tests** and on Vercel — never "I looked at the preview." Keep the intent core pure so it is testable without the Maps SDK.
- **Reducer hazards:** `SET_FILTERS` **replaces** the whole object (merge before dispatch); `SET_PINS` auto-deselects if the selection leaves the set; `city` is camera-derived on every idle (don't fight it); `useMapDispatch` default is a silent no-op (mount **inside** `MapStateProvider`); intent/tool handlers must be **idempotent**.
- **Act-then-undo, not confirm:** the map just moves; every chip is one tap from correction. Apply a `guardMoneyValue`-style 10×/100× rent-mishearing guard before dispatching a rent filter.
- **CSS:** import the `VoiceOrb` token block **directly** (new `orb-tokens.css`), never via the wizard barrel (which drags 1445 lines of `concierge.css`).
- **Commits:** end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. This worktree's pre-commit hook (`lint-staged`) is broken/under-provisioned — if `git commit` fails with `Command "lint-staged" not found`, re-run with `--no-verify` **only for docs/test-only commits**; for code commits, first `pnpm install --frozen-lockfile` at the repo root so the hook runs.
- **Worktree bring-up (do once, before Task 1):** copy `apps/web/.env.local` from the main working tree (missing → NextAuth "Configuration" error) and run `pnpm install --frozen-lockfile` (incomplete `node_modules` → `heic2any` build error), then restart the dev server.

---

## File Structure

**Pure core — no React, no network, unit-tested (`apps/web/lib/`):**
- `map-area-resolver.ts` — `resolveArea(name)` → `{ center, bounds, zoom, method }`.
- `map-post-filter.ts` — `partitionPins(pins, clientFilters)` → `{ matched, faded, isComplete }`; truthful count helpers.
- `map-intent.ts` — `buildMapIntent(input)` → `MapIntent` (ties parse + resolve + partition + filter split). **The shared type home.**
- `map-negotiation.ts` — `computeNegotiationDoors(...)` → `Door[]` (arithmetic relaxation).
- `map-voice-analytics.ts` — thin typed `trackEvent` wrappers.

**Camera + pin channels (`apps/web/components/criblmap/`):**
- `MapCameraController.tsx` — context + `useMapCamera()` executing `CameraIntent` on the real `google.maps.Map`.
- `hooks/useMapState.tsx` (**modify**) — add `highlightedPinIds` state + `SET_HIGHLIGHT`/`CLEAR_HIGHLIGHT`.
- `ListingPinLayer.tsx` (**modify**) — fade pins not in `highlightedPinIds`; coral for focused.

**Voice UI (`apps/web/components/criblmap/voice/`):**
- `useHoldToTalk.ts` — Web Speech hold-to-talk hook + support/permission probe.
- `orb-tokens.css` — relocated `--cz-orb-*` block.
- `MapVoiceDock.tsx` — orb + live caption + chips + text fallback; the orchestrator.
- `IntentChips.tsx` — applied / struck+🔔 chip row.
- `MapResultsSheet.tsx` — 3-snap bottom sheet; Maya line = handle.
- `ListingReasonCard.tsx` — quoted-reason ledger + volunteered flaw.
- `NegotiationDoors.tsx` — relaxation doors + 🔔 door.
- `DemandCaptureSheet.tsx` — bell → phone → POST demand signal.

**Demand capture backend:**
- `infra/migrations/00NN_demand_signals.sql` (**new**, next free number).
- `apps/api/src/modules/demand-signals/` (**new** module: controller, service, dto) — public `POST /v1/demand-signals`.
- `packages/shared-types/src/demand-signal.ts` (**new**) — the DTO contract.

**Config:**
- `apps/web/lib/feature-flags.ts` + `apps/api/src/config/feature-flags.ts` (**modify**) — register the flag.
- `apps/web/lib/i18n.ts` (**modify**) — strings.
- `apps/web/app/[locale]/map/map-view.tsx` (**modify**) — provide camera controller + mount dock/sheet behind the flag.

---

## Phase A — The pure intent core (no UI, fully unit-tested)

### Task 1: Shared types + `partitionPins` (pin partition & truthful count)

**Files:**
- Create: `apps/web/lib/map-intent-types.ts`
- Create: `apps/web/lib/map-post-filter.ts`
- Test: `apps/web/lib/__tests__/map-post-filter.test.ts`

**Interfaces:**
- Consumes: `MapPin` from `apps/web/components/criblmap/hooks/useMapState` (fields: `id, lat, lng, monthly_rent, bhk, furnishing, verification_status, locality, locality_slug`).
- Produces:
  - `ClientFilter = { kind: "min_rent"; value: number } | { kind: "furnishing"; value: string } | { kind: "locality"; value: string }`
  - `partitionPins(pins: MapPin[], filters: ClientFilter[], cap?: number): PartitionResult`
  - `PartitionResult = { matched: MapPin[]; faded: MapPin[]; matchedIds: string[]; count: number; isComplete: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/map-post-filter.test.ts
import { describe, it, expect } from "vitest";
import { partitionPins } from "../map-post-filter";
import type { MapPin } from "../../components/criblmap/hooks/useMapState";

const pin = (over: Partial<MapPin>): MapPin => ({
  id: "x", lat: 26.8, lng: 81.0, title: "t", monthly_rent: 15000,
  listing_type: "flat_house", bhk: 2, verification_status: "verified",
  furnishing: "semi_furnished", cover_photo: null, city: "lucknow",
  locality: "Gomti Nagar", locality_slug: "gomti-nagar", ...over,
});

describe("partitionPins", () => {
  it("min_rent keeps pins at or above the floor", () => {
    const pins = [pin({ id: "a", monthly_rent: 9000 }), pin({ id: "b", monthly_rent: 16000 })];
    const r = partitionPins(pins, [{ kind: "min_rent", value: 12000 }]);
    expect(r.matchedIds).toEqual(["b"]);
    expect(r.faded.map((p) => p.id)).toEqual(["a"]);
    expect(r.count).toBe(1);
  });

  it("furnishing matches on the enum value", () => {
    const pins = [pin({ id: "a", furnishing: "unfurnished" }), pin({ id: "b", furnishing: "fully_furnished" })];
    const r = partitionPins(pins, [{ kind: "furnishing", value: "fully_furnished" }]);
    expect(r.matchedIds).toEqual(["b"]);
  });

  it("locality matches by slug case-insensitively", () => {
    const pins = [pin({ id: "a", locality_slug: "indira-nagar" }), pin({ id: "b", locality_slug: "gomti-nagar" })];
    const r = partitionPins(pins, [{ kind: "locality", value: "Gomti-Nagar" }]);
    expect(r.matchedIds).toEqual(["b"]);
  });

  it("no filters → all matched, none faded", () => {
    const pins = [pin({ id: "a" }), pin({ id: "b" })];
    const r = partitionPins(pins, []);
    expect(r.matched).toHaveLength(2);
    expect(r.faded).toHaveLength(0);
  });

  it("isComplete is false only at the 500 cap", () => {
    const many = Array.from({ length: 500 }, (_, i) => pin({ id: String(i) }));
    expect(partitionPins(many, []).isComplete).toBe(false);
    expect(partitionPins(many.slice(0, 95), []).isComplete).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/map-post-filter.test.ts`
Expected: FAIL — `Cannot find module '../map-post-filter'`.

- [ ] **Step 3: Write the types file**

```ts
// apps/web/lib/map-intent-types.ts
// Shared contract for the voice-map intent core. No React, no network.
import type { ChipKind } from "./smart-parser";

export type ClientFilter =
  | { kind: "min_rent"; value: number }
  | { kind: "furnishing"; value: string }
  | { kind: "locality"; value: string };

export interface IntentChip {
  kind: ChipKind;
  label: string;              // display text, e.g. "2 BHK", "‹ ₹20k"
  quotedSource?: string;      // the exact words the user said (for the reason ledger)
  status: "applied" | "unsupported";
  reason?: string;            // only when unsupported, e.g. "can't filter parking yet"
}

export type CameraIntent =
  | { kind: "bounds"; sw: { lat: number; lng: number }; ne: { lat: number; lng: number }; zoom: number }
  | { kind: "center"; center: { lat: number; lng: number }; zoom: number };
```

- [ ] **Step 4: Write the minimal `partitionPins`**

```ts
// apps/web/lib/map-post-filter.ts
import type { MapPin } from "../components/criblmap/hooks/useMapState";
import type { ClientFilter } from "./map-intent-types";

export const PIN_CAP = 500;

export interface PartitionResult {
  matched: MapPin[];
  faded: MapPin[];
  matchedIds: string[];
  count: number;
  isComplete: boolean;
}

function pinPasses(pin: MapPin, filter: ClientFilter): boolean {
  switch (filter.kind) {
    case "min_rent":
      return pin.monthly_rent >= filter.value;
    case "furnishing":
      return (pin.furnishing ?? "") === filter.value;
    case "locality": {
      const want = filter.value.toLowerCase();
      return (
        (pin.locality_slug ?? "").toLowerCase() === want ||
        (pin.locality ?? "").toLowerCase() === want
      );
    }
  }
}

export function partitionPins(
  pins: MapPin[],
  filters: ClientFilter[],
  cap: number = PIN_CAP
): PartitionResult {
  const matched: MapPin[] = [];
  const faded: MapPin[] = [];
  for (const pin of pins) {
    if (filters.every((f) => pinPasses(pin, f))) matched.push(pin);
    else faded.push(pin);
  }
  return {
    matched,
    faded,
    matchedIds: matched.map((p) => p.id),
    count: matched.length,
    isComplete: pins.length < cap,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/map-post-filter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/map-intent-types.ts apps/web/lib/map-post-filter.ts apps/web/lib/__tests__/map-post-filter.test.ts
git commit -m "feat(voice-map): pin partition + truthful-count core

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `resolveArea` — spoken place name → camera target

**Files:**
- Create: `apps/web/lib/map-area-resolver.ts`
- Test: `apps/web/lib/__tests__/map-area-resolver.test.ts`

**Interfaces:**
- Consumes: `searchMapIndex(query, limit): MapSearchHit[]` from `./map-search-index` (`MapSearchHit = { id, label, lat, lng, kind: "city"|"locality" }`); `CITY_BBOXES`, `cityCentroid` from `./city-bboxes`; `boundsFromCenterZoom` from `./geo`.
- Produces:
  - `resolveArea(name: string): AreaResolution | null`
  - `AreaResolution = { center: { lat; lng }; zoom: number; hit: MapSearchHit; method: "city-bbox" | "locality-radius" }`
  - `RADIUS_ZOOM = { city: 11, locality: 14 }` (exported for reuse/tests)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/map-area-resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveArea, RADIUS_ZOOM } from "../map-area-resolver";

describe("resolveArea", () => {
  it("resolves a known locality to a centroid at locality zoom", () => {
    const r = resolveArea("Gomti Nagar");
    expect(r).not.toBeNull();
    expect(r!.center.lat).toBeGreaterThan(26); // Lucknow latitude band
    expect(r!.center.lng).toBeGreaterThan(80);
    expect(r!.zoom).toBe(RADIUS_ZOOM.locality);
    expect(r!.method).toBe("locality-radius");
  });

  it("resolves a city to a wider zoom", () => {
    const r = resolveArea("Lucknow");
    expect(r).not.toBeNull();
    expect(r!.zoom).toBe(RADIUS_ZOOM.city);
    expect(r!.method).toBe("city-bbox");
  });

  it("tolerates compaction ('Gomtinagar')", () => {
    expect(resolveArea("Gomtinagar")).not.toBeNull();
  });

  it("returns null for gibberish", () => {
    expect(resolveArea("zzxqwv")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/map-area-resolver.test.ts`
Expected: FAIL — `Cannot find module '../map-area-resolver'`.

- [ ] **Step 3: Write the resolver**

```ts
// apps/web/lib/map-area-resolver.ts
// Spoken place name -> camera target. No polygons exist in the data model,
// so a locality is a centroid + a synthesized zoom (radius proxy).
import { searchMapIndex, type MapSearchHit } from "./map-search-index";

export const RADIUS_ZOOM = { city: 11, locality: 14 } as const;

export interface AreaResolution {
  center: { lat: number; lng: number };
  zoom: number;
  hit: MapSearchHit;
  method: "city-bbox" | "locality-radius";
}

export function resolveArea(name: string): AreaResolution | null {
  const hits = searchMapIndex(name, 1);
  const hit = hits[0];
  if (!hit) return null;
  const isCity = hit.kind === "city";
  return {
    center: { lat: hit.lat, lng: hit.lng },
    zoom: isCity ? RADIUS_ZOOM.city : RADIUS_ZOOM.locality,
    hit,
    method: isCity ? "city-bbox" : "locality-radius",
  };
}
```

> **Data-hygiene note for the implementer:** the spec (§12) flags two "Gomti Nagar" centroids 6.5 km apart (`migration 0012` vs `localities.json`) and missing localities (Hazratganj). `searchMapIndex` reads the client seed index. If `resolveArea("Hazratganj")` returns `null` or the wrong point during manual Vercel testing, that is the known coverage hole — file a follow-up to extend the client index from `GET /listings/search/dictionary`; **do not** patch it inline in this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/map-area-resolver.test.ts`
Expected: PASS. If the "Gomti Nagar" assertion fails because the seed index lacks it, that confirms the coverage hole — adjust the test to a locality present in `map-search-index` seed data and file the follow-up.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/map-area-resolver.ts apps/web/lib/__tests__/map-area-resolver.test.ts
git commit -m "feat(voice-map): resolve spoken place names to camera targets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `buildMapIntent` — the parse→resolve→partition orchestrator

**Files:**
- Create: `apps/web/lib/map-intent.ts`
- Test: `apps/web/lib/__tests__/map-intent.test.ts`

**Interfaces:**
- Consumes: `parseQuery(text, cityList?, localityList?): ParseResult` and `ParsedChip { kind, value, label, sourceRange? }` from `./smart-parser`; `resolveArea` (Task 2); types from `./map-intent-types` (Task 1); `MapFilters` from the reducer.
- Produces:
  - `buildMapIntent(input: MapIntentInput): MapIntent`
  - `MapIntentInput = { transcript: string; cityList?: string[]; localityList?: string[] }`
  - `MapIntent = { chips: IntentChip[]; camera: CameraIntent | null; serverFilters: MapFilters; clientFilters: ClientFilter[] }`
  - `guardRent(value: number, transcript: string): number` (exported; reverts exact 10×/100× ASR errors)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/map-intent.test.ts
import { describe, it, expect } from "vitest";
import { buildMapIntent, guardRent } from "../map-intent";

describe("buildMapIntent", () => {
  it("splits a full query into camera + server + client filters + chips", () => {
    const r = buildMapIntent({ transcript: "2bhk in gomti nagar under 20k with parking" });
    expect(r.serverFilters.bhk).toBe(2);
    expect(r.serverFilters.max_rent).toBe(20000);
    expect(r.clientFilters).toContainEqual({ kind: "locality", value: expect.any(String) });
    expect(r.camera).not.toBeNull();
    const parking = r.chips.find((c) => c.kind === "amenity");
    expect(parking?.status).toBe("unsupported");
    expect(parking?.reason).toMatch(/can't filter/i);
  });

  it("attaches quotedSource from the transcript for the reason ledger", () => {
    const r = buildMapIntent({ transcript: "2 bhk under 20k" });
    const bhk = r.chips.find((c) => c.kind === "bhk");
    expect(bhk?.quotedSource?.toLowerCase()).toContain("bhk");
  });

  it("no locality → camera is null", () => {
    const r = buildMapIntent({ transcript: "3bhk under 30k" });
    expect(r.camera).toBeNull();
  });
});

describe("guardRent", () => {
  it("reverts a 10x mishearing when the transcript says the smaller number", () => {
    expect(guardRent(200000, "under 20k")).toBe(20000);
  });
  it("leaves a consistent value alone", () => {
    expect(guardRent(20000, "under 20k")).toBe(20000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/map-intent.test.ts`
Expected: FAIL — `Cannot find module '../map-intent'`.

- [ ] **Step 3: Write `buildMapIntent`**

```ts
// apps/web/lib/map-intent.ts
import { parseQuery, type ParsedChip } from "./smart-parser";
import { resolveArea } from "./map-area-resolver";
import type { MapFilters } from "../components/criblmap/hooks/useMapState";
import type { CameraIntent, ClientFilter, IntentChip } from "./map-intent-types";

export interface MapIntentInput {
  transcript: string;
  cityList?: string[];
  localityList?: string[];
}

export interface MapIntent {
  chips: IntentChip[];
  camera: CameraIntent | null;
  serverFilters: MapFilters;
  clientFilters: ClientFilter[];
}

// Revert exact 10x / 100x ASR errors: if the model heard 200000 but the raw
// transcript's digits imply 20000, trust the transcript. Mirrors the wizard's
// guardMoneyValue (listing-tool-handlers.ts).
export function guardRent(value: number, transcript: string): number {
  const spoken = transcript.match(/(\d[\d,]*)\s*(k|hazaar|hazar|thousand)?/i);
  if (!spoken) return value;
  for (const factor of [10, 100]) {
    if (value === Math.round(value)) {
      const reduced = value / factor;
      const digits = String(Math.round(reduced));
      if (transcript.replace(/[,\s]/g, "").includes(digits) && reduced >= 1000) {
        return reduced;
      }
    }
  }
  return value;
}

function sliceQuoted(transcript: string, chip: ParsedChip): string | undefined {
  if (!chip.sourceRange) return undefined;
  return transcript.slice(chip.sourceRange.start, chip.sourceRange.end).trim() || undefined;
}

export function buildMapIntent(input: MapIntentInput): MapIntent {
  const { transcript, cityList = [], localityList = [] } = input;
  const parsed = parseQuery(transcript, cityList, localityList);

  const chips: IntentChip[] = [];
  const serverFilters: MapFilters = {};
  const clientFilters: ClientFilter[] = [];
  let camera: CameraIntent | null = null;

  for (const chip of parsed.chips) {
    const quotedSource = sliceQuoted(transcript, chip);
    switch (chip.kind) {
      case "bhk":
        serverFilters.bhk = chip.value as number;
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "max_rent":
        serverFilters.max_rent = guardRent(chip.value as number, transcript);
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "listing_type":
        serverFilters.listing_type = chip.value as "flat_house" | "pg";
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "min_rent":
        clientFilters.push({ kind: "min_rent", value: chip.value as number });
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "furnishing":
        clientFilters.push({ kind: "furnishing", value: String(chip.value) });
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "locality": {
        const area = resolveArea(String(chip.value));
        if (area) {
          clientFilters.push({ kind: "locality", value: String(chip.value) });
          camera = { kind: "center", center: area.center, zoom: area.zoom };
          chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        } else {
          chips.push({
            kind: chip.kind, label: chip.label, quotedSource,
            status: "unsupported", reason: "couldn't place this area yet",
          });
        }
        break;
      }
      case "city": {
        const area = resolveArea(String(chip.value));
        if (area) camera = { kind: "center", center: area.center, zoom: area.zoom };
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      }
      case "amenity":
        chips.push({
          kind: chip.kind, label: chip.label, quotedSource,
          status: "unsupported", reason: `can't filter ${chip.label.toLowerCase()} yet`,
        });
        break;
    }
  }

  return { chips, camera, serverFilters, clientFilters };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/map-intent.test.ts`
Expected: PASS. (If the "gomti nagar" locality fails to resolve on seed data, swap to a seed-present locality as in Task 2 and keep the assertion.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/map-intent.ts apps/web/lib/__tests__/map-intent.test.ts
git commit -m "feat(voice-map): buildMapIntent parse->resolve->filter split with rent guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `computeNegotiationDoors` — the zero-result main screen (pure arithmetic)

**Files:**
- Create: `apps/web/lib/map-negotiation.ts`
- Test: `apps/web/lib/__tests__/map-negotiation.test.ts`

**Interfaces:**
- Consumes: `MapPin`; `MapFilters`; `ClientFilter`; `partitionPins` (Task 1).
- Produces:
  - `computeNegotiationDoors(args: NegotiationArgs): Door[]`
  - `NegotiationArgs = { pins: MapPin[]; serverFilters: MapFilters; clientFilters: ClientFilter[] }`  — `pins` is the **already server-filtered viewport set**; relaxation re-partitions in memory.
  - `Door = { id: "stretch_budget" | "loosen_furnishing" | "allow_unverified" | "subscribe"; label: string; gain: number; relaxed?: { serverFilters: MapFilters; clientFilters: ClientFilter[] } }`
  - A `subscribe` door is **always** returned last (gain = 0). Non-subscribe doors are returned **only when `gain > 0`**.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/map-negotiation.test.ts
import { describe, it, expect } from "vitest";
import { computeNegotiationDoors } from "../map-negotiation";
import type { MapPin } from "../../components/criblmap/hooks/useMapState";

const pin = (over: Partial<MapPin>): MapPin => ({
  id: "x", lat: 26.8, lng: 81.0, title: "t", monthly_rent: 22000,
  listing_type: "flat_house", bhk: 2, verification_status: "verified",
  furnishing: "unfurnished", cover_photo: null, city: "lucknow",
  locality: "Gomti Nagar", locality_slug: "gomti-nagar", ...over,
});

describe("computeNegotiationDoors", () => {
  it("offers a budget stretch that yields the pins just above the cap", () => {
    // user wanted <= 20k, nothing qualifies; two pins sit at 21-22k
    const pins = [pin({ id: "a", monthly_rent: 21000 }), pin({ id: "b", monthly_rent: 22000 })];
    const doors = computeNegotiationDoors({
      pins, serverFilters: { bhk: 2, max_rent: 20000 }, clientFilters: [],
    });
    const stretch = doors.find((d) => d.id === "stretch_budget");
    expect(stretch?.gain).toBe(2);
    expect(stretch?.label).toMatch(/22/); // 20k * 1.1 = 22k
  });

  it("always ends with a subscribe door", () => {
    const doors = computeNegotiationDoors({ pins: [], serverFilters: { max_rent: 20000 }, clientFilters: [] });
    expect(doors[doors.length - 1].id).toBe("subscribe");
  });

  it("omits doors that yield zero new homes", () => {
    const doors = computeNegotiationDoors({ pins: [], serverFilters: { max_rent: 20000 }, clientFilters: [] });
    expect(doors.filter((d) => d.id !== "subscribe")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/map-negotiation.test.ts`
Expected: FAIL — `Cannot find module '../map-negotiation'`.

- [ ] **Step 3: Write `computeNegotiationDoors`**

```ts
// apps/web/lib/map-negotiation.ts
import type { MapPin } from "../components/criblmap/hooks/useMapState";
import type { MapFilters } from "../components/criblmap/hooks/useMapState";
import type { ClientFilter } from "./map-intent-types";
import { partitionPins } from "./map-post-filter";

export interface NegotiationArgs {
  pins: MapPin[]; // server-filtered viewport pins BEFORE client post-filter
  serverFilters: MapFilters;
  clientFilters: ClientFilter[];
}

export type DoorId = "stretch_budget" | "loosen_furnishing" | "allow_unverified" | "subscribe";

export interface Door {
  id: DoorId;
  label: string;
  gain: number;
  relaxed?: { serverFilters: MapFilters; clientFilters: ClientFilter[] };
}

const rupees = (n: number) => `₹${Math.round(n / 1000)}k`;

// baseline matched count under the current constraints
function matchedCount(args: NegotiationArgs): number {
  return partitionPins(applyMaxRent(args.pins, args.serverFilters.max_rent), args.clientFilters).count;
}
function applyMaxRent(pins: MapPin[], maxRent?: number): MapPin[] {
  return maxRent ? pins.filter((p) => p.monthly_rent <= maxRent) : pins;
}

export function computeNegotiationDoors(args: NegotiationArgs): Door[] {
  const base = matchedCount(args);
  const doors: Door[] = [];

  // 1. Stretch budget by 10%
  if (args.serverFilters.max_rent) {
    const stretched = Math.round(args.serverFilters.max_rent * 1.1);
    const gain =
      partitionPins(applyMaxRent(args.pins, stretched), args.clientFilters).count - base;
    if (gain > 0) {
      doors.push({
        id: "stretch_budget",
        label: `Stretch to ${rupees(stretched)}`,
        gain,
        relaxed: { serverFilters: { ...args.serverFilters, max_rent: stretched }, clientFilters: args.clientFilters },
      });
    }
  }

  // 2. Loosen furnishing (drop the furnishing client filter)
  if (args.clientFilters.some((f) => f.kind === "furnishing")) {
    const relaxedClient = args.clientFilters.filter((f) => f.kind !== "furnishing");
    const gain = partitionPins(applyMaxRent(args.pins, args.serverFilters.max_rent), relaxedClient).count - base;
    if (gain > 0) {
      doors.push({
        id: "loosen_furnishing",
        label: "Any furnishing",
        gain,
        relaxed: { serverFilters: args.serverFilters, clientFilters: relaxedClient },
      });
    }
  }

  // 3. Allow unverified (only meaningful if verified_only was on)
  if (args.serverFilters.verified_only) {
    // gain here requires a fresh server fetch; we surface the door and let the UI refetch.
    doors.push({
      id: "allow_unverified",
      label: "Include unverified",
      gain: 1, // sentinel: "some" — UI refetches to get the real number
      relaxed: { serverFilters: { ...args.serverFilters, verified_only: false }, clientFilters: args.clientFilters },
    });
  }

  // 4. Subscribe — always last, always present
  doors.push({ id: "subscribe", label: "Text me when one lists", gain: 0 });
  return doors;
}
```

> **Note on door 3:** `verified_only` and area-widening need a fresh server round-trip to count exactly; Slice 1 surfaces the door with a sentinel and lets the dock refetch on tap rather than faking a number. "Add adjacent locality" is intentionally **deferred** — it needs adjacency data the client index doesn't cleanly expose; do not fabricate it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/map-negotiation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/map-negotiation.ts apps/web/lib/__tests__/map-negotiation.test.ts
git commit -m "feat(voice-map): negotiation doors by constraint relaxation (arithmetic)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase B — Pin fade + highlight channel

### Task 5: Reducer `highlightedPinIds` + `SET_HIGHLIGHT` / `CLEAR_HIGHLIGHT`

**Files:**
- Modify: `apps/web/components/criblmap/hooks/useMapState.tsx` (state shape ~L126, action union ~L181, reducer ~L250, initial ~L225)
- Test: `apps/web/components/criblmap/hooks/__tests__/useMapState.highlight.test.tsx`

**Interfaces:**
- Produces: `MapState.highlightedPinIds: string[] | null`; actions `{ type: "SET_HIGHLIGHT"; pinIds: string[] }` and `{ type: "CLEAR_HIGHLIGHT" }`.
- Constraint: `SET_PINS` must **not** clobber `highlightedPinIds` (it survives a refetch); `CLEAR_HIGHLIGHT` sets it to `null` (meaning "no fade — show all normally").

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/criblmap/hooks/__tests__/useMapState.highlight.test.tsx
import { describe, it, expect } from "vitest";
import { mapReducer, initialMapState } from "../useMapState";

describe("highlight channel", () => {
  it("SET_HIGHLIGHT stores the ids", () => {
    const s = mapReducer(initialMapState, { type: "SET_HIGHLIGHT", pinIds: ["a", "b"] });
    expect(s.highlightedPinIds).toEqual(["a", "b"]);
  });
  it("CLEAR_HIGHLIGHT resets to null", () => {
    const s1 = mapReducer(initialMapState, { type: "SET_HIGHLIGHT", pinIds: ["a"] });
    const s2 = mapReducer(s1, { type: "CLEAR_HIGHLIGHT" });
    expect(s2.highlightedPinIds).toBeNull();
  });
  it("SET_PINS preserves the highlight", () => {
    const s1 = mapReducer(initialMapState, { type: "SET_HIGHLIGHT", pinIds: ["a"] });
    const s2 = mapReducer(s1, { type: "SET_PINS", pins: [] });
    expect(s2.highlightedPinIds).toEqual(["a"]);
  });
});
```

> **Note:** this test imports `mapReducer` and `initialMapState`. If they are not currently exported from `useMapState.tsx`, add `export` to their declarations as part of Step 3 (they are referenced by existing tests like `criblmap-regressions.test.tsx`, so an export likely already exists — verify first).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/hooks/__tests__/useMapState.highlight.test.tsx`
Expected: FAIL — `highlightedPinIds` undefined / action not handled.

- [ ] **Step 3: Add state, actions, and reducer cases**

In `apps/web/components/criblmap/hooks/useMapState.tsx`:

Add to `interface MapState` (near `selectedPinId: string | null;`):
```ts
  highlightedPinIds: string[] | null;
```
Add to `initialMapState` (near `selectedPinId: null,`):
```ts
  highlightedPinIds: null,
```
Add to the `MapAction` union:
```ts
  | { type: "SET_HIGHLIGHT"; pinIds: string[] }
  | { type: "CLEAR_HIGHLIGHT" }
```
Add reducer cases (alongside `SELECT_PIN`):
```ts
    case "SET_HIGHLIGHT":
      return { ...state, highlightedPinIds: action.pinIds };
    case "CLEAR_HIGHLIGHT":
      return { ...state, highlightedPinIds: null };
```
Confirm the `SET_PINS` case spreads `...state` (it does at L253-268), so `highlightedPinIds` is preserved automatically — do **not** add it to the deselect logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/hooks/__tests__/useMapState.highlight.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing map reducer tests (no regressions)**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap`
Expected: existing `criblmap-regressions` / `seeker-draft` suites still PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/criblmap/hooks/useMapState.tsx apps/web/components/criblmap/hooks/__tests__/useMapState.highlight.test.tsx
git commit -m "feat(voice-map): add highlightedPinIds reducer channel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `ListingPinLayer` — fade non-matching pins (don't vanish)

**Files:**
- Modify: `apps/web/components/criblmap/ListingPinLayer.tsx`
- Test: manual (Vercel) + the reducer test above. *(This layer renders no markers in the local preview and touches the Maps SDK, so it is not unit-tested; keep the logic trivial and data-driven.)*

**Interfaces:**
- Consumes: `highlightedPinIds` from `useMapState()`.
- Behavior: when `highlightedPinIds === null`, render every pin at full opacity (today's behavior). When it is an array, pins whose `id` is in the set render normal/coral; pins **not** in the set render at ~0.4 opacity but **remain in the DOM**.

- [ ] **Step 1: Read the current marker styling effect**

Run: `sed -n '1,60p' apps/web/components/criblmap/ListingPinLayer.tsx` and locate where each pin's element/opacity/class is set (the effect that builds markers from `pins`).

- [ ] **Step 2: Thread `highlightedPinIds` into the marker builder**

Add to the destructure from `useMapState()`:
```ts
const { pins, selectedPinId, highlightedPinIds } = useMapState();
```
Where each marker's DOM element is created/updated, compute and apply the faded state:
```ts
const isFaded = highlightedPinIds !== null && !highlightedPinIds.includes(pin.id);
// on the marker's root element:
el.style.opacity = isFaded ? "0.4" : "1";
el.style.transition = "opacity 200ms ease";
el.classList.toggle("cmap-pin--faded", isFaded);
el.style.zIndex = isFaded ? "1" : el.style.zIndex || "3";
```
Add `highlightedPinIds` to that effect's dependency array so re-highlighting re-styles markers **without** a full teardown when possible (if the effect currently rebuilds all markers on any dep change, that is acceptable for Slice 1 — note it for a later perf pass).

- [ ] **Step 3: Respect reduced motion**

Guard the transition:
```ts
const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
el.style.transition = reduce ? "none" : "opacity 200ms ease";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @cribliv/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/criblmap/ListingPinLayer.tsx
git commit -m "feat(voice-map): fade non-matching pins instead of hiding them

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase C — Camera controller + voice input

### Task 7: `MapCameraController` — imperative camera context

**Files:**
- Create: `apps/web/components/criblmap/MapCameraController.tsx`
- Test: `apps/web/components/criblmap/__tests__/MapCameraController.test.tsx`

**Interfaces:**
- Produces:
  - `<MapCameraProvider map={google.maps.Map | null}>` context provider.
  - `useMapCamera(): { flyTo(intent: CameraIntent): void }`
  - `applyCameraIntent(map, intent, reduceMotion): void` (exported pure-ish helper for testing against a mock map).
- Consumes: `CameraIntent` from `lib/map-intent-types`.

- [ ] **Step 1: Write the failing test (mock map)**

```tsx
// apps/web/components/criblmap/__tests__/MapCameraController.test.tsx
import { describe, it, expect, vi } from "vitest";
import { applyCameraIntent } from "../MapCameraController";

function mockMap() {
  return { panTo: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() } as unknown as google.maps.Map & {
    panTo: ReturnType<typeof vi.fn>; setZoom: ReturnType<typeof vi.fn>; fitBounds: ReturnType<typeof vi.fn>;
  };
}

describe("applyCameraIntent", () => {
  it("center intent pans and zooms", () => {
    const m = mockMap();
    applyCameraIntent(m, { kind: "center", center: { lat: 26.8, lng: 81 }, zoom: 14 }, false);
    expect(m.panTo).toHaveBeenCalledWith({ lat: 26.8, lng: 81 });
    expect(m.setZoom).toHaveBeenCalledWith(14);
  });
  it("bounds intent fits", () => {
    const m = mockMap();
    applyCameraIntent(m, { kind: "bounds", sw: { lat: 26, lng: 80 }, ne: { lat: 27, lng: 81 }, zoom: 13 }, false);
    expect(m.fitBounds).toHaveBeenCalled();
  });
  it("null map is a no-op (no throw)", () => {
    expect(() => applyCameraIntent(null, { kind: "center", center: { lat: 0, lng: 0 }, zoom: 10 }, false)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/__tests__/MapCameraController.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the controller**

```tsx
// apps/web/components/criblmap/MapCameraController.tsx
"use client";
import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import type { CameraIntent } from "../../lib/map-intent-types";

export function applyCameraIntent(
  map: google.maps.Map | null,
  intent: CameraIntent,
  reduceMotion: boolean
): void {
  if (!map) return;
  if (intent.kind === "center") {
    map.panTo(intent.center);
    map.setZoom(intent.zoom);
    return;
  }
  const bounds = new google.maps.LatLngBounds(
    new google.maps.LatLng(intent.sw.lat, intent.sw.lng),
    new google.maps.LatLng(intent.ne.lat, intent.ne.lng)
  );
  map.fitBounds(bounds);
  void reduceMotion; // panTo/fitBounds are instant enough; hook left for future easing
}

interface CameraApi { flyTo: (intent: CameraIntent) => void }
const CameraContext = createContext<CameraApi>({ flyTo: () => {} });

export function MapCameraProvider({ map, children }: { map: google.maps.Map | null; children: ReactNode }) {
  const flyTo = useCallback(
    (intent: CameraIntent) => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      applyCameraIntent(map, intent, reduce);
    },
    [map]
  );
  const value = useMemo(() => ({ flyTo }), [flyTo]);
  return <CameraContext.Provider value={value}>{children}</CameraContext.Provider>;
}

export function useMapCamera(): CameraApi {
  return useContext(CameraContext);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/__tests__/MapCameraController.test.tsx`
Expected: PASS (3 tests). *(Uses `google.maps` only inside the `bounds` branch; the mock never enters it for center/null. For the bounds test, stub `global.google` — add at the top of the test: `vi.stubGlobal("google", { maps: { LatLngBounds: class {}, LatLng: class {} } });`.)*

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/criblmap/MapCameraController.tsx apps/web/components/criblmap/__tests__/MapCameraController.test.tsx
git commit -m "feat(voice-map): imperative camera controller context

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `useHoldToTalk` — Web Speech hold-to-talk hook

**Files:**
- Create: `apps/web/components/criblmap/voice/useHoldToTalk.ts`
- Test: `apps/web/components/criblmap/voice/__tests__/useHoldToTalk.test.tsx`

**Interfaces:**
- Produces:
  - `useHoldToTalk(opts: { lang: string; onInterim(t: string): void; onFinal(t: string): void }): HoldToTalkApi`
  - `HoldToTalkApi = { supported: boolean; state: "idle"|"listening"|"denied"|"error"; start(): void; stop(): void }`
  - Adapt the `SpeechRecognitionLike` typing already in `apps/web/components/voice-search-button.tsx` (copy the interface block; do not import from the button).

- [ ] **Step 1: Write the failing test (support probe)**

```tsx
// apps/web/components/criblmap/voice/__tests__/useHoldToTalk.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHoldToTalk } from "../useHoldToTalk";

describe("useHoldToTalk", () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it("reports unsupported when SpeechRecognition is absent", () => {
    vi.stubGlobal("window", { ...window });
    const { result } = renderHook(() =>
      useHoldToTalk({ lang: "en-IN", onInterim: () => {}, onFinal: () => {} })
    );
    expect(result.current.supported).toBe(false);
  });

  it("start() flips state to listening when supported", () => {
    class FakeRec {
      lang = ""; continuous = false; interimResults = false; maxAlternatives = 1;
      onstart: null | (() => void) = null; onend: null | (() => void) = null;
      onerror: null | ((e: unknown) => void) = null; onresult: null | ((e: unknown) => void) = null;
      start() { this.onstart?.(); } stop() { this.onend?.(); } abort() {}
    }
    vi.stubGlobal("window", { ...window, SpeechRecognition: FakeRec });
    const { result } = renderHook(() =>
      useHoldToTalk({ lang: "en-IN", onInterim: () => {}, onFinal: () => {} })
    );
    expect(result.current.supported).toBe(true);
    act(() => result.current.start());
    expect(result.current.state).toBe("listening");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/useHoldToTalk.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
// apps/web/components/criblmap/voice/useHoldToTalk.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionLike extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start: () => void; stop: () => void; abort: () => void;
  onstart: ((ev: Event) => unknown) | null;
  onend: ((ev: Event) => unknown) | null;
  onerror: ((ev: { error: string }) => unknown) | null;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => unknown) | null;
}
type Ctor = new () => SpeechRecognitionLike;

function getCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type HoldToTalkState = "idle" | "listening" | "denied" | "error";
export interface HoldToTalkApi {
  supported: boolean;
  state: HoldToTalkState;
  start: () => void;
  stop: () => void;
}

export function useHoldToTalk(opts: {
  lang: string;
  onInterim: (t: string) => void;
  onFinal: (t: string) => void;
}): HoldToTalkApi {
  const [state, setState] = useState<HoldToTalkState>("idle");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const ctor = getCtor();
  const supported = ctor !== null;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const start = useCallback(() => {
    if (!ctor) { setState("error"); return; }
    const rec = new ctor();
    rec.lang = optsRef.current.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => setState("listening");
    rec.onend = () => setState((s) => (s === "listening" ? "idle" : s));
    rec.onerror = (e) => setState(e.error === "not-allowed" ? "denied" : "error");
    rec.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) final += text; else interim += text;
      }
      if (interim) optsRef.current.onInterim(interim);
      if (final) optsRef.current.onFinal(final);
    };
    recRef.current = rec;
    try { rec.start(); } catch { setState("error"); }
  }, [ctor]);

  const stop = useCallback(() => {
    try { recRef.current?.stop(); } catch { /* noop */ }
  }, []);

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* noop */ } }, []);

  return { supported, state, start, stop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/useHoldToTalk.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/criblmap/voice/useHoldToTalk.ts apps/web/components/criblmap/voice/__tests__/useHoldToTalk.test.tsx
git commit -m "feat(voice-map): hold-to-talk Web Speech hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Orb token CSS (relocated, no wizard barrel)

**Files:**
- Create: `apps/web/components/criblmap/voice/orb-tokens.css`
- Reference: copy the `--cz-orb-c1/2/3` block from `apps/web/components/listing-wizard/concierge.css` (search it for `--cz-orb`).

**Interfaces:** none (CSS only). Produces a `.maya-orb-wrap` scope carrying the orb gradient tokens so `VoiceOrb` renders visibly without importing the wizard barrel.

- [ ] **Step 1: Find the orb token block**

Run: `grep -n "\-\-cz-orb" apps/web/components/listing-wizard/concierge.css`
Copy the ~60-line block that declares `--cz-orb-c1`, `--cz-orb-c2`, `--cz-orb-c3` and any keyframes the orb animation uses.

- [ ] **Step 2: Write the scoped copy**

```css
/* apps/web/components/criblmap/voice/orb-tokens.css
   Orb gradient tokens relocated from concierge.css so the map can render
   VoiceOrb without dragging the 1445-line wizard stylesheet. Scope under
   .maya-orb-wrap (mirror whatever selector VoiceOrb's own CSS expects — if
   VoiceOrb reads the vars off its wrapper class, apply that class here). */
.maya-orb-wrap {
  --cz-orb-c1: /* value copied from concierge.css */;
  --cz-orb-c2: /* value copied from concierge.css */;
  --cz-orb-c3: /* value copied from concierge.css */;
}
/* paste any @keyframes the orb depends on here as well */
```

> Replace the `/* value copied ... */` placeholders with the **actual literal values** from `concierge.css`. Verify by importing this file in Task 10 and confirming the orb is not a flat/black circle.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/criblmap/voice/orb-tokens.css
git commit -m "chore(voice-map): relocate orb gradient tokens for map surface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase D — Voice dock, chips, results sheet, cards

### Task 10: `IntentChips` — applied / struck+🔔 chip row

**Files:**
- Create: `apps/web/components/criblmap/voice/IntentChips.tsx`
- Create: `apps/web/components/criblmap/voice/voice-map.css` (chip + dock + sheet styles; brand tokens)
- Test: `apps/web/components/criblmap/voice/__tests__/IntentChips.test.tsx`

**Interfaces:**
- Consumes: `IntentChip` (Task 1).
- Produces: `<IntentChips chips={IntentChip[]} onBell={(chip: IntentChip) => void} />`. Applied chips render solid; `status: "unsupported"` chips render struck-through with a 🔔 button that calls `onBell`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/criblmap/voice/__tests__/IntentChips.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntentChips } from "../IntentChips";

describe("IntentChips", () => {
  it("renders applied and struck chips and fires onBell", () => {
    const onBell = vi.fn();
    render(
      <IntentChips
        chips={[
          { kind: "bhk", label: "2 BHK", status: "applied" },
          { kind: "amenity", label: "parking", status: "unsupported", reason: "can't filter parking yet" },
        ]}
        onBell={onBell}
      />
    );
    expect(screen.getByText("2 BHK")).toBeTruthy();
    const bell = screen.getByRole("button", { name: /parking/i });
    fireEvent.click(bell);
    expect(onBell).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/IntentChips.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component + CSS**

```tsx
// apps/web/components/criblmap/voice/IntentChips.tsx
"use client";
import type { IntentChip } from "../../../lib/map-intent-types";
import "./voice-map.css";

export function IntentChips({
  chips,
  onBell,
}: {
  chips: IntentChip[];
  onBell: (chip: IntentChip) => void;
}) {
  return (
    <div className="mv-chiprow">
      {chips.map((chip, i) =>
        chip.status === "applied" ? (
          <span key={i} className="mv-chip mv-chip--on">{chip.label}</span>
        ) : (
          <button
            key={i}
            type="button"
            className="mv-chip mv-chip--struck"
            aria-label={`${chip.label} — ${chip.reason ?? "not available"}. Notify me.`}
            onClick={() => onBell(chip)}
          >
            <span className="mv-chip__label">{chip.label}</span>
            <span aria-hidden>🔔</span>
          </button>
        )
      )}
    </div>
  );
}
```

```css
/* apps/web/components/criblmap/voice/voice-map.css */
.mv-chiprow { display: flex; flex-wrap: wrap; gap: 6px; }
.mv-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; padding: 5px 10px; border-radius: 999px;
  border: none; cursor: default;
}
.mv-chip--on { background: var(--brand, #0066ff); color: #fff; }
.mv-chip--struck {
  background: #fff; color: #94a3b8; cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--border, #e8ecf1);
}
.mv-chip--struck .mv-chip__label {
  text-decoration: line-through; text-decoration-color: #f87171; text-decoration-thickness: 1.5px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/IntentChips.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/criblmap/voice/IntentChips.tsx apps/web/components/criblmap/voice/voice-map.css apps/web/components/criblmap/voice/__tests__/IntentChips.test.tsx
git commit -m "feat(voice-map): intent chip row with struck + notify state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: `ListingReasonCard` — quoted-reason ledger + volunteered flaw

**Files:**
- Create: `apps/web/components/criblmap/voice/ListingReasonCard.tsx`
- Test: `apps/web/components/criblmap/voice/__tests__/ListingReasonCard.test.tsx`

**Interfaces:**
- Consumes: `MapPin`; `IntentChip[]` (to build the ledger, using `quotedSource`).
- Produces:
  - `buildReasonLedger(pin: MapPin, chips: IntentChip[]): LedgerRow[]` (exported pure fn — the tested surface)
  - `LedgerRow = { ok: boolean; text: string }`
  - `<ListingReasonCard pin={MapPin} chips={IntentChip[]} onUnlock={() => void} />`
- Behavior: each applied chip → a `✓` row quoting `quotedSource`; each **unsupported** chip → a `✕` row ("you asked for X; this one doesn't have it") — the **volunteered flaw**. No "below market", no synthetic demand (Global Constraints).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/criblmap/voice/__tests__/ListingReasonCard.test.tsx
import { describe, it, expect } from "vitest";
import { buildReasonLedger } from "../ListingReasonCard";
import type { MapPin } from "../../hooks/useMapState";

const pin: MapPin = {
  id: "a", lat: 26.8, lng: 81, title: "t", monthly_rent: 17000, listing_type: "flat_house",
  bhk: 2, verification_status: "verified", furnishing: "semi_furnished", cover_photo: null,
  city: "lucknow", locality: "Gomti Nagar", locality_slug: "gomti-nagar",
};

describe("buildReasonLedger", () => {
  it("makes a ✓ row per applied chip and a ✕ row per unsupported chip", () => {
    const rows = buildReasonLedger(pin, [
      { kind: "bhk", label: "2 BHK", status: "applied", quotedSource: "2 bhk" },
      { kind: "amenity", label: "parking", status: "unsupported", reason: "can't filter parking yet" },
    ]);
    expect(rows.find((r) => r.ok && /2 bhk/i.test(r.text))).toBeTruthy();
    const flaw = rows.find((r) => !r.ok);
    expect(flaw?.text).toMatch(/parking/i);
  });

  it("never emits a below-market or demand claim", () => {
    const rows = buildReasonLedger(pin, []);
    expect(rows.some((r) => /below market|people asked/i.test(r.text))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/ListingReasonCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component + pure ledger**

```tsx
// apps/web/components/criblmap/voice/ListingReasonCard.tsx
"use client";
import type { MapPin } from "../../hooks/useMapState";
import type { IntentChip } from "../../../lib/map-intent-types";
import "./voice-map.css";

export interface LedgerRow { ok: boolean; text: string }

export function buildReasonLedger(pin: MapPin, chips: IntentChip[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const chip of chips) {
    const said = chip.quotedSource ? `"${chip.quotedSource}"` : chip.label;
    if (chip.status === "applied") {
      rows.push({ ok: true, text: `${chip.label}, matching ${said}` });
    } else {
      rows.push({ ok: false, text: `No ${chip.label} — you asked for it; this one doesn't have it` });
    }
  }
  return rows;
}

export function ListingReasonCard({
  pin, chips, onUnlock,
}: { pin: MapPin; chips: IntentChip[]; onUnlock: () => void }) {
  const rows = buildReasonLedger(pin, chips);
  return (
    <div className="mv-card">
      <div className="mv-card__head">
        <span className="mv-card__price">₹{pin.monthly_rent.toLocaleString("en-IN")}</span>
        <span className="mv-card__meta">{pin.bhk ? `${pin.bhk} BHK` : ""} · {pin.locality ?? ""}</span>
        {pin.verification_status === "verified" && <span className="mv-card__verified">✓ Verified</span>}
      </div>
      <ul className="mv-ledger">
        {rows.map((r, i) => (
          <li key={i} className={r.ok ? "mv-ledger__ok" : "mv-ledger__no"}>
            <span aria-hidden>{r.ok ? "✓" : "✕"}</span> {r.text}
          </li>
        ))}
      </ul>
      <button type="button" className="mv-card__cta" onClick={onUnlock}>Unlock owner’s number</button>
    </div>
  );
}
```

Append to `voice-map.css`:
```css
.mv-card { background: var(--surface, #fff); border-radius: 14px; box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,.08)); overflow: hidden; padding: 12px; }
.mv-card__head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.mv-card__price { font-size: 19px; font-weight: 800; color: var(--text-primary, #1a1a2e); }
.mv-card__meta { font-size: 12px; color: var(--text-secondary, #64748b); font-weight: 600; }
.mv-card__verified { font-size: 11px; font-weight: 800; color: var(--trust, #0d9f4f); margin-left: auto; }
.mv-ledger { list-style: none; margin: 10px 0 0; padding: 10px 0 0; border-top: 1px solid var(--border, #e8ecf1); font-size: 12px; }
.mv-ledger li { margin-bottom: 4px; line-height: 1.4; }
.mv-ledger__ok { color: #334155; } .mv-ledger__ok span { color: var(--trust, #0d9f4f); }
.mv-ledger__no { color: var(--warning, #e88c00); font-weight: 600; }
.mv-card__cta { display: block; width: 100%; margin-top: 11px; padding: 10px; border: none; border-radius: 9px; background: var(--accent, #ff5a5f); color: #fff; font-weight: 800; font-size: 13px; cursor: pointer; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/ListingReasonCard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/criblmap/voice/ListingReasonCard.tsx apps/web/components/criblmap/voice/voice-map.css apps/web/components/criblmap/voice/__tests__/ListingReasonCard.test.tsx
git commit -m "feat(voice-map): listing card with quoted-reason ledger + volunteered flaw

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: `NegotiationDoors` — relaxation doors + 🔔 door

**Files:**
- Create: `apps/web/components/criblmap/voice/NegotiationDoors.tsx`
- Test: `apps/web/components/criblmap/voice/__tests__/NegotiationDoors.test.tsx`

**Interfaces:**
- Consumes: `Door` (Task 4).
- Produces: `<NegotiationDoors doors={Door[]} onPick={(door: Door) => void} />`. Non-subscribe doors show `label` + `+N homes`; the subscribe door shows the 🔔 styling.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/criblmap/voice/__tests__/NegotiationDoors.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NegotiationDoors } from "../NegotiationDoors";

describe("NegotiationDoors", () => {
  it("renders gains and fires onPick", () => {
    const onPick = vi.fn();
    render(
      <NegotiationDoors
        doors={[
          { id: "stretch_budget", label: "Stretch to ₹22k", gain: 3 },
          { id: "subscribe", label: "Text me when one lists", gain: 0 },
        ]}
        onPick={onPick}
      />
    );
    expect(screen.getByText(/\+3 homes/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Stretch to ₹22k/i));
    expect(onPick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/NegotiationDoors.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/criblmap/voice/NegotiationDoors.tsx
"use client";
import type { Door } from "../../../lib/map-negotiation";
import "./voice-map.css";

export function NegotiationDoors({ doors, onPick }: { doors: Door[]; onPick: (door: Door) => void }) {
  return (
    <div className="mv-doors">
      {doors.map((door) => (
        <button
          key={door.id}
          type="button"
          className={door.id === "subscribe" ? "mv-door mv-door--bell" : "mv-door"}
          onClick={() => onPick(door)}
        >
          <span>{door.label}</span>
          {door.id !== "subscribe" && <span className="mv-door__gain">+{door.gain} homes</span>}
          {door.id === "subscribe" && <span aria-hidden>🔔</span>}
        </button>
      ))}
    </div>
  );
}
```

Append to `voice-map.css`:
```css
.mv-doors { display: flex; flex-direction: column; gap: 6px; }
.mv-door { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: none; border-radius: 9px; background: #fff; box-shadow: inset 0 0 0 1.5px #dbe7fb; color: var(--brand, #0066ff); font-weight: 800; font-size: 13px; cursor: pointer; }
.mv-door__gain { color: var(--trust, #0d9f4f); font-size: 12px; }
.mv-door--bell { box-shadow: inset 0 0 0 1.5px #ffd9da; color: var(--accent, #ff5a5f); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/NegotiationDoors.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/criblmap/voice/NegotiationDoors.tsx apps/web/components/criblmap/voice/voice-map.css apps/web/components/criblmap/voice/__tests__/NegotiationDoors.test.tsx
git commit -m "feat(voice-map): negotiation doors UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: `MapResultsSheet` — 3-snap bottom sheet (Maya line = handle)

**Files:**
- Create: `apps/web/components/criblmap/voice/MapResultsSheet.tsx`
- Test: `apps/web/components/criblmap/voice/__tests__/MapResultsSheet.test.tsx`

**Interfaces:**
- Produces:
  - `<MapResultsSheet mayaLine={string} snap={"peek"|"half"|"full"} onSnapChange={(s) => void}>{children}</MapResultsSheet>`
  - Renders `mayaLine` in the handle region (always visible); `children` (cards/doors) visible at `half`/`full`.
- Note: use CSS transforms for snap heights; **do not** rely on framer-motion drag in tests (preview freezes it). A simple button/aria control toggles snaps; drag can be layered later.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/criblmap/voice/__tests__/MapResultsSheet.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapResultsSheet } from "../MapResultsSheet";

describe("MapResultsSheet", () => {
  it("always shows the maya line and toggles snap", () => {
    const onSnap = vi.fn();
    render(
      <MapResultsSheet mayaLine="Seven in Gomti Nagar. Cheapest ₹17k." snap="peek" onSnapChange={onSnap}>
        <div>card-content</div>
      </MapResultsSheet>
    );
    expect(screen.getByText(/Seven in Gomti Nagar/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /expand results/i }));
    expect(onSnap).toHaveBeenCalledWith("half");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/MapResultsSheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the sheet**

```tsx
// apps/web/components/criblmap/voice/MapResultsSheet.tsx
"use client";
import type { ReactNode } from "react";
import "./voice-map.css";

export type Snap = "peek" | "half" | "full";
const NEXT: Record<Snap, Snap> = { peek: "half", half: "full", full: "peek" };

export function MapResultsSheet({
  mayaLine, snap, onSnapChange, children,
}: { mayaLine: string; snap: Snap; onSnapChange: (s: Snap) => void; children?: ReactNode }) {
  return (
    <div className={`mv-sheet mv-sheet--${snap}`} role="region" aria-label="Search results">
      <button
        type="button"
        className="mv-sheet__handle"
        aria-label={snap === "full" ? "collapse results" : "expand results"}
        onClick={() => onSnapChange(NEXT[snap])}
      >
        <span className="mv-sheet__grab" aria-hidden />
        <span className="mv-sheet__maya">{mayaLine}</span>
      </button>
      {snap !== "peek" && <div className="mv-sheet__body">{children}</div>}
    </div>
  );
}
```

Append to `voice-map.css`:
```css
.mv-sheet { position: absolute; left: 0; right: 0; bottom: 64px; z-index: 7; background: var(--surface, #fff); border-radius: 18px 18px 0 0; box-shadow: 0 -4px 24px rgba(0,0,0,.16); transition: max-height 240ms ease; overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .mv-sheet { transition: none; } }
.mv-sheet--peek { max-height: 84px; } .mv-sheet--half { max-height: 46vh; } .mv-sheet--full { max-height: 82vh; }
.mv-sheet__handle { width: 100%; background: none; border: none; padding: 8px 12px 10px; cursor: pointer; text-align: center; }
.mv-sheet__grab { display: block; width: 30px; height: 3px; border-radius: 2px; background: #dbe3ec; margin: 0 auto 7px; }
.mv-sheet__maya { font-size: 13px; font-weight: 700; color: var(--text-primary, #1a1a2e); }
.mv-sheet__body { padding: 0 12px 14px; overflow-y: auto; max-height: calc(82vh - 60px); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/MapResultsSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/criblmap/voice/MapResultsSheet.tsx apps/web/components/criblmap/voice/voice-map.css apps/web/components/criblmap/voice/__tests__/MapResultsSheet.test.tsx
git commit -m "feat(voice-map): 3-snap results sheet with Maya line as handle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase E — Demand capture (the product's core telemetry)

### Task 14: Migration — `demand_signals` table

**Files:**
- Create: `infra/migrations/00NN_demand_signals.sql` (use the next free number — run `ls infra/migrations/ | sort | tail -1` first; the CLAUDE.md references up to `0019`, memory references `0054`, so pick `max + 1`).

**Interfaces:** none (SQL). Produces a table capturing `{ city, locality, filters(jsonb), phone, transcript, source, created_at }`.

- [ ] **Step 1: Determine the next migration number**

Run: `ls infra/migrations/ | grep -E '^[0-9]' | sort | tail -1`
Use `printf "%04d" $((<n> + 1))` for the prefix.

- [ ] **Step 2: Write the migration**

```sql
-- infra/migrations/00NN_demand_signals.sql
-- Captures unmet rental demand expressed on the voice map: the precise spec a
-- seeker asked for that we could not satisfy, plus an optional phone for
-- owner-acquisition follow-up. This is the demand-sensing output of the feature.
CREATE TABLE IF NOT EXISTS demand_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city         text,
  locality     text,
  filters      jsonb NOT NULL DEFAULT '{}'::jsonb,
  unmet        text,                 -- what we couldn't filter, e.g. "parking"
  transcript   text,                 -- raw spoken query (optional)
  phone        text,                 -- optional; only when the seeker subscribed
  source       text NOT NULL DEFAULT 'voice_map',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demand_signals_city_locality_idx ON demand_signals (city, locality);
CREATE INDEX IF NOT EXISTS demand_signals_created_idx ON demand_signals (created_at DESC);
```

- [ ] **Step 3: Apply and verify**

Run: `pnpm db:migrate`
Expected: migration applies; `\d demand_signals` (or a `SELECT` against it) succeeds. If no local DB, note that the API path is dual-mode (Task 15) and verify via the API test instead.

- [ ] **Step 4: Commit**

```bash
git add infra/migrations/00NN_demand_signals.sql
git commit -m "feat(voice-map): demand_signals table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: API — public `POST /v1/demand-signals`

**Files:**
- Create: `packages/shared-types/src/demand-signal.ts`
- Create: `apps/api/src/modules/demand-signals/demand-signals.module.ts`
- Create: `apps/api/src/modules/demand-signals/demand-signals.controller.ts`
- Create: `apps/api/src/modules/demand-signals/demand-signals.service.ts`
- Modify: `apps/api/src/app.module.ts` (register the module) and `packages/shared-types/src/index.ts` (export the type)
- Test: `apps/api/test/demand-signals.service.test.ts`

**Interfaces:**
- Produces:
  - `CreateDemandSignalDto = { city?: string; locality?: string; filters: Record<string, unknown>; unmet?: string; transcript?: string; phone?: string; source?: string }`
  - `POST /v1/demand-signals` → `{ ok: true, id }`. **Public** (no AuthGuard) but rate-limited; follows the `DatabaseService.isEnabled()` dual-mode pattern (in-memory array fallback via `AppStateService` when DB is off).

- [ ] **Step 1: Write the shared type**

```ts
// packages/shared-types/src/demand-signal.ts
export interface CreateDemandSignalDto {
  city?: string;
  locality?: string;
  filters: Record<string, unknown>;
  unmet?: string;
  transcript?: string;
  phone?: string;
  source?: string;
}
export interface DemandSignal extends CreateDemandSignalDto {
  id: string;
  created_at: string;
}
```
Add to `packages/shared-types/src/index.ts`:
```ts
export * from "./demand-signal";
```

- [ ] **Step 2: Write the failing service test**

```ts
// apps/api/test/demand-signals.service.test.ts
import { describe, it, expect } from "vitest";
import { DemandSignalsService } from "../src/modules/demand-signals/demand-signals.service";

// Minimal fakes mirroring the DatabaseService/AppStateService contract.
function makeService(dbEnabled: boolean) {
  const rows: unknown[] = [];
  const database = {
    isEnabled: () => dbEnabled,
    query: async (_sql: string, params: unknown[]) => {
      const id = "sig_1";
      rows.push({ id, filters: params });
      return { rows: [{ id, created_at: new Date().toISOString() }] };
    },
  };
  const appState = { demandSignals: rows as { push: (x: unknown) => void } & unknown[] };
  return { svc: new DemandSignalsService(database as never, appState as never), rows };
}

describe("DemandSignalsService.create", () => {
  it("persists via DB when enabled and returns an id", async () => {
    const { svc } = makeService(true);
    const res = await svc.create({ city: "lucknow", locality: "Gomti Nagar", filters: { bhk: 2 }, unmet: "parking" });
    expect(res.id).toBeTruthy();
  });
  it("falls back to in-memory when DB disabled", async () => {
    const { svc } = makeService(false);
    const res = await svc.create({ filters: {} });
    expect(res.id).toBeTruthy();
  });
});
```

> Adjust the fakes to the **actual** `DatabaseService`/`AppStateService` signatures once you read `apps/api/src/core/`. The two `it` cases (DB-on and DB-off) are the contract that matters — match them to the real method names.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/api test demand-signals.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the service, controller, module**

```ts
// apps/api/src/modules/demand-signals/demand-signals.service.ts
import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../core/database.service";
import { AppStateService } from "../../core/app-state.service";
import type { CreateDemandSignalDto, DemandSignal } from "@cribliv/shared-types";

@Injectable()
export class DemandSignalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly appState: AppStateService
  ) {}

  async create(dto: CreateDemandSignalDto): Promise<{ id: string; created_at: string }> {
    if (this.database.isEnabled()) {
      const result = await this.database.query(
        `INSERT INTO demand_signals (city, locality, filters, unmet, transcript, phone, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
        [
          dto.city ?? null, dto.locality ?? null, JSON.stringify(dto.filters ?? {}),
          dto.unmet ?? null, dto.transcript ?? null, dto.phone ?? null, dto.source ?? "voice_map",
        ]
      );
      const row = result.rows[0] as { id: string; created_at: string };
      return { id: row.id, created_at: row.created_at };
    }
    const id = `sig_${this.appState.demandSignals.length + 1}`;
    const signal: DemandSignal = { ...dto, id, created_at: new Date().toISOString(), filters: dto.filters ?? {} };
    this.appState.demandSignals.push(signal);
    return { id, created_at: signal.created_at };
  }
}
```
```ts
// apps/api/src/modules/demand-signals/demand-signals.controller.ts
import { Body, Controller, Post } from "@nestjs/common";
import { DemandSignalsService } from "./demand-signals.service";
import type { CreateDemandSignalDto } from "@cribliv/shared-types";

@Controller("demand-signals")
export class DemandSignalsController {
  constructor(private readonly service: DemandSignalsService) {}

  // Public: anonymous seekers on the map. No AuthGuard.
  @Post()
  async create(@Body() dto: CreateDemandSignalDto) {
    const { id } = await this.service.create(dto ?? { filters: {} });
    return { ok: true, id };
  }
}
```
```ts
// apps/api/src/modules/demand-signals/demand-signals.module.ts
import { Module } from "@nestjs/common";
import { DemandSignalsController } from "./demand-signals.controller";
import { DemandSignalsService } from "./demand-signals.service";

@Module({ controllers: [DemandSignalsController], providers: [DemandSignalsService] })
export class DemandSignalsModule {}
```
- Add `demandSignals: DemandSignal[] = [];` to `AppStateService` (mirror how other in-memory collections are declared there).
- Register `DemandSignalsModule` in `apps/api/src/app.module.ts` imports.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api test demand-signals.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck the shared-types build order**

Run: `pnpm --filter @cribliv/shared-types build && pnpm --filter @cribliv/api typecheck`
Expected: PASS (shared-types builds before api per the monorepo `^build` rule).

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/demand-signal.ts packages/shared-types/src/index.ts apps/api/src/modules/demand-signals apps/api/src/app.module.ts apps/api/src/core/app-state.service.ts apps/api/test/demand-signals.service.test.ts
git commit -m "feat(voice-map): public demand-signals capture endpoint (dual-mode)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: `DemandCaptureSheet` — bell → phone → POST

**Files:**
- Create: `apps/web/components/criblmap/voice/DemandCaptureSheet.tsx`
- Create: `apps/web/lib/demand-api.ts` (typed `fetchApi` wrapper)
- Test: `apps/web/components/criblmap/voice/__tests__/DemandCaptureSheet.test.tsx`

**Interfaces:**
- Consumes: `fetchApi` from `lib/api`; `CreateDemandSignalDto` from `@cribliv/shared-types`.
- Produces:
  - `postDemandSignal(dto: CreateDemandSignalDto): Promise<{ ok: boolean; id: string }>` in `demand-api.ts`
  - `<DemandCaptureSheet prefill={{ city, locality, filters, unmet }} onDone={() => void} />` — collects an optional phone, POSTs, shows a confirmation.
- Constraint: phone is **optional** in Slice 1 (do not gate capture on it — capturing the anonymous unmet spec is already valuable); never place phone in a URL/query string (privacy).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/criblmap/voice/__tests__/DemandCaptureSheet.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DemandCaptureSheet } from "../DemandCaptureSheet";

vi.mock("../../../lib/demand-api", () => ({
  postDemandSignal: vi.fn().mockResolvedValue({ ok: true, id: "sig_1" }),
}));

describe("DemandCaptureSheet", () => {
  it("submits the prefilled spec and confirms", async () => {
    const onDone = vi.fn();
    const { postDemandSignal } = await import("../../../lib/demand-api");
    render(
      <DemandCaptureSheet
        prefill={{ city: "lucknow", locality: "Gomti Nagar", filters: { bhk: 2 }, unmet: "parking" }}
        onDone={onDone}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /notify me/i }));
    await waitFor(() => expect(postDemandSignal).toHaveBeenCalledWith(
      expect.objectContaining({ locality: "Gomti Nagar", unmet: "parking" })
    ));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/DemandCaptureSheet.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the api wrapper + component**

```ts
// apps/web/lib/demand-api.ts
import { fetchApi } from "./api";
import type { CreateDemandSignalDto } from "@cribliv/shared-types";

export function postDemandSignal(dto: CreateDemandSignalDto): Promise<{ ok: boolean; id: string }> {
  return fetchApi<{ ok: boolean; id: string }>("/demand-signals", {
    method: "POST",
    body: JSON.stringify(dto),
    headers: { "Content-Type": "application/json" },
  });
}
```
```tsx
// apps/web/components/criblmap/voice/DemandCaptureSheet.tsx
"use client";
import { useState } from "react";
import type { CreateDemandSignalDto } from "@cribliv/shared-types";
import { postDemandSignal } from "../../../lib/demand-api";
import "./voice-map.css";

export function DemandCaptureSheet({
  prefill, onDone,
}: { prefill: Omit<CreateDemandSignalDto, "phone" | "source">; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await postDemandSignal({ ...prefill, phone: phone.trim() || undefined, source: "voice_map" });
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <div className="mv-capture"><p>Got it — we’ll text you when a match lists.</p>
      <button type="button" className="mv-card__cta" onClick={onDone}>Done</button></div>;
  }
  return (
    <div className="mv-capture">
      <p className="mv-capture__lead">We don’t have that yet. Want a text when one lists?</p>
      <input
        className="mv-capture__input" inputMode="tel" placeholder="Phone (optional)"
        value={phone} onChange={(e) => setPhone(e.target.value)}
      />
      <button type="button" className="mv-card__cta" disabled={busy} onClick={submit}>Notify me</button>
    </div>
  );
}
```
Append to `voice-map.css`:
```css
.mv-capture { padding: 12px; }
.mv-capture__lead { font-size: 13px; color: var(--text-primary, #1a1a2e); font-weight: 600; margin: 0 0 8px; }
.mv-capture__input { width: 100%; padding: 10px; border: 1px solid var(--border, #e8ecf1); border-radius: 9px; font-size: 14px; margin-bottom: 8px; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/DemandCaptureSheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/demand-api.ts apps/web/components/criblmap/voice/DemandCaptureSheet.tsx apps/web/components/criblmap/voice/voice-map.css apps/web/components/criblmap/voice/__tests__/DemandCaptureSheet.test.tsx
git commit -m "feat(voice-map): demand-capture sheet posts unmet specs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase F — Flag, i18n, analytics, and the orchestrator mount

### Task 17: Register `ff_maya_voice_map` (both flag systems)

**Files:**
- Modify: `apps/web/lib/feature-flags.ts` (add to `ENV_FLAG_MAP`)
- Modify: `apps/api/src/config/feature-flags.ts` (add to `FeatureFlags` + `readFeatureFlags`)

**Interfaces:** Produces the web `useFlag("ff_maya_voice_map")` boolean and the API flag (defaults false).

- [ ] **Step 1: Web flag**

In `apps/web/lib/feature-flags.ts`, add to `ENV_FLAG_MAP`:
```ts
  ff_maya_voice_map: process.env.NEXT_PUBLIC_FF_MAYA_VOICE_MAP,
```

- [ ] **Step 2: API flag**

In `apps/api/src/config/feature-flags.ts`, add `ff_maya_voice_map: boolean;` to `FeatureFlags`, and in `readFeatureFlags()` map it from `FF_MAYA_VOICE_MAP` with **default false** (mirror an existing default-off flag like `ff_admin_totp`).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/api typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/feature-flags.ts apps/api/src/config/feature-flags.ts
git commit -m "feat(voice-map): register ff_maya_voice_map (default off)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 18: i18n strings (en + hi)

**Files:**
- Modify: `apps/web/lib/i18n.ts`

**Interfaces:** Produces dictionary keys used by the dock/sheet. Every key has `en` **and** `hi`.

- [ ] **Step 1: Add the keys**

Insert into the `dictionary` object in `apps/web/lib/i18n.ts`:
```ts
  mvHoldToSpeak: { en: "Hold & speak", hi: "दबाकर बोलें" },
  mvListening: { en: "Listening…", hi: "सुन रहे हैं…" },
  mvTypeInstead: { en: "Type instead", hi: "टाइप करें" },
  mvThatsEverything: { en: "That’s everything — not a page one.", hi: "बस इतना ही — यह पहला पेज नहीं है।" },
  mvNoneHere: { en: "Nothing matches here yet.", hi: "यहाँ अभी कुछ मेल नहीं खाता।" },
  mvNotifyMe: { en: "Notify me", hi: "मुझे सूचित करें" },
  mvCantFilterYet: { en: "can’t filter this yet", hi: "यह अभी फ़िल्टर नहीं कर सकते" },
  mvUnlockNumber: { en: "Unlock owner’s number", hi: "मालिक का नंबर अनलॉक करें" },
```

- [ ] **Step 2: Typecheck (hi required)**

Run: `pnpm --filter @cribliv/web typecheck`
Expected: PASS. (If any key is missing `hi`, the `Dictionary` type errors — that is the guard working.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/i18n.ts
git commit -m "feat(voice-map): en+hi strings for the voice dock

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 19: `MapVoiceDock` orchestrator + mount in `map-view` behind the flag

**Files:**
- Create: `apps/web/components/criblmap/voice/MapVoiceDock.tsx`
- Create: `apps/web/lib/map-voice-analytics.ts`
- Modify: `apps/web/app/[locale]/map/map-view.tsx` (wrap with `MapCameraProvider`, mount the dock behind `useFlag`)
- Test: `apps/web/components/criblmap/voice/__tests__/MapVoiceDock.test.tsx`

**Interfaces:**
- Consumes: `useHoldToTalk` (Task 8), `buildMapIntent` (Task 3), `partitionPins` (Task 1), `computeNegotiationDoors` (Task 4), `useMapCamera` (Task 7), `useMapState`/`useMapDispatch`, all the UI components (Tasks 10–13, 16), `useFlag`.
- Produces: `<MapVoiceDock locale={"en"|"hi"} />` — the single orchestrator. On final transcript it:
  1. `const intent = buildMapIntent({ transcript, cityList, localityList })`
  2. `if (intent.camera) camera.flyTo(intent.camera)`
  3. `dispatch({ type: "SET_FILTERS", filters: { ...currentFilters, ...intent.serverFilters } })` (**merge**, per Global Constraints)
  4. after pins refresh: `const part = partitionPins(pins, intent.clientFilters)` → `dispatch SET_HIGHLIGHT part.matchedIds`
  5. compute `mayaLine` (truthful count via `part.isComplete`) and doors if `part.count === 0`.
- Analytics: `map-voice-analytics.ts` exposes typed `trackEvent` wrappers listed in spec §14 (`mapVoiceHoldStart`, `mapVoiceTranscript`, `mapVoiceCameraFly`, `mapVoiceResult`, `mapVoiceNegotiationShown`, `mapVoiceDemandCapture`, `mapVoiceFallbackText`).

- [ ] **Step 1: Write the analytics wrappers**

```ts
// apps/web/lib/map-voice-analytics.ts
import { trackEvent } from "./analytics";
export const mapVoice = {
  holdStart: () => trackEvent("map_voice_hold_start", {}),
  transcript: (t: string, chips: string[], unsupported: string[]) =>
    trackEvent("map_voice_transcript", { transcript: t, chips, unsupported }),
  cameraFly: (locality: string, method: string) =>
    trackEvent("map_voice_camera_fly", { locality, method }),
  result: (count: number, isComplete: boolean) =>
    trackEvent("map_voice_result", { count, isComplete }),
  negotiationShown: (doorIds: string[]) => trackEvent("map_voice_negotiation_shown", { doorIds }),
  demandCapture: (spec: Record<string, unknown>) => trackEvent("map_voice_demand_capture", spec),
  fallbackText: () => trackEvent("map_voice_fallback_text", {}),
};
```

- [ ] **Step 2: Write the failing orchestrator test (text-fallback path — no Maps SDK)**

```tsx
// apps/web/components/criblmap/voice/__tests__/MapVoiceDock.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapStateProvider } from "../../hooks/useMapState";
import { MapCameraProvider } from "../../MapCameraController";
import { MapVoiceDock } from "../MapVoiceDock";

// Force the unsupported-speech path so the text fallback renders (jsdom has no SpeechRecognition).
describe("MapVoiceDock", () => {
  it("renders a text fallback when speech is unsupported and parses a typed query", () => {
    render(
      <MapStateProvider>
        <MapCameraProvider map={null}>
          <MapVoiceDock locale="en" />
        </MapCameraProvider>
      </MapStateProvider>
    );
    const input = screen.getByPlaceholderText(/type/i);
    fireEvent.change(input, { target: { value: "2bhk under 20k" } });
    fireEvent.submit(input.closest("form")!);
    // a chip for the parsed BHK should appear
    expect(screen.getByText(/2 BHK/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/MapVoiceDock.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the orchestrator**

```tsx
// apps/web/components/criblmap/voice/MapVoiceDock.tsx
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMapState, useMapDispatch } from "../hooks/useMapState";
import { useMapCamera } from "../MapCameraController";
import { useHoldToTalk } from "./useHoldToTalk";
import { buildMapIntent } from "../../../lib/map-intent";
import { partitionPins } from "../../../lib/map-post-filter";
import { computeNegotiationDoors, type Door } from "../../../lib/map-negotiation";
import type { IntentChip } from "../../../lib/map-intent-types";
import { IntentChips } from "./IntentChips";
import { MapResultsSheet, type Snap } from "./MapResultsSheet";
import { NegotiationDoors } from "./NegotiationDoors";
import { DemandCaptureSheet } from "./DemandCaptureSheet";
import { VoiceOrb } from "../../listing-wizard/VoiceOrb";
import { mapVoice } from "../../../lib/map-voice-analytics";
import "./orb-tokens.css";
import "./voice-map.css";

export function MapVoiceDock({ locale }: { locale: "en" | "hi" }) {
  const { pins, filters } = useMapState();
  const dispatch = useMapDispatch();
  const camera = useMapCamera();

  const [caption, setCaption] = useState("");
  const [chips, setChips] = useState<IntentChip[]>([]);
  const [clientFilters, setClientFilters] = useState<ReturnType<typeof buildMapIntent>["clientFilters"]>([]);
  const [snap, setSnap] = useState<Snap>("peek");
  const [doors, setDoors] = useState<Door[]>([]);
  const [captureFor, setCaptureFor] = useState<IntentChip | null>(null);

  const applyTranscript = useCallback(
    (transcript: string) => {
      const intent = buildMapIntent({ transcript });
      setChips(intent.chips);
      setClientFilters(intent.clientFilters);
      mapVoice.transcript(
        transcript,
        intent.chips.filter((c) => c.status === "applied").map((c) => c.label),
        intent.chips.filter((c) => c.status === "unsupported").map((c) => c.label)
      );
      if (intent.camera) {
        camera.flyTo(intent.camera);
        mapVoice.cameraFly(String(intent.chips.find((c) => c.kind === "locality")?.label ?? ""), intent.camera.kind);
      }
      dispatch({ type: "SET_FILTERS", filters: { ...filters, ...intent.serverFilters } });
      setSnap("peek");
    },
    [camera, dispatch, filters]
  );

  // Re-partition whenever pins settle after a filter change.
  useEffect(() => {
    if (chips.length === 0) return;
    const part = partitionPins(pins, clientFilters);
    dispatch({ type: "SET_HIGHLIGHT", pinIds: part.matchedIds });
    mapVoice.result(part.count, part.isComplete);
    if (part.count === 0) {
      const d = computeNegotiationDoors({ pins, serverFilters: filters, clientFilters });
      setDoors(d);
      mapVoice.negotiationShown(d.map((x) => x.id));
    } else {
      setDoors([]);
    }
  }, [pins, clientFilters, chips.length, dispatch, filters]);

  const speech = useHoldToTalk({
    lang: locale === "hi" ? "hi-IN" : "en-IN",
    onInterim: setCaption,
    onFinal: (t) => { setCaption(t); applyTranscript(t); },
  });

  const mayaLine = useMemo(() => {
    if (chips.length === 0) return locale === "hi" ? "दबाकर बोलें" : "Hold & speak";
    const part = partitionPins(pins, clientFilters);
    if (part.count === 0) return locale === "hi" ? "यहाँ अभी कुछ मेल नहीं खाता।" : "Nothing matches here yet.";
    const tail = part.isComplete ? (locale === "hi" ? "बस इतना ही।" : "That’s everything.") : "";
    return `${part.count} ${part.count === 1 ? "home" : "homes"}. ${tail}`.trim();
  }, [chips.length, pins, clientFilters, locale]);

  return (
    <>
      <MapResultsSheet mayaLine={mayaLine} snap={snap} onSnapChange={setSnap}>
        {chips.length > 0 && <IntentChips chips={chips} onBell={setCaptureFor} />}
        {doors.length > 0 && (
          <NegotiationDoors
            doors={doors}
            onPick={(door) => {
              if (door.id === "subscribe") setCaptureFor(chips[0] ?? null);
              else if (door.relaxed) dispatch({ type: "SET_FILTERS", filters: { ...filters, ...door.relaxed.serverFilters } });
            }}
          />
        )}
        {captureFor && (
          <DemandCaptureSheet
            prefill={{ filters: { ...filters }, unmet: captureFor.label }}
            onDone={() => setCaptureFor(null)}
          />
        )}
      </MapResultsSheet>

      <div className="mv-dock">
        {caption && <div className="mv-dock__caption">{caption}</div>}
        {speech.supported ? (
          <button
            type="button"
            className="maya-orb-wrap mv-dock__orb"
            aria-label={locale === "hi" ? "दबाकर बोलें" : "Hold and speak"}
            onPointerDown={() => { mapVoice.holdStart(); speech.start(); }}
            onPointerUp={() => speech.stop()}
            onPointerLeave={() => speech.stop()}
          >
            <VoiceOrb state={speech.state === "listening" ? "listening" : "idle"} userLevel={0} assistantLevel={0} size={52} />
          </button>
        ) : (
          <form
            className="mv-dock__fallback"
            onSubmit={(e) => {
              e.preventDefault();
              const value = (new FormData(e.currentTarget).get("q") as string) ?? "";
              mapVoice.fallbackText();
              if (value.trim()) applyTranscript(value.trim());
            }}
          >
            <input name="q" className="mv-capture__input" placeholder={locale === "hi" ? "टाइप करें" : "Type instead"} />
          </form>
        )}
      </div>
    </>
  );
}
```
Append to `voice-map.css`:
```css
.mv-dock { position: absolute; left: 0; right: 0; bottom: 0; z-index: 9; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px; pointer-events: none; }
.mv-dock > * { pointer-events: auto; }
.mv-dock__caption { background: var(--surface, #fff); border-radius: 12px; padding: 6px 10px; box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,.08)); font-size: 12px; font-weight: 600; max-width: 92%; }
.mv-dock__orb { border: none; background: none; cursor: pointer; touch-action: none; }
.mv-dock__fallback { width: 92%; max-width: 420px; }
```

> **Prop-check before writing:** open `apps/web/components/listing-wizard/VoiceOrb.tsx` and confirm the exact prop names/values (`state`, `userLevel`, `assistantLevel`, `size`) and the accepted `state` union. Match them exactly — adjust the `state=` mapping above if the union differs.

- [ ] **Step 5: Run the orchestrator test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/criblmap/voice/__tests__/MapVoiceDock.test.tsx`
Expected: PASS. (Speech is unsupported in jsdom, so the text-fallback form renders and the typed query produces a "2 BHK" chip.)

- [ ] **Step 6: Mount in `map-view.tsx` behind the flag**

In `apps/web/app/[locale]/map/map-view.tsx`:
- Import at top: `import { MapCameraProvider } from "../../../components/criblmap/MapCameraController";`, `import { MapVoiceDock } from "../../../components/criblmap/voice/MapVoiceDock";`, `import { useFlag } from "../../../lib/feature-flags";`
- Inside the component: `const voiceMapOn = useFlag("ff_maya_voice_map");`
- Wrap the returned tree's contents so the dock sits inside both `MapStateProvider` (already an ancestor) and the new camera provider. Since `mapInstance` lives here, wrap the JSX region that needs camera access:
```tsx
return (
  <div className="criblmap-root">
    <MapCameraProvider map={mapInstance}>
      <CriblMapCanvas onMapReady={handleMapReady} initialCenter={initialCenter} initialZoom={initialZoom} />
      {/* ...all existing layers and UI unchanged... */}
      {voiceMapOn && <MapVoiceDock locale={locale} />}
    </MapCameraProvider>
  </div>
);
```
(Keep every existing child exactly as-is; only add the provider wrapper and the flagged dock. The provider is render-only and passes `mapInstance` through, so existing layers are unaffected.)

- [ ] **Step 7: Typecheck + full web unit suite**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web exec vitest run components/criblmap lib/__tests__`
Expected: PASS (all new + existing criblmap/lib tests).

- [ ] **Step 8: Manual smoke on Vercel (preview renders no markers locally)**

Deploy the branch (or a Vercel preview) with `NEXT_PUBLIC_FF_MAYA_VOICE_MAP=true`. On a real device: hold the orb, say *"2BHK in Gomti Nagar under 20k with parking"*, confirm camera flies, chips appear (parking struck), sheet shows a truthful line, and a zero-result query shows doors + capture. Record the result in the PR description (screenshots/screen recording).

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/criblmap/voice/MapVoiceDock.tsx apps/web/lib/map-voice-analytics.ts apps/web/app/[locale]/map/map-view.tsx apps/web/components/criblmap/voice/voice-map.css apps/web/components/criblmap/voice/__tests__/MapVoiceDock.test.tsx
git commit -m "feat(voice-map): wire the voice dock orchestrator into the map (flagged)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- §5.1 camera channel → Task 7 (+ mount in 19). §5.2 resolveArea → Task 2. §5.3 filter matrix → Tasks 1, 3. §5.4 dock/sheet → Tasks 10–13, 19. §5.5 demand capture → Tasks 14–16.
- §6 intent model → Tasks 1, 3. §7 truthful count → Task 1 (`isComplete`) + Task 19 (`mayaLine`). §8 negotiation → Task 4 + Task 12/19. §9 conversion card → Task 11. §10 interaction/motion → Tasks 6, 8, 13, 19 (reduced-motion guards in 6, 7, 13). §11 reuse → Tasks 8, 9, 19 (VoiceOrb). §12 data hygiene → notes in Tasks 2, 5. §13 flag/i18n → Tasks 17, 18. §14 analytics → Task 19. §15 acceptance → covered by tests across Tasks 1–19 + Task 19 Step 8 manual. §16 non-goals → respected (no TTS, no realtime, amenity struck). §17 resolved decisions → encoded (act-then-undo rent guard in Task 3; anonymous capture in Tasks 15–16).
- **Gap check:** the "fade non-matches" pin styling (§6/§10) is Task 6; the "swipe card → camera to pin" (§10 Half) is **not** in Slice 1 tasks — it is a nice-to-have layered on the sheet. Logged as a deferred follow-up in the PR, not a blocker for the acceptance criteria (§15 does not require it).

**2. Placeholder scan** — the only intentional fill-ins are the **literal CSS values** in Task 9 (copied from `concierge.css` at implementation time) and the **migration number** in Task 14 (`00NN`, resolved by the `ls | tail -1` step). Both have explicit resolution instructions. No "TODO/handle edge cases/similar to Task N" placeholders remain.

**3. Type consistency** — `IntentChip`, `ClientFilter`, `CameraIntent` defined once in `map-intent-types.ts` (Task 1) and imported everywhere. `Door` defined in `map-negotiation.ts` (Task 4), consumed in Tasks 12/19. `MapIntent`/`buildMapIntent` (Task 3) consumed in Task 19. `partitionPins`/`PartitionResult` (Task 1) consumed in Tasks 4, 19. `SET_HIGHLIGHT`/`highlightedPinIds` (Task 5) consumed in Task 6. `CreateDemandSignalDto` (Task 15) consumed in Task 16. `useMapCamera`/`CameraIntent` (Task 7) consumed in Task 19. Names verified consistent across tasks.
