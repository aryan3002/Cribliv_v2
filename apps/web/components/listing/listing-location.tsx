import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";
import { toTitleCase } from "../../lib/utils";

interface ListingLocationProps {
  locale: Locale;
  city: string;
  locality: string | null;
  lat?: number | null;
  lng?: number | null;
  listingId?: string | null;
}

export function ListingLocation({
  locale,
  city,
  locality,
  lat,
  lng,
  listingId
}: ListingLocationProps) {
  const localityLabel = locality ? toTitleCase(locality) : null;
  const cityLabel = toTitleCase(city);
  const title = localityLabel ? `${localityLabel}, ${cityLabel}` : cityLabel;

  // Anchor the map on this listing's actual coordinates when we have them;
  // fall back to the city slug otherwise. Also forward the listing id so
  // the map can show "X km from this listing" / walk times in the metro
  // tooltip.
  const params = new URLSearchParams({ city });
  if (typeof lat === "number" && typeof lng === "number") {
    params.set("lat", String(lat));
    params.set("lng", String(lng));
    params.set("zoom", "15");
  }
  if (listingId) {
    params.set("listing", listingId);
  }
  const mapHref = `/${locale}/map?${params.toString()}`;

  return (
    <div className="location-card">
      <div className="location-card__icon" aria-hidden="true">
        <MapPin size={26} strokeWidth={1.8} />
      </div>
      <div className="location-card__body">
        <h3 className="location-card__title">{title}</h3>
        <p className="location-card__sub">{t(locale, "exactAddressAfterUnlock")}</p>
      </div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Link href={mapHref as any} className="location-card__cta">
        {t(locale, "exploreOnMap")}
        <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}
