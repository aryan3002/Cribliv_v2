/* ──────────────────────────────────────────────────────────────────────
 * Admin formatters — money, dates, deltas, percentages.
 *
 * All values come from the API in their native units (paise for money,
 * ISO strings for dates). UI formats them on render.
 * ──────────────────────────────────────────────────────────────────── */

export function formatINR(paise: number): string {
  if (!Number.isFinite(paise)) return "₹0";
  const rupees = paise / 100;
  if (rupees >= 1_00_00_000)
    return `₹${(rupees / 1_00_00_000).toFixed(rupees >= 10_00_00_000 ? 1 : 2)} Cr`;
  if (rupees >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(rupees >= 10_00_000 ? 1 : 2)} L`;
  if (rupees >= 1000) return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  return `₹${rupees.toFixed(0)}`;
}

export function formatINRPrecise(paise: number): string {
  if (!Number.isFinite(paise)) return "₹0";
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString("en-IN");
}

export function formatPct(ratio: number | null | undefined, decimals = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return "-";
  return `${(ratio * 100).toFixed(decimals)}%`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "in the future";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "-";
  // +919876543210 → +91 98765 43210
  if (phone.startsWith("+91") && phone.length === 13) {
    return `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`;
  }
  return phone;
}

/**
 * Client-side PREVIEW of what the API's normalizeIndianPhone
 * (apps/api/src/modules/admin/phone.util.ts) will resolve an admin-entered
 * phone to, so the admin wizard's Review step can echo "this is who gets the
 * listing" back to the worker before they publish (2026-07-28 review,
 * Finding 5 — a confirmation checkpoint before a listing, and its paid-unlock
 * callback number, hand to whoever this resolves to). Returns null for
 * anything unparseable rather than guessing at a preview.
 *
 * Display-only. This value must NEVER be used to block submission — the API
 * is still the sole validator. TransferOwnerModal.tsx already documents why
 * the web side deliberately doesn't re-implement phone VALIDATION (a typo
 * costs one round-trip on the real endpoint rather than risking the two
 * implementations drifting apart); this preview is a narrower, additive
 * thing — read-only, informational, and never rejects input the server
 * would accept or accepts input the server would reject, because it never
 * gates anything at all.
 *
 * Mirrors the API's rules 1:1 (strip whitespace/hyphens, accept +91/91/0
 * prefixes, require a 10-digit subscriber number starting 6-9). The two
 * copies can still drift if one changes without the other — but the failure
 * mode of drift here is a stale or wrong PREVIEW, never a wrong WRITE: the
 * real publish call still goes through the API, which re-validates
 * independently and is the only thing that actually moves the listing. If
 * this drifts in practice, the fix is consolidating both copies into
 * packages/shared-types (dependency-free, already imported by both apps —
 * see CLAUDE.md's "shared-types must stay dependency-free" note) rather than
 * hand-syncing two copies indefinitely.
 */
export function previewNormalizedIndianPhone(input: string): string | null {
  let s = String(input ?? "").replace(/[\s\-()]/g, "");
  if (s === "") return null;

  if (s.startsWith("+")) {
    if (!s.startsWith("+91")) return null;
    s = s.slice(3);
  } else if (s.length === 12 && s.startsWith("91")) {
    s = s.slice(2);
  } else if (s.startsWith("0")) {
    s = s.replace(/^0+/, "");
  }

  if (!/^[6-9]\d{9}$/.test(s)) return null;
  return formatPhone(`+91${s}`);
}

export function formatHourBucket(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", hour12: false });
}

export function formatMinutes(m: number | null | undefined): string {
  if (m == null) return "-";
  if (m < 1) return "<1m";
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / (60 * 24))}d`;
}
