import type { ReactNode } from "react";

export const GENDER_LABEL: Record<string, string> = {
  boys: "Boys",
  girls: "Girls",
  coed: "Co-ed"
};
export const TENANT_LABEL: Record<string, string> = {
  students: "Students",
  working: "Working",
  any: "Any"
};
export const ELECTRICITY_LABEL: Record<string, string> = {
  flat: "Flat",
  submetered: "Sub-metered",
  split_equally: "Split equally"
};
export const SHARING_OPTIONS = ["single", "double", "triple", "quad", "dorm"] as const;
export const BATHROOM_OPTIONS = ["attached_western", "attached_indian", "shared"] as const;
export const FURNISHING_OPTIONS = ["fully_furnished", "semi_furnished", "unfurnished"] as const;
export const PAYMENT_MODE_OPTIONS = ["upi", "bank_transfer", "cash"] as const;

export function rupeesFromPaise(paise?: number | null): string {
  if (paise == null || paise <= 0) return "-";
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

export function titleCase(s?: string | null): string {
  if (!s) return "-";
  return s
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Money rule: rupee number ↔ paise (₹2,000–₹50,000 room-rent bounds). */
export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--ad-text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 4
      }}
    >
      {children}
    </div>
  );
}

/** Read-only label/value row used across the detail tabs. */
export function ReadRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "baseline",
        padding: "7px 0",
        borderBottom: "1px solid var(--ad-border)"
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: "var(--ad-text)",
          textAlign: "right",
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {children}
      </span>
    </div>
  );
}

/** Chips for amenity / house-rule / payment-mode lists. */
export function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span style={{ color: "var(--ad-text-3)", fontSize: 13 }}>-</span>;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
      {items.map((it) => (
        <span
          key={it}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--ad-text-2)",
            background: "var(--ad-surface-2)",
            border: "1px solid var(--ad-border)",
            borderRadius: 20,
            padding: "2px 10px"
          }}
        >
          {titleCase(it)}
        </span>
      ))}
    </span>
  );
}

/** Flatten a jsonb amenities object { category: string[] } into a flat label list. */
export function flattenAmenities(amenities: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(amenities ?? {})) {
    if (Array.isArray(v)) out.push(...v.map(String));
  }
  return out;
}

/** House rules jsonb { rule: true } → list of allowed-rule labels. */
export function allowedRules(houseRules: Record<string, unknown>): string[] {
  return Object.entries(houseRules ?? {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}
