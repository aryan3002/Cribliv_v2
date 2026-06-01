"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { trackEvent } from "../lib/analytics";
import { buildSearchQuery, fetchApi } from "../lib/api";
import { hrefForSegment, placeSearchParam } from "../lib/search-segment";
import { VoiceSearchButton } from "./voice-search-button";
import { useGooglePlaces, type PlacePrediction } from "../lib/google-places";
import { MapPin, Building2, Home, Mic, Search, Clock, BadgeCheck, X } from "lucide-react";
import type { VoiceStage } from "./voice-search-types";
import {
  pushRecentSearch,
  readRecentSearches,
  clearRecentSearches,
  type RecentSearch
} from "../lib/recent-searches";
import { parseQuery, chipsToFilters, type ParsedChip } from "../lib/smart-parser";

interface AgenticRouteResponse {
  intent: string;
  route: string;
  filters: Record<string, string | number | boolean>;
  clarifying_question?: {
    id: string;
    text: string;
    options: string[];
  };
}

interface CriblivSuggestion {
  type: "city" | "locality" | "listing";
  label: string;
  value: string;
  // City / locality enrichments
  listing_count?: number;
  rent_band?: { min: number; max: number };
  city_slug?: string;
  // Listing enrichments
  cover_url?: string | null;
  rent?: number;
  verified?: boolean;
  locality_label?: string;
  posted_at?: string;
}

type BlendedSuggestion =
  | { source: "cribliv"; data: CriblivSuggestion }
  | { source: "google"; data: PlacePrediction };

export function SearchHero({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<"homes" | "pg">("homes");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [clarification, setClarification] = useState<
    AgenticRouteResponse["clarifying_question"] | null
  >(null);
  const [baseFilters, setBaseFilters] = useState<Record<string, string | number | boolean>>({});
  const [voiceStage, setVoiceStage] = useState<VoiceStage>("idle");
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [chips, setChips] = useState<ParsedChip[]>([]);
  const [chipResidual, setChipResidual] = useState<string>("");
  const [chipConfidence, setChipConfidence] = useState<number>(0);
  const [dictionary, setDictionary] = useState<{ cities: string[]; localities: string[] }>({
    cities: [],
    localities: []
  });

  useEffect(() => {
    setRecent(readRecentSearches());

    // Fetch the city/locality dictionary so the smart parser can resolve
    // place names without a server round-trip on every keystroke.
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
      /\/+$/,
      ""
    );
    const base = apiBase.endsWith("/v1") ? apiBase : `${apiBase}/v1`;
    fetch(`${base}/listings/search/dictionary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body?.data) return;
        setDictionary({
          cities: Array.isArray(body.data.cities) ? body.data.cities : [],
          localities: Array.isArray(body.data.localities) ? body.data.localities : []
        });
      })
      .catch(() => {
        /* no dictionary, parser still works for BHK/rent/type/etc */
      });
  }, []);

  // Re-parse whenever the query or dictionary changes.
  useEffect(() => {
    if (query.trim().length < 2) {
      setChips([]);
      setChipResidual("");
      setChipConfidence(0);
      return;
    }
    const result = parseQuery(query, dictionary.cities, dictionary.localities);
    setChips(result.chips);
    setChipResidual(result.residual);
    setChipConfidence(result.confidence);
  }, [query, dictionary]);

  // -- Autocomplete state --
  const [suggestions, setSuggestions] = useState<BlendedSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const suggestAbortRef = useRef<AbortController | null>(null);
  const {
    predictions: placePredictions,
    fetchPredictions: fetchPlaces,
    getPlaceDetails,
    clearPredictions,
    enabled: placesEnabled
  } = useGooglePlaces({ types: ["locality", "sublocality", "neighborhood"] });

  // Fetch internal suggest API. Cancels any in-flight request so a slow earlier
  // response can't overwrite a fresher one keyed off a later keystroke.
  const fetchCriblivSuggestions = useCallback(
    async (q: string, signal: AbortSignal): Promise<CriblivSuggestion[]> => {
      if (q.length < 2) return [];
      try {
        const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
          /\/+$/,
          ""
        );
        const base = apiBase.endsWith("/v1") ? apiBase : `${apiBase}/v1`;
        // PG mode pulls PG-scoped suggestions (cities with PG inventory + PG
        // listings); Homes uses the property suggest.
        const path = segment === "pg" ? "/pg/suggest" : "/listings/search/suggest";
        const res = await fetch(`${base}${path}?q=${encodeURIComponent(q)}&limit=6`, { signal });
        if (res.ok) {
          const body = await res.json();
          return body.data ?? [];
        }
      } catch {
        /* aborted or network error */
      }
      return [];
    },
    [segment]
  );

  // Blend results when either source updates
  const onInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (transcript) setTranscript(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      suggestAbortRef.current?.abort();
      if (value.length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        clearPredictions();
        return;
      }
      debounceRef.current = setTimeout(async () => {
        const controller = new AbortController();
        suggestAbortRef.current = controller;
        const [cribliv] = await Promise.all([
          fetchCriblivSuggestions(value, controller.signal),
          placesEnabled ? fetchPlaces(value) : Promise.resolve()
        ]);
        if (controller.signal.aborted) return;
        const blended: BlendedSuggestion[] = cribliv.map((d) => ({
          source: "cribliv" as const,
          data: d
        }));
        setSuggestions(blended);
        setShowSuggestions(true);
      }, 80);
    },
    [transcript, fetchCriblivSuggestions, fetchPlaces, clearPredictions, placesEnabled]
  );

  // Merge Google predictions when they arrive (async)
  useEffect(() => {
    if (placePredictions.length === 0) return;
    setSuggestions((prev) => {
      const cribliv = prev.filter((s) => s.source === "cribliv");
      const google = placePredictions.map((d) => ({ source: "google" as const, data: d }));
      return [...cribliv, ...google];
    });
    setShowSuggestions(true);
  }, [placePredictions]);

  // Click-outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function routeToPg(filters: Record<string, string | number | boolean>) {
    // Resolve the typed place: a known city → `city=` (canonical), a locality or
    // keyword → `q=` (matched against title/city/locality by the PG backend).
    const { listing_type: _lt, q: _q, ...rest } = filters;
    if (query.trim()) {
      pushRecentSearch(query);
      setRecent(readRecentSearches());
    }
    const place =
      typeof rest.city === "string" && rest.city ? { city: rest.city } : placeSearchParam(query);
    const search = buildSearchQuery({ ...rest, ...place });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push(`/${locale}/pg${search ? `?${search}` : ""}` as any);
  }

  function routeToSearch(filters: Record<string, string | number | boolean>) {
    const hasFilters = Object.keys(filters).length > 0 || query.trim().length > 0;
    if (!hasFilters) {
      setClarification({
        id: "empty_voice_result",
        text:
          locale === "hi"
            ? "हम समझ नहीं पाए। क्या आप इनमें से कुछ खोज रहे हैं?"
            : "We couldn't understand that. Are you looking for one of these?",
        options: ["2BHK in Noida", "PG in Delhi", "1BHK under 15000", "Furnished flat"]
      });
      return;
    }
    if (query.trim()) {
      pushRecentSearch(query);
      setRecent(readRecentSearches());
    }
    const search = buildSearchQuery({ ...filters, q: query });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push(`/${locale}/search${search ? `?${search}` : ""}` as any);
  }

  // Route to the ACTIVE segment's surface (Homes → /search, PG → /pg). Every
  // navigation path in this bar (submit, suggestion, recent, clarification) must
  // honor the toggle — not just form submit — or PG searches leak back to Homes.
  function pushSegment(params: Record<string, string | undefined>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push(hrefForSegment(locale, segment, params) as any);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setClarification(null);
    setTranscript(null);
    setShowSuggestions(false);
    setLoading(true);

    // PG segment: route straight to the dedicated /pg surface with any parsed
    // filters. The agentic LLM router targets /search only, so we bypass it here.
    if (segment === "pg") {
      routeToPg(chips.length > 0 ? chipsToFilters(chips) : {});
      setLoading(false);
      return;
    }

    trackEvent("agentic_query_submitted", { query_text: query, lang_detected: locale });

    // Fast path: high-confidence local parse → skip the LLM round-trip entirely.
    if (chips.length > 0 && chipConfidence >= 0.7) {
      const filters = chipsToFilters(chips);
      const residual = chipResidual.trim();
      if (residual && !filters.q) filters.q = residual;
      trackEvent("agentic_route_resolved", {
        target_route: "/search",
        filters_json: filters,
        source: "local_parser"
      });
      routeToSearch(filters);
      setLoading(false);
      return;
    }

    try {
      const response = await fetchApi<AgenticRouteResponse>("/search/agentic-route", {
        method: "POST",
        body: JSON.stringify({ query, locale })
      });

      trackEvent("agentic_route_resolved", {
        target_route: response.route,
        filters_json: response.filters
      });

      if (response.clarifying_question) {
        trackEvent("agentic_clarification_shown", {
          question_type: response.clarifying_question.id,
          options_count: response.clarifying_question.options.length
        });
        setClarification(response.clarifying_question);
        setBaseFilters(response.filters ?? {});
      } else {
        routeToSearch(response.filters ?? {});
      }
    } catch {
      routeToSearch({});
      setError("Could not parse with agentic router. Showing regular results.");
    } finally {
      setLoading(false);
    }
  }

  function removeChip(chipToRemove: ParsedChip) {
    setChips((prev) =>
      prev.filter(
        (c) =>
          !(
            c.kind === chipToRemove.kind &&
            String(c.value).toLowerCase() === String(chipToRemove.value).toLowerCase()
          )
      )
    );
  }

  function applyClarification(option: string) {
    if (!clarification) return;
    const nextFilters = { ...baseFilters };
    if (clarification.id.includes("city") || clarification.id === "empty_voice_result") {
      setQuery(option);
      pushSegment({ q: option });
      return;
    }
    nextFilters.listing_type = option;
    routeToSearch(nextFilters);
  }

  async function handleSuggestionClick(s: BlendedSuggestion) {
    setShowSuggestions(false);
    if (s.source === "google") {
      const details = await getPlaceDetails(s.data.place_id);
      const locationName = details?.name ?? s.data.structured_formatting.main_text;
      trackEvent("places_suggestion_selected", { place: locationName, place_id: s.data.place_id });
      setQuery(locationName);
      pushRecentSearch(locationName);
      setRecent(readRecentSearches());
      pushSegment({ q: locationName });
    } else {
      const { data } = s;
      trackEvent("suggest_selected", { type: data.type, value: data.value });
      const labelForRecent = data.type === "city" ? data.label : data.label;
      pushRecentSearch(labelForRecent);
      setRecent(readRecentSearches());
      if (data.type === "city") {
        setQuery("");
        pushSegment({ city: data.value });
      } else if (data.type === "listing") {
        // A PG-listing suggestion routes to the PG detail; a property listing to /listing.
        if (segment === "pg" && data.city_slug) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          router.push(`/${locale}/pg/${data.city_slug}/${data.value}` as any);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          router.push(`/${locale}/listing/${data.value}` as any);
        }
      } else if (segment === "pg") {
        // PG locality → scope by city + locality slug (precise; q would carry the
        // ", city" label and miss).
        setQuery("");
        pushSegment({ city: data.city_slug, locality: data.value });
      } else {
        setQuery(data.label);
        pushSegment({ q: data.label });
      }
    }
  }

  function applyRecent(text: string) {
    setQuery(text);
    setShowSuggestions(false);
    pushSegment({ q: text });
  }

  function removeRecent(text: string) {
    const next = recent.filter((r) => r.query !== text);
    if (next.length === 0) {
      clearRecentSearches();
    } else {
      // Re-write storage so the order matches the visible list.
      try {
        window.localStorage.setItem("cribliv:recent_searches", JSON.stringify(next));
      } catch {
        /* ignore */
      }
    }
    setRecent(next);
  }

  return (
    <div className="search-hero-wrapper" ref={wrapperRef}>
      <form className="hero-search" onSubmit={onSubmit}>
        <div className="hero-segment" role="group" aria-label="Search type">
          <button
            type="button"
            aria-pressed={segment === "homes"}
            className={`hero-segment__btn${segment === "homes" ? " hero-segment__btn--active" : ""}`}
            onClick={() => setSegment("homes")}
          >
            Homes
          </button>
          <button
            type="button"
            aria-pressed={segment === "pg"}
            className={`hero-segment__btn${segment === "pg" ? " hero-segment__btn--active" : ""}`}
            onClick={() => setSegment("pg")}
          >
            PG
          </button>
        </div>
        <div className="hero-search__input-row">
          <Search
            size={18}
            style={{ flexShrink: 0, color: "#94a3b8", pointerEvents: "none" }}
            aria-hidden="true"
          />
          <input
            aria-label="Agentic search"
            value={query}
            onChange={(e) => onInputChange(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0 || (query.length < 2 && recent.length > 0)) {
                setShowSuggestions(true);
              }
            }}
            placeholder={
              segment === "pg"
                ? locale === "hi"
                  ? "शहर, इलाके या नाम से PG खोजें…"
                  : "Search PGs by city, area or name…"
                : t(locale, "searchPlaceholder")
            }
            className="hero-search__input"
            autoComplete="off"
          />
          <VoiceSearchButton
            locale={locale === "hi" ? "hi" : "en"}
            onResult={(result) => {
              trackEvent("voice_search_routed", {
                intent: result.route_result.intent,
                transcript: result.transcription.text
              });
              if (result.route_result.clarifying_question) {
                setClarification(result.route_result.clarifying_question);
                setBaseFilters(
                  (result.route_result.filters ?? {}) as Record<string, string | number | boolean>
                );
              } else {
                routeToSearch(
                  (result.route_result.filters ?? {}) as Record<string, string | number | boolean>
                );
              }
            }}
            onTranscript={(text) => {
              setQuery(text);
              setTranscript(text);
            }}
            onStageChange={setVoiceStage}
          />
          <button type="submit" className="hero-search__btn" disabled={loading}>
            <Search size={16} aria-hidden="true" />
            <span className="search-btn-label">{loading ? "Searching…" : "Search"}</span>
          </button>
        </div>
      </form>

      {/* Smart-parser chips — visible whenever the local parser extracted any filters */}
      {chips.length > 0 ? (
        <SmartChipStrip chips={chips} confidence={chipConfidence} onRemove={removeChip} />
      ) : null}

      {/* Voice pipeline stage strip — only visible while voice is active */}
      {voiceStage !== "idle" && voiceStage !== "error" ? (
        <VoiceStageStrip stage={voiceStage} />
      ) : null}

      {/* Autocomplete Dropdown — sectioned */}
      {showSuggestions ? (
        <SectionedDropdown
          suggestions={suggestions}
          recent={recent}
          query={query}
          segment={segment}
          onPickSuggestion={handleSuggestionClick}
          onPickRecent={applyRecent}
          onRemoveRecent={removeRecent}
        />
      ) : null}

      {/* Voice transcript feedback */}
      {transcript && (
        <p className="hero-search__transcript" aria-live="polite">
          <VoiceBadge /> {locale === "hi" ? "आपने कहा:" : "You said:"}{" "}
          <strong>&ldquo;{transcript}&rdquo;</strong>
        </p>
      )}

      {error ? (
        <p className="caption" style={{ color: "var(--danger)", marginTop: "var(--space-2)" }}>
          {error}
        </p>
      ) : null}

      {clarification ? (
        <div className="clarification-box">
          <p>{clarification.text}</p>
          <div className="chip-row">
            {clarification.options.map((option) => (
              <button
                key={option}
                type="button"
                className="chip-btn"
                onClick={() => applyClarification(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VoiceBadge() {
  return <Mic size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden="true" />;
}

function formatRentBand(min: number, max: number): string {
  return `${formatRent(min)}–${formatRent(max)}`;
}

function formatRent(value: number): string {
  if (value >= 100000) {
    return `₹${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 1)}L`;
  }
  if (value >= 1000) {
    return `₹${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return `₹${value}`;
}

function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function letterAvatar(label: string): string {
  return (label.trim()[0] ?? "?").toUpperCase();
}

function prettifySlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface PreviewData {
  type: "city" | "locality";
  slug: string;
  name: string;
  city_slug?: string;
  listing_count: number;
  rent_band: { min: number; max: number } | null;
  verified_pct: number | null;
  avg_bhk: number | null;
  /** PG preview only: distinct sharing kinds, shown in place of Avg BHK. */
  sharing?: string[];
  sample_photos: string[];
}

interface SectionedDropdownProps {
  suggestions: BlendedSuggestion[];
  recent: RecentSearch[];
  query: string;
  /** Drives which preview endpoint the hover card hits (PG vs property). */
  segment: "homes" | "pg";
  onPickSuggestion: (s: BlendedSuggestion) => void;
  onPickRecent: (text: string) => void;
  onRemoveRecent: (text: string) => void;
}

function SectionedDropdown({
  suggestions,
  recent,
  query,
  segment,
  onPickSuggestion,
  onPickRecent,
  onRemoveRecent
}: SectionedDropdownProps) {
  const cribliv = suggestions
    .filter((s): s is Extract<BlendedSuggestion, { source: "cribliv" }> => s.source === "cribliv")
    .map((s) => s);
  const google = suggestions
    .filter((s): s is Extract<BlendedSuggestion, { source: "google" }> => s.source === "google")
    .map((s) => s);

  const cities = cribliv.filter((s) => s.data.type === "city");
  const localities = cribliv.filter((s) => s.data.type === "locality");
  const listings = cribliv.filter((s) => s.data.type === "listing");

  const showRecent = query.length < 2 && recent.length > 0;
  const hasContent =
    cities.length + localities.length + listings.length + google.length > 0 || showRecent;

  // -- Preview hover state --
  const [hovered, setHovered] = useState<{ type: "city" | "locality"; slug: string } | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewCacheRef = useRef<Map<string, PreviewData | null>>(new Map());

  // Auto-show first city or locality preview while typing.
  useEffect(() => {
    if (cities[0]) {
      setHovered({ type: "city", slug: cities[0].data.value });
    } else if (localities[0]) {
      const slug = localities[0].data.value;
      setHovered({ type: "locality", slug });
    } else {
      setHovered(null);
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cities.length > 0 ? cities[0].data.value : null,
    localities.length > 0 ? localities[0].data.value : null
  ]);

  useEffect(() => {
    if (!hovered) {
      setPreview(null);
      return;
    }
    const key = `${segment}:${hovered.type}:${hovered.slug}`;
    const cached = previewCacheRef.current.get(key);
    if (cached !== undefined) {
      setPreview(cached);
      return;
    }
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);

    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
      /\/+$/,
      ""
    );
    const base = apiBase.endsWith("/v1") ? apiBase : `${apiBase}/v1`;
    // PG mode reads the PG-scoped preview so the hover card shows PG inventory
    // (count, rent band, sharing) instead of flat/house data.
    const previewPath = segment === "pg" ? "/pg/preview" : "/listings/search/preview";
    fetch(`${base}${previewPath}?type=${hovered.type}&value=${encodeURIComponent(hovered.slug)}`, {
      signal: controller.signal
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        const data: PreviewData | null = body?.data ?? null;
        previewCacheRef.current.set(key, data);
        setPreview(data);
      })
      .catch(() => {
        /* aborted or network error */
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
  }, [hovered, segment]);

  function scheduleHover(type: "city" | "locality", slug: string) {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHovered({ type, slug });
    }, 180);
  }

  function cancelHover() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }

  if (!hasContent) return null;

  const showPreviewPane = (cities.length > 0 || localities.length > 0) && hovered !== null;

  return (
    <div
      className={`search-dropdown ${showPreviewPane ? "search-dropdown--with-preview" : ""}`}
      role="listbox"
    >
      <div className="search-dropdown__list">
        {cities.length > 0 ? (
          <Section label="Cities">
            {cities.map((s, i) => (
              <CityRow
                key={`c-${s.data.value}-${i}`}
                data={s.data}
                onClick={() => onPickSuggestion(s)}
                onHover={() => scheduleHover("city", s.data.value)}
                onLeave={cancelHover}
              />
            ))}
          </Section>
        ) : null}

        {localities.length > 0 ? (
          <Section label="Localities">
            {localities.map((s, i) => (
              <LocalityRow
                key={`l-${s.data.value}-${i}`}
                data={s.data}
                onClick={() => onPickSuggestion(s)}
                onHover={() => scheduleHover("locality", s.data.value)}
                onLeave={cancelHover}
              />
            ))}
          </Section>
        ) : null}

        {listings.length > 0 ? (
          <Section label="Listings">
            {listings.map((s, i) => (
              <ListingRow
                key={`x-${s.data.value}-${i}`}
                data={s.data}
                onClick={() => onPickSuggestion(s)}
              />
            ))}
          </Section>
        ) : null}

        {google.length > 0 ? (
          <Section label="More places">
            {google.map((s) => (
              <GoogleRow
                key={`g-${s.data.place_id}`}
                data={s.data}
                onClick={() => onPickSuggestion(s)}
              />
            ))}
          </Section>
        ) : null}

        {showRecent ? (
          <Section label="Recent">
            {recent.map((r) => (
              <RecentRow
                key={r.query}
                text={r.query}
                onPick={() => onPickRecent(r.query)}
                onRemove={() => onRemoveRecent(r.query)}
              />
            ))}
          </Section>
        ) : null}
      </div>

      {showPreviewPane ? (
        <PreviewPane preview={preview} loading={previewLoading} segment={segment} />
      ) : null}
    </div>
  );
}

function PreviewPane({
  preview,
  loading,
  segment
}: {
  preview: PreviewData | null;
  loading: boolean;
  segment: "homes" | "pg";
}) {
  if (loading && !preview) {
    return (
      <aside className="search-preview" aria-busy="true">
        <div className="search-preview__hero search-preview__hero--skeleton" />
        <div className="search-preview__skeleton-line" />
        <div className="search-preview__skeleton-line search-preview__skeleton-line--short" />
      </aside>
    );
  }
  if (!preview) {
    return (
      <aside className="search-preview">
        <div className="search-preview__empty">No preview available.</div>
      </aside>
    );
  }

  const samplePhotos = preview.sample_photos ?? [];
  const heroPhoto = samplePhotos[0];

  return (
    <aside className="search-preview" aria-live="polite">
      <div
        className="search-preview__hero"
        style={heroPhoto ? { backgroundImage: `url(${heroPhoto})` } : undefined}
      >
        {!heroPhoto ? <div className="search-preview__hero-fallback" /> : null}
        <div className="search-preview__hero-pill">
          <MapPin size={11} aria-hidden="true" /> {preview.name}
          {preview.city_slug ? `, ${prettifySlug(preview.city_slug)}` : ""}
        </div>
      </div>

      <div className="search-preview__title">{preview.name}</div>

      <div className="search-preview__stats">
        <div className="search-preview__stat">
          <div className="search-preview__stat-label">Listings</div>
          <div className="search-preview__stat-value">{preview.listing_count}</div>
        </div>
        <div className="search-preview__stat">
          <div className="search-preview__stat-label">₹ band</div>
          <div className="search-preview__stat-value">
            {preview.rent_band
              ? `${formatRent(preview.rent_band.min)}–${formatRent(preview.rent_band.max)}`
              : "—"}
          </div>
        </div>
        <div className="search-preview__stat">
          <div className="search-preview__stat-label">Verified</div>
          <div className="search-preview__stat-value search-preview__stat-value--good">
            {preview.verified_pct != null ? `${preview.verified_pct}%` : "—"}
          </div>
        </div>
        {segment === "pg" ? (
          <div className="search-preview__stat">
            <div className="search-preview__stat-label">Sharing</div>
            <div className="search-preview__stat-value">
              {preview.sharing && preview.sharing.length > 0
                ? preview.sharing.map((s) => prettifySlug(s)).join(", ")
                : "—"}
            </div>
          </div>
        ) : (
          <div className="search-preview__stat">
            <div className="search-preview__stat-label">Avg BHK</div>
            <div className="search-preview__stat-value">
              {preview.avg_bhk != null ? preview.avg_bhk : "—"}
            </div>
          </div>
        )}
      </div>

      {samplePhotos.length > 1 ? (
        <div className="search-preview__photos">
          {samplePhotos.slice(1, 4).map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={url} alt="" loading="lazy" />
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="search-dropdown__section">
      <div className="search-dropdown__section-label">{label}</div>
      {children}
    </div>
  );
}

function CityRow({
  data,
  onClick,
  onHover,
  onLeave
}: {
  data: CriblivSuggestion;
  onClick: () => void;
  onHover?: () => void;
  onLeave?: () => void;
}) {
  const meta = [
    typeof data.listing_count === "number"
      ? `${data.listing_count} listing${data.listing_count === 1 ? "" : "s"}`
      : null,
    data.rent_band ? formatRentBand(data.rent_band.min, data.rent_band.max) : null
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      className="search-dropdown__row"
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
    >
      <span className="search-dropdown__avatar search-dropdown__avatar--city">
        {letterAvatar(data.label)}
      </span>
      <span className="search-dropdown__row-body">
        <span className="search-dropdown__row-title">{data.label}</span>
        {meta ? <span className="search-dropdown__row-meta">{meta}</span> : null}
      </span>
      <span className="search-dropdown__row-key" aria-hidden="true">
        ↵
      </span>
    </button>
  );
}

function LocalityRow({
  data,
  onClick,
  onHover,
  onLeave
}: {
  data: CriblivSuggestion;
  onClick: () => void;
  onHover?: () => void;
  onLeave?: () => void;
}) {
  const labelParts = data.label.split(",");
  const name = labelParts[0]?.trim() || data.label;
  const cityName = labelParts.slice(1).join(",").trim();
  const meta = [
    typeof data.listing_count === "number"
      ? `${data.listing_count} listing${data.listing_count === 1 ? "" : "s"}`
      : null,
    data.rent_band ? formatRentBand(data.rent_band.min, data.rent_band.max) : null,
    cityName ? cityName.charAt(0).toUpperCase() + cityName.slice(1) : null
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      className="search-dropdown__row"
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
    >
      <span className="search-dropdown__avatar search-dropdown__avatar--locality">
        <Building2 size={16} aria-hidden="true" />
      </span>
      <span className="search-dropdown__row-body">
        <span className="search-dropdown__row-title">{name}</span>
        {meta ? <span className="search-dropdown__row-meta">{meta}</span> : null}
      </span>
    </button>
  );
}

function ListingRow({ data, onClick }: { data: CriblivSuggestion; onClick: () => void }) {
  const metaPieces: string[] = [];
  if (typeof data.rent === "number") metaPieces.push(`${formatRent(data.rent)}/mo`);
  if (data.locality_label) {
    metaPieces.push(data.locality_label.charAt(0).toUpperCase() + data.locality_label.slice(1));
  }
  if (data.posted_at) {
    const ago = formatTimeAgo(data.posted_at);
    if (ago) metaPieces.push(ago);
  }
  return (
    <button type="button" className="search-dropdown__row" onClick={onClick}>
      <span className="search-dropdown__thumb">
        {data.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.cover_url} alt="" loading="lazy" />
        ) : (
          <Home size={18} aria-hidden="true" />
        )}
        {data.verified ? (
          <span className="search-dropdown__verified" aria-label="Verified">
            <BadgeCheck size={12} />
          </span>
        ) : null}
      </span>
      <span className="search-dropdown__row-body">
        <span className="search-dropdown__row-title">{data.label}</span>
        {metaPieces.length > 0 ? (
          <span className="search-dropdown__row-meta">{metaPieces.join(" · ")}</span>
        ) : null}
      </span>
    </button>
  );
}

function GoogleRow({ data, onClick }: { data: PlacePrediction; onClick: () => void }) {
  return (
    <button type="button" className="search-dropdown__row" onClick={onClick}>
      <span className="search-dropdown__avatar search-dropdown__avatar--google">
        <MapPin size={16} aria-hidden="true" />
      </span>
      <span className="search-dropdown__row-body">
        <span className="search-dropdown__row-title">
          {data.structured_formatting?.main_text ?? data.description}
        </span>
        {data.structured_formatting?.secondary_text ? (
          <span className="search-dropdown__row-meta">
            {data.structured_formatting.secondary_text}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function RecentRow({
  text,
  onPick,
  onRemove
}: {
  text: string;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="search-dropdown__row search-dropdown__row--recent">
      <button type="button" className="search-dropdown__row-main" onClick={onPick}>
        <span className="search-dropdown__avatar search-dropdown__avatar--recent">
          <Clock size={14} aria-hidden="true" />
        </span>
        <span className="search-dropdown__row-body">
          <span className="search-dropdown__row-title">{text}</span>
        </span>
      </button>
      <button
        type="button"
        className="search-dropdown__row-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${text} from recent searches`}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

const STAGE_ORDER: VoiceStage[] = ["listening", "transcribing", "parsing", "searching"];
const STAGE_LABELS: Record<VoiceStage, string> = {
  idle: "",
  listening: "Listening",
  transcribing: "Transcribing",
  parsing: "Understanding",
  searching: "Searching",
  error: ""
};

function SmartChipStrip({
  chips,
  confidence,
  onRemove
}: {
  chips: ParsedChip[];
  confidence: number;
  onRemove: (chip: ParsedChip) => void;
}) {
  return (
    <div className="search-chips" aria-live="polite">
      <span className="search-chips__label">
        <span className="search-chips__sparkle" aria-hidden="true">
          ✦
        </span>{" "}
        Understood as
      </span>
      {chips.map((chip) => (
        <button
          key={`${chip.kind}-${chip.value}`}
          type="button"
          className={`search-chip search-chip--${chip.kind}`}
          onClick={() => onRemove(chip)}
          aria-label={`Remove ${chip.label}`}
        >
          {chip.label}
          <X size={12} aria-hidden="true" />
        </button>
      ))}
      {confidence < 0.7 ? <span className="search-chips__hint">+ refining…</span> : null}
    </div>
  );
}

function VoiceStageStrip({ stage }: { stage: VoiceStage }) {
  const currentIndex = STAGE_ORDER.indexOf(stage);
  return (
    <div className="voice-stages" aria-live="polite">
      {STAGE_ORDER.map((s, i) => {
        const isDone = currentIndex > i;
        const isActive = currentIndex === i;
        const cls = isActive
          ? "voice-stages__pill voice-stages__pill--active"
          : isDone
            ? "voice-stages__pill voice-stages__pill--done"
            : "voice-stages__pill";
        return (
          <span key={s} className={cls}>
            <span className="voice-stages__dot" aria-hidden="true" />
            {STAGE_LABELS[s]}
          </span>
        );
      })}
    </div>
  );
}
