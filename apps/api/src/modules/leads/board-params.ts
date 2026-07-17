import type { AdminLeadBoardFilter, LeadStatus } from "@cribliv/shared-types";
import type { BoardParams } from "./admin-lead-ops.service";

export interface RawBoardParams {
  filter?: string;
  owner_id?: string;
  state?: string;
  status?: string;
  q?: string;
  range?: string;
  page?: string;
  page_size?: string;
  sort?: string;
  listing_id?: string;
}

const VALID_SORTS = new Set(["urgency", "newest"]);

const VALID_FILTERS: ReadonlySet<AdminLeadBoardFilter> = new Set([
  "needs_call",
  "expiring_6h",
  "called",
  "expired_today",
  "refunded_today",
  "all"
]);
const VALID_STATUS: ReadonlySet<LeadStatus> = new Set([
  "new",
  "contacted",
  "visit_scheduled",
  "deal_done",
  "lost"
]);
const VALID_RANGE = new Set(["7 days", "30 days", "90 days"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toPositiveInt(raw: string | undefined, fallback: number, max?: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  let v = Math.max(1, Math.floor(n));
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

/** Coerce untrusted query params into a safe BoardParams (no value can reach a SQL cast unvalidated). */
export function sanitizeBoardParams(raw: RawBoardParams): BoardParams {
  const filter = (
    raw.filter && VALID_FILTERS.has(raw.filter as AdminLeadBoardFilter)
      ? (raw.filter as AdminLeadBoardFilter)
      : "needs_call"
  ) as AdminLeadBoardFilter;
  const status =
    raw.status && VALID_STATUS.has(raw.status as LeadStatus)
      ? (raw.status as LeadStatus)
      : undefined;
  const range = raw.range && VALID_RANGE.has(raw.range) ? raw.range : "30 days";
  return {
    filter,
    ownerId: raw.owner_id && UUID_RE.test(raw.owner_id) ? raw.owner_id : undefined,
    listingId: raw.listing_id && UUID_RE.test(raw.listing_id) ? raw.listing_id : undefined,
    state: raw.state || undefined, // access_state is a text column — a bad value just returns 0 rows
    status,
    q: raw.q || undefined,
    range,
    sort: raw.sort && VALID_SORTS.has(raw.sort) ? (raw.sort as "urgency" | "newest") : "urgency",
    page: toPositiveInt(raw.page, 1),
    pageSize: toPositiveInt(raw.page_size, 50, 100)
  };
}
