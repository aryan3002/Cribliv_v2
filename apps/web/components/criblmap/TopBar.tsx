"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { Search, Map, List, ChevronDown } from "lucide-react";
import { useGooglePlaces, type PlacePrediction } from "../../lib/google-places";
import { useMapState, useMapDispatch, type MapFilters } from "./hooks/useMapState";
import { buildSearchQuery } from "../../lib/api";

interface TopBarProps {
  locale: string;
  onPlaceSelect?: (lat: number, lng: number) => void;
}

const BHK_OPTIONS = [
  { label: "Any BHK", value: undefined },
  { label: "1 BHK", value: 1 },
  { label: "2 BHK", value: 2 },
  { label: "3 BHK", value: 3 },
  { label: "4+ BHK", value: 4 }
];

const RENT_OPTIONS = [
  { label: "Any Rent", value: undefined },
  { label: "Under ₹10K", value: 10000 },
  { label: "Under ₹15K", value: 15000 },
  { label: "Under ₹20K", value: 20000 },
  { label: "Under ₹25K", value: 25000 },
  { label: "Under ₹30K", value: 30000 },
  { label: "Under ₹40K", value: 40000 },
  { label: "Under ₹50K", value: 50000 }
];

export function TopBar({ locale, onPlaceSelect }: TopBarProps) {
  const { filters } = useMapState();
  const dispatch = useMapDispatch();
  const { predictions, fetchPredictions, getPlaceDetails, clearPredictions, enabled } =
    useGooglePlaces({ types: ["locality", "sublocality", "neighborhood"] });

  const [query, setQuery] = useState("");
  const [showPredictions, setShowPredictions] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowPredictions(false);
      }
      setActiveDropdown(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearchInput = useCallback(
    (value: string) => {
      setQuery(value);
      if (enabled && value.length >= 2) {
        fetchPredictions(value);
        setShowPredictions(true);
      } else {
        setShowPredictions(false);
      }
    },
    [enabled, fetchPredictions]
  );

  const handlePredictionSelect = useCallback(
    async (prediction: PlacePrediction) => {
      setQuery(prediction.structured_formatting.main_text);
      setShowPredictions(false);
      clearPredictions();
      const details = await getPlaceDetails(prediction.place_id);
      if (details && onPlaceSelect) {
        onPlaceSelect(details.geometry.lat, details.geometry.lng);
      }
    },
    [getPlaceDetails, clearPredictions, onPlaceSelect]
  );

  const updateFilter = useCallback(
    (update: Partial<MapFilters>) => {
      dispatch({
        type: "SET_FILTERS",
        filters: { ...filters, ...update }
      });
      setActiveDropdown(null);
    },
    [dispatch, filters]
  );

  const bhkLabel = filters.bhk ? `${filters.bhk} BHK` : "BHK";
  const rentLabel = filters.max_rent ? `Under ₹${(filters.max_rent / 1000).toFixed(0)}K` : "Rent";

  const filterParams = buildSearchQuery({
    ...(filters.bhk && { bhk: filters.bhk }),
    ...(filters.max_rent && { max_rent: filters.max_rent }),
    ...(filters.listing_type && { listing_type: filters.listing_type }),
    ...(filters.verified_only && { verified_only: "true" })
  });

  return (
    <div className="cmap-topbar">
      <Link href={`/${locale}`} className="cmap-topbar__logo">
        Cribl<span>Map</span>
      </Link>

      <div className="cmap-topbar__search" ref={searchRef}>
        <Search size={16} className="cmap-topbar__search-icon" />
        <input
          type="text"
          className="cmap-topbar__input"
          placeholder="Search locality or area..."
          value={query}
          onChange={(e) => handleSearchInput(e.target.value)}
          onFocus={() => predictions.length > 0 && setShowPredictions(true)}
        />
        {showPredictions && predictions.length > 0 && (
          <div className="cmap-topbar__predictions">
            {predictions.map((p) => (
              <button
                key={p.place_id}
                className="cmap-topbar__prediction-item"
                onClick={() => handlePredictionSelect(p)}
              >
                <Map size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                <span>{p.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cmap-topbar__filters">
        {/* BHK Filter */}
        <div className="cmap-filter-dropdown">
          <button
            className={`cmap-filter-chip${filters.bhk ? " cmap-filter-chip--active" : ""}`}
            onClick={() => setActiveDropdown(activeDropdown === "bhk" ? null : "bhk")}
          >
            {bhkLabel} <ChevronDown size={12} />
          </button>
          {activeDropdown === "bhk" && (
            <div className="cmap-filter-dropdown__menu">
              {BHK_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  className={`cmap-filter-dropdown__item${filters.bhk === opt.value ? " cmap-filter-dropdown__item--active" : ""}`}
                  onClick={() => updateFilter({ bhk: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Rent Filter */}
        <div className="cmap-filter-dropdown">
          <button
            className={`cmap-filter-chip${filters.max_rent ? " cmap-filter-chip--active" : ""}`}
            onClick={() => setActiveDropdown(activeDropdown === "rent" ? null : "rent")}
          >
            {rentLabel} <ChevronDown size={12} />
          </button>
          {activeDropdown === "rent" && (
            <div className="cmap-filter-dropdown__menu">
              {RENT_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  className={`cmap-filter-dropdown__item${filters.max_rent === opt.value ? " cmap-filter-dropdown__item--active" : ""}`}
                  onClick={() => updateFilter({ max_rent: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Type Filter */}
        <button
          className={`cmap-filter-chip${filters.listing_type === "pg" ? " cmap-filter-chip--active" : ""}`}
          onClick={() =>
            updateFilter({
              listing_type: filters.listing_type === "pg" ? undefined : "pg"
            })
          }
        >
          PG
        </button>

        {/* Verified Toggle */}
        <button
          className={`cmap-filter-chip${filters.verified_only ? " cmap-filter-chip--active" : ""}`}
          onClick={() => updateFilter({ verified_only: !filters.verified_only })}
        >
          ✓ Verified
        </button>
      </div>

      <div className="cmap-view-toggle">
        <span className="cmap-view-toggle__btn cmap-view-toggle__btn--active">
          <Map size={14} /> Map
        </span>
        <Link
          href={`/${locale}/search${filterParams ? `?${filterParams}` : ""}`}
          className="cmap-view-toggle__btn"
        >
          <List size={14} /> List
        </Link>
      </div>
    </div>
  );
}
