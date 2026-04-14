"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { CriblMapCanvas } from "../../../components/criblmap/CriblMapCanvas";
import { ListingPinLayer } from "../../../components/criblmap/ListingPinLayer";
import { TopBar } from "../../../components/criblmap/TopBar";
import { SidePanel } from "../../../components/criblmap/panels/SidePanel";
import { ListingDetailPanel } from "../../../components/criblmap/panels/ListingDetailPanel";
import { AreaStatsPanel } from "../../../components/criblmap/panels/AreaStatsPanel";
import { SeekerFormPanel } from "../../../components/criblmap/panels/SeekerFormPanel";
import { LocalityInsightCard } from "../../../components/criblmap/panels/LocalityInsightCard";
import { FloatingToolbar } from "../../../components/criblmap/FloatingToolbar";
import { BottomBar } from "../../../components/criblmap/BottomBar";
import { AreaSelectOverlay } from "../../../components/criblmap/AreaSelectOverlay";
import { MetroOverlayLayer } from "../../../components/criblmap/MetroOverlayLayer";
import { SeekerPinLayer } from "../../../components/criblmap/SeekerPinLayer";
import { AlertZoneLayer } from "../../../components/criblmap/AlertZoneLayer";
import { CommuteOverlay } from "../../../components/criblmap/CommuteOverlay";
import { BenchmarkModal } from "../../../components/criblmap/overlays/BenchmarkModal";
import { AlertZoneModal } from "../../../components/criblmap/overlays/AlertZoneModal";
import { useMapState, useMapDispatch } from "../../../components/criblmap/hooks/useMapState";
import { useMapPins } from "../../../components/criblmap/hooks/useMapPins";
import { useSeekerPins } from "../../../components/criblmap/hooks/useSeekerPins";

interface MapViewProps {
  locale: string;
}

function getPanelTitle(type: string): string {
  switch (type) {
    case "listing":
      return "Listing Details";
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

export function MapView({ locale }: MapViewProps) {
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const { isLoading, pins, panelContent, drawMode, demandViewActive } = useMapState();
  const dispatch = useMapDispatch();

  const [showBenchmark, setShowBenchmark] = useState(false);
  const [showAlertZone, setShowAlertZone] = useState(false);
  const [showCommuteInput, setShowCommuteInput] = useState(false);

  useMapPins();
  useSeekerPins();

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

  // Long-press for locality insight
  const longPressRef = useRef<ReturnType<typeof setTimeout>>();
  const handleMapMouseDown = useCallback(() => {
    if (drawMode !== "idle") return;
    longPressRef.current = setTimeout(() => {
      if (mapInstance) {
        const center = mapInstance.getCenter();
        if (center) {
          dispatch({
            type: "SET_PANEL",
            panelContent: {
              type: "locality-insight",
              lat: center.lat(),
              lng: center.lng()
            }
          });
        }
      }
    }, 600);
  }, [mapInstance, drawMode, dispatch]);

  const handleMapMouseUp = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
    }
  }, []);

  // Alert zone modal trigger from AreaStatsPanel
  useEffect(() => {
    if (panelContent.type === "alert-zone-form" && !showAlertZone) {
      setShowAlertZone(true);
      dispatch({ type: "SET_PANEL", panelContent: { type: "area-stats" } });
    }
  }, [panelContent.type, showAlertZone, dispatch]);

  return (
    <div
      className="criblmap-root"
      onMouseDown={handleMapMouseDown}
      onMouseUp={handleMapMouseUp}
      onTouchStart={handleMapMouseDown}
      onTouchEnd={handleMapMouseUp}
    >
      <CriblMapCanvas onMapReady={handleMapReady} />

      {/* Map layers */}
      <ListingPinLayer map={mapInstance} />
      <AreaSelectOverlay map={mapInstance} />
      <MetroOverlayLayer map={mapInstance} />
      <SeekerPinLayer map={mapInstance} />
      <AlertZoneLayer map={mapInstance} />
      <CommuteOverlay
        map={mapInstance}
        showInput={showCommuteInput}
        onCloseInput={() => setShowCommuteInput(false)}
      />

      {/* Draw mode instruction overlay */}
      {drawMode === "first-corner" && (
        <div className="cmap-draw-instruction">
          <span>Tap two corners to define your area</span>
        </div>
      )}

      <TopBar locale={locale} onPlaceSelect={handlePlaceSelect} />

      {isLoading && pins.length === 0 && (
        <div className="cmap-loading">
          <span className="cmap-loading__dot" />
          <span className="cmap-loading__dot" />
          <span className="cmap-loading__dot" />
          Loading listings...
        </div>
      )}

      {!isLoading && pins.length === 0 && drawMode === "idle" && (
        <div className="cmap-empty">
          <div className="cmap-empty__title">No listings in this area</div>
          <div className="cmap-empty__desc">
            Try zooming out or adjusting your filters to find verified rentals nearby.
          </div>
        </div>
      )}

      {/* Side panel with dynamic content */}
      {panelContent.type !== "none" && panelContent.type !== "alert-zone-form" && (
        <SidePanel title={getPanelTitle(panelContent.type)}>
          {panelContent.type === "listing" && <ListingDetailPanel locale={locale} />}
          {panelContent.type === "area-stats" && <AreaStatsPanel />}
          {panelContent.type === "seeker-form" && <SeekerFormPanel locale={locale} />}
          {panelContent.type === "locality-insight" && <LocalityInsightCard locale={locale} />}
        </SidePanel>
      )}

      <FloatingToolbar onCommuteClick={() => setShowCommuteInput(true)} />
      <BottomBar onBenchmarkClick={() => setShowBenchmark(true)} />

      {/* Modals */}
      {showBenchmark && <BenchmarkModal onClose={() => setShowBenchmark(false)} />}
      {showAlertZone && <AlertZoneModal onClose={() => setShowAlertZone(false)} />}
    </div>
  );
}
