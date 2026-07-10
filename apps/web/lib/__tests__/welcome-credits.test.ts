import { describe, it, expect } from "vitest";
import { shouldShowWelcome, markWelcomeShown, welcomeStorageKey } from "../welcome-credits";

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
    expect(shouldShowWelcome({ isNewUser: true, userId: "u1", storage })).toBe(true);
    markWelcomeShown("u1", storage);
    expect(shouldShowWelcome({ isNewUser: true, userId: "u1", storage })).toBe(false);
  });

  it("never shows for returning users or missing ids", () => {
    const storage = memStorage();
    expect(shouldShowWelcome({ isNewUser: false, userId: "u1", storage })).toBe(false);
    expect(shouldShowWelcome({ isNewUser: true, userId: undefined, storage })).toBe(false);
  });

  it("keys storage per user", () => {
    expect(welcomeStorageKey("u1")).toBe("cribliv:welcome-credits-shown:u1");
  });
});
