"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition, useEffect } from "react";
import { buildSearchQuery } from "../../../lib/api";
import { Search, MapPin, Building2, Home, Building } from "lucide-react";

interface SortOption {
  key: string;
  label: string;
}

interface City {
  slug: string;
  label: string;
}

interface Suggestion {
  type: "city" | "locality" | "listing";
  label: string;
  value: string;
}

interface SearchFiltersProps {
  locale: string;
  filters: Record<string, string>;
  cities: City[];
  sortOptions: SortOption[];
}

const BHKS = [1, 2, 3, 4, 5];
const FURNISHING_OPTIONS = [
  { key: "", label: "Any Furnishing" },
  { key: "fully_furnished", label: "Fully Furnished" },
  { key: "semi_furnished", label: "Semi Furnished" },
  { key: "unfurnished", label: "Unfurnished" }
];

export function SearchFilters({ locale, filters, cities, sortOptions }: SearchFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Text search state
  const [searchText, setSearchText] = useState(filters.q ?? "");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Navigate with updated filters
  const navigate = useCallback(
    (newFilters: Record<string, string>) => {
      // Remove page when filters change (reset to page 1)
      const { page: _, ...rest } = newFilters;
      startTransition(() => {
        router.push(`/${locale}/search?${buildSearchQuery(rest)}`);
      });
    },
    [locale, router]
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      if (value) {
        navigate({ ...filters, [key]: value });
      } else {
        const { [key]: _, ...rest } = filters;
        navigate(rest);
      }
    },
    [filters, navigate]
  );

  // Fetch typeahead suggestions
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
        /\/+$/,
        ""
      );
      const base = apiBase.endsWith("/v1") ? apiBase : `${apiBase}/v1`;
      const res = await fetch(`${base}/listings/search/suggest?q=${encodeURIComponent(q)}&limit=8`);
      if (res.ok) {
        const body = await res.json();
        setSuggestions(body.data ?? []);
      }
    } catch {
      /* silently swallow */
    }
  }, []);

  const onSearchInput = (value: string) => {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 250);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowSuggestions(false);
    setFilter("q", searchText.trim());
  };

  const handleSuggestionClick = (s: Suggestion) => {
    setShowSuggestions(false);
    if (s.type === "city") {
      setSearchText("");
      const { q: _, ...rest } = filters;
      navigate({ ...rest, city: s.value });
    } else if (s.type === "locality") {
      setSearchText(s.label);
      setFilter("q", s.label);
    } else {
      setSearchText(s.label);
      setFilter("q", s.label);
    }
  };

  // Click-outside to close suggestions
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="search-filters" data-pending={isPending || undefined}>
      {/* ── Row 1: Text Search + Sort ── */}
      <div className="search-filters__row">
        <div className="search-filters__search" ref={suggestRef}>
          <form onSubmit={handleSearchSubmit} className="search-filters__search-form">
            <input
              type="search"
              className="search-filters__input"
              placeholder="Search by keyword, locality, or title…"
              value={searchText}
              onChange={(e) => onSearchInput(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              aria-label="Text search"
              autoComplete="off"
            />
            <button type="submit" className="btn btn--primary btn--sm" aria-label="Search">
              <Search size={16} />
            </button>
          </form>
          {showSuggestions && suggestions.length > 0 && (
            <ul className="search-filters__suggestions">
              {suggestions.map((s, i) => (
                <li key={`${s.type}-${s.value}-${i}`}>
                  <button
                    type="button"
                    className="search-filters__suggestion-item"
                    onClick={() => handleSuggestionClick(s)}
                  >
                    <span className="search-filters__suggestion-type">
                      {s.type === "city" ? (
                        <MapPin size={16} />
                      ) : s.type === "locality" ? (
                        <Building2 size={16} />
                      ) : (
                        <Home size={16} />
                      )}
                    </span>
                    <span>{s.label}</span>
                    <span className="search-filters__suggestion-badge">{s.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <select
          className="search-filters__select"
          value={filters.sort ?? "relevance"}
          onChange={(e) => setFilter("sort", e.target.value === "relevance" ? "" : e.target.value)}
          aria-label="Sort results"
        >
          {sortOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Row 2: Filter Controls ── */}
      <div className="search-filters__row search-filters__row--filters">
        {/* City */}
        <select
          className="search-filters__select"
          value={filters.city ?? ""}
          onChange={(e) => setFilter("city", e.target.value)}
          aria-label="City"
        >
          <option value="">All Cities</option>
          {cities.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>

        {/* Listing Type */}
        <div className="search-filters__toggle" role="group" aria-label="Listing type">
          <button
            type="button"
            className={`search-filters__toggle-btn${!filters.listing_type ? " search-filters__toggle-btn--active" : ""}`}
            onClick={() => {
              const { listing_type: _, ...rest } = filters;
              navigate(rest);
            }}
          >
            All
          </button>
          <button
            type="button"
            className={`search-filters__toggle-btn${filters.listing_type === "flat_house" ? " search-filters__toggle-btn--active" : ""}`}
            onClick={() =>
              setFilter("listing_type", filters.listing_type === "flat_house" ? "" : "flat_house")
            }
          >
            <Home size={14} style={{ marginRight: 4 }} /> Flat
          </button>
          <button
            type="button"
            className={`search-filters__toggle-btn${filters.listing_type === "pg" ? " search-filters__toggle-btn--active" : ""}`}
            onClick={() => setFilter("listing_type", filters.listing_type === "pg" ? "" : "pg")}
          >
            <Building size={14} style={{ marginRight: 4 }} /> PG
          </button>
        </div>

        {/* BHK */}
        <div className="search-filters__chips" role="group" aria-label="BHK">
          {BHKS.map((bhk) => (
            <button
              key={bhk}
              type="button"
              className={`search-filters__chip${filters.bhk === String(bhk) ? " search-filters__chip--active" : ""}`}
              onClick={() => setFilter("bhk", filters.bhk === String(bhk) ? "" : String(bhk))}
            >
              {bhk} BHK
            </button>
          ))}
        </div>

        {/* Furnishing */}
        <select
          className="search-filters__select"
          value={filters.furnishing ?? ""}
          onChange={(e) => setFilter("furnishing", e.target.value)}
          aria-label="Furnishing"
        >
          {FURNISHING_OPTIONS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Rent Range */}
        <div className="search-filters__rent" role="group" aria-label="Rent range">
          <input
            type="number"
            className="search-filters__rent-input"
            placeholder="Min ₹/mo"
            value={filters.min_rent ?? ""}
            onChange={(e) => setFilter("min_rent", e.target.value)}
            min={0}
            step={1000}
          />
          <span className="search-filters__rent-sep">–</span>
          <input
            type="number"
            className="search-filters__rent-input"
            placeholder="Max ₹/mo"
            value={filters.max_rent ?? ""}
            onChange={(e) => setFilter("max_rent", e.target.value)}
            min={0}
            step={1000}
          />
        </div>

        {/* Verified Only */}
        <label className="search-filters__checkbox">
          <input
            type="checkbox"
            checked={filters.verified_only === "true"}
            onChange={(e) => setFilter("verified_only", e.target.checked ? "true" : "")}
          />
          <span>Verified</span>
        </label>
      </div>
    </div>
  );
}
