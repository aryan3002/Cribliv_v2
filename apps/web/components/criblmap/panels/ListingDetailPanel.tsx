"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Home,
  BedDouble,
  Sofa,
  Ruler,
  ShieldCheck,
  TrendingDown,
  Minus,
  TrendingUp,
  ExternalLink,
  Phone,
  Building
} from "lucide-react";
import { fetchApi } from "../../../lib/api";
import { useMapState } from "../hooks/useMapState";

interface ListingDetail {
  id: string;
  title: string;
  city_name?: string;
  locality?: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  bhk?: number | null;
  furnishing?: string | null;
  area_sqft?: number | null;
  verification_status: string;
  cover_photo?: string | null;
}

interface PricingIntel {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  sample_size: number;
}

function formatRentINR(rent: number): string {
  return rent.toLocaleString("en-IN");
}

function furnishLabel(f: string | null | undefined): string {
  if (!f) return "Unknown";
  switch (f) {
    case "fully_furnished":
      return "Fully Furnished";
    case "semi_furnished":
      return "Semi-Furnished";
    case "unfurnished":
      return "Unfurnished";
    default:
      return f;
  }
}

function getPricePosition(
  rent: number,
  intel: PricingIntel | null
): { label: string; cls: string; icon: typeof TrendingDown } | null {
  if (!intel?.p50) return null;
  const ratio = rent / intel.p50;
  if (ratio < 0.9) return { label: "Below market average", cls: "below", icon: TrendingDown };
  if (ratio > 1.1) return { label: "Above market average", cls: "above", icon: TrendingUp };
  return { label: "At market average", cls: "at", icon: Minus };
}

interface ListingDetailPanelProps {
  locale: string;
}

export function ListingDetailPanel({ locale }: ListingDetailPanelProps) {
  const { panelContent, pins } = useMapState();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [pricingIntel, setPricingIntel] = useState<PricingIntel | null>(null);
  const [loading, setLoading] = useState(false);

  const listingId = panelContent.type === "listing" ? panelContent.listingId : null;

  const pinData = listingId ? pins.find((p) => p.id === listingId) : null;

  useEffect(() => {
    if (!listingId) {
      setListing(null);
      setPricingIntel(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const data = await fetchApi<ListingDetail>(`/listings/${listingId}`);
        if (cancelled) return;
        setListing(data);

        try {
          const params = new URLSearchParams();
          if (data.bhk) params.set("bhk", String(data.bhk));
          if (data.listing_type) params.set("listing_type", data.listing_type);
          const intel = await fetchApi<PricingIntel>(
            `/listings/pricing-intel?${params.toString()}`
          );
          if (!cancelled) setPricingIntel(intel);
        } catch {
          /* pricing intel is optional */
        }
      } catch {
        if (!cancelled) setListing(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (loading || !listing) {
    return (
      <div className="cmap-listing">
        <div className="cmap-listing__photo-placeholder">
          {loading ? "Loading..." : "Listing not found"}
        </div>
      </div>
    );
  }

  const pricePos = getPricePosition(listing.monthly_rent, pricingIntel);
  const TypeIcon = listing.listing_type === "pg" ? Building : Home;

  return (
    <div className="cmap-listing">
      {listing.cover_photo ? (
        <img
          src={listing.cover_photo}
          alt={listing.title}
          className="cmap-listing__photo"
          loading="lazy"
        />
      ) : (
        <div className="cmap-listing__photo-placeholder">
          <TypeIcon size={32} style={{ opacity: 0.3 }} />
        </div>
      )}

      <div className="cmap-listing__content">
        <div>
          <div className="cmap-listing__price-row">
            <span className="cmap-listing__price">₹{formatRentINR(listing.monthly_rent)}</span>
            <span className="cmap-listing__price-unit">/month</span>
            <span
              className={`cmap-listing__verified-badge cmap-listing__verified-badge--${listing.verification_status === "verified" ? "verified" : "unverified"}`}
            >
              {listing.verification_status === "verified" ? (
                <>
                  <ShieldCheck size={12} /> Verified
                </>
              ) : (
                "Unverified"
              )}
            </span>
          </div>
        </div>

        <div>
          <h3 className="cmap-listing__title">{listing.title}</h3>
          <p className="cmap-listing__location">
            {[listing.locality, listing.city_name].filter(Boolean).join(", ")}
          </p>
        </div>

        <div className="cmap-listing__stats">
          {listing.bhk && (
            <span className="cmap-listing__stat">
              <BedDouble /> {listing.bhk} BHK
            </span>
          )}
          {listing.listing_type === "pg" && (
            <span className="cmap-listing__stat">
              <Building /> PG
            </span>
          )}
          {listing.furnishing && (
            <span className="cmap-listing__stat">
              <Sofa /> {furnishLabel(listing.furnishing)}
            </span>
          )}
          {listing.area_sqft && (
            <span className="cmap-listing__stat">
              <Ruler /> {listing.area_sqft} sqft
            </span>
          )}
        </div>

        {pricePos && (
          <div
            className={`cmap-listing__price-position cmap-listing__price-position--${pricePos.cls}`}
          >
            <pricePos.icon size={14} />
            {pricePos.label}
            {pricingIntel?.p50 && (
              <span style={{ marginLeft: "auto", opacity: 0.7, fontSize: 12 }}>
                Avg ₹{formatRentINR(pricingIntel.p50)}
              </span>
            )}
          </div>
        )}

        <div className="cmap-listing__divider" />

        <div className="cmap-listing__actions">
          <Link
            href={`/${locale}/listing/${listing.id}`}
            className="cmap-listing__cta cmap-listing__cta--primary"
          >
            <Phone size={14} /> Unlock Contact
          </Link>
          <Link
            href={`/${locale}/listing/${listing.id}`}
            className="cmap-listing__cta cmap-listing__cta--secondary"
          >
            <ExternalLink size={14} /> View Full Listing
          </Link>
        </div>
      </div>
    </div>
  );
}
