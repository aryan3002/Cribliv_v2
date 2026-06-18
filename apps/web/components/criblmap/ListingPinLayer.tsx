"use client";

import { useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMapState, type MapPin } from "./hooks/useMapState";
import { haversineKm } from "../../lib/geo";
import { listingHref } from "../../lib/listing-href";

interface ListingPinLayerProps {
  map: google.maps.Map | null;
  locale: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function furnishLabel(f: string | null | undefined): string {
  if (!f) return "";
  switch (f) {
    case "fully_furnished":
      return "Fully furnished";
    case "semi_furnished":
      return "Semi-furnished";
    case "unfurnished":
      return "Unfurnished";
    default:
      return f;
  }
}

function formatRent(rent: number): string {
  if (rent >= 100000) return `${(rent / 100000).toFixed(1)}L`;
  if (rent >= 1000) return `${Math.round(rent / 1000)}K`;
  return String(rent);
}

function getPinLabel(pin: MapPin): string {
  const prefix = pin.listing_type === "pg" ? "PG" : pin.bhk ? `${pin.bhk}BHK` : "Flat";
  return `${prefix} · ₹${formatRent(pin.monthly_rent)}`;
}

function getPinClass(pin: MapPin, isSelected: boolean): string {
  let cls = "criblmap-pin";
  // Trust tier: verified is the dominant treatment; unverified is muted.
  // PG is layered on top of either as a side-stripe modifier rather than a
  // base tier, so a verified PG still reads as verified.
  if (pin.verification_status === "verified") cls += " criblmap-pin--verified";
  else cls += " criblmap-pin--unverified";
  if (pin.listing_type === "pg") cls += " criblmap-pin--pg";

  if (pin.belowMarket) cls += " criblmap-pin--below-market";
  if (isSelected) cls += " criblmap-pin--selected";
  return cls;
}

interface ClusterGroup {
  pins: MapPin[];
  lat: number;
  lng: number;
}

function clusterPins(pins: MapPin[], zoom: number): (MapPin | ClusterGroup)[] {
  if (zoom >= 14) return pins;

  const gridSize = zoom <= 10 ? 0.05 : 0.02;
  const clusters = new Map<string, ClusterGroup>();

  for (const pin of pins) {
    const key = `${Math.round(pin.lat / gridSize)}_${Math.round(pin.lng / gridSize)}`;
    const existing = clusters.get(key);
    if (existing) {
      existing.pins.push(pin);
      existing.lat = (existing.lat + pin.lat) / 2;
      existing.lng = (existing.lng + pin.lng) / 2;
    } else {
      clusters.set(key, { pins: [pin], lat: pin.lat, lng: pin.lng });
    }
  }

  const result: (MapPin | ClusterGroup)[] = [];
  for (const cluster of clusters.values()) {
    if (cluster.pins.length === 1) {
      result.push(cluster.pins[0]);
    } else {
      result.push(cluster);
    }
  }
  return result;
}

function isCluster(item: MapPin | ClusterGroup): item is ClusterGroup {
  return "pins" in item;
}

export function ListingPinLayer({ map, locale }: ListingPinLayerProps) {
  const { pins, selectedPinId, zoom, demandViewActive, commuteReachability, commuteMaxMinutes } =
    useMapState();
  const router = useRouter();
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  const clustered = useMemo(() => clusterPins(pins, zoom), [pins, zoom]);

  /* Reachability lookup: pre-build a small list of (centre, fit-bucket) pairs
   * so we can score each pin's nearest reachable zone in O(localities)
   * rather than re-grouping per pin. */
  const reachabilityZones = useMemo(() => {
    if (!commuteReachability || commuteReachability.length === 0) return null;
    const stretchMax = commuteMaxMinutes * 1.2;
    return commuteReachability
      .map((loc) => {
        if (loc.total_minutes <= commuteMaxMinutes) {
          return { lat: loc.lat, lng: loc.lng, bucket: "green" as const };
        }
        if (loc.total_minutes <= stretchMax) {
          return { lat: loc.lat, lng: loc.lng, bucket: "amber" as const };
        }
        return null;
      })
      .filter((z): z is { lat: number; lng: number; bucket: "green" | "amber" } => z !== null);
  }, [commuteReachability, commuteMaxMinutes]);

  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    for (const m of markersRef.current) {
      m.map = null;
    }
    markersRef.current = [];

    for (const item of clustered) {
      const el = document.createElement("div");

      /* Compute the commute-reachability opacity for this pin (only for
       * single pins, not clusters — clusters span multiple zones). */
      let reachabilityOpacity: number | null = null;
      if (reachabilityZones && !isCluster(item)) {
        let foundGreen = false;
        let foundAmber = false;
        for (const zone of reachabilityZones) {
          const km = haversineKm(zone, item);
          if (km > 1) continue; // Pin must be within ~1km of a reachable locality centre.
          if (zone.bucket === "green") {
            foundGreen = true;
            break;
          }
          foundAmber = true;
        }
        if (foundGreen) reachabilityOpacity = 1.0;
        else if (foundAmber) reachabilityOpacity = 0.7;
        else reachabilityOpacity = 0.28;
      }

      if (demandViewActive) {
        el.style.opacity = "0.3";
        el.style.transition = "opacity 0.3s ease";
      } else if (reachabilityOpacity !== null) {
        el.style.opacity = String(reachabilityOpacity);
        el.style.transition = "opacity 0.3s ease";
      }

      if (isCluster(item)) {
        const verifiedCount = item.pins.filter((p) => p.verification_status === "verified").length;
        el.className = "criblmap-cluster";
        el.innerHTML = `<span class="criblmap-cluster__count">${item.pins.length}</span><span class="criblmap-cluster__label">${verifiedCount} verified</span>`;
      } else {
        const verified = item.verification_status === "verified";
        el.className = getPinClass(item, item.id === selectedPinId);

        // Trust glyph: real Cribliv brand mark for verified, dot for unverified
        const trustGlyph = verified
          ? `<span class="criblmap-pin__brand"><img src="/cribliv.png" alt="" width="12" height="12" /></span>`
          : `<span class="criblmap-pin__dot" aria-hidden="true"></span>`;

        // Hover preview popover (suppressed on touch via CSS @media (hover: none))
        const previewBadge = verified
          ? `<span class="criblmap-pin__preview-badge criblmap-pin__preview-badge--verified"><img src="/cribliv.png" alt="" width="12" height="12" /> Cribliv Verified</span>`
          : `<span class="criblmap-pin__preview-badge criblmap-pin__preview-badge--unverified">Unverified</span>`;
        const meta = [
          item.bhk ? `${item.bhk} BHK` : null,
          item.listing_type === "pg" ? "PG" : null,
          furnishLabel(item.furnishing)
        ]
          .filter(Boolean)
          .join(" · ");

        const cover = item.cover_photo
          ? `<img class="criblmap-pin__preview-photo" src="${escapeHtml(item.cover_photo)}" alt="" loading="lazy" />`
          : `<span class="criblmap-pin__preview-photo criblmap-pin__preview-photo--placeholder" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                ${
                  item.listing_type === "pg"
                    ? '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/>'
                    : '<path d="M3 9.5L12 3l9 6.5"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>'
                }
              </svg>
            </span>`;

        el.innerHTML = `
          <span class="criblmap-pin__chip">
            ${trustGlyph}
            <span class="criblmap-pin__label">${escapeHtml(getPinLabel(item))}</span>
          </span>
          <span class="criblmap-pin__preview" role="presentation">
            <span class="criblmap-pin__preview-top">
              ${cover}
              <span class="criblmap-pin__preview-headline">
                <span class="criblmap-pin__preview-rent">₹${formatRent(item.monthly_rent)}<span class="criblmap-pin__preview-per">/month</span></span>
                ${meta ? `<span class="criblmap-pin__preview-meta">${escapeHtml(meta)}</span>` : ""}
              </span>
            </span>
            <span class="criblmap-pin__preview-title">${escapeHtml(item.title)}</span>
            ${previewBadge}
          </span>
        `;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          router.push(listingHref(locale, item));
        });
      }

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: {
          lat: isCluster(item) ? item.lat : item.lat,
          lng: isCluster(item) ? item.lng : item.lng
        },
        content: el,
        zIndex: isCluster(item) ? 1 : item.id === selectedPinId ? 10 : 5
      });

      if (isCluster(item)) {
        marker.addListener("click", () => {
          map.setZoom((map.getZoom() ?? 11) + 2);
          map.panTo({ lat: item.lat, lng: item.lng });
        });
      }

      markersRef.current.push(marker);
    }

    return () => {
      for (const m of markersRef.current) {
        m.map = null;
      }
      markersRef.current = [];
    };
  }, [map, clustered, selectedPinId, router, locale, demandViewActive, reachabilityZones]);

  return null;
}
