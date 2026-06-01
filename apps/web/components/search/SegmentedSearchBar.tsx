"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Search, Home, Building } from "lucide-react";
import { hrefForSegment, placeSearchParam, type SearchSegment } from "../../lib/search-segment";

/**
 * The single shared search bar for the split surfaces. It owns the Homes | PG
 * segment toggle + the text query, and is mounted on the homepage hero context,
 * `/search` (Homes) and `/pg` (PG). The active segment comes from the route.
 *
 * - Submitting stays in the current segment and preserves that segment's filters.
 * - Toggling jumps to the other segment, carrying only the cross-segment params
 *   (q + city); per-segment filters (BHK, gender, …) don't translate across.
 */
export function SegmentedSearchBar({
  locale,
  segment,
  params
}: {
  locale: string;
  segment: SearchSegment;
  params: Record<string, string>;
}) {
  const router = useRouter();
  // The bar searches by CITY (the canonical, inventory-keyed param) — not a
  // free-text `q`, which on PG is a title-only match and returns nothing for a
  // city name. Prefill with the active city.
  const [text, setText] = useState(params.city ?? params.q ?? "");

  // Keep the input in sync when the place changes via navigation (e.g. clearing
  // filters) — useState only seeds on mount, so the value would otherwise go stale.
  useEffect(() => {
    setText(params.city ?? params.q ?? "");
  }, [params.city, params.q]);

  function submitSameSegment(e: React.FormEvent) {
    e.preventDefault();
    // A known city → `city=` (canonical); a locality/keyword → `q=` (matched
    // against title/city/locality). Keep this segment's other structured filters.
    const { q: _q, city: _city, ...rest } = params;
    const href = hrefForSegment(locale, segment, { ...rest, ...placeSearchParam(text) });
    router.push(href as Route);
  }

  function switchSegment(next: SearchSegment) {
    if (next === segment) return;
    // Carry the place across the toggle: the typed place if any, else the current city.
    const typed = placeSearchParam(text);
    const place = typed.city || typed.q ? typed : { city: params.city };
    const href = hrefForSegment(locale, next, place);
    router.push(href as Route);
  }

  const placeholder =
    segment === "pg" ? "Search PGs by city or area…" : "Search homes by city or area…";

  return (
    <div className="segbar">
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

      <form className="segbar__form" onSubmit={submitSameSegment}>
        <Search size={18} aria-hidden="true" className="segbar__icon" />
        <input
          className="segbar__input"
          aria-label="Search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button type="submit" className="btn btn--primary segbar__submit">
          Search
        </button>
      </form>
    </div>
  );
}
