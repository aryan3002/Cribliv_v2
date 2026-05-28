"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useMapState, useMapDispatch, type MapFilters } from "../hooks/useMapState";

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

interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Mobile-first bottom-sheet filter drawer for CriblMap.
 * Provides BHK, rent, type, and verified-only filter controls.
 */
export function FilterDrawer({ open, onClose }: FilterDrawerProps) {
  const { filters } = useMapState();
  const dispatch = useMapDispatch();

  const updateFilter = useCallback(
    (update: Partial<MapFilters>) => {
      dispatch({
        type: "SET_FILTERS",
        filters: { ...filters, ...update }
      });
    },
    [dispatch, filters]
  );

  const activeCount = [
    filters.bhk,
    filters.max_rent,
    filters.listing_type,
    filters.verified_only,
    filters.near_metro
  ].filter(Boolean).length;

  const handleClearAll = useCallback(() => {
    dispatch({ type: "SET_FILTERS", filters: {} });
  }, [dispatch]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="cmap-filter-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            className="cmap-filter-drawer"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Drag handle */}
            <div className="cmap-filter-drawer__handle" />

            <div className="cmap-filter-drawer__header">
              <SlidersHorizontal size={18} />
              <h3>Filters</h3>
              {activeCount > 0 && <span className="cmap-filter-drawer__badge">{activeCount}</span>}
              <button className="cmap-panel__close" onClick={onClose} aria-label="Close filters">
                <X size={16} />
              </button>
            </div>

            <div className="cmap-filter-drawer__body">
              {/* BHK */}
              <div className="cmap-filter-drawer__section">
                <label>BHK</label>
                <div className="cmap-seeker-form__chips">
                  {BHK_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      className={`cmap-filter-chip${filters.bhk === opt.value ? " cmap-filter-chip--active" : ""}`}
                      onClick={() => updateFilter({ bhk: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rent */}
              <div className="cmap-filter-drawer__section">
                <label>Max Rent</label>
                <div className="cmap-seeker-form__chips">
                  {RENT_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      className={`cmap-filter-chip${filters.max_rent === opt.value ? " cmap-filter-chip--active" : ""}`}
                      onClick={() => updateFilter({ max_rent: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type */}
              <div className="cmap-filter-drawer__section">
                <label>Type</label>
                <div className="cmap-seeker-form__chips">
                  <button
                    className={`cmap-filter-chip${!filters.listing_type ? " cmap-filter-chip--active" : ""}`}
                    onClick={() => updateFilter({ listing_type: undefined })}
                  >
                    All
                  </button>
                  <button
                    className={`cmap-filter-chip${filters.listing_type === "flat_house" ? " cmap-filter-chip--active" : ""}`}
                    onClick={() => updateFilter({ listing_type: "flat_house" })}
                  >
                    Flat / House
                  </button>
                  <button
                    className={`cmap-filter-chip${filters.listing_type === "pg" ? " cmap-filter-chip--active" : ""}`}
                    onClick={() => updateFilter({ listing_type: "pg" })}
                  >
                    PG
                  </button>
                </div>
              </div>

              {/* Verified only */}
              <div className="cmap-filter-drawer__section">
                <label className="cmap-filter-drawer__toggle">
                  <input
                    type="checkbox"
                    checked={filters.verified_only ?? false}
                    onChange={(e) => updateFilter({ verified_only: e.target.checked || undefined })}
                  />
                  <span>Verified listings only</span>
                </label>
              </div>

              {/* Near Metro */}
              <div className="cmap-filter-drawer__section">
                <label className="cmap-filter-drawer__toggle">
                  <input
                    type="checkbox"
                    checked={filters.near_metro ?? false}
                    onChange={(e) => updateFilter({ near_metro: e.target.checked || undefined })}
                  />
                  <span>Near metro station (within 1km)</span>
                </label>
              </div>
            </div>

            <div className="cmap-filter-drawer__footer">
              <button
                className="cmap-listing__cta cmap-listing__cta--secondary"
                onClick={handleClearAll}
                disabled={activeCount === 0}
              >
                Clear All
              </button>
              <button className="cmap-listing__cta cmap-listing__cta--primary" onClick={onClose}>
                Apply Filters
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Floating trigger button for mobile — opens the FilterDrawer.
 */
export function FilterDrawerTrigger({ onClick }: { onClick: () => void }) {
  const { filters } = useMapState();
  const activeCount = [
    filters.bhk,
    filters.max_rent,
    filters.listing_type,
    filters.verified_only,
    filters.near_metro
  ].filter(Boolean).length;

  return (
    <button className="cmap-filter-trigger" onClick={onClick} aria-label="Open filters">
      <SlidersHorizontal size={16} />
      <span>Filters</span>
      {activeCount > 0 && <span className="cmap-filter-trigger__badge">{activeCount}</span>}
    </button>
  );
}
