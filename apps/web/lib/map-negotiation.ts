import type { MapPin } from "../components/criblmap/hooks/useMapState";
import type { MapFilters } from "../components/criblmap/hooks/useMapState";
import type { ClientFilter } from "./map-intent-types";
import { partitionPins } from "./map-post-filter";

export interface NegotiationArgs {
  pins: MapPin[]; // server-filtered viewport pins BEFORE client post-filter
  serverFilters: MapFilters;
  clientFilters: ClientFilter[];
}

export type DoorId = "stretch_budget" | "loosen_furnishing" | "allow_unverified" | "subscribe";

export interface Door {
  id: DoorId;
  label: string;
  gain: number;
  // gain is a placeholder, not an exact count — UI must not render it as a literal number.
  isEstimate?: boolean;
  relaxed?: { serverFilters: MapFilters; clientFilters: ClientFilter[] };
}

const rupees = (n: number) => `₹${Math.round(n / 1000)}k`;

function applyMaxRent(pins: MapPin[], maxRent?: number): MapPin[] {
  return maxRent ? pins.filter((p) => p.monthly_rent <= maxRent) : pins;
}

export function computeNegotiationDoors(args: NegotiationArgs): Door[] {
  // pins that clear the current server max_rent cap — shared by the baseline
  // count and the furnishing door so the filter is applied only once.
  const withinBudget = applyMaxRent(args.pins, args.serverFilters.max_rent);
  const base = partitionPins(withinBudget, args.clientFilters).count;
  const doors: Door[] = [];

  // 1. Stretch budget by 10%
  if (args.serverFilters.max_rent) {
    const stretched = Math.round(args.serverFilters.max_rent * 1.1);
    const gain = partitionPins(applyMaxRent(args.pins, stretched), args.clientFilters).count - base;
    if (gain > 0) {
      doors.push({
        id: "stretch_budget",
        label: `Stretch to ${rupees(stretched)}`,
        gain,
        relaxed: {
          serverFilters: { ...args.serverFilters, max_rent: stretched },
          clientFilters: args.clientFilters
        }
      });
    }
  }

  // 2. Loosen furnishing (drop the furnishing client filter)
  if (args.clientFilters.some((f) => f.kind === "furnishing")) {
    const relaxedClient = args.clientFilters.filter((f) => f.kind !== "furnishing");
    const gain = partitionPins(withinBudget, relaxedClient).count - base;
    if (gain > 0) {
      doors.push({
        id: "loosen_furnishing",
        label: "Any furnishing",
        gain,
        relaxed: { serverFilters: args.serverFilters, clientFilters: relaxedClient }
      });
    }
  }

  // 3. Allow unverified (only meaningful if verified_only was on)
  if (args.serverFilters.verified_only) {
    // gain here requires a fresh server fetch; we surface the door and let the UI refetch.
    doors.push({
      id: "allow_unverified",
      label: "Include unverified",
      gain: 1, // sentinel: "some" — UI refetches to get the real number
      isEstimate: true, // gain is a placeholder, not an exact count
      relaxed: {
        serverFilters: { ...args.serverFilters, verified_only: false },
        clientFilters: args.clientFilters
      }
    });
  }

  // 4. Subscribe — always last, always present
  doors.push({ id: "subscribe", label: "Text me when one lists", gain: 0 });
  return doors;
}
