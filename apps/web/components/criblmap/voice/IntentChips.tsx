"use client";
import type { IntentChip } from "../../../lib/map-intent-types";
import "./voice-map.css";

export function IntentChips({
  chips,
  onBell
}: {
  chips: IntentChip[];
  onBell: (chip: IntentChip) => void;
}) {
  return (
    <div className="mv-chiprow">
      {chips.map((chip, i) =>
        chip.status === "applied" ? (
          <span key={i} className="mv-chip mv-chip--on">
            {chip.label}
          </span>
        ) : (
          <button
            key={i}
            type="button"
            className="mv-chip mv-chip--struck"
            aria-label={`${chip.label} — ${chip.reason ?? "not available"}. Notify me.`}
            onClick={() => onBell(chip)}
          >
            <span className="mv-chip__label">{chip.label}</span>
            <span aria-hidden>🔔</span>
          </button>
        )
      )}
    </div>
  );
}
