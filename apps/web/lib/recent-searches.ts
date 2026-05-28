// Tiny localStorage-backed recent searches list.
// FIFO, capped at 5 entries, dedup-aware. SSR-safe (no-ops on the server).

const STORAGE_KEY = "cribliv:recent_searches";
const MAX_ENTRIES = 5;

export interface RecentSearch {
  query: string;
  ts: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readRecentSearches(): RecentSearch[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentSearch =>
          typeof item === "object" &&
          item !== null &&
          typeof item.query === "string" &&
          typeof item.ts === "number"
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): void {
  if (!isBrowser()) return;
  const trimmed = query.trim();
  if (!trimmed) return;
  try {
    const existing = readRecentSearches().filter(
      (item) => item.query.toLowerCase() !== trimmed.toLowerCase()
    );
    const next: RecentSearch[] = [{ query: trimmed, ts: Date.now() }, ...existing].slice(
      0,
      MAX_ENTRIES
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage might be disabled (private browsing) */
  }
}

export function clearRecentSearches(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
