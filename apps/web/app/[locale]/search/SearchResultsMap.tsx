"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, MapPin, Navigation, ShieldCheck } from "lucide-react";
import {
  ensureMapsLoaded,
  API_KEY,
  mapsAuthHasFailed,
  subscribeMapsAuthFailure
} from "../../../lib/google-maps";
import { CITY_BBOXES, cityCentroid } from "../../../lib/city-bboxes";
import { listingHref } from "../../../lib/listing-href";

export interface SearchMapListing {
  id: string;
  title: string;
  city: string;
  city_name?: string;
  locality?: string | null;
  lat?: number | null;
  lng?: number | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  verification_status: "unverified" | "pending" | "verified" | "failed";
  cover_photo?: string | null;
}

interface SearchResultsMapProps {
  locale: string;
  city: string;
  listings: SearchMapListing[];
  mapHref: Route;
}

function cityBounds(slug: string | null | undefined) {
  if (!slug) return null;
  return CITY_BBOXES[slug.toLowerCase()] ?? null;
}

function cityLatLngBounds(slug: string | null | undefined) {
  const bounds = cityBounds(slug);
  if (!bounds) return null;
  return {
    south: bounds.sw.lat,
    west: bounds.sw.lng,
    north: bounds.ne.lat,
    east: bounds.ne.lng
  };
}

function isWithinCityBounds(lat: number, lng: number, slug: string | null | undefined) {
  const bounds = cityBounds(slug);
  if (!bounds) return true;
  const padding = 0.08;
  return (
    lat >= bounds.sw.lat - padding &&
    lat <= bounds.ne.lat + padding &&
    lng >= bounds.sw.lng - padding &&
    lng <= bounds.ne.lng + padding
  );
}

function validCoord(listing: SearchMapListing, fallbackCity?: string | null) {
  const lat = Number(listing.lat);
  const lng = Number(listing.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 6 || lat > 38 || lng < 68 || lng > 98) return null;
  const citySlug = listing.city || fallbackCity;
  if (!isWithinCityBounds(lat, lng, citySlug)) return null;
  return { lat, lng };
}

function formatRent(rent: number): string {
  if (rent >= 100000) return `₹${(rent / 100000).toFixed(1)}L`;
  if (rent >= 1000) return `₹${Math.round(rent / 1000)}k`;
  return `₹${rent.toLocaleString("en-IN")}`;
}

function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function SearchResultsMap({ locale, city, listings, mapHref }: SearchResultsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [activeId, setActiveId] = useState<string | null>(listings[0]?.id ?? null);
  const [mapFailed, setMapFailed] = useState(false);

  // Google paints its own "Sorry! Something went wrong" overlay on an auth /
  // referrer failure without rejecting the loader promise. Treat that as a map
  // failure so we render the styled fallback instead of Google's raw error.
  useEffect(() => {
    if (mapsAuthHasFailed()) {
      setMapFailed(true);
      return;
    }
    return subscribeMapsAuthFailure(() => setMapFailed(true));
  }, []);

  const mappedListings = useMemo(
    () =>
      listings
        .map((listing) => ({ listing, position: validCoord(listing, city) }))
        .filter((item) => item.position),
    [city, listings]
  );

  const activeListing =
    listings.find((listing) => listing.id === activeId) ??
    mappedListings[0]?.listing ??
    listings[0] ??
    null;

  const center = useMemo(() => {
    if (mappedListings.length > 0) {
      const totals = mappedListings.reduce(
        (acc, item) => ({
          lat: acc.lat + item.position!.lat,
          lng: acc.lng + item.position!.lng
        }),
        { lat: 0, lng: 0 }
      );
      return {
        lat: totals.lat / mappedListings.length,
        lng: totals.lng / mappedListings.length
      };
    }
    return cityCentroid(city) ?? { lat: 26.825, lng: 80.95 };
  }, [city, mappedListings]);

  useEffect(() => {
    setActiveId((current) =>
      current && listings.some((listing) => listing.id === current)
        ? current
        : (listings[0]?.id ?? null)
    );
  }, [listings]);

  useEffect(() => {
    if (!API_KEY || !containerRef.current || mappedListings.length === 0) return;
    let cancelled = false;

    ensureMapsLoaded()
      .then(() => {
        if (cancelled || !containerRef.current || typeof google === "undefined") return;

        const map =
          mapRef.current ??
          new google.maps.Map(containerRef.current, {
            center,
            zoom: 12,
            disableDefaultUI: true,
            zoomControl: true,
            clickableIcons: false,
            gestureHandling: "cooperative",
            styles: [
              { featureType: "poi", stylers: [{ visibility: "off" }] },
              { featureType: "transit.station", stylers: [{ visibility: "on" }] }
            ]
          });
        mapRef.current = map;
        const restrictionBounds = cityLatLngBounds(city);
        map.setOptions({
          center,
          restriction: restrictionBounds
            ? {
                latLngBounds: restrictionBounds,
                strictBounds: false
              }
            : undefined
        });

        for (const marker of markersRef.current) marker.setMap(null);
        markersRef.current = [];

        const bounds = new google.maps.LatLngBounds();
        for (const { listing, position } of mappedListings) {
          if (!position) continue;
          bounds.extend(position);
          const marker = new google.maps.Marker({
            map,
            position,
            title: listing.title,
            label: {
              text: formatRent(listing.monthly_rent),
              color: "#ffffff",
              fontSize: "12px",
              fontWeight: "800"
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: listing.verification_status === "verified" ? 15 : 13,
              fillColor: listing.listing_type === "pg" ? "#0d9f4f" : "#0066ff",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3
            }
          });
          marker.addListener("click", () => {
            setActiveId(listing.id);
            map.panTo(position);
          });
          markersRef.current.push(marker);
        }

        if (mappedListings.length > 1) {
          map.fitBounds(bounds, 64);
          google.maps.event.addListenerOnce(map, "idle", () => {
            const zoom = map.getZoom();
            if (typeof zoom === "number" && zoom < 11) {
              map.setCenter(center);
              map.setZoom(12);
            }
          });
        } else {
          map.setCenter(center);
          map.setZoom(13);
        }
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      for (const marker of markersRef.current) marker.setMap(null);
      markersRef.current = [];
    };
  }, [center, mappedListings]);

  const hasMap = API_KEY && mappedListings.length > 0 && !mapFailed;
  const activeHref = activeListing
    ? listingHref(locale, {
        id: activeListing.id,
        listing_type: activeListing.listing_type,
        city: activeListing.city
      })
    : mapHref;

  return (
    <div className="tenant-live-map">
      <div className="tenant-live-map__canvas-wrap">
        {hasMap ? (
          <div
            ref={containerRef}
            className="tenant-live-map__canvas"
            aria-label="Search results map"
          />
        ) : (
          <div className="tenant-live-map__fallback" aria-hidden="true">
            <div className="tenant-map-card__street" />
            <div className="tenant-map-card__road" />
            <div className="tenant-map-card__wash" />
            <div className="tenant-map-card__river" />
            <div className="tenant-map-card__park tenant-map-card__park--top" />
            <div className="tenant-map-card__park tenant-map-card__park--bottom" />
            <div className="tenant-map-card__metro">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        <div className="tenant-live-map__summary">
          <span>
            <Navigation size={13} />
            {listings.length} live match{listings.length === 1 ? "" : "es"}
          </span>
          <strong>{titleCase(city)}</strong>
        </div>

        {activeListing && (
          <Link href={activeHref as Route} className="tenant-live-map__listing">
            <div className="tenant-live-map__photo">
              {activeListing.cover_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeListing.cover_photo} alt="" loading="lazy" />
              ) : (
                <MapPin size={24} />
              )}
              {activeListing.verification_status === "verified" && (
                <span>
                  <ShieldCheck size={12} /> Verified
                </span>
              )}
            </div>
            <div className="tenant-live-map__listing-body">
              <strong>
                ₹{activeListing.monthly_rent.toLocaleString("en-IN")}
                <span>/mo</span>
              </strong>
              <p>{activeListing.title}</p>
              <small>
                {[activeListing.locality, activeListing.city_name ?? titleCase(activeListing.city)]
                  .filter(Boolean)
                  .join(", ")}
              </small>
            </div>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>

      <div className="tenant-live-map__actions">
        <Link href={mapHref} className="tenant-results-map-btn">
          <MapPin size={15} /> Open full CriblMap
        </Link>
      </div>
    </div>
  );
}
