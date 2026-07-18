import type { MapPin } from "../components/criblmap/hooks/useMapState";
import type { ClientFilter } from "./map-intent-types";

export const PIN_CAP = 500;

export interface PartitionResult {
  matched: MapPin[];
  faded: MapPin[];
  matchedIds: string[];
  count: number;
  isComplete: boolean;
}

function pinPasses(pin: MapPin, filter: ClientFilter): boolean {
  switch (filter.kind) {
    case "min_rent":
      return pin.monthly_rent >= filter.value;
    case "furnishing":
      return (pin.furnishing ?? "") === filter.value;
    case "locality": {
      const want = filter.value.toLowerCase();
      return (
        (pin.locality_slug ?? "").toLowerCase() === want ||
        (pin.locality ?? "").toLowerCase() === want
      );
    }
  }
}

export function partitionPins(
  pins: MapPin[],
  filters: ClientFilter[],
  cap: number = PIN_CAP
): PartitionResult {
  const matched: MapPin[] = [];
  const faded: MapPin[] = [];
  for (const pin of pins) {
    if (filters.every((f) => pinPasses(pin, f))) matched.push(pin);
    else faded.push(pin);
  }
  return {
    matched,
    faded,
    matchedIds: matched.map((p) => p.id),
    count: matched.length,
    isComplete: pins.length < cap
  };
}
