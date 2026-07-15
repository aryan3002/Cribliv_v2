import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "../../../../../auth";
import { getPgPublicListing } from "../../../../../lib/pg-public-api";
import { PgDetailClient } from "../../../../../components/pg/PgDetailClient";
import { jsonLdSafe } from "../../../../../lib/jsonld";
import { buildListing } from "../../../../../lib/structured-data";
import { toTitleCase } from "../../../../../lib/utils";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";
const PHOTO_BASE = (process.env.NEXT_PUBLIC_PHOTO_BASE_URL || "").replace(/\/+$/, "");

/** Resolve a stored blob path to an absolute photo URL (mirrors PgDetailClient). */
function photoUrl(blobPath: string): string {
  if (/^https?:\/\//i.test(blobPath)) return blobPath;
  return PHOTO_BASE ? `${PHOTO_BASE}/${blobPath.replace(/^\/+/, "")}` : blobPath;
}

async function load(id: string) {
  try {
    return await getPgPublicListing(id, { server: true });
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; city: string; id: string };
}): Promise<Metadata> {
  const detail = await load(params.id);
  if (!detail) return { title: "PG not found" };
  const citySlug = detail.city_slug ?? params.city;
  const cityTitle = citySlug.charAt(0).toUpperCase() + citySlug.slice(1);
  return {
    title: `${detail.title ?? "PG"}: PG in ${cityTitle}`,
    description: `Verified PG${detail.monthly_rent ? ` from ₹${detail.monthly_rent.toLocaleString("en-IN")}/mo` : ""}. Sharing, food and amenities on Cribliv.`,
    alternates: {
      canonical: `${BASE_URL}/${params.locale}/pg/${citySlug}/${params.id}`,
      languages: {
        en: `${BASE_URL}/en/pg/${citySlug}/${params.id}`,
        hi: `${BASE_URL}/hi/pg/${citySlug}/${params.id}`
      }
    }
  };
}

export default async function PgDetailPage({
  params
}: {
  params: { locale: string; city: string; id: string };
}) {
  const detail = await load(params.id);
  if (!detail) notFound();
  const session = await auth().catch(() => null);
  const isGuest = !session?.user?.id;

  const citySlug = detail.city_slug ?? params.city;

  // Cover photo first, then the rest — schema.org prefers the lead image up front.
  const cover = detail.photos.find((p) => p.is_cover);
  const orderedPhotos = cover
    ? [cover, ...detail.photos.filter((p) => p !== cover)]
    : detail.photos;

  // Top-level monthly_rent may be null; fall back to the cheapest room type.
  const roomRentsPaise = detail.room_types
    .map((r) => r.monthly_rent_paise)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const minRoomRent = roomRentsPaise.length ? Math.round(Math.min(...roomRentsPaise) / 100) : null;
  const price = detail.monthly_rent ?? minRoomRent;

  const localitySlug = detail.locality_slug ?? detail.location_point?.locality_slug ?? null;

  const listingJsonLd = buildListing({
    url: `${BASE_URL}/${params.locale}/pg/${citySlug}/${params.id}`,
    name: detail.title ?? `PG in ${toTitleCase(citySlug)}`,
    description: `Verified PG${price ? ` from ₹${price.toLocaleString("en-IN")}/mo` : ""} in ${toTitleCase(citySlug)}. Sharing, food and amenities on Cribliv.`,
    price,
    images: orderedPhotos.map((p) => photoUrl(p.blob_path)),
    addressLocality: localitySlug ? toTitleCase(localitySlug.replace(/-/g, " ")) : null,
    addressRegion: toTitleCase(citySlug),
    lat: detail.location_point?.lat ?? null,
    lng: detail.location_point?.lng ?? null
  });

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${params.locale}` },
      { "@type": "ListItem", position: 2, name: "PG", item: `${BASE_URL}/${params.locale}/pg` },
      {
        "@type": "ListItem",
        position: 3,
        name: params.city,
        item: `${BASE_URL}/${params.locale}/pg/${params.city}`
      },
      {
        "@type": "ListItem",
        position: 4,
        name: detail.title ?? "PG",
        item: `${BASE_URL}/${params.locale}/pg/${params.city}/${params.id}`
      }
    ]
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(listingJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(breadcrumb) }}
      />
      <PgDetailClient detail={detail} city={params.city} locale={params.locale} isGuest={isGuest} />
    </>
  );
}
