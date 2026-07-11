import type { SearchMapListing } from "../app/[locale]/search/SearchResultsMap";
import type { PgCard } from "./pg-public-api";

export function pgCardToSearchMapListing(card: PgCard): SearchMapListing {
  return {
    id: card.id,
    title: card.title,
    city: card.city,
    city_name: card.city_name ?? undefined,
    locality: card.locality,
    lat: card.lat,
    lng: card.lng,
    listing_type: "pg",
    monthly_rent: card.starting_rent ?? 0,
    verification_status: card.verified ? "verified" : "pending",
    cover_photo: card.cover_photo
  };
}
