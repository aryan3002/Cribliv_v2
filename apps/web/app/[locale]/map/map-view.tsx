"use client";

import { useState, useCallback, useEffect } from "react";
import { CriblMapCanvas } from "../../../components/criblmap/CriblMapCanvas";
import { ListingPinLayer } from "../../../components/criblmap/ListingPinLayer";
import { TopBar } from "../../../components/criblmap/TopBar";
import { MapResultsRail } from "../../../components/criblmap/MapResultsRail";
import { SidePanel } from "../../../components/criblmap/panels/SidePanel";
import { AreaStatsPanel } from "../../../components/criblmap/panels/AreaStatsPanel";
import { SeekerFormPanel } from "../../../components/criblmap/panels/SeekerFormPanel";
import { LocalityInsightCard } from "../../../components/criblmap/panels/LocalityInsightCard";
import { FloatingToolbar } from "../../../components/criblmap/FloatingToolbar";
import { BottomBar } from "../../../components/criblmap/BottomBar";
import { AreaSelectOverlay } from "../../../components/criblmap/AreaSelectOverlay";
import { MetroOverlayLayer } from "../../../components/criblmap/MetroOverlayLayer";
import { SeekerPinLayer } from "../../../components/criblmap/SeekerPinLayer";
import { SeekerDraftLayer } from "../../../components/criblmap/SeekerDraftLayer";
import { AlertZoneLayer } from "../../../components/criblmap/AlertZoneLayer";
import { CommuteOverlay } from "../../../components/criblmap/CommuteOverlay";
import { CommuteReachabilityLayer } from "../../../components/criblmap/CommuteReachabilityLayer";
import { BenchmarkModal } from "../../../components/criblmap/overlays/BenchmarkModal";
import { AlertZoneModal } from "../../../components/criblmap/overlays/AlertZoneModal";
import {
  FilterDrawer,
  FilterDrawerTrigger
} from "../../../components/criblmap/overlays/FilterDrawer";
import { DemandHeatmapLayer } from "../../../components/criblmap/DemandHeatmapLayer";
import { useMapState, useMapDispatch } from "../../../components/criblmap/hooks/useMapState";
import { useMapPins } from "../../../components/criblmap/hooks/useMapPins";
import { useSeekerPins } from "../../../components/criblmap/hooks/useSeekerPins";
import { useAlertZones, useMapAccessToken } from "../../../components/criblmap/hooks/useAlertZones";

interface MapViewProps {
  locale: string;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
}

function getPanelTitle(type: string): string {
  switch (type) {
    case "area-stats":
      return "Area Statistics";
    case "seeker-form":
      return "Drop Search Pin";
    case "locality-insight":
      return "Locality Insight";
    case "alert-zone-form":
      return "Alert Zone";
    default:
      return "Details";
  }
}

export function MapView({ locale, initialCenter, initialZoom }: MapViewProps) {
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const { isLoading, pins, panelContent, drawMode, selectedPinId } = useMapState();
  const dispatch = useMapDispatch();

  const [showBenchmark, setShowBenchmark] = useState(false);
  const [showAlertZone, setShowAlertZone] = useState(false);
  const [showCommuteInput, setShowCommuteInput] = useState(false);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const { token: accessToken } = useMapAccessToken();

  useMapPins();
  useSeekerPins();
  useAlertZones(accessToken);

  const handleMapReady = useCallback((map: google.maps.Map) => {
    setMapInstance(map);
  }, []);

  const handlePlaceSelect = useCallback(
    (lat: number, lng: number) => {
      if (mapInstance) {
        mapInstance.panTo({ lat, lng });
        mapInstance.setZoom(14);
      }
    },
    [mapInstance]
  );

  // Right-click on the map → locality insight for that exact point.
  // (The old long-press handler fought with map drag — every pan over 600ms
  // popped the panel. Right-click is intentional, doesn't conflict with
  // drag, and uses the precise clicked coordinate.)
  useEffect(() => {
    if (!mapInstance) return;
    const listener = mapInstance.addListener("rightclick", (e: google.maps.MapMouseEvent) => {
      if (drawMode !== "idle") return;
      if (!e.latLng) return;
      dispatch({
        type: "SET_PANEL",
        panelContent: {
          type: "locality-insight",
          lat: e.latLng.lat(),
          lng: e.latLng.lng()
        }
      });
    });
    return () => listener.remove();
  }, [mapInstance, drawMode, dispatch]);

  useEffect(() => {
    if (!mapInstance) return;
    const listener = mapInstance.addListener("click", (e: google.maps.MapMouseEvent) => {
      // While placing a search pin, a map tap repositions the draft — the whole
      // point of the fix (the pin follows where you click, not the map centre).
      if (panelContent.type === "seeker-form" && drawMode === "idle") {
        if (e.latLng) {
          dispatch({
            type: "SET_SEEKER_DRAFT_POSITION",
            lat: e.latLng.lat(),
            lng: e.latLng.lng()
          });
        }
        return;
      }
      if (selectedPinId) dispatch({ type: "DESELECT_PIN" });
    });
    return () => listener.remove();
  }, [mapInstance, selectedPinId, panelContent.type, drawMode, dispatch]);

  // Alert zone modal trigger from AreaStatsPanel
  useEffect(() => {
    if (panelContent.type === "alert-zone-form" && !showAlertZone) {
      setShowAlertZone(true);
      dispatch({ type: "SET_PANEL", panelContent: { type: "area-stats" } });
    }
  }, [panelContent.type, showAlertZone, dispatch]);

  return (
    <div className="criblmap-root">
      <CriblMapCanvas
        onMapReady={handleMapReady}
        initialCenter={initialCenter}
        initialZoom={initialZoom}
      />

      {/* Map layers */}
      <ListingPinLayer map={mapInstance} locale={locale} />
      <AreaSelectOverlay map={mapInstance} />
      <MetroOverlayLayer map={mapInstance} />
      <SeekerPinLayer map={mapInstance} />
      <SeekerDraftLayer map={mapInstance} />
      <AlertZoneLayer map={mapInstance} />
      <CommuteOverlay
        map={mapInstance}
        showInput={showCommuteInput}
        onCloseInput={() => setShowCommuteInput(false)}
      />
      <CommuteReachabilityLayer map={mapInstance} />
      <DemandHeatmapLayer map={mapInstance} />

      {/* Draw mode instruction overlay */}
      {drawMode === "first-corner" && (
        <div className="cmap-draw-instruction">
          <span>Tap two corners to define your area</span>
        </div>
      )}

      {/* Seeker pin placement hint */}
      {panelContent.type === "seeker-form" && drawMode === "idle" && (
        <div className="cmap-draw-instruction">
          <span>Drag the pin or tap the map to set your search spot</span>
        </div>
      )}

      <TopBar locale={locale} onPlaceSelect={handlePlaceSelect} />
      <MapResultsRail locale={locale} map={mapInstance} />

      {isLoading && pins.length === 0 && (
        <div className="cmap-loading">
          <span className="cmap-loading__dot" />
          <span className="cmap-loading__dot" />
          <span className="cmap-loading__dot" />
          Loading listings...
        </div>
      )}

      {/* Side panel with dynamic content. NOTE: the "listing" case is no
          longer rendered — clicking a pin now navigates to /listing/[id]
          directly via ListingPinLayer. ListingDetailPanel is left in the tree
          so we can revive an in-map preview pattern later if we want to. */}
      {panelContent.type !== "none" &&
        panelContent.type !== "alert-zone-form" &&
        panelContent.type !== "listing" && (
          <SidePanel title={getPanelTitle(panelContent.type)}>
            {panelContent.type === "area-stats" && <AreaStatsPanel />}
            {panelContent.type === "seeker-form" && <SeekerFormPanel locale={locale} />}
            {panelContent.type === "locality-insight" && <LocalityInsightCard locale={locale} />}
          </SidePanel>
        )}

      <FloatingToolbar onCommuteClick={() => setShowCommuteInput(true)} />
      <BottomBar onBenchmarkClick={() => setShowBenchmark(true)} />

      {/* Modals */}
      {showBenchmark && <BenchmarkModal onClose={() => setShowBenchmark(false)} />}
      {showAlertZone && (
        <AlertZoneModal
          accessToken={accessToken}
          locale={locale}
          onClose={() => setShowAlertZone(false)}
        />
      )}
      <FilterDrawer open={showFilterDrawer} onClose={() => setShowFilterDrawer(false)} />

      {/* Mobile filter trigger */}
      <FilterDrawerTrigger onClick={() => setShowFilterDrawer(true)} />
    </div>
  );
}
