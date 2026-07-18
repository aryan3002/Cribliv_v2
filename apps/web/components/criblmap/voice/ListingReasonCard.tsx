"use client";
import type { MapPin } from "../hooks/useMapState";
import type { IntentChip } from "../../../lib/map-intent-types";
import "./voice-map.css";

export interface LedgerRow {
  ok: boolean;
  text: string;
}

export function buildReasonLedger(pin: MapPin, chips: IntentChip[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const chip of chips) {
    const said = chip.quotedSource ? `"${chip.quotedSource}"` : chip.label;
    if (chip.status === "applied") {
      rows.push({ ok: true, text: `${chip.label}, matching ${said}` });
    } else {
      rows.push({
        ok: false,
        text: `No ${chip.label} — you asked for it; this one doesn't have it`
      });
    }
  }
  return rows;
}

export function ListingReasonCard({
  pin,
  chips,
  onUnlock
}: {
  pin: MapPin;
  chips: IntentChip[];
  onUnlock: () => void;
}) {
  const rows = buildReasonLedger(pin, chips);
  return (
    <div className="mv-card">
      <div className="mv-card__head">
        <span className="mv-card__price">₹{pin.monthly_rent.toLocaleString("en-IN")}</span>
        <span className="mv-card__meta">
          {pin.bhk ? `${pin.bhk} BHK` : ""} · {pin.locality ?? ""}
        </span>
        {pin.verification_status === "verified" && (
          <span className="mv-card__verified">✓ Verified</span>
        )}
      </div>
      <ul className="mv-ledger">
        {rows.map((r, i) => (
          <li key={i} className={r.ok ? "mv-ledger__ok" : "mv-ledger__no"}>
            <span aria-hidden>{r.ok ? "✓" : "✕"}</span> {r.text}
          </li>
        ))}
      </ul>
      <button type="button" className="mv-card__cta" onClick={onUnlock}>
        Unlock owner’s number
      </button>
    </div>
  );
}
