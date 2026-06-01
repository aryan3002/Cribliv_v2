"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { buildSearchQuery } from "../../../lib/api";
import { Bell, BellRing } from "lucide-react";

interface SortOption {
  key: string;
  label: string;
}

interface City {
  slug: string;
  label: string;
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
  { key: "semi_furnished", label: "Semi-Furnished" },
  { key: "unfurnished", label: "Unfurnished" }
];

/**
 * Advanced (Homes-segment) filters for /search: city, BHK, furnishing, rent,
 * verified, sort + save-search. The text query and the Homes|PG segment toggle
 * live in the shared <SegmentedSearchBar>; listing type is owned by the segment
 * (/search is flats & houses only), so there is no listing-type toggle here.
 */
export function SearchFilters({ locale, filters, cities, sortOptions }: SearchFiltersProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { data: session } = useSession();
  const accessToken = session?.accessToken ?? null;

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const hasFilters = !!(filters.city || filters.bhk || filters.max_rent);

  async function handleSaveSearch() {
    if (!accessToken) {
      router.push(`/${locale}/auth/login?from=/${locale}/search?${buildSearchQuery(filters)}`);
      return;
    }
    setSaveState("saving");
    try {
      const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
        /\/+$/,
        ""
      );
      const base = apiBase.endsWith("/v1") ? apiBase : `${apiBase}/v1`;
      const body: Record<string, unknown> = {};
      if (filters.city) body.city_slug = filters.city;
      if (filters.bhk) body.bhk = Number(filters.bhk);
      if (filters.max_rent) body.max_rent = Number(filters.max_rent);

      const res = await fetch(`${base}/tenant/saved-searches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error("failed");
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 3000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  }

  const navigate = useCallback(
    (newFilters: Record<string, string>) => {
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

  return (
    <div className="search-filters" data-pending={isPending || undefined}>
      {/* ── Row 1: Sort + Save ── */}
      <div className="search-filters__row">
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

        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={!hasFilters || saveState === "saving" || saveState === "saved"}
          onClick={handleSaveSearch}
          title={!hasFilters ? "Add filters to save a search" : undefined}
          style={{
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            ...(saveState === "saved"
              ? { borderColor: "var(--trust, #22c55e)", color: "var(--trust, #22c55e)" }
              : {}),
            ...(saveState === "error" ? { borderColor: "#ef4444", color: "#ef4444" } : {})
          }}
        >
          {saveState === "saved" ? <BellRing size={15} /> : <Bell size={15} />}
          {saveState === "idle" && "Save Search"}
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "✓ Saved!"}
          {saveState === "error" && "Failed — retry?"}
        </button>
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
