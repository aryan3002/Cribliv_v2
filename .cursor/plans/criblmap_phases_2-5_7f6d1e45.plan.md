---
name: CriblMap Phases 2-5
overview: "Implement the remaining four phases of CriblMap: Phase 2 (Area Stats + Metro Overlay), Phase 3 (Seeker Pins + Owner Demand View), Phase 4 (AI Locality Insights + Benchmark Tool), and Phase 5 (Alert Zones + Commute Isochrone). This spans 3 new DB migrations, 1 new NestJS module, 5 new API endpoints, 2 new worker jobs, ~20 new frontend components, and extensions to the Phase 1 map state/UI."
todos:
  - id: p2-backend-stats
    content: "Phase 2: Create map module + GET /map/stats endpoint with PostGIS area query"
    status: pending
  - id: p2-metro-migration
    content: "Phase 2: Create 0015_metro_stations.sql migration + seed data + GET /map/metro endpoint"
    status: pending
  - id: p2-state-extend
    content: "Phase 2: Extend useMapState with drawMode, drawnBounds, areaStats, metroVisible fields + actions"
    status: pending
  - id: p2-area-overlay
    content: "Phase 2: Build AreaSelectOverlay (two-click draw) + AreaStatsPanel + useAreaStats hook"
    status: pending
  - id: p2-metro-overlay
    content: "Phase 2: Build MetroOverlayLayer + useMetroData hook + metro proximity filter"
    status: pending
  - id: p2-toolbar-enable
    content: "Phase 2: Enable area-stats and metro buttons in FloatingToolbar with handlers"
    status: pending
  - id: p3-migration
    content: "Phase 3: Create 0016_seeker_pins.sql migration"
    status: pending
  - id: p3-seeker-endpoints
    content: "Phase 3: Add GET/POST/DELETE /map/seekers endpoints + worker cleanup job"
    status: pending
  - id: p3-seeker-frontend
    content: "Phase 3: Build SeekerPinLayer + SeekerFormPanel + useSeekerPins hook"
    status: pending
  - id: p3-demand-view
    content: "Phase 3: Implement owner demand view toggle (fade listings, show seekers) + enable toolbar buttons"
    status: pending
  - id: p3-owner-widget
    content: "Phase 3: Build seeker-nearby-widget for owner dashboard"
    status: pending
  - id: p4-locality-endpoint
    content: "Phase 4: Build GET /map/locality-insight endpoint with AI summary + caching"
    status: pending
  - id: p4-locality-card
    content: "Phase 4: Build LocalityInsightCard panel + long-press/cluster interaction"
    status: pending
  - id: p4-benchmark
    content: "Phase 4: Build BenchmarkModal (rent fair tool) using existing pricing-intel"
    status: pending
  - id: p5-migration
    content: "Phase 5: Create 0017_alert_zones.sql migration"
    status: pending
  - id: p5-alert-endpoints
    content: "Phase 5: Add alert zone CRUD endpoints + 6-hour worker sweep + WhatsApp template"
    status: pending
  - id: p5-alert-frontend
    content: "Phase 5: Build AlertZoneModal + AlertZoneLayer + useAlertZones hook"
    status: pending
  - id: p5-commute
    content: "Phase 5: Build CommuteOverlay (office address + metro radial buffer isochrone)"
    status: pending
  - id: p-css-i18n
    content: "All phases: Add CSS for new components + i18n keys + feature flags"
    status: pending
  - id: p-wire-mapview
    content: "All phases: Wire all new layers/panels into map-view.tsx + SidePanel content switching"
    status: pending
isProject: false
---

# CriblMap Phases 2-5 — Full Implementation Plan

## How This Builds on Phase 1

Phase 1 established the foundation: `useMapState` reducer + context, `CriblMapCanvas`, `ListingPinLayer`, `SidePanel`, `FloatingToolbar` (with disabled buttons), and the dark-mode CSS token system (`--cmap-*` / `cmap-*` classes) in [globals.css](apps/web/app/globals.css). All four remaining phases extend this foundation by:

1. Adding new `PanelContent` variants to [useMapState.tsx](apps/web/components/criblmap/hooks/useMapState.tsx)
2. Enabling toolbar buttons in [FloatingToolbar.tsx](apps/web/components/criblmap/FloatingToolbar.tsx)
3. Adding new overlay layers to `MapView` in [map-view.tsx](apps/web/app/[locale]/map/map-view.tsx)
4. Adding new panel components under `components/criblmap/panels/`

---

## Phase 2 — Area Stats + Metro Overlay

### 2A. Backend: `GET /map/stats` endpoint

**New module:** `apps/api/src/modules/map/` with `map.module.ts`, `map.controller.ts`, `map.service.ts`. Register in [app.module.ts](apps/api/src/app.module.ts).

**`GET /map/stats`** — public, no auth required:

```sql
SELECT
  l.bhk,
  COUNT(*) as count,
  AVG(l.monthly_rent)::int as avg_rent,
  MIN(l.monthly_rent) as min_rent,
  MAX(l.monthly_rent) as max_rent,
  COUNT(*) FILTER (WHERE l.verification_status = 'verified') as verified_count
FROM listings l
JOIN listing_locations ll ON ll.listing_id = l.id
WHERE l.status = 'active'
  AND ll.geo_point IS NOT NULL
  AND ST_Intersects(ll.geo_point, ST_MakeEnvelope($1,$2,$3,$4,4326)::geography)
  AND ($5::text IS NULL OR l.listing_type::text = $5)
GROUP BY l.bhk ORDER BY l.bhk
```

Plus a second query for 3-month trend (compare avg rent of listings created in last 90 days vs 90-180 days ago). Response shape matches the spec: `{ total_pins, by_bhk[], verified_count, verified_pct, trend }`.

### 2B. Backend: `GET /map/metro` endpoint + `metro_stations` table

**Migration:** `infra/migrations/0015_metro_stations.sql` — creates `metro_stations` table with `id SERIAL`, `city TEXT`, `line_name TEXT`, `line_color TEXT`, `station_name TEXT`, `geom GEOMETRY(Point, 4326)`, `sequence INTEGER`, plus GIST index.

**Seed data:** `data/seeds/metro-stations.json` — a JSON file with all 9 Delhi NCR metro lines (Blue, Yellow, Red, Green, Violet, Pink, Magenta, Aqua/Gurugram, Noida Aqua) and their station coordinates. Seeded via a seed script or included as INSERT statements in the migration.

**`GET /map/metro?city=delhi`** — returns `{ lines: [{ line_name, line_color, stations: [{ id, name, lat, lng }] }] }`. Cached aggressively (static data, no writes).

### 2C. Frontend: Area Stats Draw Mode

**State extension** in [useMapState.tsx](apps/web/components/criblmap/hooks/useMapState.tsx):

- New `MapState` fields: `drawMode: 'idle' | 'first-corner' | 'complete'`, `drawnBounds: MapViewport | null`, `areaStats: AreaStatsData | null`
- New `PanelContent` variant: `{ type: "area-stats" }`
- New actions: `START_DRAW`, `SET_FIRST_CORNER`, `COMPLETE_DRAW`, `CLEAR_DRAW`, `SET_AREA_STATS`

**New components:**

- **`AreaSelectOverlay.tsx`** — Listens to map clicks when `drawMode !== 'idle'`. First click drops corner A marker. Second click completes the rectangle (renders via `google.maps.Rectangle` with semi-transparent fill + dashed stroke). Corners are draggable; drag fires `COMPLETE_DRAW` with new bounds.
- **`panels/AreaStatsPanel.tsx`** — Renders BHK breakdown table, verified count/percentage, trend arrow, "Save as Alert Zone" CTA (disabled for Phase 2, enabled in Phase 5).
- **`hooks/useAreaStats.ts`** — When `drawnBounds` changes, calls `GET /map/stats`. Dispatches `SET_AREA_STATS`.

**FloatingToolbar:** Enable `area-stats` button. Click dispatches `START_DRAW` and shows instruction overlay "Tap two corners to define your area".

### 2D. Frontend: Metro Overlay

**New components:**

- **`MetroOverlayLayer.tsx`** — When toggled on, fetches `GET /map/metro?city=delhi` (cached via `useMetroData` hook). Renders each line as a `google.maps.Polyline` with the line's color. Station dots as small `AdvancedMarkerElement` circles. Click station dot shows station name tooltip.
- **`hooks/useMetroData.ts`** — Fetches once per session, stores in state. Returns `{ lines, loading }`.

**FloatingToolbar:** Enable `metro` button as a toggle. Active state shows polylines; inactive hides them.

**Metro proximity filter:** Add a `near_metro: boolean` filter to `MapFilters`. When active, client-side filters pins to only show those within ~1km of any loaded station (haversine check on client, no backend change needed since station data is already loaded).

---

## Phase 3 — Seeker Pins + Owner Demand View

### 3A. Backend: `seeker_pins` table + endpoints

**Migration:** `infra/migrations/0016_seeker_pins.sql` — creates `seeker_pins` table per the spec: `id UUID`, `user_id UUID REFERENCES users(id)`, `geom GEOMETRY(Point, 4326)`, `city TEXT`, `budget_min INT`, `budget_max INT NOT NULL`, `bhk_preference SMALLINT[]`, `move_in TEXT`, `listing_type TEXT`, `note TEXT`, `is_active BOOLEAN`, `expires_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`. GIST index on `geom`, index on `city`, composite index on `(is_active, expires_at)`.

**Endpoints** in the existing `map.module.ts`:

- **`GET /map/seekers`** (public) — query by viewport bounds, returns active non-expired pins without user identity
- **`POST /map/seekers`** (auth: tenant) — creates a seeker pin, validates budget/bhk, sets 30-day expiry
- **`DELETE /map/seekers/:id`** (auth: tenant) — soft-delete own pin

### 3B. Backend: Worker cleanup

**In [worker.ts](apps/api/src/worker/worker.ts):** Add `runSeekerPinCleanup(pool)` — daily job: `UPDATE seeker_pins SET is_active = false WHERE is_active = true AND expires_at < NOW()`.

### 3C. Frontend: Seeker Pin Layer

**State extension:**

- New `MapState` fields: `seekerPins: SeekerPin[]`, `demandViewActive: boolean`
- New `PanelContent` variant: `{ type: "seeker-form" }`
- New actions: `SET_SEEKER_PINS`, `TOGGLE_DEMAND_VIEW`

**New components:**

- **`SeekerPinLayer.tsx`** — Renders seeker pins as teal chips (`--cmap-pin-seeker`): `"Looking . 25K / 2BHK . ASAP"`. Uses `AdvancedMarkerElement` same as `ListingPinLayer`. Only visible when `demandViewActive` is true OR user is owner.
- **`panels/SeekerFormPanel.tsx`** — Form with budget slider, BHK selector (multi-select), move-in timing, type, optional note (200 char). Requires auth (`useSession`). On submit, calls `POST /map/seekers`, drops pin at map center (or where user tapped).
- **`hooks/useSeekerPins.ts`** — When viewport changes and seeker layer is active, calls `GET /map/seekers`.

**FloatingToolbar:**

- Enable `seeker` button — click opens `SeekerFormPanel` in SidePanel (tenant only; owners see disabled state)
- Enable `demand` button — toggle that sets `demandViewActive`. When active, listing pins fade to 30% opacity and seeker pins become primary layer. Owner-only feature: check `session.user.role` in component.

**Owner demand view UX:** When `demandViewActive` is true, `ListingPinLayer` applies `opacity: 0.3` to its root markers via `el.style.opacity`. Seeker pins render full opacity. The `BottomBar` switches text to show seeker counts: "12 active seekers in view . Avg budget 22K".

### 3D. Owner Dashboard Widget

**New component:** `apps/web/components/owner/seeker-nearby-widget.tsx` — mirrors `lead-stats-widget.tsx` pattern. Fetches a new endpoint `GET /map/seekers/near-listing?listing_id=X` (returns count + budget range of seekers within 2km of the listing). Rendered in [dashboard-client.tsx](apps/web/components/owner/dashboard-client.tsx) in the Leads tab section.

---

## Phase 4 — AI Locality Insights + Benchmark Tool

### 4A. Backend: `GET /map/locality-insight`

**In `map.service.ts`:** New method `getLocalityInsight(lat, lng, city)`:

1. Reverse-geocode to locality using `localities` table (nearest by lat/lng, or use PostGIS `ST_DWithin` on `listing_locations`)
2. Query stats: active listing count, avg rent by BHK, verified percentage, median days active (from `created_at`), seeker pin density
3. Compute demand score: `(seeker_density * 0.4 + listing_velocity * 0.35 + turnover_speed * 0.25) * 100`
4. Call Azure OpenAI (same pattern as [listing-content-generator.service.ts](apps/api/src/modules/owner/listing-content-generator.service.ts)) with a locality summary prompt. Include `locale` param for Hindi summaries. Cache summary per `(locality_id, locale)` for 1 hour.
5. Fallback: if AI fails within 300ms timeout, return stats-only response with `summary: null`

**Response:** `{ locality_name, summary, stats: { active_listings, avg_rent_2bhk, demand_score, median_days_active, verified_pct }, trend }`

### 4B. Frontend: Locality Insight Card

**State extension:**

- New `PanelContent` variant: `{ type: "locality-insight"; lat: number; lng: number }`
- New action: trigger on cluster click or long-press on empty map area

**New component:** `panels/LocalityInsightCard.tsx` — calls `GET /map/locality-insight?lat=...&lng=...&city=delhi`. Renders the AI summary, stats grid (active listings, verified %, demand score progress bar), avg rent by BHK, trend, and CTAs ("See all listings", "Set Alert").

**Interaction:** Long-press (500ms) on empty map area, or click on a cluster that contains 5+ pins, opens the locality insight panel instead of zooming in.

### 4C. Frontend: Benchmark Tool

**New component:** `overlays/BenchmarkModal.tsx` — a modal (not in SidePanel) accessible from the `BottomBar` via a "Is my rent fair?" link. Fields: locality (autocomplete), BHK, furnishing, current rent. On submit, calls existing `GET /listings/pricing-intel`. Computes position (below/at/above) and shows result with contextual copy per the spec's positioning table.

**No backend work.** Reuses existing `/listings/pricing-intel`.

**CSS:** New `.cmap-modal` class (dark glassmorphism, centered, max-width 420px).

---

## Phase 5 — Alert Zones + Commute Isochrone

### 5A. Backend: `alert_zones` table + endpoints

**Migration:** `infra/migrations/0017_alert_zones.sql` — creates `alert_zones` per spec: `id UUID`, `user_id UUID`, `geom GEOMETRY(Polygon, 4326)`, `label TEXT`, `filters JSONB`, `notify_whatsapp BOOLEAN`, `notify_email BOOLEAN`, `is_active BOOLEAN`, `last_triggered TIMESTAMPTZ`, `created_at TIMESTAMPTZ`. GIST index on `geom`, index on `user_id`.

**Feature flag:** Add `ff_alert_zones_enabled` to [feature-flags.ts](apps/api/src/config/feature-flags.ts).

**Endpoints** in `map.controller.ts`:

- **`POST /map/alert-zones`** (auth: tenant) — saves zone geometry + filters
- **`GET /map/alert-zones`** (auth: tenant) — lists user's zones
- **`DELETE /map/alert-zones/:id`** (auth: tenant) — soft-delete

### 5B. Backend: Alert Zone Worker Job

**In [worker.ts](apps/api/src/worker/worker.ts):** New `runAlertZoneSweep(pool, whatsapp)` running every 6 hours:

```sql
SELECT az.*, u.phone_e164, u.preferred_language
FROM alert_zones az
JOIN users u ON u.id = az.user_id
WHERE az.is_active = true
  AND (az.last_triggered IS NULL OR az.last_triggered < NOW() - INTERVAL '6 hours')
```

For each zone: query new listings created in last 6h within `ST_Within(ll.geo_point, az.geom)` matching stored filters. If count > 0, insert `outbound_events` row with `event_type = 'notification.whatsapp.alert_zone_match'`, template params: `[listing_title, bhk_text, rent, zone_label]`. Update `last_triggered`.

**WhatsApp template:** Add `"tenant.alert_zone_match"` to [notification.templates.ts](apps/api/src/modules/notifications/notification.templates.ts).

### 5C. Frontend: Alert Zone Save + Display

**State extension:**

- New `MapState` field: `alertZones: AlertZone[]`
- New `PanelContent` variant: `{ type: "alert-zone-form" }`
- New actions: `SET_ALERT_ZONES`

**New components:**

- **`overlays/AlertZoneModal.tsx`** — Opens from `AreaStatsPanel`'s "Save as Alert Zone" CTA. Fields: name, BHK filter, max rent, type, verified only, notification preferences (WhatsApp/email). On save: `POST /map/alert-zones` with the drawn rectangle's geometry.
- **`AlertZoneLayer.tsx`** — Fetches `GET /map/alert-zones` on mount (if authenticated). Renders saved zones as translucent rectangles with a bell icon in the center. Uses `google.maps.Rectangle`.
- **`hooks/useAlertZones.ts`** — Manages fetch + state sync.

**Enable "Save as Alert Zone" button** in `AreaStatsPanel` (was disabled placeholder in Phase 2).

### 5D. Frontend: Commute Isochrone Overlay

**New component:** `CommuteOverlay.tsx` — User enters office address via Places autocomplete in a small popover from the TopBar (or a toolbar button). The component:

1. Gets the office lat/lng from Places
2. Filters loaded metro stations to find those reachable within ~25 min transit
3. Draws a 1km radial buffer around each reachable station using `google.maps.Circle` (semi-transparent fill)
4. Union of circles creates an approximate isochrone
5. Listing pins inside the isochrone get a subtle highlight class

This is client-side only, no new backend endpoint. The metro station data from Phase 2 is reused.

---

## Shared Infrastructure Changes

### Extended `useMapState` (all phases)

The `PanelContent` union in [useMapState.tsx](apps/web/components/criblmap/hooks/useMapState.tsx) grows to:

```typescript
export type PanelContent =
  | { type: "listing"; listingId: string }
  | { type: "area-stats" }
  | { type: "seeker-form" }
  | { type: "locality-insight"; lat: number; lng: number }
  | { type: "alert-zone-form" }
  | { type: "none" };
```

New `MapState` fields across all phases: `drawMode`, `drawnBounds`, `areaStats`, `seekerPins`, `demandViewActive`, `alertZones`, `metroVisible`, `commuteOrigin`.

### Extended `FloatingToolbar`

Remove `disabled: true` from each tool as its phase is implemented. Add `onClick` handlers that dispatch appropriate actions. Owner-only tools (`demand`) check session role.

### Extended `map-view.tsx`

Add new layer components (`AreaSelectOverlay`, `MetroOverlayLayer`, `SeekerPinLayer`, `AlertZoneLayer`, `CommuteOverlay`) alongside existing `ListingPinLayer`. SidePanel content switches based on `panelContent.type`.

### i18n

Add CriblMap-specific keys to [i18n.ts](apps/web/lib/i18n.ts) for both English and Hindi: panel titles, button labels, empty states, tooltip strings.

### Feature Flags

Add to [feature-flags.ts](apps/api/src/config/feature-flags.ts):

- `ff_seeker_pins_enabled` (Phase 3)
- `ff_locality_insights_enabled` (Phase 4)
- `ff_alert_zones_enabled` (Phase 5)

---

## New File Tree (Phases 2-5)

```
apps/api/src/modules/map/
  map.module.ts                    Phase 2
  map.controller.ts                Phase 2 (+3, +5 endpoints)
  map.service.ts                   Phase 2 (+3, +4, +5 methods)

infra/migrations/
  0015_metro_stations.sql          Phase 2
  0016_seeker_pins.sql             Phase 3
  0017_alert_zones.sql             Phase 5

data/seeds/
  metro-stations.json              Phase 2

apps/web/components/criblmap/
  AreaSelectOverlay.tsx             Phase 2
  MetroOverlayLayer.tsx            Phase 2
  SeekerPinLayer.tsx               Phase 3
  AlertZoneLayer.tsx               Phase 5
  CommuteOverlay.tsx               Phase 5
  panels/
    AreaStatsPanel.tsx              Phase 2
    SeekerFormPanel.tsx             Phase 3
    LocalityInsightCard.tsx         Phase 4
  overlays/
    AlertZoneModal.tsx              Phase 5
    BenchmarkModal.tsx              Phase 4
  hooks/
    useAreaStats.ts                 Phase 2
    useMetroData.ts                 Phase 2
    useSeekerPins.ts               Phase 3
    useAlertZones.ts                Phase 5

apps/web/components/owner/
  seeker-nearby-widget.tsx          Phase 3
```

---

## Implementation Order (dependency-aware)

Phases can be built strictly sequentially (2 then 3 then 4 then 5), but within each phase the backend and frontend are largely parallelizable. The recommended order within each phase:

- **Phase 2:** Migration + seed data first, then `map.module` + endpoints, then frontend (AreaSelectOverlay + MetroOverlayLayer in parallel)
- **Phase 3:** Migration first, then seeker endpoints, then frontend components, then owner dashboard widget
- **Phase 4:** Locality insight endpoint (depends on Phase 3 seeker density data), then frontend panels + benchmark modal
- **Phase 5:** Migration first, then alert zone CRUD + worker job, then frontend alert + commute components

---

## What Will Remain After All 5 Phases

After implementing everything above, the following items from the original spec will still need attention:

- **Metro station seed data curation** — The `metro-stations.json` needs actual lat/lng coordinates for all ~270 stations across 9 lines (public DMRC/NMRC data needs to be compiled)
- **WhatsApp template approval** — Templates (`alert_zone_match`, `seeker_pin_*`) must be approved in Meta Business Manager before production use
- **Email notification channel** — The spec mentions email alerts for alert zones; the codebase has no email infrastructure yet (only WhatsApp)
- **Distance Matrix API integration** — The commute isochrone in Phase 5 uses a simplified client-side radial buffer; a true travel-time isochrone would need the Google Distance Matrix API for accuracy
- **Owner "seekers near your listing" backend endpoint** — `GET /map/seekers/near-listing` needs implementation in `map.service.ts`
- **Progressive onboarding tooltips** — The spec mentions `OnboardingTooltip.tsx` for feature discovery; not included in the core phases
- **SEO landing pages** — The Benchmark Tool needs dedicated `/rent-calculator` or similar SEO pages to capture organic search traffic
- **Production feature flag tuning** — All new flags default to `false`; needs env configuration per deployment
- **Mobile drag-to-dismiss bottom sheet** — The SidePanel CSS supports mobile bottom sheet but lacks touch drag gesture handling (would need a small gesture library or manual touch events)
