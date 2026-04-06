import type { Metadata } from "next";
import { fetchApi } from "../../../../lib/api";
import { toTitleCase, VERIFICATION_LABELS } from "../../../../lib/utils";
import { UnlockContactPanel } from "../../../../components/unlock-contact-panel";
import Link from "next/link";
import {
  MapPin,
  Camera,
  ShieldCheck,
  Clock,
  Shield,
  HomeIcon,
  CheckCircle2,
  ChevronRight
} from "lucide-react";

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

export default async function ListingDetailPage({
  params
}: {
  params: { locale: string; listingId: string };
}) {
  const payload = await fetchListing(params.listingId);

  if (!payload) {
    return (
      <div className="container empty-state" style={{ minHeight: "60vh" }}>
        <span className="empty-state__icon" aria-hidden="true">
          <HomeIcon size={48} />
        </span>
        <h3>Listing Unavailable</h3>
        <p>This listing may have been removed or is temporarily unavailable.</p>
        <Link href={`/${params.locale}/search`} className="btn btn--primary">
          Browse Listings
        </Link>
      </div>
    );
  }

  const listing = payload.listing_detail;
  const typeLabel = listing.listing_type === "flat_house" ? "Flat/House" : "PG";
  const isVerified = listing.verification_status === "verified";

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

  // JSON-LD structured data for rich search results
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: listing.title,
    description: listing.description || `${typeLabel} for rent in ${listing.city}`,
    url: `${BASE_URL}/${params.locale}/listing/${params.listingId}`,
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

  // BreadcrumbList JSON-LD for rich navigation in SERPs
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${params.locale}` },
      {
        "@type": "ListItem",
        position: 2,
        name: listing.city,
        item: `${BASE_URL}/${params.locale}/search?city=${listing.city.toLowerCase()}`
      },
      { "@type": "ListItem", position: 3, name: listing.title }
    ]
  };

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

      <div
        className="container"
        style={{ paddingTop: "var(--space-8)", paddingBottom: "var(--space-16)" }}
      >
        {/* Breadcrumb */}
        <nav
          className="body-sm text-secondary"
          style={{
            marginBottom: "var(--space-5)",
            display: "flex",
            gap: "var(--space-1)",
            alignItems: "center"
          }}
        >
          <Link href={`/${params.locale}`} style={{ color: "var(--text-secondary)" }}>
            Home
          </Link>
          <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />
          <Link
            href={`/${params.locale}/search?city=${listing.city.toLowerCase()}`}
            style={{ color: "var(--text-secondary)" }}
          >
            {toTitleCase(listing.city)}
          </Link>
          <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />
          <span className="truncate" style={{ maxWidth: 200, color: "var(--text-primary)" }}>
            {listing.title}
          </span>
        </nav>

        {/* Gallery Placeholder */}
        <div className="gallery">
          <div className="gallery-placeholder">
            <Camera size={40} strokeWidth={1.5} style={{ color: "var(--text-tertiary)" }} />
            <span>Photos coming soon</span>
          </div>
        </div>

        {/* Detail Layout: Content + Sidebar */}
        <div className="detail-layout">
          <div className="detail-layout__content">
            {/* Title Block */}
            <div style={{ marginBottom: "var(--space-6)" }}>
              <div className="flex items-center gap-3" style={{ marginBottom: "var(--space-2)" }}>
                {isVerified && (
                  <span className="badge badge--verified">
                    <ShieldCheck size={14} style={{ marginRight: 4 }} /> Verified
                  </span>
                )}
                {!isVerified && listing.verification_status === "pending" && (
                  <span className="badge badge--pending">
                    <Clock size={14} style={{ marginRight: 4 }} /> Verification Pending
                  </span>
                )}
                <span className="badge badge--brand">{typeLabel}</span>
              </div>
              <h1 style={{ marginBottom: "var(--space-2)" }}>{listing.title}</h1>
              <p className="text-secondary flex items-center gap-2">
                <MapPin size={16} aria-hidden="true" />
                {toTitleCase(listing.city)}
                {listing.locality ? `, ${listing.locality}` : ""}
              </p>
            </div>

            {/* Price */}
            <div className="price-hero">
              <span className="price-hero__amount">
                ₹{listing.monthly_rent.toLocaleString("en-IN")}
              </span>
              <span className="price-hero__period">/month</span>
            </div>

            {/* Trust Info */}
            <div className="trust-strip" style={{ marginBottom: "var(--space-6)" }}>
              <span className="trust-strip__item">
                {isVerified ? (
                  <CheckCircle2 size={16} style={{ color: "var(--trust)" }} />
                ) : (
                  <Clock size={16} style={{ color: "var(--amber)" }} />
                )}
                {isVerified ? "Verified Owner" : "Verification Pending"}
              </span>
              {payload.owner_trust.no_response_refund && (
                <span className="trust-strip__item">
                  <Shield size={16} style={{ color: "var(--brand)" }} />
                  Auto-refund if no response in 12h
                </span>
              )}
            </div>

            <hr className="divider" />

            {/* Description */}
            <section style={{ marginBottom: "var(--space-6)" }}>
              <h3 style={{ marginBottom: "var(--space-3)" }}>About this property</h3>
              <p className="text-secondary" style={{ lineHeight: 1.7 }}>
                {listing.description || "No description available for this property."}
              </p>
            </section>

            <hr className="divider" />

            {/* Key Details */}
            <section style={{ marginBottom: "var(--space-6)" }}>
              <h3 style={{ marginBottom: "var(--space-3)" }}>Key Details</h3>
              <div className="stats-row">
                <div className="stat-item">
                  <span className="stat-item__value">{typeLabel}</span>
                  <span className="stat-item__label">Property Type</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item__value">{toTitleCase(listing.city)}</span>
                  <span className="stat-item__label">City</span>
                </div>
                {listing.locality && (
                  <div className="stat-item">
                    <span className="stat-item__value">{listing.locality}</span>
                    <span className="stat-item__label">Locality</span>
                  </div>
                )}
                <div className="stat-item">
                  <span className="stat-item__value">
                    {VERIFICATION_LABELS[listing.verification_status] ??
                      listing.verification_status}
                  </span>
                  <span className="stat-item__label">Status</span>
                </div>
              </div>
            </section>

            {/* Market Rate Widget */}
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
                  <>
                    <hr className="divider" />
                    <section style={{ marginBottom: "var(--space-6)" }}>
                      <h3 style={{ marginBottom: "var(--space-3)" }}>
                        Market Rate for {listing.bhk}BHK in {toTitleCase(listing.city)}
                      </h3>

                      {/* P25 / P50 / P75 stats */}
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

                      {/* Progress bar with marker */}
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
                            background: `linear-gradient(to right, var(--trust, #22c55e), var(--amber, #f59e0b), #ef4444)`
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

                      {/* Label */}
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
                  </>
                );
              })()}
          </div>

          {/* Sidebar */}
          <div className="detail-layout__sidebar">
            <div className="detail-sidebar-card">
              <h4 style={{ marginBottom: "var(--space-4)" }}>Contact Owner</h4>
              <UnlockContactPanel listingId={params.listingId} />
            </div>
          </div>
        </div>
      </div>
      {/* /container */}

      {/* Mobile CTA bar — price only; unlock action lives in the sidebar panel */}
      <div className="cta-bar">
        <div>
          <div className="card__price">
            ₹{listing.monthly_rent.toLocaleString("en-IN")}
            <span className="card__price-period">/mo</span>
          </div>
        </div>
        <a href="#main-content" className="btn btn--primary btn--sm">
          View Contact
        </a>
      </div>
    </>
  );
}
