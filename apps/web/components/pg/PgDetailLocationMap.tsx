"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import type { PgMapPoint } from "../../lib/pg-public-api";
import { cityCentroid } from "../../lib/city-bboxes";
import { API_KEY, ensureMapsLoaded } from "../../lib/google-maps";

type PgDetailLocationMapProps = {
  point: PgMapPoint | null;
  citySlug: string | null;
  listingId: string;
  locale: string;
};

const ZOOM: Record<PgMapPoint["source"], number> = {
  exact: 15,
  locality: 13,
  city: 12
};

const CAPTION: Record<PgMapPoint["source"], string> = {
  exact: "Exact location",
  locality: "Approximate area",
  city: "City area"
};

function cityFallbackPoint(citySlug: string | null): PgMapPoint | null {
  if (!citySlug) return null;
  const centroid = cityCentroid(citySlug);
  if (!centroid) return null;
  return {
    lat: centroid.lat,
    lng: centroid.lng,
    source: "city",
    label: "",
    city_slug: citySlug.toLowerCase(),
    locality_slug: null
  };
}

function criblMapHref(
  locale: string,
  effective: PgMapPoint,
  listingId: string,
  zoom: number
): Route {
  const params = new URLSearchParams({
    city: effective.city_slug,
    listing_type: "pg",
    lat: String(effective.lat),
    lng: String(effective.lng),
    zoom: String(zoom),
    listing: listingId
  });
  return `/${locale}/map?${params.toString()}` as Route;
}

export function PgDetailLocationMap({
  point,
  citySlug,
  listingId,
  locale
}: PgDetailLocationMapProps): JSX.Element {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  const effective = useMemo(() => point ?? cityFallbackPoint(citySlug), [citySlug, point]);

  useEffect(() => {
    if (!effective || !API_KEY || !mapRef.current) return;
    let cancelled = false;
    const center = { lat: effective.lat, lng: effective.lng };
    const zoom = ZOOM[effective.source];

    ensureMapsLoaded()
      .then(() => {
        if (cancelled || !mapRef.current || typeof google === "undefined") return;
        const map =
          googleMapRef.current ??
          new google.maps.Map(mapRef.current, {
            center,
            zoom,
            disableDefaultUI: true,
            zoomControl: true,
            clickableIcons: false,
            gestureHandling: "cooperative",
            styles: [
              { featureType: "poi", stylers: [{ visibility: "off" }] },
              { featureType: "transit.station", stylers: [{ visibility: "on" }] }
            ]
          });

        googleMapRef.current = map;
        map.setCenter(center);
        map.setZoom(zoom);

        markerRef.current?.setMap(null);
        markerRef.current = new google.maps.Marker({
          map,
          position: center,
          title: effective.label || CAPTION[effective.source],
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: effective.source === "exact" ? 11 : 9,
            fillColor: effective.source === "exact" ? "#0066ff" : "#0d9f4f",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3
          }
        });
      })
      .catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      markerRef.current = null;
    };
  }, [effective]);

  if (!effective) {
    return (
      <div className="pg-detail-map__empty">
        <MapPin size={18} aria-hidden="true" />
        <span>Location</span>
      </div>
    );
  }

  const caption = CAPTION[effective.source];
  const zoom = ZOOM[effective.source];
  const href = criblMapHref(locale, effective, listingId, zoom);
  const hasGoogleMap = Boolean(API_KEY && !mapFailed);

  return (
    <div className="pg-detail-map">
      <div className="pg-detail-map__caption">
        <MapPin size={16} aria-hidden="true" />
        {effective.label ? <span className="pg-detail-map__label">{effective.label}</span> : null}
        <span className="pg-detail-map__badge">{caption}</span>
      </div>

      <div className="pg-detail-map__frame">
        {hasGoogleMap ? (
          <div ref={mapRef} className="pg-detail-map__canvas" aria-label="PG location map" />
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
      </div>

      <Link href={href} className="tenant-results-map-btn">
        <MapPin size={15} aria-hidden="true" />
        Explore on CriblMap
      </Link>
    </div>
  );
}
