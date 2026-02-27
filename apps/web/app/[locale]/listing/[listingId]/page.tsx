import type { Metadata } from "next";
import { fetchApi } from "../../../../lib/api";
import { UnlockContactPanel } from "../../../../components/unlock-contact-panel";

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
  const error = payload ? null : "Listing is unavailable right now.";

  if (!payload) {
    return (
      <section className="hero">
        <h1>Listing #{params.listingId}</h1>
        <div className="panel warning-box">{error}</div>
      </section>
    );
  }

  const listing = payload.listing_detail;
  const typeLabel = listing.listing_type === "flat_house" ? "Flat/House" : "PG";

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
    <section className="hero">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <h1>{listing.title}</h1>
      <div className="panel">
        <p className="muted-text">
          {listing.city} {listing.locality ? `• ${listing.locality}` : ""} •{" "}
          {listing.listing_type === "flat_house" ? "Flat/House" : "PG"}
        </p>
        <p className="rent">₹{listing.monthly_rent.toLocaleString("en-IN")}/month</p>
        <p>{listing.description || "No description available."}</p>
        <div className="trust-strip">
          {listing.verification_status === "verified" ? "Verified owner" : "Verification pending"} •
          Auto-refund if no response in 12 hours.
        </div>
      </div>
      <UnlockContactPanel listingId={params.listingId} />
    </section>
  );
}
