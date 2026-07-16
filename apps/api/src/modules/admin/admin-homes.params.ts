import type {
  AdminHomeSort,
  AdminHomesListParams,
  AdminHomeStatusFilter
} from "@cribliv/shared-types";

const VALID_STATUSES = new Set<AdminHomeStatusFilter>(["active", "paused", "archived", "all"]);
const VALID_SORTS = new Set<AdminHomeSort>([
  "leads",
  "views",
  "conversion",
  "updated",
  "rent_desc",
  "rent_asc"
]);
const VALID_PAGE_SIZES = new Set([25, 50, 100]);

export function sanitizeAdminHomesParams(
  raw: Record<string, string | undefined>
): AdminHomesListParams {
  const status = VALID_STATUSES.has(raw.status as AdminHomeStatusFilter)
    ? (raw.status as AdminHomeStatusFilter)
    : "active";
  const sort = VALID_SORTS.has(raw.sort as AdminHomeSort) ? (raw.sort as AdminHomeSort) : "leads";
  const pageNumber = Number(raw.page);
  const requestedPageSize = Number(raw.page_size);
  const city = raw.city?.trim().toLowerCase().slice(0, 100) || undefined;
  const q = raw.q?.trim().slice(0, 200) || undefined;

  return {
    status,
    ...(city ? { city } : {}),
    ...(q ? { q } : {}),
    sort,
    page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    page_size: (VALID_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25) as 25 | 50 | 100
  };
}
