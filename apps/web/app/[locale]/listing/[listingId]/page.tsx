import type { Metadata } from "next";
import { fetchApi } from "../../../../lib/api";
import { toTitleCase } from "../../../../lib/utils";
import { UnlockContactPanel } from "../../../../components/unlock-contact-panel";
import { ListingGallery } from "../../../../components/listing/listing-gallery";
import { ListingHighlights } from "../../../../components/listing/listing-highlights";
import { ListingAmenities } from "../../../../components/listing/listing-amenities";
import { ListingHostCard } from "../../../../components/listing/listing-host-card";
import { ListingThingsToKnow } from "../../../../components/listing/listing-things-to-know";
import { ListingLocation } from "../../../../components/listing/listing-location";
import { SimilarListings } from "../../../../components/listing/similar-listings";
import { ListingToolbarActions } from "../../../../components/listing/listing-toolbar-actions";
import Link from "next/link";
import { MapPin, Camera, ShieldCheck, Clock, HomeIcon, ChevronRight, Shield } from "lucide-react";
import { isValidLocale, type Locale, t } from "../../../../lib/i18n";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

interface ListingDetailResponse {
  listing_detail: {
    id: string;
    title: string;
    description: string | null;
    listing_type: "flat_house" | "pg";
    monthly_rent: number;
    verification_status: "unverified" | "pending" | "verified" | "failed";
    city: string;
    locality?: string | null;
    bhk?: number | null;
    bathrooms?: number | null;
    area_sqft?: number | null;
    furnishing?: "unfurnished" | "semi_furnished" | "fully_furnished" | null;
    preferred_tenant?: string | null;
    security_deposit?: number | null;
    available_from?: string | null;
    whatsapp_available?: boolean;
    amenities?: string[];
    rules?: Record<string, unknown> | null;
    photos?: string[];
    pg_details?: {
      total_beds: number | null;
      occupancy_type: string | null;
      room_sharing_options: string[];
      food_included: boolean;
      curfew_time: string | null;
      attached_bathroom: boolean;
    } | null;
  };
  owner?: {
    first_name: string | null;
    member_since: string | null;
    preferred_language: string | null;
    whatsapp_available: boolean;
  };
  owner_trust: {
    verification_status: string;
    no_response_refund: boolean;
  };
  contact_locked: boolean;
}

interface PricingIntelResponse {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  sample_size: number;
}

async function fetchListing(listingId: string): Promise<ListingDetailResponse | null> {
  try {
    return await fetchApi<ListingDetailResponse>(`/listings/${listingId}`, undefined, {
      server: true
    });
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; listingId: string };
}): Promise<Metadata> {
  const payload = await fetchListing(params.listingId);
  if (!payload) {
    return { title: "Listing Not Found" };
  }

  const listing = payload.listing_detail;
  const typeLabel = listing.listing_type === "flat_house" ? "Flat/House" : "PG";
  const title = `${listing.title} — ${typeLabel} for Rent in ${toTitleCase(listing.city)}`;
  const description = listing.description
    ? listing.description.slice(0, 160)
    : `${typeLabel} for rent in ${listing.city}${listing.locality ? `, ${listing.locality}` : ""} at ₹${listing.monthly_rent.toLocaleString("en-IN")}/month. Verified on Cribliv.`;

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/listing/${params.listingId}`,
      languages: {
        en: `${BASE_URL}/en/listing/${params.listingId}`,
        hi: `${BASE_URL}/hi/listing/${params.listingId}`
      }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/listing/${params.listingId}`,
      siteName: "Cribliv",
      locale: params.locale === "hi" ? "hi_IN" : "en_IN",
      type: "website"
    },
    twitter: { card: "summary", title, description }
  };
}

function formatAvailableFromShort(iso: string | null | undefined, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  if (d.getTime() <= now.getTime()) return t(locale, "availableNow");
  return d.toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short"
  });
}

export default async function ListingDetailPage({
  params
}: {
  params: { locale: string; listingId: string };
}) {
  const locale: Locale = isValidLocale(params.locale) ? params.locale : "en";
  const payload = await fetchListing(params.listingId);

  if (!payload) {
    return (
      <div className="container empty-state" style={{ minHeight: "60vh" }}>
        <span className="empty-state__icon" aria-hidden="true">
          <HomeIcon size={48} />
        </span>
        <h3>Listing Unavailable</h3>
        <p>This listing may have been removed or is temporarily unavailable.</p>
        <Link href={`/${locale}/search`} className="btn btn--primary">
          Browse Listings
        </Link>
      </div>
    );
  }

  const listing = payload.listing_detail;
  const typeLabel = listing.listing_type === "flat_house" ? "Flat/House" : "PG";
  const isVerified = listing.verification_status === "verified";
  const isPending = listing.verification_status === "pending";
  const amenities = listing.amenities ?? [];
  const photos = listing.photos ?? [];

  // Fetch market rate data
  let pricingIntel: PricingIntelResponse | null = null;
  if (listing.bhk) {
    try {
      pricingIntel = await fetchApi<PricingIntelResponse>(
        `/listings/pricing-intel?city=${encodeURIComponent(listing.city)}&bhk=${listing.bhk}&listing_type=${listing.listing_type}`,
        undefined,
        { server: true }
      );
      if (!pricingIntel || pricingIntel.sample_size < 3 || pricingIntel.p50 === null) {
        pricingIntel = null;
      }
    } catch {
      pricingIntel = null;
    }
  }

  // JSON-LD
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: listing.title,
    description: listing.description || `${typeLabel} for rent in ${listing.city}`,
    url: `${BASE_URL}/${locale}/listing/${params.listingId}`,
    address: {
      "@type": "PostalAddress",
      addressLocality: listing.locality || listing.city,
      addressRegion: listing.city,
      addressCountry: "IN"
    },
    offers: {
      "@type": "Offer",
      price: listing.monthly_rent,
      priceCurrency: "INR",
      availability: "https://schema.org/InStock"
    }
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${locale}` },
      {
        "@type": "ListItem",
        position: 2,
        name: listing.city,
        item: `${BASE_URL}/${locale}/search?city=${listing.city.toLowerCase()}`
      },
      { "@type": "ListItem", position: 3, name: listing.title }
    ]
  };

  const shareUrl = `${BASE_URL}/${locale}/listing/${params.listingId}`;
  const summaryParts: string[] = [];
  if (listing.bhk) summaryParts.push(`${listing.bhk} BHK`);
  if (listing.bathrooms) summaryParts.push(`${listing.bathrooms} bath`);
  if (listing.area_sqft) summaryParts.push(`${listing.area_sqft.toLocaleString("en-IN")} sqft`);
  const summaryLine = summaryParts.join(" · ");
  const availableShort = formatAvailableFromShort(listing.available_from, locale);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <div className="container ld-page">
        {/* Breadcrumb */}
        <nav className="ld-crumb" aria-label="Breadcrumb">
          <Link href={`/${locale}`}>Home</Link>
          <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
          <Link href={`/${locale}/search?city=${listing.city.toLowerCase()}`}>
            {toTitleCase(listing.city)}
          </Link>
          <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
          <span className="ld-crumb__current">{listing.title}</span>
        </nav>

        {/* Title toolbar */}
        <div className="listing-toolbar">
          <div className="listing-toolbar__heading">
            <div
              className="flex items-center gap-2"
              style={{ flexWrap: "wrap", marginBottom: "var(--space-2)" }}
            >
              {isVerified && (
                <span className="badge badge--verified">
                  <ShieldCheck size={14} style={{ marginRight: 4 }} aria-hidden="true" /> Verified
                </span>
              )}
              {isPending && (
                <span className="badge badge--pending">
                  <Clock size={14} style={{ marginRight: 4 }} aria-hidden="true" /> Verification
                  Pending
                </span>
              )}
              <span className="badge badge--brand">{typeLabel}</span>
            </div>
            <h1>{listing.title}</h1>
            <div className="listing-toolbar__meta">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <MapPin size={14} aria-hidden="true" />
                {toTitleCase(listing.city)}
                {listing.locality ? `, ${toTitleCase(listing.locality)}` : ""}
              </span>
              {photos.length > 0 && (
                <>
                  <span className="listing-toolbar__meta-dot" aria-hidden="true" />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Camera size={14} aria-hidden="true" />
                    {photos.length} {photos.length === 1 ? "photo" : "photos"}
                  </span>
                </>
              )}
              {payload.owner_trust.no_response_refund && (
                <>
                  <span className="listing-toolbar__meta-dot" aria-hidden="true" />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Shield size={14} aria-hidden="true" />
                    {t(locale, "autoRefund12h")}
                  </span>
                </>
              )}
            </div>
          </div>
          <ListingToolbarActions locale={locale} title={listing.title} shareUrl={shareUrl} />
        </div>

        {/* Gallery */}
        <ListingGallery photos={photos} title={listing.title} locale={locale} />

        {/* Highlight chips */}
        <ListingHighlights
          locale={locale}
          bhk={listing.bhk}
          bathrooms={listing.bathrooms}
          area_sqft={listing.area_sqft}
          furnishing={listing.furnishing ?? null}
          listing_type={listing.listing_type}
          pgTotalBeds={listing.pg_details?.total_beds ?? null}
        />

        {/* Detail layout */}
        <div className="detail-layout">
          <div className="detail-layout__content">
            {/* About */}
            <section className="ld-section">
              <div className="ld-section__head">
                <h2>{t(locale, "aboutThisProperty")}</h2>
              </div>
              <p className="ld-prose">
                {listing.description || "No description available for this property."}
              </p>
            </section>

            {/* Listed by */}
            <section className="ld-section">
              <div className="ld-section__head">
                <h2>
                  {t(locale, "listedBy")}{" "}
                  {payload.owner?.first_name ?? (locale === "hi" ? "ओनर" : "the owner")}
                </h2>
              </div>
              <ListingHostCard
                firstName={payload.owner?.first_name ?? null}
                memberSinceIso={payload.owner?.member_since ?? null}
                preferredLanguage={payload.owner?.preferred_language ?? null}
                whatsappAvailable={payload.owner?.whatsapp_available ?? false}
                isVerified={isVerified}
                isPending={isPending}
                noResponseRefund={payload.owner_trust.no_response_refund}
                locale={locale}
              />
            </section>

            {/* Amenities */}
            <section className="ld-section">
              <div className="ld-section__head">
                <div>
                  <h2>{t(locale, "whatThisPlaceOffers")}</h2>
                  {amenities.length > 0 && (
                    <p className="ld-section__sub">
                      {amenities.length} {amenities.length === 1 ? "amenity" : "amenities"}{" "}
                      available
                    </p>
                  )}
                </div>
              </div>
              <ListingAmenities
                amenities={amenities}
                listing_type={listing.listing_type}
                locale={locale}
              />
            </section>

            {/* Things to know */}
            <section className="ld-section">
              <div className="ld-section__head">
                <h2>{t(locale, "thingsToKnow")}</h2>
              </div>
              <ListingThingsToKnow
                locale={locale}
                listing_type={listing.listing_type}
                available_from={listing.available_from ?? null}
                security_deposit={listing.security_deposit ?? null}
                preferred_tenant={listing.preferred_tenant ?? null}
                rules={listing.rules ?? null}
                pg_details={listing.pg_details}
              />
            </section>

            {/* Location */}
            <section className="ld-section">
              <div className="ld-section__head">
                <h2>{t(locale, "whereYoullBe")}</h2>
              </div>
              <ListingLocation
                locale={locale}
                city={listing.city}
                locality={listing.locality ?? null}
              />
            </section>

            {/* Market rate */}
            {pricingIntel &&
              pricingIntel.p25 !== null &&
              pricingIntel.p50 !== null &&
              pricingIntel.p75 !== null &&
              (() => {
                const p25 = pricingIntel.p25!;
                const p50 = pricingIntel.p50!;
                const p75 = pricingIntel.p75!;
                const rent = listing.monthly_rent;
                const range = p75 - p25;
                const markerPct =
                  range > 0 ? Math.min(100, Math.max(0, ((rent - p25) / range) * 100)) : 50;
                const markerColor =
                  rent <= p50
                    ? "var(--trust, #22c55e)"
                    : rent <= p75
                      ? "var(--amber, #f59e0b)"
                      : "#ef4444";
                const label =
                  rent <= p50 ? "Great deal" : rent <= p75 ? "Fair price" : "Above market";
                const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

                return (
                  <section className="ld-section">
                    <div className="ld-section__head">
                      <h2>
                        Market Rate · {listing.bhk}BHK in {toTitleCase(listing.city)}
                      </h2>
                    </div>

                    <div className="stats-row" style={{ marginBottom: "var(--space-4)" }}>
                      <div className="stat-item">
                        <span className="stat-item__value">{fmt(p25)}</span>
                        <span className="stat-item__label">Budget (P25)</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-item__value">{fmt(p50)}</span>
                        <span className="stat-item__label">Fair Market (P50)</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-item__value">{fmt(p75)}</span>
                        <span className="stat-item__label">Premium (P75)</span>
                      </div>
                    </div>

                    <div
                      style={{
                        position: "relative",
                        height: 8,
                        borderRadius: 4,
                        background: "var(--surface-2, #f3f4f6)",
                        marginBottom: "var(--space-3)"
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 4,
                          background:
                            "linear-gradient(to right, var(--trust, #22c55e), var(--amber, #f59e0b), #ef4444)"
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: `${markerPct}%`,
                          transform: "translate(-50%, -50%)",
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          background: markerColor,
                          border: "3px solid #fff",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.2)"
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        marginBottom: "var(--space-2)"
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 10px",
                          borderRadius: "var(--radius-full)",
                          background: markerColor,
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: 600
                        }}
                      >
                        {label}
                      </span>
                      <span className="body-sm text-secondary">This listing: {fmt(rent)}/mo</span>
                    </div>

                    <p className="body-sm text-tertiary">
                      Based on {pricingIntel.sample_size} active listings · Data from Cribliv
                    </p>
                  </section>
                );
              })()}
          </div>

          {/* Sticky right rail */}
          <aside className="detail-layout__sidebar">
            <div className="detail-rail">
              <div>
                <div className="detail-rail__price">
                  <strong>₹{listing.monthly_rent.toLocaleString("en-IN")}</strong>
                  <span>{t(locale, "perMonth")}</span>
                </div>
                {(listing.security_deposit || availableShort) && (
                  <div className="detail-rail__secondary">
                    {listing.security_deposit && (
                      <span>
                        ₹{listing.security_deposit.toLocaleString("en-IN")}{" "}
                        {t(locale, "depositShort")}
                      </span>
                    )}
                    {listing.security_deposit && availableShort && (
                      <span aria-hidden="true">·</span>
                    )}
                    {availableShort && (
                      <span>
                        {t(locale, "availableFrom")} {availableShort}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {summaryLine && <div className="detail-rail__summary">{summaryLine}</div>}

              <div className="detail-rail__panel">
                <UnlockContactPanel listingId={params.listingId} />
              </div>

              <div className="detail-rail__reassure">
                <Shield size={14} aria-hidden="true" />
                <span>{t(locale, "noChargeUntilUnlock")}</span>
              </div>
            </div>
          </aside>
        </div>

        {/* Similar properties */}
        <section className="ld-section" style={{ borderTop: 0 }}>
          <SimilarListings
            locale={locale}
            city={listing.city}
            listingType={listing.listing_type}
            excludeId={listing.id}
          />
        </section>
      </div>

      {/* Mobile CTA bar */}
      <div className="cta-bar">
        <div>
          <div className="card__price">
            ₹{listing.monthly_rent.toLocaleString("en-IN")}
            <span className="card__price-period">/mo</span>
          </div>
          {availableShort && (
            <div className="body-sm text-secondary" style={{ fontSize: 12 }}>
              {t(locale, "availableFrom")} {availableShort}
            </div>
          )}
        </div>
        <a href="#main-content" className="btn btn--primary btn--sm">
          View Contact
        </a>
      </div>
    </>
  );
}
