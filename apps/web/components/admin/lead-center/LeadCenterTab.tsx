"use client";

import { useState } from "react";
import { EmptyState } from "../primitives/EmptyState";
import { LeadBoard } from "./LeadBoard";

interface Props {
  accessToken: string;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

type LeadCenterView = "board" | "analytics";

export function LeadCenterTab({ accessToken, onCountChange, onToast }: Props) {
  const [view, setView] = useState<LeadCenterView>("board");

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Lead Center</h1>
        <span className="admin-page-title__sub">Live callback board &amp; funnel analytics</span>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className="admin-chip"
          aria-pressed={view === "board"}
          onClick={() => setView("board")}
        >
          Board
        </button>
        <button
          type="button"
          className="admin-chip"
          aria-pressed={view === "analytics"}
          onClick={() => setView("analytics")}
        >
          Analytics
        </button>
      </div>

      {view === "board" ? (
        <LeadBoard accessToken={accessToken} onCountChange={onCountChange} onToast={onToast} />
      ) : (
        <EmptyState
          title="Lead analytics coming soon"
          hint="Funnel + engagement charts and the per-owner rollup land in Task 4."
        />
      )}
    </div>
  );
}
