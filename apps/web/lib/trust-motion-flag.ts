/**
 * Server-safe flag read for `ff_trust_motion`.
 *
 * `useFlag` (./feature-flags.ts) is a `"use client"` hook and cannot run inside
 * a Server Component. The listing detail page is a Server Component, so it reads
 * the env var directly here to decide whether to render the TrustMotion
 * treatment (rent count-up, safety strip) — same pattern as
 * `unavailable-listings-flag.ts`. Client surfaces (the listing card) keep using
 * `useFlag("ff_trust_motion")`; both resolve to the same env default.
 */
export function isTrustMotionEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_FF_TRUST_MOTION;
  return raw === "true" || raw === "1";
}
