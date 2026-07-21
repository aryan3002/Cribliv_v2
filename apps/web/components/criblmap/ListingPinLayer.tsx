"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMapDispatch, useMapState, type MapPin } from "./hooks/useMapState";
import { haversineKm } from "../../lib/geo";
import { listingHref } from "../../lib/listing-href";
import { fetchApi } from "../../lib/api";
import { readAuthSession, readGuestShortlist, toggleGuestShortlist } from "../../lib/client-auth";
import {
  clusterPins,
  diffRenderItems,
  isCluster,
  pinSignature,
  renderKey,
  type ClusterGroup,
  type RenderItem
} from "./lib/pin-render";

interface ListingPinLayerProps {
  map: google.maps.Map | null;
  locale: string;
}

interface ReachabilityZone {
  lat: number;
  lng: number;
  bucket: "green" | "amber";
}

interface PinRecord {
  item: RenderItem;
  element: HTMLDivElement;
  marker: google.maps.marker.AdvancedMarkerElement;
  signature: string;
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

/* Direction B trust tiers: price-first white pills. Verified carries the real
 * Cribliv mark + a blue outline; unverified recedes to a plain grey pill; PG is
 * a violet-outlined modifier; below-market adds a corner DEAL badge. */
function getPinClass(pin: MapPin, isSelected: boolean): string {
  let cls = "criblmap-pin";
  if (pin.verification_status === "verified") cls += " criblmap-pin--verified";
  else cls += " criblmap-pin--unverified";
  if (pin.listing_type === "pg") cls += " criblmap-pin--pg";
  if (pin.belowMarket) cls += " criblmap-pin--below-market";
  if (isSelected) cls += " criblmap-pin--selected";
  return cls;
}

function pinAriaLabel(pin: MapPin): string {
  const tier = pin.verification_status === "verified" ? "Verified" : "Unverified";
  const kind = pin.listing_type === "pg" ? "PG" : pin.bhk ? `${pin.bhk} BHK` : "flat";
  return `${tier} ${kind} listing, ₹${pin.monthly_rent.toLocaleString("en-IN")} per month`;
}

function formatRupee(rent: number): string {
  return `₹${rent.toLocaleString("en-IN")}`;
}

const HEART_ICON = `<svg class="criblmap-pin__heart-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>`;

/* Toggle the listing in the shortlist store the Saved Homes page reads: guest
 * localStorage when anonymous, POST/DELETE /shortlist when signed in. The card's
 * saved state is carried by the --saved class, which drives the heart fill. */
function toggleSave(item: MapPin, card: HTMLElement) {
  const token = readAuthSession()?.access_token ?? null;
  if (!token) {
    const result = toggleGuestShortlist(item.id);
    card.classList.toggle("criblmap-pin__preview--saved", result.active);
    return;
  }
  const willSave = !card.classList.contains("criblmap-pin__preview--saved");
  card.classList.toggle("criblmap-pin__preview--saved", willSave);
  const request = willSave
    ? fetchApi<{ shortlist_id: string }>("/shortlist", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listing_id: item.id })
      })
    : fetchApi<{ success: true }>(`/shortlist/${item.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
  request.catch(() => card.classList.toggle("criblmap-pin__preview--saved", !willSave));
}

/* Interactive detail card (desktop hover). Photo header with the verified badge
 * + save heart, then price / meta / title and View listing / Save actions.
 * Suppressed on touch via CSS — the results rail is the mobile detail surface. */
function previewInner(item: MapPin): string {
  const verified = item.verification_status === "verified";
  const guestSaved = !readAuthSession()?.access_token && readGuestShortlist().includes(item.id);
  const savedClass = guestSaved ? " criblmap-pin__preview--saved" : "";

  const meta = [
    item.bhk ? `${item.bhk} BHK` : null,
    item.listing_type === "pg" ? "PG" : null,
    furnishLabel(item.furnishing)
  ]
    .filter(Boolean)
    .join(" · ");

  const verifiedBadge = verified
    ? `<span class="criblmap-pin__preview-verified"><img src="/cribliv-logo-new.svg" alt="" width="13" height="13" /> Cribliv Verified</span>`
    : "";

  const photo = item.cover_photo
    ? `<img class="criblmap-pin__preview-photo" src="${escapeHtml(item.cover_photo)}" alt="" loading="lazy" />`
    : `<span class="criblmap-pin__preview-photo criblmap-pin__preview-photo--placeholder" aria-hidden="true"></span>`;

  return `
    <span class="criblmap-pin__preview${savedClass}" role="presentation">
      <span class="criblmap-pin__preview-media">
        ${photo}
        ${verifiedBadge}
        <button type="button" class="criblmap-pin__cta-save criblmap-pin__preview-heart" aria-label="Save listing">${HEART_ICON}</button>
      </span>
      <span class="criblmap-pin__preview-body">
        <span class="criblmap-pin__preview-rent">${formatRupee(item.monthly_rent)}<span class="criblmap-pin__preview-per">/month</span></span>
        ${meta ? `<span class="criblmap-pin__preview-meta">${escapeHtml(meta)}</span>` : ""}
        <span class="criblmap-pin__preview-title">${escapeHtml(item.title)}</span>
        <span class="criblmap-pin__preview-cta">
          <button type="button" class="criblmap-pin__cta-view">View listing</button>
          <button type="button" class="criblmap-pin__cta-save criblmap-pin__preview-save">${HEART_ICON}<span>Save</span></button>
        </span>
      </span>
    </span>`;
}

/* Chip markup. Verified → leading Cribliv mark. PG → violet PG token in place of
 * the BHK type (a verified PG keeps the mark, so it still reads as trusted).
 * Below-market → corner DEAL badge on top of whatever tier the pill is. */
function pinInner(item: MapPin): string {
  const verified = item.verification_status === "verified";
  const isPg = item.listing_type === "pg";
  const mark = verified
    ? `<img class="criblmap-pin__mark" src="/cribliv-logo-new.svg" alt="" width="16" height="16" />`
    : "";
  const price = `<span class="criblmap-pin__price">₹${formatRent(item.monthly_rent)}</span>`;
  const deal = item.belowMarket
    ? `<span class="criblmap-pin__deal" aria-hidden="true">Deal</span>`
    : "";

  let core: string;
  if (isPg) {
    core = `${mark}<span class="criblmap-pin__pg">PG</span>${price}`;
  } else {
    const typeLabel = item.bhk ? `${item.bhk}BHK` : "Flat";
    core = `${mark}${price}<span class="criblmap-pin__type">· ${typeLabel}</span>`;
  }

  return `<span class="criblmap-pin__chip">${core}${deal}</span><span class="criblmap-pin__nub" aria-hidden="true"></span>${previewInner(item)}`;
}

function clusterInner(item: ClusterGroup): string {
  const verifiedCount = item.pins.filter((p) => p.verification_status === "verified").length;
  const check =
    verifiedCount > 0 ? `<span class="criblmap-cluster__check" aria-hidden="true">✓</span>` : "";
  const label = verifiedCount > 0 ? `${verifiedCount} verified` : `${item.pins.length} homes`;
  return `<span class="criblmap-cluster__bubble"><span class="criblmap-cluster__count">${item.pins.length}</span>${check}</span><span class="criblmap-cluster__label">${label}</span>`;
}

function computeReachabilityOpacity(pin: MapPin, zones: ReachabilityZone[] | null): number | null {
  if (!zones || zones.length === 0) return null;
  let foundGreen = false;
  let foundAmber = false;
  for (const zone of zones) {
    const km = haversineKm(zone, pin);
    if (km > 1) continue; // Pin must be within ~1km of a reachable locality centre.
    if (zone.bucket === "green") {
      foundGreen = true;
      break;
    }
    foundAmber = true;
  }
  if (foundGreen) return 1.0;
  if (foundAmber) return 0.7;
  return 0.28;
}

/* In-place opacity pass — demand view dims everything; commute reachability
 * fades single pins by how reachable they are. Runs without rebuilding markers
 * so toggling either never causes a repop. */
function applyOpacity(
  records: Map<string, PinRecord>,
  demandActive: boolean,
  zones: ReachabilityZone[] | null
) {
  for (const rec of records.values()) {
    const el = rec.element;
    el.style.transition = "opacity 0.3s ease";
    if (demandActive) {
      el.style.opacity = "0.3";
      continue;
    }
    if (isCluster(rec.item)) {
      el.style.opacity = "";
      continue;
    }
    const op = computeReachabilityOpacity(rec.item, zones);
    el.style.opacity = op === null ? "" : String(op);
  }
}

/* In-place selection pass — only pins carry a selected state. */
function applySelectedState(records: Map<string, PinRecord>, selectedPinId: string | null) {
  for (const rec of records.values()) {
    if (isCluster(rec.item)) continue;
    const selected = rec.item.id === selectedPinId;
    rec.element.className = getPinClass(rec.item, selected);
    rec.marker.zIndex = selected ? 10 : 5;
  }
}

export function ListingPinLayer({ map, locale }: ListingPinLayerProps) {
  const { pins, selectedPinId, zoom, demandViewActive, commuteReachability, commuteMaxMinutes } =
    useMapState();
  const dispatch = useMapDispatch();
  const router = useRouter();

  const recordsRef = useRef<Map<string, PinRecord>>(new Map());
  const selectedPinIdRef = useRef<string | null>(selectedPinId);
  const demandRef = useRef(demandViewActive);
  const reachabilityRef = useRef<ReachabilityZone[] | null>(null);

  const clustered = useMemo(() => clusterPins(pins, zoom), [pins, zoom]);

  /* Reachability lookup: pre-build (centre, fit-bucket) pairs so each pin scores
   * its nearest reachable zone in O(localities) rather than re-grouping per pin. */
  const reachabilityZones = useMemo<ReachabilityZone[] | null>(() => {
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
      .filter((z): z is ReachabilityZone => z !== null);
  }, [commuteReachability, commuteMaxMinutes]);

  /* Selection is applied in place — never rebuilds markers. */
  useEffect(() => {
    selectedPinIdRef.current = selectedPinId;
    applySelectedState(recordsRef.current, selectedPinId);
  }, [selectedPinId]);

  /* Opacity is applied in place — toggling demand / commute never rebuilds. */
  useEffect(() => {
    demandRef.current = demandViewActive;
    reachabilityRef.current = reachabilityZones;
    applyOpacity(recordsRef.current, demandViewActive, reachabilityZones);
  }, [demandViewActive, reachabilityZones]);

  /* Reconciliation: persist markers across zoom/pan/refetch and only touch what
   * actually changed. This replaces the previous teardown-and-rebuild, which
   * flashed and re-animated every pin on every zoom step. */
  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    const records = recordsRef.current;

    function paint(el: HTMLDivElement, item: RenderItem) {
      if (isCluster(item)) {
        el.className = "criblmap-cluster";
        el.innerHTML = clusterInner(item);
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", `${item.pins.length} listings — zoom in`);
        el.onclick = () => {
          map!.setZoom((map!.getZoom() ?? 11) + 2);
          map!.panTo({ lat: item.lat, lng: item.lng });
        };
      } else {
        el.className = getPinClass(item, item.id === selectedPinIdRef.current);
        el.innerHTML = pinInner(item);
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", pinAriaLabel(item));
        el.onclick = (e) => {
          const target = e.target as HTMLElement;
          // Save heart / Save button — toggle the shortlist, don't navigate.
          if (target.closest(".criblmap-pin__cta-save")) {
            e.preventDefault();
            e.stopPropagation();
            const card = el.querySelector(".criblmap-pin__preview") as HTMLElement | null;
            if (card) toggleSave(item, card);
            return;
          }
          // "View listing" button — go straight to the detail page.
          if (target.closest(".criblmap-pin__cta-view")) {
            e.stopPropagation();
            router.push(listingHref(locale, item));
            return;
          }
          // Chip itself — first tap selects + pans, second tap opens the listing.
          e.stopPropagation();
          if (item.id === selectedPinIdRef.current) {
            router.push(listingHref(locale, item));
            return;
          }
          selectedPinIdRef.current = item.id;
          applySelectedState(records, item.id);
          dispatch({ type: "SELECT_PIN", pinId: item.id });
          map!.panTo({ lat: item.lat, lng: item.lng });
        };
      }
    }

    const { toAdd, toRemove, toKeep } = diffRenderItems(records.keys(), clustered);

    for (const key of toRemove) {
      const rec = records.get(key);
      if (rec) {
        rec.marker.map = null;
        records.delete(key);
      }
    }

    for (const item of toKeep) {
      const rec = records.get(renderKey(item));
      if (!rec) continue;
      const sig = pinSignature(item);
      rec.item = item;
      if (sig !== rec.signature) {
        rec.signature = sig;
        paint(rec.element, item);
        if (isCluster(item)) rec.marker.position = { lat: item.lat, lng: item.lng };
      }
    }

    for (const item of toAdd) {
      const el = document.createElement("div");
      paint(el, item);
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: item.lat, lng: item.lng },
        content: el,
        zIndex: isCluster(item) ? 1 : item.id === selectedPinIdRef.current ? 10 : 5
      });
      records.set(renderKey(item), { item, element: el, marker, signature: pinSignature(item) });
    }

    applySelectedState(records, selectedPinIdRef.current);
    applyOpacity(records, demandRef.current, reachabilityRef.current);
  }, [map, clustered, dispatch, router, locale]);

  /* Detach every marker only on unmount — NOT between reconciliations. */
  useEffect(() => {
    const records = recordsRef.current;
    return () => {
      for (const rec of records.values()) rec.marker.map = null;
      records.clear();
    };
  }, []);

  return null;
}
