/**
 * apps/web/lib/welcome-credits.ts
 *
 * Pure gating helper for the one-time welcome-credits celebration shown to
 * new users on their first landing after signup. Kept storage-agnostic
 * (Storage is passed in) so it's trivially unit-testable without jsdom.
 */

import type { Locale } from "./i18n";

export function welcomeStorageKey(userId: string): string {
  return `cribliv:welcome-credits-shown:${userId}`;
}

export function shouldShowWelcome(input: {
  isNewUser: boolean | undefined;
  userId: string | undefined;
  creditsGranted: number | undefined;
  storage: Storage;
}): boolean {
  if (!input.isNewUser || !input.userId || !input.creditsGranted || input.creditsGranted <= 0) {
    return false;
  }
  try {
    return input.storage.getItem(welcomeStorageKey(input.userId)) === null;
  } catch {
    return true;
  }
}

export function markWelcomeShown(userId: string, storage: Storage): void {
  try {
    storage.setItem(welcomeStorageKey(userId), new Date().toISOString());
  } catch {
    // The in-page fired ref still prevents repeats when storage is unavailable.
  }
}

export function formatSignupRewardExpiry(expiresAt: string, locale: Locale): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  }).format(date);
}
