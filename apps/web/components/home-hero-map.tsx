// Light-theme cartographic canvas for the Living Map hero. Pure decoration
// plus real data: the SVG streetscape is loosely shaped after Lucknow (Gomti
// sweeping NW→SE, arterials, a ring road) and ships inline — no Maps JS, no
// billing, no network. The price pills are REAL live listings projected from
// their coordinates; the featured card is a real listing. Everything except
// the featured card link is aria-hidden.
import Link from "next/link";
import type { Route } from "next";
import { CheckCircle2 } from "lucide-react";
import type { Locale } from "../lib/i18n";
import type { HeroMapMarker } from "../lib/hero-map-markers";
import type { ListingCardData } from "./listing-card";

export function HomeHeroMap({
  markers,
  featured,
  featuredHref,
  locale
}: {
  markers: HeroMapMarker[];
  featured: ListingCardData | null;
  featuredHref: string | null;
  locale: Locale;
}) {
  const isHindi = locale === "hi";
  const showCard = Boolean(featured && featuredHref && featured.cover_photo);
  return (
    <div className="hero-map" aria-hidden={showCard ? undefined : true}>
      <svg
        className="hero-map__art"
        viewBox="0 0 1400 800"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="1400" height="800" fill="var(--hero-map-bg)" />
        {/* Gomti */}
        <path
          d="M-40,340 C220,290 380,420 600,380 C830,340 900,460 1120,430 C1280,410 1360,470 1460,450"
          stroke="var(--hero-map-water)"
          strokeWidth="34"
          fill="none"
          strokeLinecap="round"
        />
        {/* arterials */}
        <g stroke="var(--hero-map-road-major)" strokeWidth="5" fill="none" opacity="0.9">
          <path d="M120,-20 L340,820" />
          <path d="M-40,180 L1460,260" />
          <path d="M700,-30 L560,830" />
          <path d="M-30,620 L1450,540" />
          <path d="M1050,-30 L1180,830" />
        </g>
        {/* streets */}
        <g stroke="var(--hero-map-road)" strokeWidth="2.5" fill="none">
          <path d="M-30,80 L1460,140" />
          <path d="M-30,450 L1460,380" />
          <path d="M-40,720 L1460,660" />
          <path d="M260,-20 L400,820" />
          <path d="M480,-20 L430,830" />
          <path d="M880,-20 L800,830" />
          <path d="M1250,-20 L1330,830" />
          <path d="M-20,290 L560,330" />
          <path d="M620,520 L1460,470" />
          <path d="M180,540 C300,500 420,580 520,545" />
          <path d="M900,180 C1000,240 1120,190 1240,230" />
          <path d="M340,120 L640,190" />
          <path d="M980,560 L1220,640" />
        </g>
        {/* blocks + parks */}
        <g fill="var(--hero-map-block)">
          <rect x="180" y="120" width="60" height="42" rx="4" />
          <rect x="420" y="480" width="74" height="50" rx="4" />
          <rect x="760" y="230" width="66" height="46" rx="4" />
          <rect x="1080" y="500" width="80" height="52" rx="4" />
          <rect x="600" y="620" width="58" height="40" rx="4" />
          <rect x="950" y="90" width="64" height="44" rx="4" />
        </g>
        <g fill="var(--hero-map-park)" opacity="0.9">
          <ellipse cx="330" cy="660" rx="70" ry="42" />
          <ellipse cx="1150" cy="150" rx="62" ry="38" />
          <ellipse cx="840" cy="560" rx="52" ry="34" />
        </g>
      </svg>

      <div className="hero-map__markers" aria-hidden="true">
        {markers.map((marker) => (
          <span
            key={marker.id}
            className="hero-map__marker"
            style={{ left: `${marker.xPct}%`, top: `${marker.yPct}%` }}
          >
            <span className="hero-map__marker-pill">
              <span className="hero-map__marker-dot" />
              {marker.rentLabel}
            </span>
          </span>
        ))}
      </div>

      {showCard && featured && featuredHref && (
        <Link href={featuredHref as Route} className="hero-map__card">
          <span
            className="hero-map__card-media"
            style={{ backgroundImage: `url('${featured.cover_photo}')` }}
            aria-hidden="true"
          >
            {featured.verification_status === "verified" && (
              <span className="hero-map__card-badge">
                <CheckCircle2 size={11} aria-hidden="true" />
                {isHindi ? "वेरिफाइड" : "Verified"}
              </span>
            )}
          </span>
          <span className="hero-map__card-body">
            <span className="hero-map__card-title">{featured.title}</span>
            {featured.monthly_rent && featured.monthly_rent > 0 ? (
              <span className="hero-map__card-rent">
                ₹{featured.monthly_rent.toLocaleString("en-IN")}
                <em>{isHindi ? "/माह" : "/month"}</em>
              </span>
            ) : null}
          </span>
        </Link>
      )}
    </div>
  );
}
