"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Building, Home, Search, X } from "lucide-react";
import { fetchApi } from "../../lib/api";
import {
  buildIntentCountPath,
  buildIntentSearchHref,
  parseIntentSearch,
  type SearchDictionary
} from "../../lib/intent-search";
import { hrefForSegment, type SearchSegment } from "../../lib/search-segment";
import type { ParsedChip } from "../../lib/smart-parser";

interface CountResponse {
  total: number;
}

const EMPTY_DICTIONARY: SearchDictionary = { cities: [], localities: [] };
const COUNT_DEBOUNCE_MS = 250;
type CountStatus = "idle" | "loading" | "ready" | "unavailable";

function chipRemovalLabel(chip: ParsedChip): string {
  const label = chip.label.replace("₹", "Rs. ").replace(/^≤ /, "up to ").replace(/^≥ /, "from ");
  return `Remove ${label}`;
}

function removeChipText(query: string, chip: ParsedChip): string {
  if (!chip.sourceRange) return query;
  const { start, end } = chip.sourceRange;
  return `${query.slice(0, start)} ${query.slice(end)}`.replace(/\s+/g, " ").trim();
}

export function IntentSearchBar({
  locale,
  segment,
  params
}: {
  locale: string;
  segment: SearchSegment;
  params: Record<string, string>;
}) {
  const router = useRouter();
  const [text, setText] = useState(params.city ?? params.q ?? "");
  const [dictionary, setDictionary] = useState<SearchDictionary>(EMPTY_DICTIONARY);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [countStatus, setCountStatus] = useState<CountStatus>("idle");
  const countAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setText(params.city ?? params.q ?? "");
  }, [params.city, params.q]);

  useEffect(() => {
    const controller = new AbortController();
    fetchApi<SearchDictionary>("/listings/search/dictionary", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setDictionary({
            cities: Array.isArray(data.cities) ? data.cities : [],
            localities: Array.isArray(data.localities) ? data.localities : []
          });
        }
      })
      .catch(() => {
        // City aliases and all non-place filters still parse without the dictionary.
      });

    return () => controller.abort();
  }, []);

  const parsed = useMemo(
    () => parseIntentSearch(text, dictionary, segment),
    [dictionary, segment, text]
  );
  const chipSignature = parsed.chips.map((chip) => `${chip.kind}:${chip.value}`).join("|");

  useEffect(() => {
    countAbortRef.current?.abort();
    if (parsed.chips.length === 0) {
      setMatchCount(null);
      setCountStatus("idle");
      return;
    }

    setMatchCount(null);
    setCountStatus("loading");
    const timer = setTimeout(async () => {
      const controller = new AbortController();
      countAbortRef.current = controller;
      try {
        const result = await fetchApi<CountResponse>(buildIntentCountPath(parsed), {
          signal: controller.signal
        });
        if (!controller.signal.aborted && Number.isFinite(result.total)) {
          setMatchCount(result.total);
          setCountStatus("ready");
        }
      } catch {
        if (!controller.signal.aborted) {
          setMatchCount(null);
          setCountStatus("unavailable");
        }
      }
    }, COUNT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      countAbortRef.current?.abort();
    };
  }, [chipSignature, parsed]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    router.push(buildIntentSearchHref(locale, segment, params, text, dictionary) as Route);
  }

  function switchSegment(next: SearchSegment) {
    if (next === segment) return;

    const nextParsed = parseIntentSearch(text, dictionary, next);
    const city =
      typeof nextParsed.filters.city === "string" ? nextParsed.filters.city : params.city;
    const q =
      !city && typeof nextParsed.filters.q === "string"
        ? nextParsed.filters.q
        : !city
          ? nextParsed.residual || params.q
          : undefined;
    router.push(hrefForSegment(locale, next, { city, q }) as Route);
  }

  const countLabel =
    countStatus === "unavailable"
      ? "Match count unavailable"
      : countStatus !== "ready" || matchCount === null
        ? "Finding matches"
        : `${matchCount} ${parsed.targetSegment === "pg" ? "PG" : "home"}${matchCount === 1 ? "" : "s"} match`;

  return (
    <div className="intent-search-bar">
      <div className="segbar__toggle" role="group" aria-label="Search type">
        <button
          type="button"
          aria-pressed={segment === "homes"}
          className={`segbar__seg${segment === "homes" ? " segbar__seg--active" : ""}`}
          onClick={() => switchSegment("homes")}
        >
          <Home size={15} aria-hidden="true" /> Homes
        </button>
        <button
          type="button"
          aria-pressed={segment === "pg"}
          className={`segbar__seg${segment === "pg" ? " segbar__seg--active" : ""}`}
          onClick={() => switchSegment("pg")}
        >
          <Building size={15} aria-hidden="true" /> PG
        </button>
      </div>

      <form className="intent-search-bar__form" onSubmit={submit}>
        <Search size={18} aria-hidden="true" className="segbar__icon" />
        <input
          className="intent-search-bar__input"
          aria-label="Search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Try 2BHK Gomti Nagar under 20k"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn--primary intent-search-bar__submit">
          Search
        </button>
      </form>

      {parsed.chips.length > 0 && (
        <div className="intent-search-bar__interpretation">
          <div className="intent-search-bar__chips" aria-label="Recognized filters">
            {parsed.chips.map((chip) => (
              <button
                key={`${chip.kind}:${chip.value}`}
                type="button"
                className={`intent-search-bar__chip intent-search-bar__chip--${chip.kind}`}
                aria-label={chipRemovalLabel(chip)}
                onClick={() => setText((current) => removeChipText(current, chip))}
              >
                {chip.label} <X size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
          <p className="intent-search-bar__summary" aria-live="polite">
            <span>
              Understood as {parsed.chips.length} filter{parsed.chips.length === 1 ? "" : "s"}
            </span>
            <strong>{countLabel}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
