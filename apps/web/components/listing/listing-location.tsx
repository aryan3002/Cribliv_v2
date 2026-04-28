import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";
import { toTitleCase } from "../../lib/utils";

interface ListingLocationProps {
  locale: Locale;
  city: string;
  locality: string | null;
}

export function ListingLocation({ locale, city, locality }: ListingLocationProps) {
  const localityLabel = locality ? toTitleCase(locality) : null;
  const cityLabel = toTitleCase(city);
  const title = localityLabel ? `${localityLabel}, ${cityLabel}` : cityLabel;

  const mapHref = `/${locale}/map?city=${encodeURIComponent(city)}`;

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
