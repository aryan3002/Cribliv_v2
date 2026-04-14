"use client";

import { RectangleHorizontal, TrainFront, MapPinPlus, Flame, Navigation, Bell } from "lucide-react";
import { useMapState, useMapDispatch } from "./hooks/useMapState";

interface FloatingToolbarProps {
  onCommuteClick?: () => void;
}

export function FloatingToolbar({ onCommuteClick }: FloatingToolbarProps) {
  const { panelContent, drawMode, metroVisible, demandViewActive, commuteOrigin } = useMapState();
  const dispatch = useMapDispatch();
  const panelOpen = panelContent.type !== "none";

  const tools = [
    {
      id: "area-stats",
      label: "Stats",
      icon: RectangleHorizontal,
      active: drawMode !== "idle",
      tooltip: "Area Stats — Draw to analyze",
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
      tooltip: metroVisible ? "Hide metro lines" : "Show metro lines",
      onClick: () => dispatch({ type: "TOGGLE_METRO" })
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
          dispatch({ type: "SET_PANEL", panelContent: { type: "seeker-form" } });
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
    }
  ];

  return (
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
  );
}
