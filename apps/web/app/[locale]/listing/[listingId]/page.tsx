import { fetchApi } from "../../../../lib/api";
import { UnlockContactPanel } from "../../../../components/unlock-contact-panel";

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

export default async function ListingDetailPage({ params }: { params: { listingId: string } }) {
  let payload: ListingDetailResponse | null = null;
  let error: string | null = null;

  try {
    payload = await fetchApi<ListingDetailResponse>(`/listings/${params.listingId}`, undefined, {
      server: true
    });
  } catch {
    error = "Listing is unavailable right now.";
  }

  if (!payload) {
    return (
      <section className="hero">
        <h1>Listing #{params.listingId}</h1>
        <div className="panel warning-box">{error}</div>
      </section>
    );
  }

  const listing = payload.listing_detail;
  return (
    <section className="hero">
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
