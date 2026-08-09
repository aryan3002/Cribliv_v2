import Link from "next/link";
import type { Route } from "next";
import styles from "../../app/[locale]/blog/cribliv-times.module.css";
import { cityLabel, formatRent } from "../../app/[locale]/blog/_components/blog-format";
import type { ListingCardData } from "../listing-card";
import type { PgCard } from "../../lib/pg-public-api";

// Server-rendered classified-ad treatment for listings embedded in CRIBLIV
// TIMES articles. The site's interactive cards (carousel, chips, motion) read
// as a different product dropped into the broadsheet — this renders the same
// data in the paper's own language: ink border, serif headline, tabular price,
// a VERIFIED stamp, and a photo that prints in halftone grey until hovered.

const GENDER_LABEL: Record<string, string> = {
  boys: "Boys",
  girls: "Girls",
  coed: "Co-ed"
};

function furnishingLabel(value: string): string {
  const label = value.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

interface TimesAd {
  href: string;
  title: string;
  photo: string | null;
  rent: number | null;
  fromRent: boolean;
  place: string;
  details: string;
  verified: boolean;
}

function fromListing(card: ListingCardData, locale: string): TimesAd {
  return {
    href: `/${locale}/listing/${card.id}`,
    title: card.title,
    photo: card.cover_photo ?? null,
    rent: card.monthly_rent ?? null,
    fromRent: false,
    place: [card.locality ?? null, card.city_name ?? cityLabel(card.city ?? null)]
      .filter(Boolean)
      .join(", "),
    details: [
      card.bhk ? `${card.bhk} BHK` : null,
      card.furnishing ? furnishingLabel(card.furnishing) : null,
      card.area_sqft ? `${card.area_sqft} sq ft` : null
    ]
      .filter(Boolean)
      .join(" · "),
    verified: card.verification_status === "verified"
  };
}

function fromPg(card: PgCard, locale: string): TimesAd {
  return {
    href: `/${locale}/pg/${card.city}/${card.id}`,
    title: card.title,
    photo: card.cover_photo ?? null,
    rent: card.starting_rent,
    fromRent: true,
    place: [card.locality ? cityLabel(card.locality) : null, card.city_name ?? cityLabel(card.city)]
      .filter(Boolean)
      .join(", "),
    details: [
      card.gender_policy ? (GENDER_LABEL[card.gender_policy] ?? null) : null,
      card.sharing_options.length ? card.sharing_options.map(furnishingLabel).join(", ") : null,
      card.food_included ? "Meals included" : null
    ]
      .filter(Boolean)
      .join(" · "),
    verified: card.verified
  };
}

export function TimesEmbedCard(
  props: { locale: string } & ({ listing: ListingCardData } | { pg: PgCard })
) {
  const hi = props.locale === "hi";
  const ad =
    "listing" in props ? fromListing(props.listing, props.locale) : fromPg(props.pg, props.locale);
  return (
    <Link href={ad.href as Route} className={styles.embedAd}>
      {ad.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.embedAdPhoto} src={ad.photo} alt={ad.title} loading="lazy" />
      ) : null}
      <div className={styles.embedAdBody}>
        <div className={styles.embedAdKicker}>
          <span>
            {hi ? "किराये के लिए" : "For rent"}
            {ad.place ? ` · ${ad.place}` : ""}
          </span>
          {ad.verified ? (
            <span className={styles.embedAdStamp}>{hi ? "सत्यापित" : "Verified"}</span>
          ) : null}
        </div>
        <div className={styles.embedAdTitleRow}>
          <h4 className={styles.embedAdTitle}>{ad.title}</h4>
          {ad.rent != null ? (
            <span className={styles.embedAdPrice}>
              {ad.fromRent ? <small>{hi ? "से" : "from"}</small> : null}
              {formatRent(ad.rent)}
              <small>{hi ? "/माह" : "/month"}</small>
            </span>
          ) : null}
        </div>
        {ad.details ? <p className={styles.embedAdDetails}>{ad.details}</p> : null}
        <span className={styles.embedAdCta}>{hi ? "लिस्टिंग देखें →" : "See the listing →"}</span>
      </div>
    </Link>
  );
}
