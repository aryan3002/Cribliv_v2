"use client";

import { useState, useEffect, useId } from "react";
import { setListingAvailability } from "../../lib/owner-api";
import { useFlag } from "../../lib/feature-flags";

interface ListingAvailabilityToggleProps {
  listingId: string;
  accessToken: string;
  available: boolean;
  onAvailabilityChange?: (available: boolean) => void;
  /** Hide the row label + helper copy for tight, inline placements (desktop action row). */
  showLabel?: boolean;
  errorMessage?: string;
}

/**
 * "Availability" control — distinct from the older `AvailabilityToggle`
 * (now labeled "Visibility"). This one keeps the listing fully live/searchable
 * but marks it not-available: it sinks in search ranking and starts collecting
 * "notify me" sign-ups from interested seekers, instead of hiding the listing
 * outright. Self-hides entirely when `ff_unavailable_listings` is off.
 */
export function ListingAvailabilityToggle({
  listingId,
  accessToken,
  available,
  onAvailabilityChange,
  showLabel = true,
  errorMessage = "We couldn't update availability. Please try again."
}: ListingAvailabilityToggleProps) {
  const flagOn = useFlag("ff_unavailable_listings");
  const id = useId();
  const [isAvailable, setIsAvailable] = useState(available);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsAvailable(available);
  }, [available]);

  async function handleToggle() {
    const next = !isAvailable;
    const prev = isAvailable;
    setIsAvailable(next);
    setToggling(true);
    setError(null);

    try {
      const result = await setListingAvailability(accessToken, listingId, next);
      setIsAvailable(result.is_available);
      onAvailabilityChange?.(result.is_available);
    } catch {
      setIsAvailable(prev);
      setError(errorMessage);
      setTimeout(() => setError(null), 3000);
    } finally {
      setToggling(false);
    }
  }

  if (!flagOn) return null;

  return (
    <div className="listing-availability-toggle listing-availability-toggle--touch">
      {showLabel && <span className="listing-availability-toggle__row-label">Availability</span>}

      <label htmlFor={id} className="listing-availability-toggle__label">
        <span className="listing-availability-toggle__switch">
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={isAvailable}
            aria-checked={isAvailable}
            aria-label="Availability"
            disabled={toggling}
            onChange={() => void handleToggle()}
            className="listing-availability-toggle__input"
          />
          {toggling && (
            <span className="listing-availability-toggle__spinner-wrap" aria-hidden="true">
              <span className="listing-availability-toggle__spinner" />
            </span>
          )}
        </span>

        {showLabel && (
          <span
            className={
              isAvailable
                ? "listing-availability-toggle__text"
                : "listing-availability-toggle__text listing-availability-toggle__text--amber"
            }
          >
            {isAvailable ? "Available" : "Not available"}
          </span>
        )}
      </label>

      {showLabel && (
        <p className="listing-availability-toggle__helper">
          Stays listed, sinks in search, collects notify sign-ups.
        </p>
      )}

      {error && <p className="listing-availability-toggle__error">{error}</p>}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
