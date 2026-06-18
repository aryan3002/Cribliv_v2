"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
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
  Building,
  Users,
  UtensilsCrossed,
  Layers
} from "lucide-react";
import { fetchApi } from "../../../lib/api";
import { getPgPublicListing } from "../../../lib/pg-public-api";
import { listingHref } from "../../../lib/listing-href";
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

// Normalized view model so the SAME card layout renders both a flat/house
// (from /listings/:id) and a PG (from the CQRS split /pg/listings/:id), each
// showing the stats that matter for its type.
interface CardView {
  id: string;
  title: string;
  cityName: string | null;
  locality: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  verification_status: string;
  cover_photo: string | null;
  href: Route;
  // flat/house
  bhk?: number | null;
  furnishing?: string | null;
  area_sqft?: number | null;
  // pg
  genderLabel?: string | null;
  sharings?: string[];
  totalBeds?: number | null;
  hasMeals?: boolean;
}

const PG_GENDER_LABEL: Record<string, string> = {
  boys: "Boys Only",
  girls: "Girls Only",
  coed: "Co-ed"
};

function formatRentINR(rent: number): string {
  return rent.toLocaleString("en-IN");
}

function titleCase(s?: string | null): string | null {
  if (!s) return null;
  return s
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
  const [view, setView] = useState<CardView | null>(null);
  const [pricingIntel, setPricingIntel] = useState<PricingIntel | null>(null);
  const [loading, setLoading] = useState(false);

  const listingId = panelContent.type === "listing" ? panelContent.listingId : null;

  const pinData = listingId ? pins.find((p) => p.id === listingId) : null;
  // The pin already knows the type before any fetch — use it to pick the right
  // CQRS read endpoint (PG vs flat) and avoid a flat-shaped fetch for a PG.
  const isPg = pinData?.listing_type === "pg";

  useEffect(() => {
    if (!listingId) {
      setView(null);
      setPricingIntel(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        if (isPg) {
          const pg = await getPgPublicListing(listingId);
          if (cancelled) return;
          const startingPaise =
            pg.room_types.length > 0
              ? Math.min(...pg.room_types.map((r) => r.monthly_rent_paise))
              : null;
          const monthly_rent =
            startingPaise != null ? Math.round(startingPaise / 100) : (pg.monthly_rent ?? 0);
          const sharings = Array.from(
            new Set(pg.room_types.map((r) => titleCase(r.sharing)).filter(Boolean) as string[])
          );
          setView({
            id: pg.id,
            title: pg.title ?? "PG",
            cityName: titleCase(pg.city_slug),
            locality: titleCase(pg.locality_slug),
            listing_type: "pg",
            monthly_rent,
            // PG public detail has no verification flag; reuse the pin's.
            verification_status: pinData?.verification_status ?? "unverified",
            cover_photo: pinData?.cover_photo ?? null,
            href: listingHref(locale, { id: pg.id, listing_type: "pg", city: pg.city_slug }),
            genderLabel: pg.pg_details.gender_policy
              ? (PG_GENDER_LABEL[pg.pg_details.gender_policy] ??
                titleCase(pg.pg_details.gender_policy))
              : null,
            sharings,
            totalBeds: pg.pg_details.total_beds,
            hasMeals: (pg.pg_details.meals as { provided?: boolean } | null)?.provided === true
          });
          // PG has no BHK → market pricing-intel (bhk-keyed) doesn't apply.
          if (!cancelled) setPricingIntel(null);
          return;
        }

        const data = await fetchApi<ListingDetail>(`/listings/${listingId}`);
        if (cancelled) return;
        setView({
          id: data.id,
          title: data.title,
          cityName: data.city_name ?? null,
          locality: data.locality ?? null,
          listing_type: "flat_house",
          monthly_rent: data.monthly_rent,
          verification_status: data.verification_status,
          cover_photo: data.cover_photo ?? null,
          href: listingHref(locale, { id: data.id, listing_type: "flat_house" }),
          bhk: data.bhk,
          furnishing: data.furnishing,
          area_sqft: data.area_sqft
        });

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
        if (!cancelled) setView(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listingId, isPg]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !view) {
    return (
      <div className="cmap-listing">
        <div className="cmap-listing__photo-placeholder">
          {loading ? "Loading..." : "Listing not found"}
        </div>
      </div>
    );
  }

  const pricePos = getPricePosition(view.monthly_rent, pricingIntel);
  const TypeIcon = view.listing_type === "pg" ? Building : Home;

  return (
    <div className="cmap-listing">
      {view.cover_photo ? (
        <img
          src={view.cover_photo}
          alt={view.title}
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
            <span className="cmap-listing__price">₹{formatRentINR(view.monthly_rent)}</span>
            <span className="cmap-listing__price-unit">
              {view.listing_type === "pg" ? "/mo onwards" : "/month"}
            </span>
            <span
              className={`cmap-listing__verified-badge cmap-listing__verified-badge--${view.verification_status === "verified" ? "verified" : "unverified"}`}
            >
              {view.verification_status === "verified" ? (
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
          <h3 className="cmap-listing__title">{view.title}</h3>
          <p className="cmap-listing__location">
            {[view.locality, view.cityName].filter(Boolean).join(", ")}
          </p>
        </div>

        <div className="cmap-listing__stats">
          {view.listing_type === "pg" ? (
            <>
              {view.genderLabel && (
                <span className="cmap-listing__stat">
                  <Users /> {view.genderLabel}
                </span>
              )}
              {view.sharings && view.sharings.length > 0 && (
                <span className="cmap-listing__stat">
                  <Layers /> {view.sharings.join(", ")} sharing
                </span>
              )}
              {!!view.totalBeds && view.totalBeds > 0 && (
                <span className="cmap-listing__stat">
                  <BedDouble /> {view.totalBeds} beds
                </span>
              )}
              {view.hasMeals && (
                <span className="cmap-listing__stat">
                  <UtensilsCrossed /> Meals included
                </span>
              )}
            </>
          ) : (
            <>
              {view.bhk && (
                <span className="cmap-listing__stat">
                  <BedDouble /> {view.bhk} BHK
                </span>
              )}
              {view.furnishing && (
                <span className="cmap-listing__stat">
                  <Sofa /> {furnishLabel(view.furnishing)}
                </span>
              )}
              {view.area_sqft && (
                <span className="cmap-listing__stat">
                  <Ruler /> {view.area_sqft} sqft
                </span>
              )}
            </>
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
          <Link href={view.href} className="cmap-listing__cta cmap-listing__cta--primary">
            <Phone size={14} /> Unlock Contact
          </Link>
          <Link href={view.href} className="cmap-listing__cta cmap-listing__cta--secondary">
            <ExternalLink size={14} /> View Full Listing
          </Link>
        </div>
      </div>
    </div>
  );
}
