/**
 * Server-safe flag read for `ff_unavailable_listings`.
 *
 * `useFlag` (./feature-flags.ts) is a `"use client"` hook (it calls
 * `useFeatureFlagEnabled` from posthog-js/react) and cannot run inside a
 * Server Component. Pages that need this flag to decide *what to render on
 * the server* (e.g. splitting the search results grid into available vs
 * unavailable before the HTML is generated) read the env var directly here
 * instead — same pattern as `pg-maintenance-ops-v2-flag.ts`.
 *
 * There is no posthog-node dependency in this app, so unlike the client hook,
 * this only ever resolves via the env var — the same trade-off already
 * accepted by the other env-only server flags in this codebase (e.g. the
 * inline `NEXT_PUBLIC_FF_LISTENING_HERO` check in `app/[locale]/page.tsx`).
 */
export function isUnavailableListingsEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS;
  return raw === "true" || raw === "1";
}
