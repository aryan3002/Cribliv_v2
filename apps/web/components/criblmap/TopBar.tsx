"use client";

import type { Route } from "next";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Search,
  Map,
  List,
  ChevronDown,
  Building2,
  Home,
  ShieldCheck,
  TrainFront,
  SlidersHorizontal
} from "lucide-react";
import { useGooglePlaces, type PlacePrediction } from "../../lib/google-places";
import { useMapState, useMapDispatch, type MapFilters } from "./hooks/useMapState";
import { buildSearchQuery } from "../../lib/api";
import { searchMapIndex, type MapSearchHit } from "../../lib/map-search-index";

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
  const [isMac, setIsMac] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const localSuggestions = useMemo(() => searchMapIndex(query), [query]);

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

  // Detect platform once for the right keyboard glyph.
  useEffect(() => {
    setIsMac(typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  // ⌘K / Ctrl+K to focus the search input — the hallmark "power tool" hotkey.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      if (k === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (k === "escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setShowPredictions(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const handleSearchInput = useCallback(
    (value: string) => {
      setQuery(value);
      if (value.trim().length >= 2) {
        if (enabled) {
          fetchPredictions(value);
        }
        setShowPredictions(true);
      } else {
        setShowPredictions(false);
      }
    },
    [enabled, fetchPredictions]
  );

  const handleLocalSelect = useCallback(
    (hit: MapSearchHit) => {
      setQuery(hit.label);
      setShowPredictions(false);
      clearPredictions();
      dispatch({ type: "SET_CITY", city: hit.city });
      onPlaceSelect?.(hit.lat, hit.lng);
    },
    [clearPredictions, dispatch, onPlaceSelect]
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

  const handleSubmit = useCallback(() => {
    const firstLocal = localSuggestions[0];
    if (firstLocal) {
      handleLocalSelect(firstLocal);
      return;
    }
    const firstPrediction = predictions[0];
    if (firstPrediction) {
      void handlePredictionSelect(firstPrediction);
      return;
    }
    if (enabled && query.trim().length >= 2) {
      fetchPredictions(query);
      setShowPredictions(true);
    }
  }, [
    enabled,
    fetchPredictions,
    handleLocalSelect,
    handlePredictionSelect,
    localSuggestions,
    predictions,
    query
  ]);

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

  const resetFilters = useCallback(() => {
    dispatch({ type: "SET_FILTERS", filters: {} });
    setActiveDropdown(null);
  }, [dispatch]);

  const bhkLabel = filters.bhk ? `${filters.bhk} BHK` : "BHK";
  const rentLabel = filters.max_rent ? `Under ₹${(filters.max_rent / 1000).toFixed(0)}K` : "Rent";
  const activeFilterCount = [
    filters.bhk,
    filters.max_rent,
    filters.listing_type,
    filters.verified_only,
    filters.near_metro
  ].filter(Boolean).length;

  const filterParams = buildSearchQuery({
    ...(filters.bhk && { bhk: filters.bhk }),
    ...(filters.max_rent && { max_rent: filters.max_rent }),
    ...(filters.listing_type && { listing_type: filters.listing_type }),
    ...(filters.verified_only && { verified_only: "true" }),
    ...(filters.near_metro && { near_metro: "true" })
  });

  return (
    <div className="cmap-topbar">
      <div className="cmap-topbar__main">
        <Link
          href={`/${locale}` as Route}
          className="cmap-brand"
          aria-label="Cribliv Map — back to home"
        >
          <Image
            src="/cribliv-logo-new.svg"
            alt=""
            width={28}
            height={28}
            priority
            className="cmap-brand__icon"
          />
          <Image
            src="/criblivFont.png"
            alt="Cribliv"
            width={72}
            height={24}
            priority
            className="cmap-brand__wordmark"
          />
          <span className="cmap-brand__sep" aria-hidden="true" />
          <span className="cmap-brand__suffix">Map</span>
        </Link>

        <div className="cmap-segmented" aria-label="Listing type">
          <button
            type="button"
            className={`cmap-segmented__btn${!filters.listing_type ? " cmap-segmented__btn--active" : ""}`}
            onClick={() => updateFilter({ listing_type: undefined })}
          >
            All
          </button>
          <button
            type="button"
            className={`cmap-segmented__btn${filters.listing_type === "flat_house" ? " cmap-segmented__btn--active" : ""}`}
            onClick={() => updateFilter({ listing_type: "flat_house" })}
          >
            <Home size={13} /> Flat
          </button>
          <button
            type="button"
            className={`cmap-segmented__btn${filters.listing_type === "pg" ? " cmap-segmented__btn--active" : ""}`}
            onClick={() => updateFilter({ listing_type: "pg" })}
          >
            <Building2 size={13} /> PG
          </button>
        </div>

        <div className="cmap-topbar__search" ref={searchRef}>
          <Search size={16} className="cmap-topbar__search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cmap-topbar__input"
            placeholder="Search locality, metro, or area"
            value={query}
            onChange={(e) => handleSearchInput(e.target.value)}
            onFocus={() =>
              (localSuggestions.length > 0 || predictions.length > 0) && setShowPredictions(true)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          {!query && (
            <kbd className="cmap-topbar__kbd" aria-label="Press Command K to focus search">
              <span className="cmap-topbar__kbd-key">{isMac ? "⌘" : "Ctrl"}</span>
              <span className="cmap-topbar__kbd-key">K</span>
            </kbd>
          )}
          {showPredictions && (localSuggestions.length > 0 || predictions.length > 0) && (
            <div className="cmap-topbar__predictions">
              {localSuggestions.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  className="cmap-topbar__prediction-item"
                  onClick={() => handleLocalSelect(hit)}
                >
                  <Map size={14} style={{ opacity: 0.7, flexShrink: 0 }} />
                  <span>
                    {hit.label}
                    <small>{hit.detail}</small>
                  </span>
                </button>
              ))}
              {predictions.map((p) => (
                <button
                  key={p.place_id}
                  type="button"
                  className="cmap-topbar__prediction-item"
                  onClick={() => handlePredictionSelect(p)}
                >
                  <Map size={14} style={{ opacity: 0.7, flexShrink: 0 }} />
                  <span>{p.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Link href={`/${locale}/become-owner` as Route} className="cmap-topbar__owner-link">
          List your property
        </Link>

        <div className="cmap-view-toggle">
          <span className="cmap-view-toggle__btn cmap-view-toggle__btn--active">
            <Map size={14} /> Map
          </span>
          <Link
            href={`/${locale}/search${filterParams ? `?${filterParams}` : ""}` as Route}
            className="cmap-view-toggle__btn"
          >
            <List size={14} /> List
          </Link>
        </div>
      </div>

      <div className="cmap-topbar__filters">
        <span className="cmap-topbar__filter-label">
          <SlidersHorizontal size={13} /> Filters
          {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
        </span>

        <div className="cmap-filter-dropdown">
          <button
            type="button"
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
                  type="button"
                  className={`cmap-filter-dropdown__item${filters.bhk === opt.value ? " cmap-filter-dropdown__item--active" : ""}`}
                  onClick={() => updateFilter({ bhk: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="cmap-filter-dropdown">
          <button
            type="button"
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
                  type="button"
                  className={`cmap-filter-dropdown__item${filters.max_rent === opt.value ? " cmap-filter-dropdown__item--active" : ""}`}
                  onClick={() => updateFilter({ max_rent: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className={`cmap-filter-chip${filters.verified_only ? " cmap-filter-chip--active" : ""}`}
          onClick={() => updateFilter({ verified_only: !filters.verified_only })}
        >
          <ShieldCheck size={13} /> Verified only
        </button>

        <button
          type="button"
          className={`cmap-filter-chip${filters.near_metro ? " cmap-filter-chip--active" : ""}`}
          onClick={() => updateFilter({ near_metro: !filters.near_metro })}
        >
          <TrainFront size={13} /> Near metro
        </button>

        <button
          type="button"
          className="cmap-filter-chip cmap-filter-chip--ghost"
          onClick={resetFilters}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
