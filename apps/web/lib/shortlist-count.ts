import { readGuestShortlist } from "./client-auth";
import { fetchApi } from "./api";

/**
 * One shared shortlist count for the whole page.
 *
 * Before this module every ListingCardHeart fetched its own saved-state
 * independently, so a header badge built the same way would go stale the
 * instant a user hearted a listing. The header subscribes here; the hearts
 * notify on toggle.
 *
 * `null` means "not determined yet" and must render as no badge at all —
 * distinct from a determined zero, which also renders no badge but for a
 * different reason.
 */
type Listener = (count: number | null) => void;

let count: number | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) fn(count);
}

export function getShortlistCount(): number | null {
  return count;
}

export function subscribeShortlistCount(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Optimistic local nudge — avoids a refetch on every heart tap. */
export function adjustShortlistCount(delta: number): void {
  if (count === null) return;
  count = Math.max(0, count + delta);
  emit();
}

export async function refreshShortlistCount(token: string | null): Promise<void> {
  if (!token) {
    count = readGuestShortlist().length;
    emit();
    return;
  }
  try {
    const res = await fetchApi<{ items: { id: string }[]; total: number }>("/shortlist", {
      headers: { Authorization: `Bearer ${token}` }
    });
    count = res.total;
    emit();
  } catch {
    // Leave the count as-is. A failed refresh must not blank an existing badge,
    // and must not invent a zero.
  }
}

/** Test-only. */
export function __resetShortlistCountForTests(): void {
  count = null;
  listeners.clear();
}
