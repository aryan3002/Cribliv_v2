"use client";

import Link from "next/link";
import type { Route } from "next";
import { Building2, Home, ShieldCheck, Sparkles, ArrowUpRight } from "lucide-react";
import { listingHref } from "../../lib/listing-href";
import { useMapDispatch, useMapState, type MapPin } from "./hooks/useMapState";

interface MapResultsRailProps {
  locale: string;
  map: google.maps.Map | null;
}

function formatRent(rent: number): string {
  return rent.toLocaleString("en-IN");
}

function compactRent(rent: number): string {
  if (rent >= 100000) return `${(rent / 100000).toFixed(1)}L`;
  if (rent >= 1000) return `${Math.round(rent / 1000)}K`;
  return String(rent);
}

function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function furnishLabel(value: string | null | undefined): string {
  switch (value) {
    case "fully_furnished":
      return "Fully furnished";
    case "semi_furnished":
      return "Semi-furnished";
    case "unfurnished":
      return "Unfurnished";
    default:
      return value ? titleCase(value) : "Ready to visit";
  }
}

function pinSubtitle(pin: MapPin): string {
  const locality = titleCase(pin.locality ?? pin.locality_slug ?? pin.city);
  const spec =
    pin.listing_type === "pg" ? "PG stay" : pin.bhk ? `${pin.bhk} BHK` : "Flat / house";
  return [spec, locality].filter(Boolean).join(" · ");
}

function pinHref(locale: string, pin: MapPin): Route {
  return listingHref(locale, pin);
}

function ResultCard({
  pin,
  selected,
  locale,
  onSelect
}: {
  pin: MapPin;
  selected: boolean;
  locale: string;
  onSelect: () => void;
}) {
  const Icon = pin.listing_type === "pg" ? Building2 : Home;
  const verified = pin.verification_status === "verified";

  return (
    <article className={`cmap-results-card${selected ? " cmap-results-card--selected" : ""}`}>
      <button
        type="button"
        className="cmap-results-card__hit"
        onClick={onSelect}
        aria-label={`Select ${pin.title}`}
      />
      <div className="cmap-results-card__media">
        {pin.cover_photo ? (
          <img src={pin.cover_photo} alt="" loading="lazy" className="cmap-results-card__img" />
        ) : (
          <Icon size={24} />
        )}
        {verified && (
          <span className="cmap-results-card__verified">
            <ShieldCheck size={12} /> Verified
          </span>
        )}
      </div>
      <div className="cmap-results-card__body">
        <div className="cmap-results-card__price-row">
          <span className="cmap-results-card__price">₹{formatRent(pin.monthly_rent)}</span>
          <span className="cmap-results-card__unit">/mo</span>
          {pin.belowMarket && <span className="cmap-results-card__deal">Below market</span>}
        </div>
        <h3 className="cmap-results-card__title">{pin.title}</h3>
        <p className="cmap-results-card__meta">
          {pinSubtitle(pin)} · {furnishLabel(pin.furnishing)}
        </p>
        <div className="cmap-results-card__actions">
          <Link href={pinHref(locale, pin)} className="cmap-results-card__cta">
            View details
          </Link>
          <Link
            href={pinHref(locale, pin)}
            className="cmap-results-card__ghost"
            aria-label="View listing"
          >
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function MapResultsRail({ locale, map }: MapResultsRailProps) {
  const { pins, selectedPinId, isLoading, city } = useMapState();
  const dispatch = useMapDispatch();
  const selectedPin = selectedPinId ? pins.find((pin) => pin.id === selectedPinId) : null;
  const orderedPins = selectedPin
    ? [selectedPin, ...pins.filter((pin) => pin.id !== selectedPin.id)]
    : pins;
  const verifiedCount = pins.filter((pin) => pin.verification_status === "verified").length;
  const headingCount = verifiedCount > 0 ? verifiedCount : pins.length;
  const headingNoun = verifiedCount > 0 ? "verified home" : "home";

  function selectPin(pin: MapPin) {
    dispatch({ type: "SELECT_PIN", pinId: pin.id });
    map?.panTo({ lat: pin.lat, lng: pin.lng });
  }

  return (
    <aside className="cmap-results-rail" aria-label="Map listings">
      <div className="cmap-results-rail__handle" aria-hidden="true" />
      <div className="cmap-results-rail__head">
        <div>
          <span className="cmap-results-rail__eyebrow">Live map search</span>
          <h2 className="cmap-results-rail__title">
            {headingCount} {headingNoun}
            {headingCount === 1 ? "" : "s"}
          </h2>
          <p className="cmap-results-rail__sub">
            {titleCase(city)} · {isLoading ? "Refreshing listings" : `${pins.length} in view`}
          </p>
        </div>
        <div className="cmap-results-rail__score">
          <Sparkles size={14} />
          <span>
            {pins.length
              ? `from ₹${compactRent(Math.min(...pins.map((p) => p.monthly_rent)))}`
              : "live"}
          </span>
        </div>
      </div>

      <div className="cmap-results-rail__list">
        {orderedPins.length === 0 && !isLoading ? (
          <div className="cmap-results-rail__empty">
            <Home size={22} />
            <h3>No listings in this area</h3>
            <p>Try zooming out or adjusting filters to find verified rentals nearby.</p>
          </div>
        ) : (
          orderedPins.slice(0, 12).map((pin) => (
            <ResultCard
              key={pin.id}
              pin={pin}
              selected={pin.id === selectedPinId}
              locale={locale}
              onSelect={() => selectPin(pin)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
