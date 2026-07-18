"use client";
import type { Door } from "../../../lib/map-negotiation";
import "./voice-map.css";

export function NegotiationDoors({
  doors,
  onPick
}: {
  doors: Door[];
  onPick: (door: Door) => void;
}) {
  return (
    <div className="mv-doors">
      {doors.map((door) => (
        <button
          key={door.id}
          type="button"
          className={door.id === "subscribe" ? "mv-door mv-door--bell" : "mv-door"}
          onClick={() => onPick(door)}
        >
          <span>{door.label}</span>
          {door.id !== "subscribe" && (
            <>
              {door.isEstimate ? (
                <span className="mv-door__hint">see how many</span>
              ) : (
                <span className="mv-door__gain">+{door.gain} homes</span>
              )}
            </>
          )}
          {door.id === "subscribe" && <span aria-hidden>🔔</span>}
        </button>
      ))}
    </div>
  );
}
