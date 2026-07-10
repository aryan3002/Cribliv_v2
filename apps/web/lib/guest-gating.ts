/**
 * apps/web/lib/guest-gating.ts
 *
 * Pure guest-gating constants/helpers, shared between server and client.
 *
 * IMPORTANT: this module must NOT be "use client". The search results page
 * (a React Server Component) computes each card's `gated` prop with
 * `index >= GUEST_FREE_CARDS`. When this constant lived inside the
 * "use client" guest-gate.tsx, importing it into the RSC handed the server a
 * client-reference Proxy instead of the number 6 — `index >= Proxy` is
 * silently false, so no card was ever gated regardless of flag or session.
 * Keeping the value in a plain shared module means both runtimes see the
 * real number.
 */

export const GUEST_FREE_CARDS = 6;

export function isCardGated(input: { index: number; isGuest: boolean; flagOn: boolean }): boolean {
  return input.flagOn && input.isGuest && input.index >= GUEST_FREE_CARDS;
}
