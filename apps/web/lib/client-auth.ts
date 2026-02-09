"use client";

export interface StoredAuthSession {
  access_token: string;
  refresh_token?: string;
  user?: {
    id: string;
    role: string;
    phone_e164: string;
    preferred_language: "en" | "hi";
  };
}

const AUTH_KEY = "cribliv:auth-session";
const GUEST_SHORTLIST_KEY = "cribliv:guest-shortlist";

export function readAuthSession(): StoredAuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(AUTH_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredAuthSession;
  } catch {
    return null;
  }
}

export function writeAuthSession(session: StoredAuthSession) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

export function clearAuthSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_KEY);
}

export function readGuestShortlist(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(GUEST_SHORTLIST_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

export function writeGuestShortlist(listingIds: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(GUEST_SHORTLIST_KEY, JSON.stringify(Array.from(new Set(listingIds))));
}

export function toggleGuestShortlist(listingId: string) {
  const existing = readGuestShortlist();
  if (existing.includes(listingId)) {
    const next = existing.filter((id) => id !== listingId);
    writeGuestShortlist(next);
    return { active: false, listingIds: next };
  }

  const next = [...existing, listingId];
  writeGuestShortlist(next);
  return { active: true, listingIds: next };
}
