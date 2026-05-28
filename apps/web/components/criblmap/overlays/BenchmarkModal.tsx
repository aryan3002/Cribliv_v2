"use client";

import { useState, useCallback } from "react";
import { X, TrendingDown, TrendingUp, Minus, Scale, Loader2 } from "lucide-react";
import { fetchApi, buildSearchQuery } from "../../../lib/api";

interface BenchmarkModalProps {
  onClose: () => void;
}

interface PricingIntel {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  sample_size: number;
}

const BHK_OPTIONS = [1, 2, 3, 4];
const FURNISHING_OPTIONS = [
  { value: "unfurnished", label: "Unfurnished" },
  { value: "semi_furnished", label: "Semi-Furnished" },
  { value: "fully_furnished", label: "Fully Furnished" }
];

function formatRent(rent: number): string {
  return rent.toLocaleString("en-IN");
}

function getPosition(
  currentRent: number,
  intel: PricingIntel
): { label: string; emoji: string; cls: string; desc: string; Icon: typeof TrendingDown } {
  if (!intel.p50) {
    return {
      label: "Not enough data",
      emoji: "📊",
      cls: "neutral",
      desc: "We need more listings in this area to give you a comparison.",
      Icon: Minus
    };
  }
  const ratio = currentRent / intel.p50;
  if (ratio < 0.85) {
    return {
      label: "Below Market!",
      emoji: "🎉",
      cls: "below",
      desc: `Your rent is significantly below the area average of ₹${formatRent(intel.p50)}. You're getting great value!`,
      Icon: TrendingDown
    };
  }
  if (ratio < 0.95) {
    return {
      label: "Slightly Below Average",
      emoji: "👍",
      cls: "below",
      desc: `Your rent is slightly below the area average of ₹${formatRent(intel.p50)}. Fair deal.`,
      Icon: TrendingDown
    };
  }
  if (ratio <= 1.05) {
    return {
      label: "At Market Average",
      emoji: "⚖️",
      cls: "at",
      desc: `Your rent is right at the market average of ₹${formatRent(intel.p50)}.`,
      Icon: Minus
    };
  }
  if (ratio <= 1.15) {
    return {
      label: "Slightly Above Average",
      emoji: "📈",
      cls: "above",
      desc: `Your rent is slightly above the area average of ₹${formatRent(intel.p50)}. May be worth negotiating.`,
      Icon: TrendingUp
    };
  }
  return {
    label: "Above Market",
    emoji: "⚠️",
    cls: "above",
    desc: `Your rent is significantly above the area average of ₹${formatRent(intel.p50)}. Consider negotiating or exploring options.`,
    Icon: TrendingUp
  };
}

export function BenchmarkModal({ onClose }: BenchmarkModalProps) {
  const [bhk, setBhk] = useState(2);
  const [furnishing, setFurnishing] = useState("semi_furnished");
  const [currentRent, setCurrentRent] = useState<number>(20000);
  const [result, setResult] = useState<PricingIntel | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildSearchQuery({
        bhk,
        listing_type: "flat_house"
      });
      const data = await fetchApi<PricingIntel>(`/listings/pricing-intel?${params}`);
      setResult(data);
    } catch {
      /* handle silently */
    } finally {
      setLoading(false);
    }
  }, [bhk]);

  const position = result ? getPosition(currentRent, result) : null;

  return (
    <div className="cmap-modal-backdrop" onClick={onClose}>
      <div className="cmap-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmap-modal__header">
          <Scale size={20} />
          <h2>Is My Rent Fair?</h2>
          <button className="cmap-panel__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {!result ? (
          <div className="cmap-modal__body">
            <div className="cmap-seeker-form__field">
              <label>BHK</label>
              <div className="cmap-seeker-form__chips">
                {BHK_OPTIONS.map((b) => (
                  <button
                    key={b}
                    className={`cmap-filter-chip${bhk === b ? " cmap-filter-chip--active" : ""}`}
                    onClick={() => setBhk(b)}
                  >
                    {b} BHK
                  </button>
                ))}
              </div>
            </div>

            <div className="cmap-seeker-form__field">
              <label>Furnishing</label>
              <div className="cmap-seeker-form__chips">
                {FURNISHING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`cmap-filter-chip${furnishing === opt.value ? " cmap-filter-chip--active" : ""}`}
                    onClick={() => setFurnishing(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cmap-seeker-form__field">
              <label>Your Current Monthly Rent</label>
              <div className="cmap-seeker-form__budget-input" style={{ maxWidth: 200 }}>
                <span>₹</span>
                <input
                  type="number"
                  value={currentRent}
                  onChange={(e) => setCurrentRent(Number(e.target.value))}
                  min={1000}
                  step={1000}
                />
              </div>
            </div>

            <button
              className="cmap-listing__cta cmap-listing__cta--primary"
              onClick={handleSubmit}
              disabled={loading}
              style={{ marginTop: 8 }}
            >
              {loading ? <Loader2 size={14} className="cmap-spin" /> : <Scale size={14} />}
              {loading ? "Analyzing..." : "Check My Rent"}
            </button>
          </div>
        ) : (
          <div className="cmap-modal__body">
            {position && (
              <div className={`cmap-benchmark__result cmap-benchmark__result--${position.cls}`}>
                <span className="cmap-benchmark__emoji">{position.emoji}</span>
                <h3>{position.label}</h3>
                <p>{position.desc}</p>
              </div>
            )}

            {result.p25 && result.p50 && result.p75 && (
              <div className="cmap-benchmark__range">
                <div className="cmap-benchmark__range-bar">
                  <div
                    className="cmap-benchmark__range-segment cmap-benchmark__range-segment--low"
                    style={{ flex: 1 }}
                  >
                    <span>₹{formatRent(result.p25)}</span>
                    <small>25th %ile</small>
                  </div>
                  <div
                    className="cmap-benchmark__range-segment cmap-benchmark__range-segment--mid"
                    style={{ flex: 1 }}
                  >
                    <span>₹{formatRent(result.p50)}</span>
                    <small>Median</small>
                  </div>
                  <div
                    className="cmap-benchmark__range-segment cmap-benchmark__range-segment--high"
                    style={{ flex: 1 }}
                  >
                    <span>₹{formatRent(result.p75)}</span>
                    <small>75th %ile</small>
                  </div>
                </div>
                <div className="cmap-benchmark__your-rent">
                  Your rent: <strong>₹{formatRent(currentRent)}</strong>
                </div>
              </div>
            )}

            <p className="cmap-benchmark__sample">
              Based on <strong>{result.sample_size}</strong> comparable listings
            </p>

            <button
              className="cmap-listing__cta cmap-listing__cta--secondary"
              onClick={() => setResult(null)}
              style={{ marginTop: 8 }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
