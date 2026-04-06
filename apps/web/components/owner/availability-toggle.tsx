"use client";

import { useState, useEffect, useId } from "react";
import { toggleListingAvailability } from "../../lib/owner-api";

interface AvailabilityToggleProps {
  listingId: string;
  currentStatus: "active" | "paused";
  accessToken: string;
  onStatusChange?: (newStatus: "active" | "paused") => void;
  showLabel?: boolean;
}

export function AvailabilityToggle({
  listingId,
  currentStatus,
  accessToken,
  onStatusChange,
  showLabel = true
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
    } catch (err) {
      setStatus(prev);
      const msg = err instanceof Error ? err.message : "Failed to update availability";
      setError(msg);
      setTimeout(() => setError(null), 3000);
    } finally {
      setToggling(false);
    }
  }

  const isActive = status === "active";

  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-2)",
          cursor: toggling ? "not-allowed" : "pointer",
          userSelect: "none"
        }}
      >
        {/* Toggle track */}
        <span
          style={{
            position: "relative",
            display: "inline-block",
            width: 40,
            height: 22,
            flexShrink: 0
          }}
        >
          <input
            id={id}
            type="checkbox"
            checked={isActive}
            disabled={toggling}
            onChange={() => void handleToggle()}
            style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
          />
          {/* Track */}
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 22,
              background: isActive ? "#22c55e" : "#d1d5db",
              transition: "background 0.2s ease",
              opacity: toggling ? 0.6 : 1
            }}
          />
          {/* Thumb */}
          <span
            style={{
              position: "absolute",
              top: 2,
              left: isActive ? 20 : 2,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "white",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              transition: "left 0.2s ease"
            }}
          />
          {/* Spinner overlay when toggling */}
          {toggling && (
            <span
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  border: "1.5px solid white",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  display: "inline-block",
                  animation: "spin 0.7s linear infinite"
                }}
              />
            </span>
          )}
        </span>

        {showLabel && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: isActive ? "#166534" : "#6b7280"
            }}
          >
            {isActive ? "Active" : "Paused"}
          </span>
        )}
      </label>

      {error && (
        <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 4, lineHeight: 1.3 }}>
          {error}
        </p>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
