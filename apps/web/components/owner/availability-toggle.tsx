"use client";

import { useState, useEffect, useId } from "react";
import { toggleListingAvailability } from "../../lib/owner-api";

interface AvailabilityToggleProps {
  listingId: string;
  currentStatus: "active" | "paused";
  accessToken: string;
  onStatusChange?: (newStatus: "active" | "paused") => void;
  showLabel?: boolean;
  errorMessage?: string;
}

export function AvailabilityToggle({
  listingId,
  currentStatus,
  accessToken,
  onStatusChange,
  showLabel = true,
  errorMessage = "We couldn't update availability. Please try again."
}: AvailabilityToggleProps) {
  const id = useId();
  const [status, setStatus] = useState(currentStatus);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(currentStatus);
  }, [currentStatus]);

  async function handleToggle() {
    const next = status === "active" ? "paused" : "active";
    const prev = status;
    setStatus(next);
    setToggling(true);
    setError(null);

    try {
      const result = await toggleListingAvailability(accessToken, listingId, next === "active");
      setStatus(result.status);
      onStatusChange?.(result.status);
    } catch {
      setStatus(prev);
      setError(errorMessage);
      setTimeout(() => setError(null), 3000);
    } finally {
      setToggling(false);
    }
  }

  const isActive = status === "active";

  return (
    <div className="availability-toggle availability-toggle--touch">
      {showLabel && <span className="availability-toggle__row-label">Visibility</span>}

      <label htmlFor={id} className="availability-toggle__label">
        <span className="availability-toggle__switch">
          <input
            id={id}
            type="checkbox"
            checked={isActive}
            aria-label="Available to tenants"
            disabled={toggling}
            onChange={() => void handleToggle()}
            className="availability-toggle__input"
          />
          {toggling && (
            <span className="availability-toggle__spinner-wrap" aria-hidden="true">
              <span className="availability-toggle__spinner" />
            </span>
          )}
        </span>

        {showLabel && (
          <span className="availability-toggle__text">{isActive ? "Live" : "Paused"}</span>
        )}
      </label>

      {showLabel && (
        <p className="availability-toggle__helper">Paused hides it from search completely</p>
      )}

      {error && <p className="availability-toggle__error">{error}</p>}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
