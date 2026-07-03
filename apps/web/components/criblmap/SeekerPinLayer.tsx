"use client";

import { useEffect, useRef } from "react";
import { useMapState, type SeekerPin } from "./hooks/useMapState";

interface SeekerPinLayerProps {
  map: google.maps.Map | null;
}

function formatBudget(max: number): string {
  if (max >= 100000) return `${(max / 100000).toFixed(1)}L`;
  if (max >= 1000) return `${Math.round(max / 1000)}K`;
  return String(max);
}

function getSeekerLabel(pin: SeekerPin): string {
  const bhk =
    pin.bhk_preference?.length > 0 ? pin.bhk_preference.map((b) => `${b}BHK`).join("/") : "Any";
  const timing = pin.move_in === "immediate" ? "ASAP" : pin.move_in === "within_month" ? "1mo" : "";
  const prefix = pin.source === "estimated" ? "Demand" : "Looking";
  return `${prefix} · ₹${formatBudget(pin.budget_max)} · ${bhk}${timing ? ` · ${timing}` : ""}`;
}

/* Urgency drives the circle/label tint so an owner scanning the map can
 * immediately see who's moving "this week" vs. someone browsing months out. */
function urgencyColor(moveIn: string): string {
  switch (moveIn) {
    case "immediate":
      return "#ef4444"; // red
    case "within_month":
      return "#f59e0b"; // amber
    case "within_3_months":
      return "#22c55e"; // green
    default:
      return "#7c3aed"; // brand purple — flexible / default
  }
}

/* Age decay — fresher demand looks louder; pins approaching the 30-day TTL
 * fade out so owners focus on real, recent intent. */
function ageOpacity(createdAt: string | undefined): number {
  if (!createdAt) return 1;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1;
  if (ageDays < 3) return 1.0;
  if (ageDays < 7) return 0.85;
  if (ageDays < 14) return 0.65;
  if (ageDays < 21) return 0.45;
  return 0.3;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function SeekerPinLayer({ map }: SeekerPinLayerProps) {
  const { seekerPins, demandViewActive } = useMapState();
  const markerCleanupRef = useRef<Array<() => void>>([]);
  const circlesRef = useRef<google.maps.Circle[]>([]);

  useEffect(() => {
    for (const cleanup of markerCleanupRef.current) cleanup();
    for (const c of circlesRef.current) c.setMap(null);
    markerCleanupRef.current = [];
    circlesRef.current = [];

    if (!map || !demandViewActive || seekerPins.length === 0) return;

    for (const pin of seekerPins) {
      const color = urgencyColor(pin.move_in);
      const radiusM = pin.radius_m && pin.radius_m > 0 ? pin.radius_m : 1000;
      const opacity = ageOpacity(pin.created_at);

      // Circle: communicates the seeker's actual search area, not just a point.
      const circle = new google.maps.Circle({
        map,
        center: { lat: pin.lat, lng: pin.lng },
        radius: radiusM,
        strokeColor: color,
        strokeWeight: 1.5,
        strokeOpacity: (pin.source === "estimated" ? 0.28 : 0.55) * opacity,
        fillColor: color,
        fillOpacity: (pin.source === "estimated" ? 0.06 : 0.1) * opacity,
        clickable: false,
        zIndex: 4
      });
      circlesRef.current.push(circle);

      const el = document.createElement("div");
      el.className = "cmap-seeker-pin";
      el.style.setProperty("--seeker-color", color);
      el.style.setProperty("--seeker-age-opacity", opacity.toFixed(2));

      // Top 3 tags as small chips under the main label — turns the pin into
      // a real demand profile owners can scan at a glance.
      const tags = (pin.tags ?? []).slice(0, 3);
      const tagsHtml =
        tags.length > 0
          ? `<span class="cmap-seeker-pin__tags">${tags
              .map(
                (t) =>
                  `<span class="cmap-seeker-pin__tag">${escapeHtml(t.replace(/-/g, " "))}</span>`
              )
              .join("")}</span>`
          : "";

      el.innerHTML = `
        <span class="cmap-seeker-pin__label">${getSeekerLabel(pin)}</span>
        ${tagsHtml}
      `;

      if (pin.note) {
        el.title = pin.note;
      } else if (pin.source === "estimated") {
        el.title = "Estimated from nearby active listings until real seeker pins exist.";
      }

      const advancedMarkerCtor = google.maps.marker?.AdvancedMarkerElement;
      try {
        if (!advancedMarkerCtor) throw new Error("Advanced markers unavailable");
        const marker = new advancedMarkerCtor({
          map,
          position: { lat: pin.lat, lng: pin.lng },
          content: el,
          zIndex: 8
        });
        markerCleanupRef.current.push(() => {
          marker.map = null;
        });
      } catch {
        const marker = new google.maps.Marker({
          map,
          position: { lat: pin.lat, lng: pin.lng },
          label: {
            text: pin.source === "estimated" ? "D" : "S",
            color: "#ffffff",
            fontSize: "11px",
            fontWeight: "700"
          },
          title: el.textContent ?? undefined
        });
        markerCleanupRef.current.push(() => marker.setMap(null));
      }
    }

    return () => {
      for (const cleanup of markerCleanupRef.current) cleanup();
      for (const c of circlesRef.current) c.setMap(null);
      markerCleanupRef.current = [];
      circlesRef.current = [];
    };
  }, [map, seekerPins, demandViewActive]);

  return null;
}
