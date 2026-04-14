"use client";

import { useState, useCallback } from "react";
import { MapPinPlus, Loader2 } from "lucide-react";
import { useMapState, useMapDispatch } from "../hooks/useMapState";
import { fetchApi } from "../../../lib/api";

interface SeekerFormPanelProps {
  locale: string;
}

const BHK_OPTIONS = [1, 2, 3, 4];
const MOVE_IN_OPTIONS = [
  { value: "immediate", label: "ASAP" },
  { value: "within_month", label: "Within 1 month" },
  { value: "within_3_months", label: "Within 3 months" },
  { value: "flexible", label: "Flexible" }
];

export function SeekerFormPanel({ locale }: SeekerFormPanelProps) {
  const { center } = useMapState();
  const dispatch = useMapDispatch();

  const [budgetMin, setBudgetMin] = useState(5000);
  const [budgetMax, setBudgetMax] = useState(25000);
  const [bhkPreference, setBhkPreference] = useState<number[]>([2]);
  const [moveIn, setMoveIn] = useState("flexible");
  const [listingType, setListingType] = useState("flat_house");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const toggleBhk = useCallback((bhk: number) => {
    setBhkPreference((prev) =>
      prev.includes(bhk) ? prev.filter((b) => b !== bhk) : [...prev, bhk]
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      await fetchApi("/map/seekers", {
        method: "POST",
        body: JSON.stringify({
          lat: center.lat,
          lng: center.lng,
          budget_min: budgetMin,
          budget_max: budgetMax,
          bhk_preference: bhkPreference,
          move_in: moveIn,
          listing_type: listingType,
          note: note || undefined
        })
      });

      setSubmitted(true);
      setTimeout(() => {
        dispatch({ type: "DESELECT_PIN" });
      }, 2000);
    } catch {
      /* handle error silently for now */
    } finally {
      setSubmitting(false);
    }
  }, [
    center,
    budgetMin,
    budgetMax,
    bhkPreference,
    moveIn,
    listingType,
    note,
    submitting,
    dispatch
  ]);

  if (submitted) {
    return (
      <div className="cmap-seeker-form">
        <div className="cmap-seeker-form__success">
          <MapPinPlus size={32} />
          <h3>Search pin dropped!</h3>
          <p>Owners in this area can now see your requirement. Your pin is active for 30 days.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cmap-seeker-form">
      <div className="cmap-seeker-form__intro">
        <MapPinPlus size={20} />
        <p>Drop a search pin to let owners know what you&apos;re looking for in this area.</p>
      </div>

      <div className="cmap-seeker-form__field">
        <label>Budget Range</label>
        <div className="cmap-seeker-form__budget">
          <div className="cmap-seeker-form__budget-input">
            <span>₹</span>
            <input
              type="number"
              value={budgetMin}
              onChange={(e) => setBudgetMin(Number(e.target.value))}
              min={0}
              step={1000}
            />
          </div>
          <span className="cmap-seeker-form__budget-sep">to</span>
          <div className="cmap-seeker-form__budget-input">
            <span>₹</span>
            <input
              type="number"
              value={budgetMax}
              onChange={(e) => setBudgetMax(Number(e.target.value))}
              min={1000}
              step={1000}
            />
          </div>
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>BHK Preference</label>
        <div className="cmap-seeker-form__chips">
          {BHK_OPTIONS.map((bhk) => (
            <button
              key={bhk}
              className={`cmap-filter-chip${bhkPreference.includes(bhk) ? " cmap-filter-chip--active" : ""}`}
              onClick={() => toggleBhk(bhk)}
            >
              {bhk} BHK
            </button>
          ))}
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>Move-in Timing</label>
        <div className="cmap-seeker-form__chips">
          {MOVE_IN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`cmap-filter-chip${moveIn === opt.value ? " cmap-filter-chip--active" : ""}`}
              onClick={() => setMoveIn(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>Type</label>
        <div className="cmap-seeker-form__chips">
          <button
            className={`cmap-filter-chip${listingType === "flat_house" ? " cmap-filter-chip--active" : ""}`}
            onClick={() => setListingType("flat_house")}
          >
            Flat / House
          </button>
          <button
            className={`cmap-filter-chip${listingType === "pg" ? " cmap-filter-chip--active" : ""}`}
            onClick={() => setListingType("pg")}
          >
            PG
          </button>
        </div>
      </div>

      <div className="cmap-seeker-form__field">
        <label>Note (optional)</label>
        <textarea
          className="cmap-seeker-form__textarea"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 200))}
          placeholder="e.g. Family with 2 kids, need parking, pet-friendly..."
          rows={3}
          maxLength={200}
        />
        <span className="cmap-seeker-form__char-count">{note.length}/200</span>
      </div>

      <button
        className="cmap-listing__cta cmap-listing__cta--primary"
        onClick={handleSubmit}
        disabled={submitting}
      >
        {submitting ? <Loader2 size={14} className="cmap-spin" /> : <MapPinPlus size={14} />}
        {submitting ? "Dropping pin..." : "Drop Search Pin"}
      </button>
    </div>
  );
}
