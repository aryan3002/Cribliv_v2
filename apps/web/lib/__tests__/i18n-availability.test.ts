import { describe, expect, it } from "vitest";
import { t } from "../i18n";

// Task 16: consolidate the "unavailable listings" feature's copy into i18n.
// Every key below backs a real t(locale, key) call somewhere in the
// availability feature (owner toggles, listing cards, search page, tenant
// unlock/waitlist panel). This test guards two things:
//   1. every key actually resolves to real copy (not silently falling back
//      to the bare key string) in both locales, and
//   2. the hi copy is genuinely translated, not just the English string
//      copy-pasted under the hi field (which would defeat the point).
const LOCALES = ["en", "hi"] as const;

// Keys newly introduced by Task 16 for components that previously had no
// t()-backed copy at all (owner toggles' labels/helper text, the owner-facing
// waitlist nudge, the search-results "currently unavailable" divider) plus
// the two literal aliases from the original task brief.
const NEW_TASK_16_KEYS = [
  "availabilityLabel",
  "availabilityAvailable",
  "availabilityNotAvailable",
  "availabilityHelper",
  "visibilityLabel",
  "visibilityLive",
  "visibilityHelper",
  "notifyMe",
  "waitlistPeopleWaiting",
  "currentlyUnavailableDivider",
  "notifyWhenAvailable",
  "currentlyUnavailable"
] as const;

// Keys the feature already had wired up via t() before this task (Tasks
// 8/10/13/15) and that this task's swaps now additionally reuse in
// listing-card.tsx / notify-availability-button.tsx / availability-toggle.tsx.
// Re-checked here so the whole feature's copy surface is covered by one test.
const EXISTING_AVAILABILITY_KEYS = [
  "availUnavailableBadge",
  "availUnavailableChip",
  "availNotifyButton",
  "availVerifyButton",
  "availGuestHint",
  "availJoinedSuccess",
  "availAlreadyOnList",
  "availWaitlistCount",
  "paused"
] as const;

describe("i18n availability copy (Task 16)", () => {
  it("has the brief's illustrative keys truthy in en and hi", () => {
    // Mirrors the task-16-brief.md Step 1 failing test verbatim.
    for (const loc of LOCALES) {
      expect(t(loc, "notifyWhenAvailable")).toBeTruthy();
      expect(t(loc, "currentlyUnavailable")).toBeTruthy();
    }
  });

  describe.each(NEW_TASK_16_KEYS)("key %s", (key) => {
    it("resolves to a truthy string in en and hi", () => {
      for (const loc of LOCALES) {
        expect(t(loc, key)).toBeTruthy();
      }
    });

    it("is not silently falling back to the raw key", () => {
      for (const loc of LOCALES) {
        expect(t(loc, key)).not.toBe(key);
      }
    });

    it("has a genuinely different hi translation from en", () => {
      expect(t("hi", key)).not.toBe(t("en", key));
    });
  });

  describe.each(EXISTING_AVAILABILITY_KEYS)("pre-existing key %s", (key) => {
    it("still resolves to a truthy, distinct translation in en and hi", () => {
      expect(t("en", key)).toBeTruthy();
      expect(t("hi", key)).toBeTruthy();
      expect(t("hi", key)).not.toBe(t("en", key));
    });
  });

  it("supports the {count} placeholder on waitlistPeopleWaiting", () => {
    for (const loc of LOCALES) {
      const rendered = t(loc, "waitlistPeopleWaiting").replace("{count}", "5");
      expect(rendered).toContain("5");
      expect(rendered).not.toContain("{count}");
    }
  });

  it("keeps the en copy byte-for-byte identical to the original rendered strings", () => {
    // Protects the existing English UI/tests — these MUST match the raw
    // strings that were hardcoded before this task's swap.
    expect(t("en", "availabilityLabel")).toBe("Availability");
    expect(t("en", "availabilityAvailable")).toBe("Available");
    expect(t("en", "availabilityNotAvailable")).toBe("Not available");
    expect(t("en", "availabilityHelper")).toBe(
      "Stays listed, sinks in search, collects notify sign-ups."
    );
    expect(t("en", "visibilityLabel")).toBe("Visibility");
    expect(t("en", "visibilityLive")).toBe("Live");
    expect(t("en", "visibilityHelper")).toBe("Paused hides it from search completely");
    expect(t("en", "notifyMe")).toBe("Notify me");
    expect(t("en", "waitlistPeopleWaiting")).toBe(
      "{count} people want to be notified when this is available"
    );
    expect(t("en", "currentlyUnavailableDivider")).toBe(
      "Currently unavailable · get notified when they're back"
    );
    expect(t("en", "paused")).toBe("Paused");
    expect(t("en", "availUnavailableBadge")).toBe("Unavailable");
    expect(t("en", "availNotifyButton")).toBe("Notify when available");
  });
});
