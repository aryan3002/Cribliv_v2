"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { trackEvent } from "../lib/analytics";
import { buildSearchQuery, fetchApi } from "../lib/api";

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
  const [clarification, setClarification] = useState<
    AgenticRouteResponse["clarifying_question"] | null
  >(null);
  const [baseFilters, setBaseFilters] = useState<Record<string, string | number | boolean>>({});

  function routeToSearch(filters: Record<string, string | number | boolean>) {
    const search = buildSearchQuery({ ...filters, q: query });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push(`/${locale}/search${search ? `?${search}` : ""}` as any);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setClarification(null);
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
    if (clarification.id.includes("city")) {
      nextFilters.city = option.toLowerCase();
    } else {
      nextFilters.listing_type = option;
    }
    routeToSearch(nextFilters);
  }

  return (
    <div>
      <form className="hero-search" onSubmit={onSubmit}>
        <input
          aria-label="Agentic search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(locale, "searchPlaceholder")}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Routing..." : "Search"}
        </button>
      </form>
      {error ? <p className="muted-text">{error}</p> : null}
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
