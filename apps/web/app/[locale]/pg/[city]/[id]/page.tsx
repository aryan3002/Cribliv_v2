import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "../../../../../auth";
import { getPgPublicListing } from "../../../../../lib/pg-public-api";
import { PgDetailClient } from "../../../../../components/pg/PgDetailClient";
import { jsonLdSafe } from "../../../../../lib/jsonld";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

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
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(breadcrumb) }}
      />
      <PgDetailClient detail={detail} city={params.city} locale={params.locale} isGuest={isGuest} />
    </>
  );
}
