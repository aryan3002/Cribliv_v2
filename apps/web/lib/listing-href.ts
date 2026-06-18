import type { Route } from "next";

/**
 * Canonical listing → detail-page URL, honouring the PG/flat CQRS split:
 *   - PG listings use the split read route /[locale]/pg/[city]/[id]
 *   - flats/houses keep /[locale]/listing/[id]
 *
 * The [city] segment on the PG route is cosmetic (the page resolves by id and
 * self-corrects the canonical from the listing's own city_slug), so a missing
 * city falls back to the flat route rather than producing /pg//[id].
 */
export function listingHref(
  locale: string,
  listing: { id: string; listing_type?: string | null; city?: string | null }
): Route {
  if (listing.listing_type === "pg" && listing.city) {
    return `/${locale}/pg/${listing.city}/${listing.id}` as Route;
  }
  return `/${locale}/listing/${listing.id}` as Route;
}
