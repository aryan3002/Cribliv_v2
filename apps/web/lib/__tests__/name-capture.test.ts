import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasName,
  isNamePromptDismissed,
  isSuppressedPath,
  markNamePromptDismissed,
  namePromptDismissKey,
  shouldShowNamePrompt
} from "../name-capture";
import { locales, t } from "../i18n";

/** Minimal in-memory Storage so these stay pure — no jsdom needed. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (k: string) => {
      return map.get(k) ?? null;
    },
    key: (i: number) => {
      return Array.from(map.keys())[i] ?? null;
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    }
  };
}

const base = {
  status: "authenticated" as const,
  role: "tenant" as const,
  name: null as string | null | undefined,
  userId: "u1",
  pathname: "/en",
  storage: undefined as Storage | undefined,
  welcomePending: false
};

describe("hasName", () => {
  it.each([null, undefined, "", "   "])("is false for %j", (value) => {
    expect(hasName(value)).toBe(false);
  });

  it("is true for a real name", () => {
    expect(hasName("Asha")).toBe(true);
  });
});

describe("isSuppressedPath", () => {
  it.each(["/en/auth/login", "/auth/login", "/hi/auth/login", "/en/admin", "/en/admin/leads"])(
    "suppresses %s",
    (path) => {
      expect(isSuppressedPath(path)).toBe(true);
    }
  );

  it.each(["/en", "/en/listing/abc", "/hi/pg", null])("does not suppress %j", (path) => {
    expect(isSuppressedPath(path)).toBe(false);
  });
});

describe("dismissal flag", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it("is namespaced per user", () => {
    expect(namePromptDismissKey("u1")).toBe("cribliv:name-prompt-dismissed:u1");
  });

  it("records a dismissal", () => {
    expect(isNamePromptDismissed("u1", storage)).toBe(false);
    markNamePromptDismissed("u1", storage);
    expect(isNamePromptDismissed("u1", storage)).toBe(true);
  });

  it("does not leak across users", () => {
    markNamePromptDismissed("u1", storage);
    expect(isNamePromptDismissed("u2", storage)).toBe(false);
  });

  it("treats a throwing storage as not-dismissed", () => {
    const hostile = {
      ...makeStorage(),
      getItem: () => {
        throw new Error("blocked");
      }
    } as unknown as Storage;
    expect(isNamePromptDismissed("u1", hostile)).toBe(false);
  });
});

describe("shouldShowNamePrompt", () => {
  it("shows for an authenticated nameless tenant", () => {
    expect(shouldShowNamePrompt({ ...base, storage: makeStorage() })).toBe(true);
  });

  it.each(["owner", "pg_operator"] as const)("shows for %s", (role) => {
    expect(shouldShowNamePrompt({ ...base, role, storage: makeStorage() })).toBe(true);
  });

  it("never shows for admin", () => {
    expect(shouldShowNamePrompt({ ...base, role: "admin", storage: makeStorage() })).toBe(false);
  });

  it("does not show when a name exists", () => {
    expect(shouldShowNamePrompt({ ...base, name: "Asha", storage: makeStorage() })).toBe(false);
  });

  it("does show for a whitespace-only name, which is not a name", () => {
    expect(shouldShowNamePrompt({ ...base, name: "   ", storage: makeStorage() })).toBe(true);
  });

  it.each(["loading", "unauthenticated"] as const)("does not show when status is %s", (status) => {
    expect(shouldShowNamePrompt({ ...base, status, storage: makeStorage() })).toBe(false);
  });

  it("does not show on a suppressed path", () => {
    expect(
      shouldShowNamePrompt({ ...base, pathname: "/en/auth/login", storage: makeStorage() })
    ).toBe(false);
  });

  it("does not show once dismissed", () => {
    const storage = makeStorage();
    markNamePromptDismissed("u1", storage);
    expect(shouldShowNamePrompt({ ...base, storage })).toBe(false);
  });

  it("does not show while the welcome-credits modal is pending", () => {
    // Both overlays lock body scroll and trap focus; two at once fight.
    expect(shouldShowNamePrompt({ ...base, welcomePending: true, storage: makeStorage() })).toBe(
      false
    );
  });

  it("does not show without a userId", () => {
    expect(shouldShowNamePrompt({ ...base, userId: undefined, storage: makeStorage() })).toBe(
      false
    );
  });

  it("shows when storage is unavailable rather than staying silent", () => {
    expect(shouldShowNamePrompt({ ...base, storage: undefined })).toBe(true);
  });
});

describe("name-capture copy", () => {
  const keys = [
    "nameCaptureTitle",
    "nameCaptureTitleRequired",
    "nameCaptureBodyTenant",
    "nameCaptureBodyOwner",
    "nameCaptureBodyContact",
    "nameCaptureLabel",
    "nameCapturePlaceholder",
    "nameCaptureSave",
    "nameCaptureSaving",
    "nameCaptureSaveAndContinue",
    "nameCaptureSkip",
    "nameCaptureClose",
    "nameCaptureError",
    "nameCaptureTooShort",
    "nameCaptureInvalid"
  ];

  // t() returns the key itself when missing, which would otherwise ship as
  // visible gibberish like "nameCaptureSave" in the UI.
  it.each(locales)("resolves every key in %s", (locale) => {
    for (const key of keys) {
      expect(t(locale, key)).not.toBe(key);
    }
  });
});
