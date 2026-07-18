"use client";
import type { ReactNode } from "react";
import "./voice-map.css";

export type Snap = "peek" | "half" | "full";
const NEXT: Record<Snap, Snap> = { peek: "half", half: "full", full: "peek" };

export function MapResultsSheet({
  mayaLine,
  snap,
  onSnapChange,
  children
}: {
  mayaLine: string;
  snap: Snap;
  onSnapChange: (s: Snap) => void;
  children?: ReactNode;
}) {
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
