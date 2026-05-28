import { fetchApi } from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import { t } from "../../lib/i18n";
import { ListingCarousel } from "../listing-carousel";
import type { ListingCardData } from "../listing-card";

interface SimilarListingsProps {
  locale: Locale;
  city: string;
  listingType: "flat_house" | "pg";
  excludeId: string;
}

interface ListingsSearchResponse {
  items: ListingCardData[];
  total: number;
  page: number;
  page_size: number;
}

export async function SimilarListings({
  locale,
  city,
  listingType,
  excludeId
}: SimilarListingsProps) {
  let items: ListingCardData[] = [];
  try {
    const res = await fetchApi<ListingsSearchResponse>(
      `/listings/search?city=${encodeURIComponent(city)}&listing_type=${listingType}&sort=verified&page=1`,
      undefined,
      { server: true }
    );
    items = (res.items ?? []).filter((l) => l.id !== excludeId).slice(0, 12);
  } catch {
    items = [];
  }

  if (items.length === 0) return null;

  return (
    <ListingCarousel
      title={t(locale, "similarProperties")}
      items={items}
      locale={locale}
      viewAllHref={`/${locale}/search?city=${encodeURIComponent(city)}&listing_type=${listingType}`}
      viewAllLabel={t(locale, "viewAll")}
    />
  );
}
