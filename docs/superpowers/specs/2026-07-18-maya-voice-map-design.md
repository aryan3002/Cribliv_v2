# Maya Voice Map — Design Spec

**Date:** 2026-07-18
**Status:** Approved for planning
**Author:** brainstorming session (founder-led)
**Flag:** `ff_maya_voice_map` (web) / `FF_MAYA_VOICE_MAP` (api) — defaults **OFF**

---

## 1. One-line summary

A seeker opens Cribliv's map, **holds an orb and speaks** ("2BHK in Gomti Nagar under 20k"). The camera
flies to the locality while they are still talking, matching pins brighten and non-matching pins fade,
and a bottom sheet answers in the map's own voice — truthfully, in the user's own quoted words, including
what we **couldn't** deliver.

## 2. The reframe that drives every decision

Cribliv has **~90–95 live listings in Lucknow** today. That single fact inverts the feature:

- **This is not a search-narrowing tool.** You do not need voice to narrow 95 homes; the map already shows
  all of them. Building a "342 → 41 → 7" narrowing experience would be theater at this inventory.
- **This is a market-truth-teller and a demand sensor.** At 95 listings you can describe the *entire* market
  truthfully in one breath — *"That's all four 2BHKs under ₹20k in Gomti Nagar, not a page one."* Housing.com
  with 50,000 listings **structurally cannot say that sentence**. Scarcity is the moat.
- **The default outcome is "few or none."** So the negotiation/zero-result flow is not an edge case — it is the
  **main screen**, and it earns the most design investment.
- **Every honest failure is a supply lead.** When Maya says *"nothing furnished under ₹18k in Gomti Nagar"* and the
  user taps 🔔, we capture a **precise unmet spec with a phone number** → which becomes an owner-acquisition warrant
  (*"nine people are waiting for a furnished 2BHK in Gomti Nagar at ₹18k — list with me"*). People **say out loud
  what they would never type into a filter**. That is the reason voice specifically is the right instrument.

**North-star sentence:** *"Cribliv is the only place that tells you the whole truth about the rental market in
one breath — including when the home you want doesn't exist yet."*

## 3. Locked product decisions (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | First engine | **Reflex layer** — on-device speech → existing `parseQuery` → camera + chips. ~300ms, ~₹0 marginal cost. No LLM. |
| D2 | Honesty when the map can't filter it | **Show it, strike it, say it.** Every heard requirement becomes a chip; unsupported ones render struck with a 🔔 to subscribe. Never silently drop. |
| D3 | Mic gesture | **Hold-to-talk, WhatsApp-style.** Press-and-hold the orb; the hold *is* the session; release settles. Desktop: hold-Space or tap-toggle. |
| D4 | Layout | **The Dock** while held (orb + caption + chips bottom-centre, map uncovered) → on release, **chips fly up into the search bar** (C's resting state). Orb never moves. |
| D5 | Results surface | **Bottom sheet, three snap points** (Peek / Half / Full). **Maya's answer line IS the sheet handle.** Orb lives in a strip *below* the sheet and is never covered. |
| D6 | Pin treatment | **Fade, don't vanish.** Non-matches dim to ~40% and stay. At 95 listings this is the difference between "empty site" and "95 homes, four are yours." |
| D7 | Conversion card | Argues in the user's **own quoted words** ("₹3,000 under *'under 20k'*"), and **volunteers the flaw** ("✕ no parking — you asked for it; this one doesn't have it"). |
| D8 | Zero-result flow | **Negotiation as default.** Present relaxed-constraint "doors" priced in homes-gained ("Stretch to ₹22k → +3 homes"), plus a 🔔 demand-capture door. **Pure arithmetic — no LLM.** |
| D9 | Audience / auth | **Anonymous seeker-facing.** On-device speech = no server audio cost = no login required to search. Phone captured only at 🔔 subscribe / contact-unlock. |
| D10 | Cost ladder | Reflex (free) → **Reason** (₹~0.10/query, text-only Maya via the *chat* LLM, **unblocked today**) → Voice-out/Realtime (expensive, **optional** — the map is the response, so TTS is not a user need). |

## 4. Scope — three slices

The spec documents the whole vision. **Only Slice 1 is planned for implementation now.** Slices 2–3 are roadmap.

### Slice 1 — "The Reflex Map" (this spec's build target; **no LLM**)
Everything in §5–§10 below. Ships the moat and the demand sensor with zero LLM cost and zero LLM risk.

### Slice 2 — "Maya Speaks" (Reason tier; cheap chat LLM; **text-out only**)
- Maya renders **text** bubbles (not speech) driven by the existing Azure OpenAI *chat* deployment (working in prod
  per project memory; only the *realtime* key is broken).
- Conversational phrasing of the §8 negotiation and the §7 count.
- **"Hold to ask about this one"** — per-listing Q&A (context swaps to the focused listing: *"is this real?"*,
  *"bachelors allowed?"*).
- Follow-up refinement inside a session (*"actually under 18"*), using the existing `pushContext()` on
  `RealtimeClient`'s cheaper sibling (a plain chat call, not realtime).

### Slice 3 — "Voice-out / Realtime" (optional; expensive; explicitly deferred)
Only if a spoken-reply demo is ever wanted. Requires a **seeker-reachable realtime endpoint** (today owner-gated),
**server-side cost brakes** (none exist — lift the PG gateway's `SESSION_MAX_MS`/idle/concurrency/daily/tool-cap
block), and **rotating the broken `adars-moibam2t-eastus2` realtime key**. Not needed for product value.

## 5. Architecture — the critical path (audio → camera)

```
[hold orb]
  └─ Web Speech API (on-device, free)  ──interim transcript──┐
        │                                                     │
        ▼ (partial)                                           ▼ (final)
   parseQuery(transcript)  ───────────────────────────►  parseQuery(final)
        │  ParsedChip[] {kind, value, label, sourceRange}       │
        ▼                                                       ▼
   ┌─ locality chip? ─► resolveArea(name) ─► {center, bounds} ─► CAMERA.flyTo(bounds)   [~400ms]
   │                                                               (fade non-matches live)
   └─ other chips ────► buildMapQuery(chips) ─► dispatch SET_FILTERS ─► useMapPins refetch ─► pins settle  [~1.5s]
                                     │
                                     ▼
                         partition pins in-memory (≤500):
                           supported filters → server; furnishing/amenity/min_rent/locality → client post-filter
                                     │
                                     ▼
                    ResultModel { matched[], faded[], count, isComplete, unmet[] }
                                     │
                    ┌────────────────┼─────────────────┐
                    ▼                ▼                 ▼
              chips (D2/D4)    bottom sheet (D5)   negotiation (D8, if matched==0)
```

### The five things that do not exist and must be built

1. **Camera command channel (the namesake gap).** The `google.maps.Map` is trapped in
   `apps/web/app/[locale]/map/map-view.tsx:55` local state; the 25-action `MapAction` union **deliberately has no
   camera action** (camera is modelled as a one-way *report* via `SET_VIEWPORT`). We introduce a small
   **`MapCameraController`** (imperative, not reducer state) built from the already-captured `mapInstance`
   (`handleMapReady`, `map-view.tsx:69`) and provide it via context to the voice dock. The tool/intent layer stays
   **pure** and returns a `CameraIntent` descriptor (`{center, zoom}` or `{bounds}`); the controller executes it.
   *Rationale: keeps intent unit-testable in jsdom, since the local Browser preview renders no markers.*

2. **Area resolution (`resolveArea`).** "Gomti Nagar" → `{center, bounds}`. **No polygons/bounds exist anywhere**
   (grep-confirmed). Primary path: extend the client `searchMapIndex` (`apps/web/lib/map-search-index.ts`) to cover
   DB localities and **synthesize bounds** from centroid + a per-kind radius via `apps/web/lib/geo.ts`
   (`boundsFromCenterZoom`/`zoomToFitBounds`), radius by kind: city → `CITY_BBOXES`, locality → ~2 km,
   sub-area → ~1 km. *Enhancement (later): add `'viewport'` to the Places field mask at
   `apps/web/lib/google-places.ts:264` for real per-locality viewports — one line, on an API already billed.*

3. **Widened map query with client post-filter.** `MapFilters` supports only 5 fields; the parser already emits
   `locality`, `min_rent`, `furnishing`, `amenity`. The map pin payload **already carries `furnishing`**
   (`search.service.ts:856`); `amenities` is a `jsonb` column on the same row — add it to the map SELECT (one line,
   **no index needed** because we post-filter the ≤500 in-memory pins). Rule: `bhk`/`max_rent`/`listing_type`/
   `verified_only`/`near_metro` go to the server; `locality`/`min_rent`/`furnishing`/`amenity` are applied
   **client-side** over the returned pins.

4. **The voice dock + bottom sheet UI.** New surface. The old in-map listing `SidePanel` is intentionally dead
   (`map-view.tsx:185-187`) — we do **not** revive it. The sheet is new.

5. **Demand capture on 🔔.** A struck/zero-result chip's bell subscribes the user to *this exact spec*. Reuse the
   existing saved-search / alert-zone plumbing where possible; capture `{filters, locality, phone}`.

## 6. The intent model (pure, testable core)

A single pure module `apps/web/lib/map-intent.ts` (new), unit-tested, no React, no network:

```ts
// Input: raw transcript (interim or final) + current map context
interface MapIntentInput {
  transcript: string;
  cityInView: string;            // from map state (camera-derived)
}

// Output: everything the UI and camera need, as data
interface MapIntent {
  chips: IntentChip[];           // ordered, each carries honesty status
  camera: CameraIntent | null;   // null if no locality/city heard
  serverFilters: MapFilters;     // what the /search/map endpoint honors
  clientFilters: ClientFilter[]; // furnishing/min_rent/amenity/locality — applied in-memory
}

interface IntentChip {
  kind: ChipKind;                // reuse smart-parser's ChipKind
  label: string;                 // display ("2 BHK", "‹ ₹20k")
  quotedSource?: string;         // the exact words the user said (from sourceRange) — for the card ledger
  status: "applied" | "unsupported";   // unsupported → struck + 🔔
  reason?: string;               // e.g. "can't filter parking yet"
}

type CameraIntent =
  | { kind: "bounds"; bounds: LatLngBounds }
  | { kind: "center"; center: LatLng; zoom: number };
```

`buildMapIntent(input)` wraps `parseQuery` + `resolveArea` + the supported/unsupported partition. **This is the
unit-test surface** — the recon confirmed the local preview renders no markers, so correctness is proven here and
on Vercel, not in the Browser pane.

## 7. Truthful counting (blocking honesty rule)

The pins (cap 500, ordered `created_at DESC`) and the rail (first 12) **disagree by design**. Maya may only speak a
number when it is provably the whole set:

- **`isComplete = returnedPinCount < 500`.** At ~95 city-wide listings this is always true, so Maya can say
  *"that's everything"* / *"all four"* safely today.
- **If `isComplete` is false** (future, higher inventory): Maya says *"at least N"* and never *"that's everything."*
- **`count` = matched pins after client post-filter**, not the rail's `slice(0,12)`.

## 8. The negotiation flow (pure arithmetic — the main screen)

**Trigger (Slice 1):** exactly when `matched.length === 0`. (A "few results" nudge is deferred to Slice 2 so the
threshold stays unambiguous.) Compute **relaxation doors** by re-running the same query with **one constraint
relaxed at a time** and reporting the delta:

| Door | How | Example label |
|------|-----|---------------|
| Stretch budget | `max_rent × 1.1`, re-count | "Stretch to ₹22k → **+3 homes**" |
| Loosen furnishing | drop furnishing post-filter, re-count | "Semi-furnished too → **+2 homes**" |
| Widen area | resolve **adjacent** locality, re-count | "Add Indira Nagar → **+4 homes**" |
| Allow unverified | drop `verified_only` | "Include unverified → **+1 home**" |
| **Subscribe (🔔)** | capture `{filters, locality, phone}` | "Text me when one lists" |

- Each door is a **tappable chip** in Slice 1 (no spoken phrasing). Slice 2 lets Maya *say* them.
- Only show doors that actually yield `+N > 0`. Silent no-op doors are forbidden (honesty).
- "Adjacent locality" for Slice 1 = nearest centroid(s) from the resolver's index (haversine via `geo.ts`).

## 9. The conversion card

Rendered in the bottom sheet (Half/Full) and as the focused card:

- **Header:** price, BHK, locality, verified badge **with the verified date** ("✓ Verified 12 Jul").
- **Reason ledger** — one row per heard requirement, using `quotedSource`:
  - `✓ ₹3,000 under "under 20k"`
  - `✓ 2 BHK, like you asked`
  - `✓ 1.2 km inside "Gomti Nagar"`
  - `✕ No parking — you asked for it; this one doesn't have it`  ← **volunteered flaw**
- **CTAs:** primary "Unlock owner's number" (existing contact-unlock flow); secondary (Slice 2) "🎙 Hold to ask
  about this one."
- **Honesty guardrails (hard prohibitions):**
  - **Never** speak/print "below market" as fact — it is computed client-side relative to the current viewport
    (`useMapPins.ts:78-84`) and flips as you pan.
  - **Never** speak/print synthetic demand ("N people asked today") — `GET /map/seekers` returns `source:"estimated"`
    synthetic pins when none are real.

## 10. Interaction & motion detail

- **Hold** → orb enters `listening`, top bar shows "listening…", dock owns the bottom. Camera launches on the
  **first resolvable locality token** in the interim transcript (don't wait for final).
- **Release** → chips animate **up into the search bar** (teaches "what I said = the search state"), dock collapses
  to orb + Maya's one line, sheet snaps to **Peek**.
- **Sheet snaps:** Peek (handle + Maya line) / Half (2-up card carousel; swiping a card pans camera to its pin) /
  Full (vertical list, sorted, still voice-refinable).
- **Fade-don't-vanish:** matched pins = brand blue, focused = coral, non-matched = white @ ~40% opacity, still
  present. Below zoom 14 clustering swallows pins — **camera must reach the resolved bounds (≥ zoom 14 effective)
  before highlight is meaningful**; resolver targets an appropriate zoom.
- **Text fallback (required):** if mic permission is denied or `SpeechRecognition` is unavailable
  (`isRealtimeSupported`-style probe), the same dock exposes a **text input** that runs the identical
  `buildMapIntent` path. Voice is the fast producer; text is the floor. Never a dead end.
- **Reduced motion:** honor `prefers-reduced-motion` — camera uses `panTo` without the fly easing; chips
  cross-fade instead of translate.

## 11. Reuse inventory (what we stand on)

**Reuse as-is:** `parseQuery`/`chipsToFilters` (`smart-parser.ts` — already emits every chip kind we need, with
`sourceRange`), `VoiceOrb` (`listing-wizard/VoiceOrb.tsx` — but import the ~60-line `--cz-orb-*` token block
directly, **not** via the wizard barrel, or it drags 1445 lines of `concierge.css`), Web Speech plumbing from
`voice-search-button.tsx`, `geo.ts` (bounds/haversine math), `city-bboxes.ts`, `useMapPins` (never fetch pins
directly — dispatch filters and let it refetch), `GET /listings/search/map`, `GET /map/stats`.

**Reuse with changes:** `MapFilters` (widen or wrap with a client-filter companion), the map SELECT (add
`amenities`), `map-view.tsx` (thread the camera controller), `MobileMayaShell` semantics (hide-not-unmount tray).

**Must build new:** `MapCameraController` + context, `resolveArea`, `map-intent.ts`, the voice dock, the bottom
sheet, the negotiation computation, demand-capture on 🔔.

## 12. Data hygiene / known landmines (call out in the plan)

- **Two "Gomti Nagar" centroids 6.5 km apart** (`migration 0012:23` vs `localities.json`). Slice 1 resolver must
  pick **one** source of truth (recommend the DB/`0012` set, reconciled into the client index) so the camera never
  flies to the wrong point. Flag as a data task.
- **Coverage holes:** `localities.json` has one Lucknow row; migration 0012 has 15; **Hazratganj is missing** from
  the client index. Extend the index from the server dictionary (`GET /listings/search/dictionary`).
- **Reducer hazards to respect:** `SET_PINS` auto-deselects if the selection leaves the refreshed set; `SET_FILTERS`
  **replaces** the whole object (merge before dispatch); toolbar actions are **toggles not setters**; `city` is
  auto-derived from the camera on every idle (don't fight it); `useMapDispatch` default is a **no-op** (mount the
  dock **inside** `MapStateProvider` or it fails silently); tool-call/intent handlers must be **idempotent**.
- **Corrupted Hindi string** at `search.service.ts:388` (stray Tamil char) — not ours to ship through Maya; note
  for cleanup.

## 13. Feature flag & i18n

- Register `ff_maya_voice_map` in **both** `apps/api/src/config/feature-flags.ts` (`FF_MAYA_VOICE_MAP`, default
  false) and `apps/web/lib/feature-flags.ts` (`NEXT_PUBLIC_FF_MAYA_VOICE_MAP`), following the `ff_listening_hero`
  precedent. **Web gate must default OFF** to avoid the owner-page mismatch bug (UI rendered, endpoint 404).
- All user-facing strings added to `apps/web/lib/i18n.ts` in **both `en` and `hi`** (the `Dictionary` type makes
  `hi` required). Keep Maya's spoken/printed lines short — the map is the response.

## 14. Analytics (extend, don't reinvent)

Extend the listening-hero vocabulary (`hero_voice_started`, `hero_voice_transcript`, `hero_map_handoff`). New
events: `map_voice_hold_start`, `map_voice_transcript` (with parsed chips + which were unsupported),
`map_voice_camera_fly` (resolved locality + method), `map_voice_result` (count, isComplete, matched/faded),
`map_voice_negotiation_shown`/`_door_tapped` (which door, +N), `map_voice_demand_capture` (the unmet spec),
`map_voice_fallback_text`. **The unsupported-chip and demand-capture events are the product's core telemetry** —
they are the demand-sensing output.

## 15. Acceptance criteria (Slice 1)

1. With the flag on, the map route shows the voice dock (orb bottom-centre, text-fallback available).
2. Holding the orb and saying *"2BHK in Gomti Nagar under 20k"* (or Hinglish equivalent) resolves chips **2 BHK /
   ‹ ₹20k / 📍 Gomti Nagar**, flies the camera to Gomti Nagar at usable zoom, and fades non-matching pins — camera
   move begins before the sentence ends.
3. Saying *"…with parking"* adds a **struck** `parking` chip with a 🔔 and never silently drops it.
4. The bottom sheet shows Maya's truthful line; at ≤95 inventory she may say *"that's everything / all N"*.
5. A zero-match query renders **only** relaxation doors that yield `+N > 0`, plus a 🔔 demand-capture door;
   tapping 🔔 records the exact unmet spec.
6. Denying mic permission (or an unsupported browser) yields a working **text input** on the same dock running the
   identical intent path.
7. `buildMapIntent` and the negotiation arithmetic are covered by **unit tests** (jsdom, no Maps SDK), including
   Hinglish/Devanagari numerals, the furnishing/amenity client post-filter, and the truthful-count rule.
8. No "below market" or synthetic-demand claim is ever printed or spoken.
9. Nothing renders for anonymous users when the flag is OFF; no new unauthenticated server cost is introduced
   (on-device speech only).

## 16. Explicit non-goals (Slice 1)

- No spoken (TTS) replies. No Azure Realtime. No new realtime endpoint. No server-side audio.
- No per-listing conversational Q&A ("is this real?") — that is Slice 2.
- No amenity **database** indexing — client post-filter over ≤500 pins only.
- No new cities — Lucknow is the live surface; out-of-coverage spoken cities get a "we're only in Lucknow —
  alert me?" demand-capture, not a broken fly-to.
- No polygon/boundary data model — synthesized radius bounds only.

## 17. Open decisions folded in (resolved)

- **Who / auth:** anonymous seeker; on-device speech; phone only at 🔔/unlock. (D9)
- **Definition of "found":** §7 truthful-count rule. Resolved.
- **Honesty on unfilterable intent:** §9 guardrails + D2 struck chips. Resolved.
- **Confirm-before-act vs act-then-undo:** **act-then-undo** — the map just moves, and every chip is one tap from
  correction (voice is lossy). `guardMoneyValue`-style 10×/100× rent-mishearing guard applied before dispatch.
- **Session across navigation (MayaDock):** **out of scope for Slice 1**; the orb's fixed position is the seed that
  makes it possible later. No cross-route session.
- **Continuation from listening-hero:** Slice 1 treats a hero handoff as **entry seed only** (existing behavior);
  true session continuation is a later concern.
