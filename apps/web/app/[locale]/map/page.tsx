import type { Metadata } from "next";
import dynamic from "next/dynamic";

const MapClient = dynamic(() => import("./map-client"), { ssr: false });

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";

  return {
    title: isHindi
      ? "CriblMap — सत्यापित किराये का नक्शा"
      : "CriblMap — Verified Rent Intelligence Map",
    description: isHindi
      ? "दिल्ली NCR में सत्यापित किराये की लिस्टिंग का मानचित्र। क्षेत्र के हिसाब से किराया, मेट्रो, और बाजार अंतर्दृष्टि देखें।"
      : "Explore verified rental listings on a live map. See area-level rent data, metro proximity, and market insights across Delhi NCR.",
    openGraph: {
      title: "CriblMap — Verified Rent Intelligence",
      description:
        "Every pin is a verified listing. Explore rents, demand, and market trends on an interactive map.",
      url: `${BASE_URL}/${params.locale}/map`,
      siteName: "Cribliv",
      type: "website"
    },
    robots: { index: true, follow: true }
  };
}

export default function MapPage({
  params,
  searchParams
}: {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const initialFilters: Record<string, unknown> = {};

  const bhk = typeof searchParams.bhk === "string" ? Number(searchParams.bhk) : undefined;
  const max_rent =
    typeof searchParams.max_rent === "string" ? Number(searchParams.max_rent) : undefined;
  const listing_type =
    typeof searchParams.listing_type === "string" ? searchParams.listing_type : undefined;
  const verified_only = searchParams.verified_only === "true";

  if (bhk) initialFilters.bhk = bhk;
  if (max_rent) initialFilters.max_rent = max_rent;
  if (listing_type === "flat_house" || listing_type === "pg")
    initialFilters.listing_type = listing_type;
  if (verified_only) initialFilters.verified_only = true;

  // Optional initial centering — used when arriving from a listing's
  // "Explore on CriblMap" link so the map opens on that listing's pin.
  const latParam = typeof searchParams.lat === "string" ? Number(searchParams.lat) : NaN;
  const lngParam = typeof searchParams.lng === "string" ? Number(searchParams.lng) : NaN;
  const zoomParam = typeof searchParams.zoom === "string" ? Number(searchParams.zoom) : NaN;
  const initialCenter =
    Number.isFinite(latParam) && Number.isFinite(lngParam)
      ? { lat: latParam, lng: lngParam }
      : undefined;
  const initialZoom = Number.isFinite(zoomParam) ? zoomParam : undefined;

  // City slug (?city=lucknow) drives city-aware overlays (metro lines, etc.).
  // Defaults to "delhi" when absent so the existing experience is unchanged.
  const initialCity =
    typeof searchParams.city === "string" && /^[a-z][a-z0-9_-]{1,32}$/i.test(searchParams.city)
      ? searchParams.city.toLowerCase()
      : undefined;

  // Originating listing (?listing=<uuid>) — set by the listing detail page's
  // "Explore on CriblMap" link. Drives walk-time / distance-from-listing
  // overlays in the metro tooltips.
  const initialOriginatingListingId =
    typeof searchParams.listing === "string" && /^[0-9a-f-]{36}$/i.test(searchParams.listing)
      ? searchParams.listing
      : undefined;

  return (
    <MapClient
      locale={params.locale}
      initialFilters={
        initialFilters as {
          bhk?: number;
          max_rent?: number;
          listing_type?: "flat_house" | "pg";
          verified_only?: boolean;
        }
      }
      initialCenter={initialCenter}
      initialZoom={initialZoom}
      initialCity={initialCity}
      initialOriginatingListingId={initialOriginatingListingId}
    />
  );
}
