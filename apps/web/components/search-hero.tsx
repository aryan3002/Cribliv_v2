"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { trackEvent } from "../lib/analytics";
import { buildSearchQuery, fetchApi } from "../lib/api";
import { VoiceSearchButton } from "./voice-search-button";
import { useGooglePlaces, type PlacePrediction } from "../lib/google-places";
import { MapPin, Building2, Home, Mic, Search } from "lucide-react";

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
}

type BlendedSuggestion =
  | { source: "cribliv"; data: CriblivSuggestion }
  | { source: "google"; data: PlacePrediction };

export function SearchHero({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [clarification, setClarification] = useState<
    AgenticRouteResponse["clarifying_question"] | null
  >(null);
  const [baseFilters, setBaseFilters] = useState<Record<string, string | number | boolean>>({});

  // -- Autocomplete state --
  const [suggestions, setSuggestions] = useState<BlendedSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const {
    predictions: placePredictions,
    fetchPredictions: fetchPlaces,
    getPlaceDetails,
    clearPredictions,
    enabled: placesEnabled
  } = useGooglePlaces({ types: ["locality", "sublocality", "neighborhood"] });

  // Fetch internal suggest API
  const fetchCriblivSuggestions = useCallback(async (q: string): Promise<CriblivSuggestion[]> => {
    if (q.length < 2) return [];
    try {
      const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
        /\/+$/,
        ""
      );
      const base = apiBase.endsWith("/v1") ? apiBase : `${apiBase}/v1`;
      const res = await fetch(`${base}/listings/search/suggest?q=${encodeURIComponent(q)}&limit=6`);
      if (res.ok) {
        const body = await res.json();
        return body.data ?? [];
      }
    } catch {
      /* no-op */
    }
    return [];
  }, []);

  // Blend results when either source updates
  const onInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (transcript) setTranscript(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (value.length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        clearPredictions();
        return;
      }
      debounceRef.current = setTimeout(async () => {
        // Fire both sources in parallel
        const [cribliv] = await Promise.all([
          fetchCriblivSuggestions(value),
          placesEnabled ? fetchPlaces(value) : Promise.resolve()
        ]);
        const blended: BlendedSuggestion[] = cribliv.map((d) => ({
          source: "cribliv" as const,
          data: d
        }));
        setSuggestions(blended);
        setShowSuggestions(true);
      }, 250);
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
    const search = buildSearchQuery({ ...filters, q: query });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push(`/${locale}/search${search ? `?${search}` : ""}` as any);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setClarification(null);
    setTranscript(null);
    setShowSuggestions(false);
    setLoading(true);
    trackEvent("agentic_query_submitted", { query_text: query, lang_detected: locale });

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

  function applyClarification(option: string) {
    if (!clarification) return;
    const nextFilters = { ...baseFilters };
    if (clarification.id.includes("city") || clarification.id === "empty_voice_result") {
      setQuery(option);
      const search = buildSearchQuery({ q: option });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push(`/${locale}/search${search ? `?${search}` : ""}` as any);
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
      // Use as a text query — the agentic router will parse the city/locality
      const search = buildSearchQuery({ q: locationName });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push(`/${locale}/search${search ? `?${search}` : ""}` as any);
    } else {
      const { data } = s;
      trackEvent("suggest_selected", { type: data.type, value: data.value });
      if (data.type === "city") {
        setQuery("");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.push(`/${locale}/search?${buildSearchQuery({ city: data.value })}` as any);
      } else {
        setQuery(data.label);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.push(`/${locale}/search?${buildSearchQuery({ q: data.label })}` as any);
      }
    }
  }

  return (
    <div className="search-hero-wrapper" ref={wrapperRef}>
      <form className="hero-search" onSubmit={onSubmit}>
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
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder={t(locale, "searchPlaceholder")}
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
          />
          <button type="submit" className="hero-search__btn" disabled={loading}>
            <Search size={16} aria-hidden="true" />
            <span className="search-btn-label">{loading ? "Searching…" : "Search"}</span>
          </button>
        </div>
      </form>

      {/* Autocomplete Dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <ul className="hero-search__suggestions">
          {suggestions.map((s, i) => (
            <li key={s.source === "google" ? `g-${s.data.place_id}` : `c-${s.data.value}-${i}`}>
              <button
                type="button"
                className="hero-search__suggestion-item"
                onClick={() => handleSuggestionClick(s)}
              >
                <span className="hero-search__suggestion-icon">
                  {s.source === "google" ? (
                    <MapPin size={16} />
                  ) : s.data.type === "city" ? (
                    <Building2 size={16} />
                  ) : s.data.type === "locality" ? (
                    <Building2 size={16} />
                  ) : (
                    <Home size={16} />
                  )}
                </span>
                <span className="hero-search__suggestion-text">
                  {s.source === "google" ? s.data.description : s.data.label}
                </span>
                <span className="hero-search__suggestion-badge">
                  {s.source === "google" ? "Google" : s.data.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

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
