import { describe, it, expect } from "vitest";
import { GUEST_FREE_CARDS, isCardGated } from "../../components/guest-gate";

describe("guest gating threshold", () => {
  it("first 6 cards are never gated", () => {
    for (let i = 0; i < GUEST_FREE_CARDS; i++) {
      expect(isCardGated({ index: i, isGuest: true, flagOn: true })).toBe(false);
    }
  });
  it("7th+ cards gate only for guests with the flag on", () => {
    expect(isCardGated({ index: 6, isGuest: true, flagOn: true })).toBe(true);
    expect(isCardGated({ index: 6, isGuest: false, flagOn: true })).toBe(false);
    expect(isCardGated({ index: 6, isGuest: true, flagOn: false })).toBe(false);
  });
});
