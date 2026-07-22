import type {
  PgAdminListingSort,
  PgAdminListingStatusFilter,
  PgAdminListingsParams,
  PgAdminVerificationFilter
} from "@cribliv/shared-types";

const VALID_VERIFICATION = new Set<PgAdminVerificationFilter>(["verified", "all"]);
const VALID_STATUSES = new Set<PgAdminListingStatusFilter>([
  "active",
  "paused",
  "pending_review",
  "draft",
  "archived",
  "all"
]);
const VALID_SORTS = new Set<PgAdminListingSort>(["leads", "updated", "rent_desc", "rent_asc"]);
const VALID_PAGE_SIZES = new Set([25, 50, 100]);

export function sanitizeAdminPgListingsParams(
  raw: Record<string, string | undefined>
): PgAdminListingsParams {
  const verification = VALID_VERIFICATION.has(raw.verification as PgAdminVerificationFilter)
    ? (raw.verification as PgAdminVerificationFilter)
    : "verified";
  const status = VALID_STATUSES.has(raw.status as PgAdminListingStatusFilter)
    ? (raw.status as PgAdminListingStatusFilter)
    : "active";
  const sort = VALID_SORTS.has(raw.sort as PgAdminListingSort)
    ? (raw.sort as PgAdminListingSort)
    : "leads";
  const pageNumber = Number(raw.page);
  const requestedPageSize = Number(raw.page_size);
  const city = raw.city?.trim().toLowerCase().slice(0, 100) || undefined;
  const q = raw.q?.trim().slice(0, 200) || undefined;

  return {
    verification,
    status,
    ...(city ? { city } : {}),
    ...(q ? { q } : {}),
    sort,
    page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    page_size: (VALID_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25) as 25 | 50 | 100
  };
}
