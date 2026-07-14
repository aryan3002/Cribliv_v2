"use client";

import { useState } from "react";

export interface DecisionAction {
  key: string;
  label: string;
  variant: "primary" | "danger" | "ghost";
  requiresReason?: boolean;
}

export function DecisionBar({
  actions,
  busy,
  onDecide
}: {
  actions: DecisionAction[];
  busy: string | null;
  onDecide: (key: string, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        background: "var(--ad-surface)",
        borderTop: "1px solid var(--ad-border)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8
      }}
    >
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required for reject / pause / fail)"
        style={{
          width: "100%",
          minHeight: 64,
          padding: 10,
          border: "1px solid var(--ad-border)",
          borderRadius: "var(--ad-radius-sm)",
          fontFamily: "inherit",
          fontSize: 13,
          resize: "vertical"
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`admin-btn admin-btn--${a.variant}`}
            disabled={!!busy}
            onClick={() => onDecide(a.key, reason.trim())}
          >
            {busy === a.key ? "…" : a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
