// Shared contract for the voice-map intent core. No React, no network.
import type { ChipKind } from "./smart-parser";

export type ClientFilter =
  | { kind: "min_rent"; value: number }
  | { kind: "furnishing"; value: string }
  | { kind: "locality"; value: string };

export interface IntentChip {
  kind: ChipKind;
  label: string; // display text, e.g. "2 BHK", "‹ ₹20k"
  quotedSource?: string; // the exact words the user said (for the reason ledger)
  status: "applied" | "unsupported";
  reason?: string; // only when unsupported, e.g. "can't filter parking yet"
}

export type CameraIntent =
  | {
      kind: "bounds";
      sw: { lat: number; lng: number };
      ne: { lat: number; lng: number };
      zoom: number;
    }
  | { kind: "center"; center: { lat: number; lng: number }; zoom: number };
