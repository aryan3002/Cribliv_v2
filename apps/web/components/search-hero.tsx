"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { trackEvent } from "../lib/analytics";
import { buildSearchQuery, fetchApi } from "../lib/api";
import { VoiceSearchButton } from "./voice-search-button";

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

  function routeToSearch(filters: Record<string, string | number | boolean>) {
    const hasFilters = Object.keys(filters).length > 0 || query.trim().length > 0;
    if (!hasFilters) {
      // No filters resolved — show clarification instead of silently doing nothing
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
    setLoading(true);
    trackEvent("agentic_query_submitted", {
      query_text: query,
      lang_detected: locale
    });

    try {
      const response = await fetchApi<AgenticRouteResponse>("/search/agentic-route", {
        method: "POST",
        body: JSON.stringify({
          query,
          locale
        })
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
    if (!clarification) {
      return;
    }
    const nextFilters = { ...baseFilters };
    if (clarification.id.includes("city") || clarification.id === "empty_voice_result") {
      // For fallback voice results, set the option as the search query
      setQuery(option);
      const search = buildSearchQuery({ q: option });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push(`/${locale}/search${search ? `?${search}` : ""}` as any);
      return;
    }
    nextFilters.listing_type = option;
    routeToSearch(nextFilters);
  }

  return (
    <div className="search-hero-wrapper">
      <form className="hero-search" onSubmit={onSubmit}>
        <div className="hero-search__input-row">
          <input
            aria-label="Agentic search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (transcript) setTranscript(null);
            }}
            placeholder={t(locale, "searchPlaceholder")}
            className="hero-search__input"
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
            {loading ? "Routing..." : "Search"}
          </button>
        </div>
      </form>

      {/* Show voice transcript feedback */}
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
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ verticalAlign: "-2px", marginRight: 4 }}
      aria-hidden="true"
    >
      <rect x="9" y="1" width="6" height="14" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="21" x2="12" y2="17" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  );
}
