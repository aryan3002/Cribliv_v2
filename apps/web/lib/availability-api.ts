import { fetchApi } from "./api";
import type { AvailabilityAlertResult, AvailabilityAlertStatus } from "@cribliv/shared-types";

export type { AvailabilityAlertResult, AvailabilityAlertStatus };

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Joins the calling account to a listing's "notify when available" waitlist.
 * POST /listings/:id/availability-alerts (Task 11) is idempotent per
 * (listing, phone) — a repeat call from the same account returns
 * `already_on_list: true` rather than erroring or duplicating a row, so this
 * is always safe to call, including as the terminal step right after a guest
 * completes OTP verification.
 *
 * `locale` is optional and, when passed, is stored against the alert so a
 * later notification can be sent in the seeker's language (mirrors
 * `preferred_language` elsewhere in the app) — the API accepts it but does
 * not require it.
 */
export async function joinAvailabilityWaitlist(
  accessToken: string,
  listingId: string,
  locale?: string
): Promise<AvailabilityAlertResult> {
  return fetchApi<AvailabilityAlertResult>(`/listings/${listingId}/availability-alerts`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: locale ? JSON.stringify({ locale }) : undefined
  });
}

export interface WaitlistEntry {
  listing_id: string;
  status: AvailabilityAlertStatus;
}

/**
 * Lists every listing the current account's phone is on the
 * notify-when-available waitlist for. GET /tenant/availability-alerts
 * (Task 11) — reachable by any authenticated role, not tenant-only.
 */
export async function getMyWaitlist(accessToken: string): Promise<{ items: WaitlistEntry[] }> {
  return fetchApi<{ items: WaitlistEntry[] }>("/tenant/availability-alerts", {
    headers: authHeaders(accessToken)
  });
}
