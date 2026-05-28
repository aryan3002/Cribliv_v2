"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMapState } from "./hooks/useMapState";
import { useMetroData, type MetroLine } from "./hooks/useMetroData";
import { useMetroWalks } from "./hooks/useMetroWalks";
import { haversineKm } from "../../lib/geo";

interface MetroOverlayLayerProps {
  map: google.maps.Map | null;
}

interface StationCtx {
  /** Reference to the dynamic <span> inside the tooltip we rewrite when
   *  selection / pins / walks change. */
  dynamicEl: HTMLElement;
  station: MetroLine["stations"][number];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatKm(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km.toFixed(1)} km`;
}

function formatWalkDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min walk`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours} hr walk` : `${hours} hr ${rem} min walk`;
}

function formatMeters(m: number): string {
  if (m < 1000) {
    const rounded = Math.max(10, Math.round(m / 10) * 10);
    return `${rounded} m`;
  }
  return `${(m / 1000).toFixed(1)} km`;
}

export function MetroOverlayLayer({ map }: MetroOverlayLayerProps) {
  const { metroVisible, selectedPinId, pins, originatingListingId } = useMapState();
  const { lines, loading } = useMetroData();
  /* Walking-time fetch is keyed off the originating listing — i.e. the
   * listing the user came from. We DON'T fetch for arbitrarily-clicked
   * pins (clicks navigate, not select), so this is the only stable id. */
  const { walks } = useMetroWalks(originatingListingId);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  /** station_id → tooltip dynamic span. Rebuilt whenever the static layer
   *  is rebuilt (lines change). Read by the dynamic-content effect to
   *  avoid recreating all 21 markers on every pin / selection update. */
  const dynamicSpansRef = useRef<Map<number, StationCtx>>(new Map());

  /* The "reference listing" is whichever listing the user came from
   *  (?listing= query param) or actively selected on the map. Drives the
   *  "X km from this listing" tooltip line. */
  const referenceListing = useMemo(() => {
    const id = selectedPinId ?? originatingListingId;
    if (!id) return null;
    return pins.find((p) => p.id === id) ?? null;
  }, [pins, selectedPinId, originatingListingId]);

  /* ─── Static layer: polylines + dot markers + tooltip skeletons ───── */
  useEffect(() => {
    // Clear existing overlays
    for (const pl of polylinesRef.current) pl.setMap(null);
    for (const m of markersRef.current) m.map = null;
    polylinesRef.current = [];
    markersRef.current = [];
    dynamicSpansRef.current.clear();

    if (!map || !metroVisible || loading || lines.length === 0) return;

    for (const line of lines) {
      const path = line.stations.map((s) => ({ lat: s.lat, lng: s.lng }));

      const polyline = new google.maps.Polyline({
        map,
        path,
        strokeColor: line.line_color,
        strokeWeight: 3,
        strokeOpacity: 0.85,
        zIndex: 50
      });
      polylinesRef.current.push(polyline);

      const totalStops = line.stations.length;

      for (let i = 0; i < line.stations.length; i++) {
        const station = line.stations[i];
        const prev = line.stations[i - 1];
        const next = line.stations[i + 1];

        const wrapper = document.createElement("div");
        wrapper.className = `cmap-metro-station${station.interchange ? " cmap-metro-station--interchange" : ""}`;
        wrapper.style.setProperty("--line-color", line.line_color);
        // For interchanges, also set a second colour CSS var so the dot
        // can render as a bicolour ring (primary line + first connecting
        // line's colour).
        if (station.interchange && station.connections?.[0]) {
          wrapper.style.setProperty("--line-color-2", station.connections[0].line_color);
        }

        const stopLine = `Stop ${i + 1} of ${totalStops}`;
        const neighbourRow =
          prev || next
            ? `<span class="cmap-metro-tooltip__neighbours">
                 ${prev ? `<span class="cmap-metro-tooltip__neighbour"><span class="cmap-metro-tooltip__arrow">←</span>${escapeHtml(prev.name)}</span>` : `<span></span>`}
                 ${next ? `<span class="cmap-metro-tooltip__neighbour cmap-metro-tooltip__neighbour--next">${escapeHtml(next.name)}<span class="cmap-metro-tooltip__arrow">→</span></span>` : `<span></span>`}
               </span>`
            : "";

        // System label appears above the line name as a small uppercase
        // tag — so the user can distinguish "DMRC · Yellow Line" (a
        // connecting line into their city) from "Rapid Metro" (the
        // city's own primary network). Coloured to match the line.
        const systemTag = line.system
          ? `<span class="cmap-metro-tooltip__system">${escapeHtml(line.system)}</span>`
          : "";

        // Interchange row: when a station serves multiple lines, render a
        // row showing every other line you can transfer to here. Each
        // chip is colour-coded so the connection is unmistakeable.
        const interchangeRow =
          station.interchange && station.connections && station.connections.length > 0
            ? `<span class="cmap-metro-tooltip__interchange">
                 <span class="cmap-metro-tooltip__interchange-label">Interchange</span>
                 ${station.connections
                   .map(
                     (c) =>
                       `<span class="cmap-metro-tooltip__interchange-chip" style="--chip-color: ${c.line_color}">
                          <span class="cmap-metro-tooltip__interchange-dot"></span>
                          ${escapeHtml(c.system)} · ${escapeHtml(c.line_name)}
                        </span>`
                   )
                   .join("")}
               </span>`
            : "";

        wrapper.innerHTML = `
          <span class="cmap-metro-dot" aria-label="${escapeHtml(station.name)}"></span>
          <span class="cmap-metro-tooltip" role="tooltip">
            <span class="cmap-metro-tooltip__head">
              <span class="cmap-metro-tooltip__swatch" aria-hidden="true"></span>
              <span class="cmap-metro-tooltip__name">${escapeHtml(station.name)}</span>
              ${systemTag}
            </span>
            <span class="cmap-metro-tooltip__line-row">${escapeHtml(line.line_name)} · ${stopLine}</span>
            ${neighbourRow}
            ${interchangeRow}
            <span class="cmap-metro-tooltip__dynamic" data-station-id="${station.id}"></span>
          </span>
        `;

        const dynamicEl = wrapper.querySelector<HTMLElement>(".cmap-metro-tooltip__dynamic");
        if (dynamicEl) {
          dynamicSpansRef.current.set(station.id, { dynamicEl, station });
        }

        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: station.lat, lng: station.lng },
          content: wrapper,
          zIndex: 55
        });

        // Click pins the tooltip on for 3.2s (mobile-friendly: tap-to-reveal
        // since :hover doesn't fire on touch). Re-tapping any station resets
        // the timer on that station.
        let pinTimer: ReturnType<typeof setTimeout> | null = null;
        wrapper.addEventListener("click", (e) => {
          e.stopPropagation();
          wrapper.classList.add("cmap-metro-station--active");
          if (pinTimer) clearTimeout(pinTimer);
          pinTimer = setTimeout(() => {
            wrapper.classList.remove("cmap-metro-station--active");
          }, 3200);
        });

        markersRef.current.push(marker);
      }
    }

    return () => {
      for (const pl of polylinesRef.current) pl.setMap(null);
      for (const m of markersRef.current) m.map = null;
      polylinesRef.current = [];
      markersRef.current = [];
      dynamicSpansRef.current.clear();
    };
  }, [map, metroVisible, lines, loading]);

  /* ─── Dynamic tooltip content: distance, listings-within-500m ─────
   *  Recomputed cheaply (21 stations × O(pins)) and written via direct
   *  DOM access — avoids tearing down the whole layer on every pan. */
  useEffect(() => {
    if (dynamicSpansRef.current.size === 0) return;

    for (const { dynamicEl, station } of dynamicSpansRef.current.values()) {
      const rows: string[] = [];

      // Real walking time (from Distance Matrix) for the originating
      // listing → this station. Preferred over Haversine when available.
      const walk = walks.get(station.id);
      if (walk) {
        rows.push(
          `<span class="cmap-metro-tooltip__row cmap-metro-tooltip__row--walk">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4v3l3 1"/><circle cx="14" cy="3.5" r="1.5"/><path d="M9 21l1-5-3-1 1-5 3 2 3-2"/><path d="M7 11l-2 4"/></svg>
             ${formatWalkDuration(walk.duration_s)} · ${formatMeters(walk.distance_m)}
           </span>`
        );
      } else if (referenceListing) {
        // Fallback: straight-line Haversine while walks are loading or
        // when the listing has no metro data yet.
        const km = haversineKm(referenceListing, station);
        rows.push(
          `<span class="cmap-metro-tooltip__row cmap-metro-tooltip__row--dist">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7"/><path d="M9 7v13"/><path d="M15 4l5.447 2.724A1 1 0 0 1 21 7.618v10.764a1 1 0 0 1-1.447.894L15 17"/><path d="M15 4v13"/></svg>
             ~${formatKm(km)} from this listing
           </span>`
        );
      }

      const within500m = pins.filter(
        (p) => p.id !== referenceListing?.id && haversineKm(p, station) < 0.5
      ).length;
      if (within500m > 0) {
        rows.push(
          `<span class="cmap-metro-tooltip__row cmap-metro-tooltip__row--density">
             <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg>
             ${within500m} ${within500m === 1 ? "rental" : "rentals"} within 500 m
           </span>`
        );
      }

      dynamicEl.innerHTML = rows.join("");
    }
    // `metroVisible`, `loading`, and `map` are included so the dynamic
    // rows are populated on the same render that builds the tooltips
    // (right after the static effect runs above).
  }, [pins, referenceListing, walks, lines, metroVisible, loading, map]);

  return null;
}
