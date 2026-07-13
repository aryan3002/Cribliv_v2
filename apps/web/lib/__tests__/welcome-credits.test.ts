import { describe, it, expect } from "vitest";
import {
  formatSignupRewardExpiry,
  shouldShowWelcome,
  markWelcomeShown,
  welcomeStorageKey
} from "../welcome-credits";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    }
  } as Storage;
}

describe("welcome credits gating", () => {
  it("shows once for a new user, then never again", () => {
    const storage = memStorage();
    expect(shouldShowWelcome({ isNewUser: true, userId: "u1", creditsGranted: 10, storage })).toBe(
      true
    );
    markWelcomeShown("u1", storage);
    expect(shouldShowWelcome({ isNewUser: true, userId: "u1", creditsGranted: 10, storage })).toBe(
      false
    );
  });

  it("never shows for returning users, missing ids, or missing/zero rewards", () => {
    const storage = memStorage();
    expect(shouldShowWelcome({ isNewUser: false, userId: "u1", creditsGranted: 10, storage })).toBe(
      false
    );
    expect(
      shouldShowWelcome({ isNewUser: true, userId: undefined, creditsGranted: 10, storage })
    ).toBe(false);
    expect(
      shouldShowWelcome({ isNewUser: true, userId: "u1", creditsGranted: undefined, storage })
    ).toBe(false);
    expect(shouldShowWelcome({ isNewUser: true, userId: "u1", creditsGranted: 0, storage })).toBe(
      false
    );
  });

  it("keys storage per user", () => {
    expect(welcomeStorageKey("u1")).toBe("cribliv:welcome-credits-shown:u1");
  });
});

describe("signup reward expiry formatting", () => {
  it("formats the canonical date in English using UTC", () => {
    expect(formatSignupRewardExpiry("2026-10-11T23:30:00.000-05:00", "en")).toBe("12 October 2026");
  });

  it("formats the canonical date in Hindi using UTC", () => {
    expect(formatSignupRewardExpiry("2026-10-11T23:30:00.000-05:00", "hi")).toBe("12 अक्टूबर 2026");
  });
});
