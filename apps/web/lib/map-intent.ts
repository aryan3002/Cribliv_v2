// Voice/NL query -> map intent. Ties smart-parser's chip extraction to
// map-area-resolver's camera targets, then partitions chips into what the
// API can filter server-side vs. what only makes sense client-side (or
// isn't supported at all yet). Pure module: no React, no network.
import { parseQuery, parseRentValue, type ParsedChip } from "./smart-parser";
import { resolveArea } from "./map-area-resolver";
import { KNOWN_CITY_SLUGS, KNOWN_LOCALITY_SLUGS } from "./map-search-index";
import type { MapFilters } from "../components/criblmap/hooks/useMapState";
import type { CameraIntent, ClientFilter, IntentChip } from "./map-intent-types";

export interface MapIntentInput {
  transcript: string;
  cityList?: string[];
  localityList?: string[];
}

export interface MapIntent {
  chips: IntentChip[];
  camera: CameraIntent | null;
  serverFilters: MapFilters;
  clientFilters: ClientFilter[];
}

// A rent-shaped number token: digits (or Hindi number words / Devanagari
// digits), optionally followed by a unit suffix ("k", "lakh", "hazaar", ...).
// Mirrors the token shapes smart-parser itself matches, so "spoken" amounts
// extracted here always agree with what parseQuery would have produced.
const SPOKEN_NUM_TOKEN =
  "(\\d{1,6}|ek|do|teen|char|paanch|panch|chhe|che|saat|aath|nau|das|[०-९]+)";
const SPOKEN_UNIT_TOKEN = "(k|lakh|lac|thousand|हजार|hazar|hazaar|jar|yaar|लाख)?";
const SPOKEN_RENT_RE = new RegExp(`${SPOKEN_NUM_TOKEN}\\s*${SPOKEN_UNIT_TOKEN}`, "gi");

// A number only counts as a rent candidate when it carries a MONEY SIGNAL, so
// incidental digits in a live ASR transcript (sqft, floor, sector/block, a
// 6-digit pincode) can't collide at an exact 10x/100x ratio and hijack the
// guard. Signal (a) is a multiplier suffix on the token itself; signal (b) is
// a budget/currency cue word sitting immediately before (e.g. "under 20000",
// "budget ₹200000") or a trailing money word right after (e.g. "20000 rent").
// A bare number with neither signal is ignored.
//
// The cue words are `\b`-anchored so a word that merely *ends* in a cue
// substring ("diffe-rent", "cur-rent", "wonder", "thunder") can't false-match.
// The ₹ symbol is a non-word char that may be space-separated from its number
// ("budget ₹200000"), so it sits OUTSIDE the `\b` group where a boundary rule
// would wrongly reject it.
const CUE_BEFORE_RE =
  /(?:\b(?:under|below|upto|up\s*to|within|max|budget|rent|rupees?|rs\.?)|₹)\s*$/i;
const CUE_AFTER_RE = /^\s*(?:rent|rupees?|budget)\b/i;

/**
 * Every money-signalled rent amount mentioned in a transcript, suffix-expanded
 * via smart-parser's own `parseRentValue` (so "20k" -> 20000, "1 lakh" ->
 * 100000, "20 hazaar" -> 20000, "under 20000" -> 20000). Bare numbers with no
 * multiplier suffix and no adjacent budget/currency cue (sqft, sector, floor,
 * pincode) are dropped, as are sub-100 values (BHK counts, etc.).
 */
function spokenAmounts(transcript: string): number[] {
  const cleaned = transcript.replace(/,/g, "");
  const amounts: number[] = [];
  for (const match of cleaned.matchAll(SPOKEN_RENT_RE)) {
    const [full, numStr, unit] = match;
    if (!numStr) continue;
    const start = match.index ?? 0;
    const hasSuffix = Boolean(unit && unit.trim());
    const hasCue =
      CUE_BEFORE_RE.test(cleaned.slice(0, start)) ||
      CUE_AFTER_RE.test(cleaned.slice(start + full.length));
    if (!hasSuffix && !hasCue) continue;
    const value = parseRentValue(numStr, unit || undefined);
    if (value !== null && Number.isFinite(value) && value >= 100) amounts.push(value);
  }
  return amounts;
}

/**
 * Revert an exact 10x/100x ASR mishearing: if `value` is precisely 10x or
 * 100x one of the rent-shaped amounts actually present in `transcript`,
 * trust the transcript and return the smaller (spoken) amount. Otherwise
 * `value` is left untouched, including when it already matches what was
 * spoken. Mirrors the intent (not the buggy digit-string comparison) of the
 * wizard's guardMoneyValue (listing-tool-handlers.ts).
 */
export function guardRent(value: number, transcript: string): number {
  if (!transcript || !Number.isFinite(value)) return value;
  for (const spoken of spokenAmounts(transcript)) {
    if (spoken <= 0) continue;
    const ratio = value / spoken;
    if (Math.abs(ratio - 10) < 0.5 || Math.abs(ratio - 100) < 0.5) {
      return spoken;
    }
  }
  return value;
}

function sliceQuoted(transcript: string, chip: ParsedChip): string | undefined {
  if (!chip.sourceRange) return undefined;
  return transcript.slice(chip.sourceRange.start, chip.sourceRange.end).trim() || undefined;
}

export function buildMapIntent(input: MapIntentInput): MapIntent {
  const { transcript, cityList = KNOWN_CITY_SLUGS, localityList = KNOWN_LOCALITY_SLUGS } = input;
  const parsed = parseQuery(transcript, cityList, localityList);

  const chips: IntentChip[] = [];
  const serverFilters: MapFilters = {};
  const clientFilters: ClientFilter[] = [];
  let camera: CameraIntent | null = null;

  for (const chip of parsed.chips) {
    const quotedSource = sliceQuoted(transcript, chip);
    switch (chip.kind) {
      case "bhk":
        serverFilters.bhk = chip.value as number;
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "max_rent":
        serverFilters.max_rent = guardRent(chip.value as number, transcript);
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "listing_type":
        serverFilters.listing_type = chip.value as "flat_house" | "pg";
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "min_rent":
        clientFilters.push({ kind: "min_rent", value: chip.value as number });
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "furnishing":
        clientFilters.push({ kind: "furnishing", value: String(chip.value) });
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      case "locality": {
        const area = resolveArea(String(chip.value));
        if (area) {
          clientFilters.push({ kind: "locality", value: String(chip.value) });
          camera = { kind: "center", center: area.center, zoom: area.zoom };
          chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        } else {
          chips.push({
            kind: chip.kind,
            label: chip.label,
            quotedSource,
            status: "unsupported",
            reason: "couldn't place this area yet"
          });
        }
        break;
      }
      case "city": {
        const area = resolveArea(String(chip.value));
        if (area) camera = { kind: "center", center: area.center, zoom: area.zoom };
        chips.push({ kind: chip.kind, label: chip.label, quotedSource, status: "applied" });
        break;
      }
      case "amenity":
        chips.push({
          kind: chip.kind,
          label: chip.label,
          quotedSource,
          status: "unsupported",
          reason: `can't filter ${chip.label.toLowerCase()} yet`
        });
        break;
    }
  }

  return { chips, camera, serverFilters, clientFilters };
}
