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
  created_at: string;
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
  // Phase 5
  alertZones: AlertZone[];
  commuteOrigin: { lat: number; lng: number; address: string } | null;
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
  | { type: "TOGGLE_DEMAND_VIEW" }
  // Phase 5: Alerts & Commute
  | { type: "SET_ALERT_ZONES"; zones: AlertZone[] }
  | { type: "SET_COMMUTE_ORIGIN"; origin: { lat: number; lng: number; address: string } | null };

/* ── Reducer ──────────────────────────────────────────────────────── */

const initialState: MapState = {
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
  alertZones: [],
  commuteOrigin: null
};

function mapReducer(state: MapState, action: MapAction): MapState {
  switch (action.type) {
    case "SET_VIEWPORT":
      return { ...state, viewport: action.viewport, zoom: action.zoom, center: action.center };

    case "SET_PINS":
      return { ...state, pins: action.pins, isLoading: false };

    case "SELECT_PIN":
      return {
        ...state,
        selectedPinId: action.pinId,
        panelContent: { type: "listing", listingId: action.pinId }
      };

    case "DESELECT_PIN":
      return { ...state, selectedPinId: null, panelContent: { type: "none" } };

    case "SET_FILTERS":
      return { ...state, filters: action.filters };

    case "SET_PANEL":
      return { ...state, panelContent: action.panelContent };

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
      return { ...state, seekerPins: action.pins };

    case "TOGGLE_DEMAND_VIEW":
      return { ...state, demandViewActive: !state.demandViewActive };

    // Phase 5
    case "SET_ALERT_ZONES":
      return { ...state, alertZones: action.zones };

    case "SET_COMMUTE_ORIGIN":
      return { ...state, commuteOrigin: action.origin };

    default:
      return state;
  }
}

/* ── Context ──────────────────────────────────────────────────────── */

const MapStateContext = createContext<MapState>(initialState);
const MapDispatchContext = createContext<Dispatch<MapAction>>(() => {});

export function MapStateProvider({
  children,
  initialFilters
}: {
  children: ReactNode;
  initialFilters?: MapFilters;
}) {
  const [state, dispatch] = useReducer(mapReducer, {
    ...initialState,
    filters: initialFilters ?? {}
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
