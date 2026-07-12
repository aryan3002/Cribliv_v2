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
import { useSearchSuggestions, type BlendedSuggestion } from "../../lib/use-search-suggestions";
import { SearchSuggestionsDropdown } from "./SearchSuggestionsDropdown";
import {
  clearRecentSearches,
  pushRecentSearch,
  readRecentSearches,
  type RecentSearch
} from "../../lib/recent-searches";

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
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const {
    suggestions: suggestionItems,
    isOpen: suggestionsOpen,
    containerRef: suggestionsRef,
    onQueryChange: onSuggestQuery,
    open: openSuggestions,
    close: closeSuggestions
  } = useSearchSuggestions(segment);

  useEffect(() => {
    setRecent(readRecentSearches());
  }, []);

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
    closeSuggestions();
    router.push(buildIntentSearchHref(locale, segment, params, text, dictionary) as Route);
  }

  function rememberSearch(value: string) {
    if (!value.trim()) return;
    pushRecentSearch(value);
    setRecent(readRecentSearches());
  }

  function handleSelectSuggestion(suggestion: BlendedSuggestion) {
    closeSuggestions();

    if (suggestion.source === "google") {
      const name = suggestion.data.structured_formatting?.main_text ?? suggestion.data.description;
      rememberSearch(name);
      setText(name);
      router.push(hrefForSegment(locale, segment, { q: name }) as Route);
      return;
    }

    const { data } = suggestion;
    rememberSearch(data.label);

    if (data.type === "city") {
      setText("");
      router.push(hrefForSegment(locale, segment, { city: data.value }) as Route);
    } else if (data.type === "listing") {
      // A PG listing routes to its PG detail; a property listing to /listing.
      const href =
        segment === "pg" && data.city_slug
          ? `/${locale}/pg/${data.city_slug}/${data.value}`
          : `/${locale}/listing/${data.value}`;
      router.push(href as Route);
    } else if (segment === "pg") {
      // PG locality → scope by city + locality slug (precise).
      setText("");
      router.push(
        hrefForSegment(locale, segment, { city: data.city_slug, locality: data.value }) as Route
      );
    } else {
      // Homes locality → carry the label as a free-text query.
      setText(data.label);
      router.push(hrefForSegment(locale, segment, { q: data.label }) as Route);
    }
  }

  function handlePickRecent(value: string) {
    closeSuggestions();
    setText(value);
    rememberSearch(value);
    router.push(hrefForSegment(locale, segment, { q: value }) as Route);
  }

  function handleRemoveRecent(value: string) {
    const next = recent.filter((entry) => entry.query !== value);
    if (next.length === 0) {
      clearRecentSearches();
    } else {
      try {
        window.localStorage.setItem("cribliv:recent_searches", JSON.stringify(next));
      } catch {
        /* localStorage may be unavailable */
      }
    }
    setRecent(next);
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

      <div className="intent-search-bar__field" ref={suggestionsRef}>
        <form className="intent-search-bar__form" onSubmit={submit}>
          <Search size={18} aria-hidden="true" className="segbar__icon" />
          <input
            className="intent-search-bar__input"
            aria-label="Search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Try 2BHK Gomti Nagar under 20k"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onSuggestQuery(e.target.value);
            }}
            onFocus={openSuggestions}
          />
          <button type="submit" className="btn btn--primary intent-search-bar__submit">
            Search
          </button>
        </form>
        {suggestionsOpen ? (
          <SearchSuggestionsDropdown
            suggestions={suggestionItems}
            recent={recent}
            query={text}
            onSelect={handleSelectSuggestion}
            onPickRecent={handlePickRecent}
            onRemoveRecent={handleRemoveRecent}
          />
        ) : null}
      </div>

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
