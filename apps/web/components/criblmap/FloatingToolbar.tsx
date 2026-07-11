"use client";

import { useEffect, useRef, useState } from "react";
import {
  RectangleHorizontal,
  TrainFront,
  MapPinPlus,
  Flame,
  Navigation,
  Bell,
  Info
} from "lucide-react";
import { useMapState, useMapDispatch } from "./hooks/useMapState";
import { useMetroData } from "./hooks/useMetroData";

interface FloatingToolbarProps {
  onCommuteClick?: () => void;
}

function prettyCity(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function FloatingToolbar({ onCommuteClick }: FloatingToolbarProps) {
  const { panelContent, drawMode, metroVisible, demandViewActive, commuteOrigin, center } =
    useMapState();
  const dispatch = useMapDispatch();
  const panelOpen = panelContent.type !== "none" && panelContent.type !== "listing";

  // City-aware metro data — drives "Metro lines coming soon for {city}" feedback
  // when the toggle would otherwise no-op silently in cities with no seeded data.
  const { loading: metroLoading, supported: metroSupported, city } = useMetroData();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function flashToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  function handleMetroClick() {
    // Toggling off — no city-availability check.
    if (metroVisible) {
      dispatch({ type: "TOGGLE_METRO" });
      return;
    }
    // Loading — optimistic toggle; the layer will render once data lands.
    if (metroLoading) {
      dispatch({ type: "TOGGLE_METRO" });
      return;
    }
    // Loaded but empty → unsupported city. Flash a toast and skip toggling so
    // the button doesn't get stuck in an active state while showing nothing.
    if (!metroSupported) {
      flashToast(`Metro lines coming soon for ${prettyCity(city)}.`);
      return;
    }
    dispatch({ type: "TOGGLE_METRO" });
  }

  const tools = [
    {
      id: "area-stats",
      label: "Stats",
      icon: RectangleHorizontal,
      active: drawMode !== "idle",
      tooltip: "Area Stats: Draw to analyze",
      onClick: () => {
        if (drawMode !== "idle") {
          dispatch({ type: "CLEAR_DRAW" });
        } else {
          dispatch({ type: "START_DRAW" });
        }
      }
    },
    {
      id: "metro",
      label: "Metro",
      icon: TrainFront,
      active: metroVisible,
      tooltip: metroVisible
        ? "Hide metro lines"
        : metroSupported || metroLoading
          ? "Show metro lines"
          : `Metro lines coming soon for ${prettyCity(city)}`,
      onClick: handleMetroClick
    },
    {
      id: "seeker",
      label: "Seek",
      icon: MapPinPlus,
      active: panelContent.type === "seeker-form",
      tooltip: "Drop a search pin",
      onClick: () => {
        if (panelContent.type === "seeker-form") {
          dispatch({ type: "DESELECT_PIN" });
        } else {
          // Opening Seek drops the draft pin at the current map centre; the
          // seeker then drags it or taps the map to choose the real spot.
          dispatch({ type: "START_SEEKER_DRAFT", center });
        }
      }
    },
    {
      id: "demand",
      label: "Demand",
      icon: Flame,
      active: demandViewActive,
      tooltip: demandViewActive ? "Hide demand view" : "Show seeker demand",
      onClick: () => dispatch({ type: "TOGGLE_DEMAND_VIEW" })
    },
    {
      id: "commute",
      label: "Commute",
      icon: Navigation,
      active: !!commuteOrigin,
      tooltip: commuteOrigin ? "Clear commute overlay" : "Set office for commute",
      onClick: () => {
        if (commuteOrigin) {
          dispatch({ type: "SET_COMMUTE_ORIGIN", origin: null });
        } else {
          onCommuteClick?.();
        }
      }
    },
    {
      id: "insight",
      label: "Insight",
      icon: Info,
      active: panelContent.type === "locality-insight",
      tooltip:
        panelContent.type === "locality-insight"
          ? "Close locality insight"
          : "Locality insight (or right-click anywhere on the map)",
      onClick: () => {
        if (panelContent.type === "locality-insight") {
          dispatch({ type: "SET_PANEL", panelContent: { type: "none" } });
        } else {
          dispatch({
            type: "SET_PANEL",
            panelContent: { type: "locality-insight", lat: center.lat, lng: center.lng }
          });
        }
      }
    }
  ];

  return (
    <>
      <div className={`cmap-toolbar${panelOpen ? " cmap-toolbar--panel-open" : ""}`}>
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`cmap-toolbar__btn${tool.active ? " cmap-toolbar__btn--active" : ""}`}
            title={tool.tooltip}
            aria-label={tool.tooltip}
            onClick={tool.onClick}
          >
            <tool.icon size={18} />
            <span className="cmap-toolbar__btn-label">{tool.label}</span>
          </button>
        ))}
      </div>
      {toast && (
        <div className="cmap-toolbar-toast" role="status" aria-live="polite">
          <Bell size={14} aria-hidden="true" />
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}
