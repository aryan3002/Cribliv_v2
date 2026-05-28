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
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN");
}

export function formatPct(ratio: number | null | undefined, decimals = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
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
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  // +919876543210 → +91 98765 43210
  if (phone.startsWith("+91") && phone.length === 13) {
    return `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`;
  }
  return phone;
}

export function formatHourBucket(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", hour12: false });
}

export function formatMinutes(m: number | null | undefined): string {
  if (m == null) return "—";
  if (m < 1) return "<1m";
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / (60 * 24))}d`;
}
