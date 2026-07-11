"use client";

import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";

/* ── Types ────────────────────────────────────────────────────────── */

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  title: string;
  monthly_rent: number;
  listing_type: string;
  bhk: number | null;
  verification_status: string;
  furnishing: string | null;
  cover_photo: string | null;
  /** City slug — drives the PG split route /[locale]/pg/[city]/[id] on click. */
  city: string;
  locality: string | null;
  locality_slug: string | null;
  belowMarket?: boolean;
}

export interface MapViewport {
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
}

export interface MapFilters {
  bhk?: number;
  max_rent?: number;
  listing_type?: "flat_house" | "pg";
  verified_only?: boolean;
  near_metro?: boolean;
}

export type PanelContent =
  | { type: "listing"; listingId: string }
  | { type: "area-stats" }
  | { type: "seeker-form" }
  | { type: "locality-insight"; lat: number; lng: number }
  | { type: "alert-zone-form" }
  | { type: "none" };

/* ── Phase 2: Area Stats ─────────────────────────────────────────── */

export interface AreaStatsRow {
  bhk: number;
  count: number;
  avg_rent: number;
  min_rent: number;
  max_rent: number;
  verified_count: number;
}

export interface AreaStatsData {
  total_pins: number;
  by_bhk: AreaStatsRow[];
  verified_count: number;
  verified_pct: number;
  trend: "up" | "down" | "stable";
}

/* ── Phase 3: Seeker Pins ────────────────────────────────────────── */

export interface SeekerPin {
  id: string;
  lat: number;
  lng: number;
  budget_min: number;
  budget_max: number;
  bhk_preference: number[];
  move_in: string;
  listing_type: string;
  note: string | null;
  /** Search radius in metres (100..10000). Drives the circle overlay
   *  rendered around the pin so owners see the actual search area. */
  radius_m: number;
  /** Structured tags extracted from the seeker's note (taxonomy in
   *  `seeker-tags.service.ts` ALLOWED_TAGS). Empty if no note / AI off. */
  tags: string[];
  created_at: string;
  source?: "seeker" | "estimated";
}

/* ── Phase 5: Alert Zones ────────────────────────────────────────── */

export interface AlertZone {
  id: string;
  label: string;
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
  filters: Record<string, unknown>;
  notify_whatsapp: boolean;
  notify_email: boolean;
  is_active: boolean;
  last_triggered: string | null;
  created_at: string;
}

/* ── Commute reverse-search ──────────────────────────────────────── */

export interface LocalityReachability {
  locality_id: number;
  locality_slug: string;
  locality_name: string;
  lat: number;
  lng: number;
  total_minutes: number;
  walk_minutes: number;
  transit_minutes: number;
  via_station_id: number;
  via_station_name: string;
}

/* ── State ────────────────────────────────────────────────────────── */

export type DrawMode = "idle" | "first-corner" | "complete";

export interface MapState {
  viewport: MapViewport | null;
  zoom: number;
  center: { lat: number; lng: number };
  pins: MapPin[];
  selectedPinId: string | null;
  filters: MapFilters;
  panelContent: PanelContent;
  isLoading: boolean;
  // Phase 2
  drawMode: DrawMode;
  drawnBounds: MapViewport | null;
  areaStats: AreaStatsData | null;
  metroVisible: boolean;
  // Phase 3
  seekerPins: SeekerPin[];
  demandViewActive: boolean;
  demandLoading: boolean;
  demandError: string | null;
  /** The pin the seeker is currently placing (drag-to-position). `null`
   *  whenever the Seek panel is closed. Drives the draggable draft marker and
   *  is the coordinate actually submitted — replacing the old behaviour of
   *  always dropping at the map centre (which made every pin land in the same
   *  spot). */
  seekerDraft: { lat: number; lng: number } | null;
  /** Search radius (m) shared between the Seek panel's radius chips and the
   *  on-map draft circle, so the circle resizes live as the seeker changes it. */
  seekerRadiusM: number;
  // Phase 5
  alertZones: AlertZone[];
  commuteOrigin: { lat: number; lng: number; address: string } | null;
  /** City the user is currently exploring (slug, e.g. "delhi", "lucknow"). Drives
   *  city-aware overlays like the metro layer. Defaults from URL `?city=` and
   *  can be updated as the map navigates. */
  city: string;
  /** ID of the listing the user came from (`?listing=` in the URL when
   *  navigating from a listing detail page's "Explore on CriblMap" link).
   *  Drives "X km from this listing" / walking-time overlays. Stays set
   *  for the session — pin clicks now navigate, so this is the only
   *  reliable way to know which listing is the user's "home" reference. */
  originatingListingId: string | null;
  /** "Where Should I Live?" reverse-search — max acceptable commute (min). */
  commuteMaxMinutes: number;
  /** Per-locality reachability for the current office. `null` until the
   *  user enters an office and the API responds; `[]` means "we have data
   *  but no localities match" (e.g. unsupported city). */
  commuteReachability: LocalityReachability[] | null;
  /** Fetch-time error for the reachability call (404, 5xx, network drop).
   *  Distinguished from `commuteReachability === []` so the UI can show
   *  "service unavailable" instead of misleading "city has no metro." */
  commuteReachabilityError: string | null;
}

/* ── Actions ──────────────────────────────────────────────────────── */

export type MapAction =
  | {
      type: "SET_VIEWPORT";
      viewport: MapViewport;
      zoom: number;
      center: { lat: number; lng: number };
    }
  | { type: "SET_PINS"; pins: MapPin[] }
  | { type: "SELECT_PIN"; pinId: string }
  | { type: "DESELECT_PIN" }
  | { type: "SET_FILTERS"; filters: MapFilters }
  | { type: "SET_PANEL"; panelContent: PanelContent }
  | { type: "SET_LOADING"; isLoading: boolean }
  // Phase 2: Draw mode
  | { type: "START_DRAW" }
  | { type: "SET_FIRST_CORNER"; lat: number; lng: number }
  | { type: "COMPLETE_DRAW"; bounds: MapViewport }
  | { type: "CLEAR_DRAW" }
  | { type: "SET_AREA_STATS"; stats: AreaStatsData | null }
  | { type: "TOGGLE_METRO" }
  // Phase 3: Seekers
  | { type: "SET_SEEKER_PINS"; pins: SeekerPin[] }
  | { type: "SET_DEMAND_LOADING"; isLoading: boolean }
  | { type: "SET_DEMAND_ERROR"; error: string | null }
  | { type: "TOGGLE_DEMAND_VIEW" }
  | { type: "START_SEEKER_DRAFT"; center: { lat: number; lng: number } }
  | { type: "ENSURE_SEEKER_DRAFT"; center: { lat: number; lng: number } }
  | { type: "SET_SEEKER_DRAFT_POSITION"; lat: number; lng: number }
  | { type: "SET_SEEKER_RADIUS"; radiusM: number }
  // Phase 5: Alerts & Commute
  | { type: "SET_ALERT_ZONES"; zones: AlertZone[] }
  | { type: "SET_COMMUTE_ORIGIN"; origin: { lat: number; lng: number; address: string } | null }
  | { type: "SET_CITY"; city: string }
  | { type: "SET_COMMUTE_MAX_MINUTES"; minutes: number }
  | { type: "SET_COMMUTE_REACHABILITY"; reachability: LocalityReachability[] | null }
  | { type: "SET_COMMUTE_REACHABILITY_ERROR"; error: string | null };

/* ── Reducer ──────────────────────────────────────────────────────── */

export const initialMapState: MapState = {
  viewport: null,
  zoom: 11,
  center: { lat: 28.6139, lng: 77.209 },
  pins: [],
  selectedPinId: null,
  filters: {},
  panelContent: { type: "none" },
  isLoading: false,
  drawMode: "idle",
  drawnBounds: null,
  areaStats: null,
  metroVisible: false,
  seekerPins: [],
  demandViewActive: false,
  demandLoading: false,
  demandError: null,
  seekerDraft: null,
  seekerRadiusM: 1000,
  alertZones: [],
  commuteOrigin: null,
  city: "delhi",
  originatingListingId: null,
  commuteMaxMinutes: 45,
  commuteReachability: null,
  commuteReachabilityError: null
};

export function mapReducer(state: MapState, action: MapAction): MapState {
  switch (action.type) {
    case "SET_VIEWPORT":
      return { ...state, viewport: action.viewport, zoom: action.zoom, center: action.center };

    case "SET_PINS": {
      const selectedPinStillVisible = state.selectedPinId
        ? action.pins.some((pin) => pin.id === state.selectedPinId)
        : true;
      return {
        ...state,
        pins: action.pins,
        selectedPinId: selectedPinStillVisible ? state.selectedPinId : null,
        panelContent:
          selectedPinStillVisible || state.panelContent.type !== "listing"
            ? state.panelContent
            : { type: "none" },
        isLoading: false
      };
    }

    case "SELECT_PIN":
      return {
        ...state,
        selectedPinId: action.pinId,
        panelContent: { type: "listing", listingId: action.pinId }
      };

    case "DESELECT_PIN":
      // Closing the panel (incl. the Seek toolbar toggle) discards the draft
      // so the next Seek starts fresh at the map centre.
      return { ...state, selectedPinId: null, panelContent: { type: "none" }, seekerDraft: null };

    case "SET_FILTERS":
      return { ...state, filters: action.filters };

    case "SET_PANEL":
      // Any panel other than the seeker form abandons an in-progress draft pin.
      return {
        ...state,
        panelContent: action.panelContent,
        seekerDraft: action.panelContent.type === "seeker-form" ? state.seekerDraft : null
      };

    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };

    // Phase 2: Draw mode
    case "START_DRAW":
      return {
        ...state,
        drawMode: "first-corner",
        drawnBounds: null,
        areaStats: null,
        panelContent: { type: "none" },
        selectedPinId: null
      };

    case "SET_FIRST_CORNER":
      return {
        ...state,
        drawMode: "first-corner",
        drawnBounds: {
          sw_lat: action.lat,
          sw_lng: action.lng,
          ne_lat: action.lat,
          ne_lng: action.lng
        }
      };

    case "COMPLETE_DRAW":
      return {
        ...state,
        drawMode: "complete",
        drawnBounds: action.bounds,
        panelContent: { type: "area-stats" }
      };

    case "CLEAR_DRAW":
      return {
        ...state,
        drawMode: "idle",
        drawnBounds: null,
        areaStats: null,
        panelContent: { type: "none" }
      };

    case "SET_AREA_STATS":
      return { ...state, areaStats: action.stats };

    case "TOGGLE_METRO":
      return { ...state, metroVisible: !state.metroVisible };

    // Phase 3
    case "SET_SEEKER_PINS":
      return { ...state, seekerPins: action.pins, demandLoading: false, demandError: null };

    case "SET_DEMAND_LOADING":
      return { ...state, demandLoading: action.isLoading };

    case "SET_DEMAND_ERROR":
      return {
        ...state,
        seekerPins: [],
        demandLoading: false,
        demandError: action.error
      };

    case "TOGGLE_DEMAND_VIEW":
      return state.demandViewActive
        ? {
            ...state,
            demandViewActive: false,
            seekerPins: [],
            demandLoading: false,
            demandError: null
          }
        : { ...state, demandViewActive: true, demandError: null };

    case "START_SEEKER_DRAFT":
      return {
        ...state,
        seekerDraft: { lat: action.center.lat, lng: action.center.lng },
        panelContent: { type: "seeker-form" },
        selectedPinId: null
      };

    case "ENSURE_SEEKER_DRAFT":
      // Idempotent seed used by the panel on mount: only drops a draft if one
      // isn't already placed, so it can never clobber a position the seeker
      // has already dragged to (the reducer checks live state, dodging the
      // stale-closure race a mount effect would otherwise hit).
      return state.seekerDraft
        ? state
        : { ...state, seekerDraft: { lat: action.center.lat, lng: action.center.lng } };

    case "SET_SEEKER_DRAFT_POSITION":
      return { ...state, seekerDraft: { lat: action.lat, lng: action.lng } };

    case "SET_SEEKER_RADIUS":
      return { ...state, seekerRadiusM: action.radiusM };

    // Phase 5
    case "SET_ALERT_ZONES":
      return { ...state, alertZones: action.zones };

    case "SET_COMMUTE_ORIGIN":
      // Clearing the origin also wipes derived reachability AND any stale
      // error — otherwise the heatmap or error banner lingers after the
      // user removed their office.
      return {
        ...state,
        commuteOrigin: action.origin,
        commuteReachability: action.origin == null ? null : state.commuteReachability,
        commuteReachabilityError: action.origin == null ? null : state.commuteReachabilityError
      };

    case "SET_CITY":
      return { ...state, city: action.city };

    case "SET_COMMUTE_MAX_MINUTES":
      return { ...state, commuteMaxMinutes: action.minutes };

    case "SET_COMMUTE_REACHABILITY":
      // Clear any stale error when a successful response lands.
      return {
        ...state,
        commuteReachability: action.reachability,
        commuteReachabilityError: null
      };

    case "SET_COMMUTE_REACHABILITY_ERROR":
      // When the request fails, also wipe stale reachability data so the
      // UI can't accidentally render half-loaded results.
      return {
        ...state,
        commuteReachability: null,
        commuteReachabilityError: action.error
      };

    default:
      return state;
  }
}

/* ── Context ──────────────────────────────────────────────────────── */

const MapStateContext = createContext<MapState>(initialMapState);
const MapDispatchContext = createContext<Dispatch<MapAction>>(() => {});

export function MapStateProvider({
  children,
  initialFilters,
  initialCity,
  initialOriginatingListingId
}: {
  children: ReactNode;
  initialFilters?: MapFilters;
  initialCity?: string;
  initialOriginatingListingId?: string | null;
}) {
  const [state, dispatch] = useReducer(mapReducer, {
    ...initialMapState,
    filters: initialFilters ?? {},
    city: initialCity ?? initialMapState.city,
    originatingListingId: initialOriginatingListingId ?? null
  });

  return (
    <MapStateContext.Provider value={state}>
      <MapDispatchContext.Provider value={dispatch}>{children}</MapDispatchContext.Provider>
    </MapStateContext.Provider>
  );
}

export function useMapState() {
  return useContext(MapStateContext);
}

export function useMapDispatch() {
  return useContext(MapDispatchContext);
}
