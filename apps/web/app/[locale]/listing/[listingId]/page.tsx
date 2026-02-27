import type { Metadata } from "next";
import { fetchApi } from "../../../../lib/api";
import { UnlockContactPanel } from "../../../../components/unlock-contact-panel";
import Link from "next/link";

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
  };
  owner_trust: {
    verification_status: string;
    no_response_refund: boolean;
  };
  contact_locked: boolean;
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
    return { title: "Listing Not Found — Cribliv" };
  }

  const listing = payload.listing_detail;
  const typeLabel = listing.listing_type === "flat_house" ? "Flat/House" : "PG";
  const title = `${listing.title} — ${typeLabel} for Rent in ${listing.city} | Cribliv`;
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
      <div className="empty-state" style={{ minHeight: "60vh" }}>
        <span className="empty-state__icon" aria-hidden="true">
          🏚️
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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb */}
      <nav
        className="body-sm text-secondary"
        style={{
          marginBottom: "var(--space-4)",
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "center"
        }}
      >
        <Link
          href={`/${params.locale}`}
          className="text-brand"
          style={{ textDecoration: "underline" }}
        >
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={`/${params.locale}/search?city=${listing.city.toLowerCase()}`}
          className="text-brand"
          style={{ textDecoration: "underline" }}
        >
          {listing.city}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate" style={{ maxWidth: 200 }}>
          {listing.title}
        </span>
      </nav>

      {/* Gallery Placeholder */}
      <div className="gallery">
        <div className="gallery-placeholder">
          <span aria-hidden="true">📸</span>
          <span>Photos coming soon</span>
        </div>
      </div>

      {/* Detail Layout: Content + Sidebar */}
      <div className="detail-layout">
        <div className="detail-layout__content">
          {/* Title Block */}
          <div style={{ marginBottom: "var(--space-6)" }}>
            <div className="flex items-center gap-3" style={{ marginBottom: "var(--space-2)" }}>
              {isVerified && <span className="badge badge--verified">✓ Verified</span>}
              {!isVerified && listing.verification_status === "pending" && (
                <span className="badge badge--pending">Verification Pending</span>
              )}
              <span className="badge badge--brand">{typeLabel}</span>
            </div>
            <h1 style={{ marginBottom: "var(--space-2)" }}>{listing.title}</h1>
            <p className="text-secondary flex items-center gap-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {listing.city}
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
              <span aria-hidden="true">{isVerified ? "✅" : "⏳"}</span>
              {isVerified ? "Verified Owner" : "Verification Pending"}
            </span>
            {payload.owner_trust.no_response_refund && (
              <span className="trust-strip__item">
                <span aria-hidden="true">🛡️</span>
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
                <span className="stat-item__value">{listing.city}</span>
                <span className="stat-item__label">City</span>
              </div>
              {listing.locality && (
                <div className="stat-item">
                  <span className="stat-item__value">{listing.locality}</span>
                  <span className="stat-item__label">Locality</span>
                </div>
              )}
              <div className="stat-item">
                <span className="stat-item__value" style={{ textTransform: "capitalize" }}>
                  {listing.verification_status.replace("_", " ")}
                </span>
                <span className="stat-item__label">Status</span>
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <div className="detail-layout__sidebar">
          <div className="detail-sidebar-card">
            <h4 style={{ marginBottom: "var(--space-4)" }}>Contact Owner</h4>
            <UnlockContactPanel listingId={params.listingId} />
          </div>
        </div>
      </div>

      {/* Mobile CTA bar */}
      <div className="cta-bar">
        <div>
          <div className="card__price">
            ₹{listing.monthly_rent.toLocaleString("en-IN")}
            <span className="card__price-period">/mo</span>
          </div>
        </div>
        <button className="btn btn--primary">Unlock Contact</button>
      </div>
    </>
  );
}
