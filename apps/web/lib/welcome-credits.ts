/**
 * apps/web/lib/welcome-credits.ts
 *
 * Pure gating helper for the one-time welcome-credits celebration shown to
 * new users on their first landing after signup. Kept storage-agnostic
 * (Storage is passed in) so it's trivially unit-testable without jsdom.
 */

export function welcomeStorageKey(userId: string): string {
  return `cribliv:welcome-credits-shown:${userId}`;
}

export function shouldShowWelcome(input: {
  isNewUser: boolean | undefined;
  userId: string | undefined;
  storage: Storage;
}): boolean {
  if (!input.isNewUser || !input.userId) return false;
  try {
    return input.storage.getItem(welcomeStorageKey(input.userId)) === null;
  } catch {
    return false;
  }
}

export function markWelcomeShown(userId: string, storage: Storage): void {
  try {
    storage.setItem(welcomeStorageKey(userId), new Date().toISOString());
  } catch {
    // Private-mode storage failures just skip the celebration; never crash.
  }
}
