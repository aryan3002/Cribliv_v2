"use client";

import { MapPin, Building2, Home, Clock, BadgeCheck, X } from "lucide-react";
import type { PlacePrediction } from "../../lib/google-places";
import type { BlendedSuggestion, CriblivSuggestion } from "../../lib/use-search-suggestions";
import type { RecentSearch } from "../../lib/recent-searches";

const MIN_QUERY = 2;

interface SearchSuggestionsDropdownProps {
  suggestions: BlendedSuggestion[];
  recent: RecentSearch[];
  query: string;
  onSelect: (suggestion: BlendedSuggestion) => void;
  onPickRecent: (text: string) => void;
  onRemoveRecent: (text: string) => void;
}

/**
 * Presentational suggestions dropdown for the results-page bar. Groups Cribliv
 * suggestions into Cities / Localities / Listings, then Google places, then
 * recent searches. Deliberately leaner than the homepage hero's dropdown — no
 * hover-preview pane, since the results grid already sits directly below.
 * Reuses the `.search-dropdown` styles for visual parity.
 */
export function SearchSuggestionsDropdown({
  suggestions,
  recent,
  query,
  onSelect,
  onPickRecent,
  onRemoveRecent
}: SearchSuggestionsDropdownProps) {
  const cribliv = suggestions.filter(
    (s): s is Extract<BlendedSuggestion, { source: "cribliv" }> => s.source === "cribliv"
  );
  const google = suggestions.filter(
    (s): s is Extract<BlendedSuggestion, { source: "google" }> => s.source === "google"
  );

  const cities = cribliv.filter((s) => s.data.type === "city");
  const localities = cribliv.filter((s) => s.data.type === "locality");
  const listings = cribliv.filter((s) => s.data.type === "listing");

  const showRecent = query.trim().length < MIN_QUERY && recent.length > 0;
  const hasContent =
    cities.length + localities.length + listings.length + google.length > 0 || showRecent;

  if (!hasContent) return null;

  return (
    <div className="search-dropdown search-dropdown--results" role="listbox">
      <div className="search-dropdown__list">
        {cities.length > 0 ? (
          <Section label="Cities">
            {cities.map((s, i) => (
              <CityRow key={`c-${s.data.value}-${i}`} data={s.data} onClick={() => onSelect(s)} />
            ))}
          </Section>
        ) : null}

        {localities.length > 0 ? (
          <Section label="Localities">
            {localities.map((s, i) => (
              <LocalityRow
                key={`l-${s.data.value}-${i}`}
                data={s.data}
                onClick={() => onSelect(s)}
              />
            ))}
          </Section>
        ) : null}

        {listings.length > 0 ? (
          <Section label="Listings">
            {listings.map((s, i) => (
              <ListingRow
                key={`x-${s.data.value}-${i}`}
                data={s.data}
                onClick={() => onSelect(s)}
              />
            ))}
          </Section>
        ) : null}

        {google.length > 0 ? (
          <Section label="More places">
            {google.map((s) => (
              <GoogleRow key={`g-${s.data.place_id}`} data={s.data} onClick={() => onSelect(s)} />
            ))}
          </Section>
        ) : null}

        {showRecent ? (
          <Section label="Recent">
            {recent.map((r) => (
              <RecentRow
                key={r.query}
                text={r.query}
                onPick={() => onPickRecent(r.query)}
                onRemove={() => onRemoveRecent(r.query)}
              />
            ))}
          </Section>
        ) : null}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="search-dropdown__section">
      <div className="search-dropdown__section-label">{label}</div>
      {children}
    </div>
  );
}

function CityRow({ data, onClick }: { data: CriblivSuggestion; onClick: () => void }) {
  const meta = [
    typeof data.listing_count === "number"
      ? `${data.listing_count} listing${data.listing_count === 1 ? "" : "s"}`
      : null,
    data.rent_band ? formatRentBand(data.rent_band.min, data.rent_band.max) : null
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button type="button" className="search-dropdown__row" onClick={onClick}>
      <span className="search-dropdown__avatar search-dropdown__avatar--city" aria-hidden="true">
        {letterAvatar(data.label)}
      </span>
      <span className="search-dropdown__row-body">
        <span className="search-dropdown__row-title">{data.label}</span>
        {meta ? <span className="search-dropdown__row-meta">{meta}</span> : null}
      </span>
      <span className="search-dropdown__row-key" aria-hidden="true">
        ↵
      </span>
    </button>
  );
}

function LocalityRow({ data, onClick }: { data: CriblivSuggestion; onClick: () => void }) {
  const labelParts = data.label.split(",");
  const name = labelParts[0]?.trim() || data.label;
  const cityName = labelParts.slice(1).join(",").trim();
  const meta = [
    typeof data.listing_count === "number"
      ? `${data.listing_count} listing${data.listing_count === 1 ? "" : "s"}`
      : null,
    data.rent_band ? formatRentBand(data.rent_band.min, data.rent_band.max) : null,
    cityName ? cityName.charAt(0).toUpperCase() + cityName.slice(1) : null
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button type="button" className="search-dropdown__row" onClick={onClick}>
      <span
        className="search-dropdown__avatar search-dropdown__avatar--locality"
        aria-hidden="true"
      >
        <Building2 size={16} />
      </span>
      <span className="search-dropdown__row-body">
        <span className="search-dropdown__row-title">{name}</span>
        {meta ? <span className="search-dropdown__row-meta">{meta}</span> : null}
      </span>
    </button>
  );
}

function ListingRow({ data, onClick }: { data: CriblivSuggestion; onClick: () => void }) {
  const metaPieces: string[] = [];
  if (typeof data.rent === "number") metaPieces.push(`${formatRent(data.rent)}/mo`);
  if (data.locality_label) {
    metaPieces.push(data.locality_label.charAt(0).toUpperCase() + data.locality_label.slice(1));
  }
  if (data.posted_at) {
    const ago = formatTimeAgo(data.posted_at);
    if (ago) metaPieces.push(ago);
  }
  return (
    <button type="button" className="search-dropdown__row" onClick={onClick}>
      <span className="search-dropdown__thumb" aria-hidden="true">
        {data.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.cover_url} alt="" loading="lazy" />
        ) : (
          <Home size={18} />
        )}
        {data.verified ? (
          <span className="search-dropdown__verified" aria-label="Verified">
            <BadgeCheck size={12} />
          </span>
        ) : null}
      </span>
      <span className="search-dropdown__row-body">
        <span className="search-dropdown__row-title">{data.label}</span>
        {metaPieces.length > 0 ? (
          <span className="search-dropdown__row-meta">{metaPieces.join(" · ")}</span>
        ) : null}
      </span>
    </button>
  );
}

function GoogleRow({ data, onClick }: { data: PlacePrediction; onClick: () => void }) {
  return (
    <button type="button" className="search-dropdown__row" onClick={onClick}>
      <span className="search-dropdown__avatar search-dropdown__avatar--google" aria-hidden="true">
        <MapPin size={16} />
      </span>
      <span className="search-dropdown__row-body">
        <span className="search-dropdown__row-title">
          {data.structured_formatting?.main_text ?? data.description}
        </span>
        {data.structured_formatting?.secondary_text ? (
          <span className="search-dropdown__row-meta">
            {data.structured_formatting.secondary_text}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function RecentRow({
  text,
  onPick,
  onRemove
}: {
  text: string;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="search-dropdown__row search-dropdown__row--recent">
      <button type="button" className="search-dropdown__row-main" onClick={onPick}>
        <span
          className="search-dropdown__avatar search-dropdown__avatar--recent"
          aria-hidden="true"
        >
          <Clock size={14} />
        </span>
        <span className="search-dropdown__row-body">
          <span className="search-dropdown__row-title">{text}</span>
        </span>
      </button>
      <button
        type="button"
        className="search-dropdown__row-remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${text} from recent searches`}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function formatRentBand(min: number, max: number): string {
  return `${formatRent(min)}-${formatRent(max)}`;
}

function formatRent(value: number): string {
  if (value >= 100000) {
    return `₹${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 1)}L`;
  }
  if (value >= 1000) {
    return `₹${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return `₹${value}`;
}

function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function letterAvatar(label: string): string {
  return (label.trim()[0] ?? "?").toUpperCase();
}
