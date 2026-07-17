# PG Detail Page Redesign — Implementation Plan (single-pass)

> **For agentic workers (Codex / Sonnet):** This plan is self-contained and executable in ONE pass. Every changed file has complete code. Do NOT invent values — all design tokens, class names, enum values, and field names are given verbatim. Implement top to bottom, then run the verification in the final section.

**Goal:** Redesign the PG detail listing page so (1) the starting rent is visible above the fold on desktop AND mobile with no scroll, (2) room-option cards are clear and complete (no leaked raw enum values, with live vacancy), (3) amenities read premium/minimal, and (4) every detail the operator captured is surfaced — all strictly within the existing Cribliv Design System v2.0.

**Architecture:** Frontend redesign of `apps/web/components/pg/PgDetailClient.tsx` + additive CSS in `apps/web/app/globals.css`, plus a small backend slice that exposes already-persisted-but-withheld fields through the existing public detail loader (following the `getEditPayload` SELECT pattern). No DB migration. No new dependencies. Reuse `ListingGallery`, `ListingHighlights`, `PgDetailLocationMap`, `PgInterestButton`, `PgListingCard` as-is.

**Tech stack:** Next.js 14 App Router, React 18, TypeScript strict, NestJS + raw SQL (Postgres), lucide-react icons, Vitest + @testing-library/react.

---

## Global Constraints (apply to every task)

**Design system — use ONLY these tokens (already defined in `:root` of `globals.css`):**

- Fonts: `--font-heading` (Manrope) for all headings/prices/numbers; `--font-body` (Inter) for body/labels. Never hardcode font families.
- Color law (do not violate): coral `--accent` = **exactly one** primary action per screen (the Show-Interest CTA). Blue `--brand`/`--brand-50`/`--brand-light` = everyday interactive. Green `--trust`/`--trust-light`/`--trust-dark` = verification/meals only. Amber `--amber`/`--amber-light` = deposits/terms. Danger `--danger`/`--danger-light` = low-vacancy/blocked.
- Spacing: `--space-1..24` (4px grid). Radii: `--radius-sm 8`, `--radius-md 12`, `--radius-lg 20`, `--radius-full`. Shadows: `--shadow-xs/sm/md/lg`. Transitions: `--transition-fast/base/spring`.
- Text: `--text-primary/secondary/tertiary`; surfaces `--surface/--surface-raised/--surface-sunken`; borders `--border/--border-strong`.
- The page root already carries `.tenant-detail-page` overrides; **scope every new CSS rule after line ~18450 in globals.css (append at end of file) so it wins the cascade**, and prefix page-specific rules with `.tenant-detail-page` where they must beat an existing rule.

**Responsive breakpoints already in use (match them):** `1024px` (2-col → 1-col; mobile `.cta-bar` appears; `.tenant-cost-strip` → 1-col; PG `.detail-rail` stays sticky via `.tenant-detail-page` override), `640px` (toolbar stacks; amenity grid 1-col), `600px` (`.pg-rooms-grid` → horizontal snap-scroll), `540px` (`.pg-meals-card` icon column drops).

**Do NOT:**

- Change `ListingGallery`, `ListingHighlights`, `PgDetailLocationMap`, `PgInterestButton` behavior.
- Expose `formatted_address`, `display_name`, or `internal_code` (privacy — deliberately withheld).
- Add any new npm dependency. Icons come from `lucide-react` (already used).

**Test/verify commands:** `pnpm --filter @cribliv/api test -- pg`, `pnpm --filter @cribliv/web test -- PgDetail`, `pnpm typecheck`, and the browser verification in the final task.

---

## File map

**Modify:**

- `apps/api/src/modules/pg-operator/services/pg-listing.service.ts` — detail loader SELECT + `PgListingDetail` interface: add `nearby`, `meal_charges_paise`, `deposit_refundable_pct`, `maintenance_paise`, `total_floors`, and pass through `verification_status`/`composite_score` already selected.
- `apps/web/lib/pg-public-api.ts` — extend `PgPublicDetail` + add `PgNearby` type.
- `apps/web/components/pg/PgDetailClient.tsx` — full redesign (complete file given below).
- `apps/web/app/globals.css` — append the CSS block (given below).

**Tests:**

- `apps/web/components/pg/__tests__/PgDetailClient.test.tsx` — add/extend (given below).
- `apps/api/test/pg-public-detail.test.ts` — extend for new fields (given below).

---

## SLICE A — Backend: expose the withheld fields

### Task A1: Extend `PgListingDetail` + public loader SELECT

**File:** `apps/api/src/modules/pg-operator/services/pg-listing.service.ts`

**Context (verified):** the public loader `loadListingDetail` (~lines 746–889) currently selects `d.total_beds, d.gender_policy, d.tenant_type, d.security_deposit_paise, d.notice_period_days, d.lock_in_months, d.electricity_mode, d.rent_due_day, d.price_negotiable, d.payment_modes, d.meals, d.amenities, d.house_rules` from `pg_details d`, joins `pg_properties pp`, `cities c`, `localities loc`. The richer `getEditPayload` already selects `d.nearby, d.meal_charges_paise, d.deposit_refundable_pct, d.maintenance_paise` and `pp.total_floors` — proof they are persisted. We mirror those SELECT columns into the public loader.

- [ ] **Step 1: Extend the `PgListingDetail` interface.** In the `pg_details` object add these fields (keep existing fields):

```ts
pg_details: {
  total_beds: number | null;
  gender_policy: string | null;
  tenant_type: string | null;
  security_deposit_paise: number | null;
  notice_period_days: number | null;
  lock_in_months: number | null;
  electricity_mode: string | null;
  rent_due_day: number | null;
  price_negotiable: boolean;
  payment_modes: string[];
  meals: Record<string, unknown> | null;
  amenities: Record<string, unknown>;
  house_rules: Record<string, unknown>;
  // NEW — already persisted, now exposed:
  meal_charges_paise: number | null;
  deposit_refundable_pct: number | null;
  maintenance_paise: number | null;
  nearby: { metro: string[]; college: string[]; office: string[] } | null;
};
// NEW top-level (from pg_properties):
total_floors: number | null;
```

- [ ] **Step 2: Add the SELECT columns** to the head SELECT in `loadListingDetail` (place beside the existing `d.*` columns and `pp.*` columns — no new joins needed; `d` and `pp` are already joined):

```sql
  d.meal_charges_paise      AS meal_charges_paise,
  d.deposit_refundable_pct  AS deposit_refundable_pct,
  d.maintenance_paise       AS maintenance_paise,
  d.nearby                  AS nearby,
  pp.total_floors           AS total_floors,
```

- [ ] **Step 3: Map them in the row→DTO builder** (where `pg_details` is assembled). Add:

```ts
meal_charges_paise: row.meal_charges_paise ?? null,
deposit_refundable_pct: row.deposit_refundable_pct ?? null,
maintenance_paise: row.maintenance_paise ?? null,
nearby: normalizeNearby(row.nearby),
```

and at the top level of the returned detail object add `total_floors: row.total_floors ?? null,`.

- [ ] **Step 4: Add the `normalizeNearby` helper** near the top of the file (JSONB may arrive as object or null; be defensive):

```ts
function normalizeNearby(
  raw: unknown
): { metro: string[]; college: string[]; office: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  const metro = arr(r.metro),
    college = arr(r.college),
    office = arr(r.office);
  if (metro.length === 0 && college.length === 0 && office.length === 0) return null;
  return { metro, college, office };
}
```

- [ ] **Step 5: Verify the existing `verification_status` / `composite_score`** are already in `PgListingDetail` and selected (they are, per the location-map work). No change needed server-side; they'll be typed on the web in Task A2.

- [ ] **Step 6:** `pnpm --filter @cribliv/api test -- pg-public-detail` — extend the test (Task A3) first; expect the new fields to appear.

### Task A2: Extend the web `PgPublicDetail` type

**File:** `apps/web/lib/pg-public-api.ts`

- [ ] Add the `PgNearby` type and extend `PgPublicDetail`:

```ts
export interface PgNearby {
  metro: string[];
  college: string[];
  office: string[];
}
```

In `PgPublicDetail`, add to the `pg_details` object: `meal_charges_paise: number | null;`, `deposit_refundable_pct: number | null;`, `maintenance_paise: number | null;`, `nearby: PgNearby | null;`. Add at top level: `total_floors: number | null;` and `verification_status: string | null;` (already on the wire, previously untyped).

### Task A3: Backend test for exposure

**File:** `apps/api/test/pg-public-detail.test.ts` (extend the existing fake-DB test)

- [ ] Add a head row with `nearby: { metro: ["Munshipulia"], college: [], office: ["Vibhuti Khand"] }`, `meal_charges_paise: 120000`, `deposit_refundable_pct: 80`, `maintenance_paise: 50000`, `total_floors: 3`, and assert the built detail maps them:

```ts
it("exposes nearby, meal charges, deposit refundable, maintenance, floors", async () => {
  const d = await (
    svc({
      ...head,
      nearby: { metro: ["Munshipulia"], college: [], office: ["Vibhuti Khand"] },
      meal_charges_paise: 120000,
      deposit_refundable_pct: 80,
      maintenance_paise: 50000,
      total_floors: 3
    }) as any
  ).loadListingDetail("1".repeat(32));
  expect(d.pg_details.nearby).toEqual({
    metro: ["Munshipulia"],
    college: [],
    office: ["Vibhuti Khand"]
  });
  expect(d.pg_details.meal_charges_paise).toBe(120000);
  expect(d.pg_details.deposit_refundable_pct).toBe(80);
  expect(d.pg_details.maintenance_paise).toBe(50000);
  expect(d.total_floors).toBe(3);
});
```

Run `pnpm --filter @cribliv/api test -- pg-public-detail` → PASS.

---

## SLICE B — Frontend: full `PgDetailClient.tsx` rewrite

### Task B1: Replace `apps/web/components/pg/PgDetailClient.tsx` with the complete file below

This preserves all tracking, effects, share, similar-PGs, gallery, highlights, location map, and CTA behavior, and applies: hero header with above-the-fold price, redesigned room cards (fixed bathroom/furnishing labels + vacancy), premium amenity tiles, fixed meals (snack key + veg badge + charges), new "What's nearby" section, expanded policy (refundable %, maintenance, floors, humanized electricity), house-rules curfew/guests, and a real verification badge.

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Share2,
  MapPin,
  BedDouble,
  Snowflake,
  ChevronRight,
  ShieldCheck,
  Shield,
  Users,
  GraduationCap,
  Briefcase,
  UtensilsCrossed,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Wallet,
  Calendar,
  CreditCard,
  Lock,
  ShowerHead,
  Wifi,
  Droplets,
  ParkingSquare,
  Cctv,
  Tv,
  BookOpen,
  Package,
  Key,
  WashingMachine,
  Refrigerator,
  Microwave,
  Dumbbell,
  Gamepad2,
  Sparkles,
  TramFront,
  Building2,
  Navigation,
  Layers,
  Leaf,
  UserCheck,
  type LucideIcon
} from "lucide-react";
import type { PgPublicDetail, PgCard } from "../../lib/pg-public-api";
import { searchPgListings } from "../../lib/pg-public-api";
import { PgInterestButton } from "./PgInterestButton";
import { PgListingCard } from "./PgListingCard";
import { PgDetailLocationMap } from "./PgDetailLocationMap";
import { ListingGallery } from "../listing/listing-gallery";
import { ListingHighlights } from "../listing/listing-highlights";
import { toTitleCase } from "../../lib/utils";
import type { Locale } from "../../lib/i18n";
import { t } from "../../lib/i18n";
import {
  trackPgDetailView,
  trackPgPhotoViewed,
  trackPgShare,
  trackPgInterestClicked,
  trackPgInterestSubmitted
} from "../../lib/pg-track";

const PHOTO_BASE = (process.env.NEXT_PUBLIC_PHOTO_BASE_URL || "").replace(/\/+$/, "");
const photoUrl = (b: string) =>
  /^https?:\/\//i.test(b) ? b : PHOTO_BASE ? `${PHOTO_BASE}/${b.replace(/^\/+/, "")}` : b;
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

const GENDER_CONFIG: Record<string, { label: string; cls: string }> = {
  boys: { label: "Boys Only", cls: "pg-fact--boys" },
  girls: { label: "Girls Only", cls: "pg-fact--girls" },
  coed: { label: "Co-ed", cls: "pg-fact--coed" }
};

const TENANT_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  students: { label: "Students", cls: "pg-fact--students", icon: <GraduationCap size={13} /> },
  working: { label: "Working Pros", cls: "pg-fact--working", icon: <Briefcase size={13} /> },
  any: { label: "All Welcome", cls: "pg-fact--any", icon: <Users size={13} /> }
};

const SHARING_COLORS: Record<string, string> = {
  single: "single",
  double: "double",
  triple: "triple",
  quad: "quad",
  dorm: "dorm"
};

// FIX: real enum keys (attached_western | attached_indian | shared_western | shared_indian).
const BATHROOM_LABEL: Record<string, string> = {
  attached_western: "Attached · Western",
  attached_indian: "Attached · Indian",
  shared_western: "Shared · Western",
  shared_indian: "Shared · Indian",
  attached: "Attached bath",
  shared: "Shared bath"
};
const FURNISHING_LABEL: Record<string, string> = {
  fully_furnished: "Furnished",
  semi_furnished: "Semi-furnished",
  unfurnished: "Unfurnished"
};
const ELECTRICITY_LABEL: Record<string, string> = {
  flat: "Included in rent",
  submetered: "Sub-metered",
  split_equally: "Split equally"
};

const RULE_LABELS: Record<string, string> = {
  smoking: "Smoking",
  alcohol: "Alcohol",
  non_veg: "Non-veg food",
  pets: "Pets",
  cooking_in_room: "Cooking in room"
};

const VERIF_BADGE: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
  verified: {
    cls: "verified",
    label: "Verified",
    icon: <ShieldCheck size={14} style={{ marginRight: 4 }} />
  },
  pending: {
    cls: "pending",
    label: "Under review",
    icon: <Clock size={14} style={{ marginRight: 4 }} />
  },
  unverified: {
    cls: "unverified",
    label: "Unverified",
    icon: <Shield size={14} style={{ marginRight: 4 }} />
  },
  failed: {
    cls: "unverified",
    label: "Unverified",
    icon: <Shield size={14} style={{ marginRight: 4 }} />
  }
};

const PG_AMENITY_LABEL: Record<string, string> = {
  wifi: "High-Speed WiFi",
  hot_water: "Hot Water",
  power_backup: "Power Backup",
  cctv: "CCTV",
  security_guard: "Security Guard",
  ac: "Air Conditioning",
  tv: "TV",
  study_table: "Study Table",
  wardrobe: "Wardrobe",
  safety_locker: "Safety Locker",
  mattress: "Mattress",
  housekeeping: "Daily Cleaning",
  laundry: "Laundry",
  biometric_access: "Biometric Access",
  parking_2w: "2-Wheeler Parking",
  parking_4w: "4-Wheeler Parking",
  fridge: "Fridge",
  microwave: "Microwave",
  gym: "Gym",
  indoor_games: "Indoor Games"
};

const PG_AMENITY_ICON: Record<string, LucideIcon> = {
  wifi: Wifi,
  hot_water: Droplets,
  power_backup: Zap,
  cctv: Cctv,
  security_guard: Shield,
  ac: Snowflake,
  tv: Tv,
  study_table: BookOpen,
  wardrobe: Package,
  safety_locker: Key,
  mattress: BedDouble,
  housekeeping: Sparkles,
  laundry: WashingMachine,
  biometric_access: Key,
  parking_2w: ParkingSquare,
  parking_4w: ParkingSquare,
  fridge: Refrigerator,
  microwave: Microwave,
  gym: Dumbbell,
  indoor_games: Gamepad2
};

const AMENITY_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Security", keys: ["cctv", "security_guard", "biometric_access", "safety_locker"] },
  { label: "Comfort", keys: ["ac", "tv", "study_table", "wardrobe", "mattress", "housekeeping"] },
  { label: "Kitchen", keys: ["fridge", "microwave"] },
  {
    label: "Facilities",
    keys: [
      "wifi",
      "hot_water",
      "power_backup",
      "laundry",
      "parking_2w",
      "parking_4w",
      "gym",
      "indoor_games"
    ]
  }
];

// Extract all truthy amenity keys — handles flat {wifi:true} and nested {core:["wifi"]}
function extractPgAmenities(amenities: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const [key, value] of Object.entries(amenities)) {
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") found.push(item);
    } else if (value === true || value === 1) found.push(key);
  }
  return found;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PgAmenitiesDisplay({ amenityKeys }: { amenityKeys: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const keySet = new Set(amenityKeys);
  const knownKeys = new Set(AMENITY_GROUPS.flatMap((g) => g.keys));

  const groups = [
    ...AMENITY_GROUPS.map((g) => ({
      label: g.label,
      items: g.keys.filter((k) => keySet.has(k))
    })).filter((g) => g.items.length > 0),
    ...((): { label: string; items: string[] }[] => {
      const unknown = amenityKeys.filter((k) => !knownKeys.has(k));
      return unknown.length > 0 ? [{ label: "More", items: unknown }] : [];
    })()
  ];

  const VISIBLE_GROUPS = 2;
  const visibleGroups = showAll ? groups : groups.slice(0, VISIBLE_GROUPS);
  const hiddenCount = showAll
    ? 0
    : groups.slice(VISIBLE_GROUPS).reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <div className="amenity-groups">
        {visibleGroups.map((group) => (
          <div key={group.label} className="amenity-group">
            <div className="amenity-group__label">{group.label}</div>
            <div className="amenity-tile-grid">
              {group.items.map((key) => {
                const label = PG_AMENITY_LABEL[key] ?? toTitleCase(key.replace(/_/g, " "));
                const Icon = PG_AMENITY_ICON[key] ?? Sparkles;
                return (
                  <div key={key} className="amenity-tile">
                    <span className="amenity-tile__icon" aria-hidden="true">
                      <Icon size={18} strokeWidth={1.6} />
                    </span>
                    <span className="amenity-tile__label">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button type="button" className="amenity-show-all" onClick={() => setShowAll(true)}>
          Show {hiddenCount} more amenities
        </button>
      )}
    </>
  );
}

function PgQuickFacts({
  pd,
  totalBeds,
  hasMeals
}: {
  pd: PgPublicDetail["pg_details"];
  totalBeds: number;
  hasMeals: boolean;
}) {
  const gender = pd.gender_policy ? GENDER_CONFIG[pd.gender_policy] : null;
  const tenant = pd.tenant_type ? TENANT_CONFIG[pd.tenant_type] : null;

  return (
    <div className="pg-fact-strip">
      {gender && (
        <span className={`pg-fact ${gender.cls}`}>
          <Users size={13} aria-hidden="true" />
          {gender.label}
        </span>
      )}
      {gender && (tenant || totalBeds > 0 || hasMeals) && (
        <span className="pg-fact-divider" aria-hidden="true" />
      )}
      {tenant && (
        <span className={`pg-fact ${tenant.cls}`}>
          {tenant.icon}
          {tenant.label}
        </span>
      )}
      {totalBeds > 0 && (
        <span className="pg-fact pg-fact--beds">
          <BedDouble size={13} aria-hidden="true" />
          {totalBeds} beds total
        </span>
      )}
      {hasMeals && (
        <span className="pg-fact pg-fact--food">
          <UtensilsCrossed size={13} aria-hidden="true" />
          Meals included
        </span>
      )}
      {pd.price_negotiable && <span className="pg-fact pg-fact--negotiable">Negotiable</span>}
    </div>
  );
}

function PgRoomCard({ rt, index }: { rt: PgPublicDetail["room_types"][number]; index: number }) {
  const sharingKey = rt.sharing.toLowerCase();
  const colorClass = `pg-room-card--${SHARING_COLORS[sharingKey] ?? "dorm"}`;
  const availFrom = rt.available_from ? new Date(rt.available_from) : null;
  const isAvailableNow = !availFrom || availFrom <= new Date();
  const availLabel =
    availFrom && !isAvailableNow
      ? availFrom.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : "Now";
  const vacancy = rt.vacancy_count ?? 0;
  const bathroomLabel = rt.bathroom_kind
    ? (BATHROOM_LABEL[rt.bathroom_kind] ?? toTitleCase(rt.bathroom_kind.replace(/_/g, " ")))
    : null;
  const furnishingLabel = rt.furnishing ? (FURNISHING_LABEL[rt.furnishing] ?? rt.furnishing) : null;

  return (
    <div className={`pg-room-card ${colorClass}`} style={{ animationDelay: `${index * 60}ms` }}>
      <div className="pg-room-card__top">
        <span className="pg-room-card__label">{rt.sharing} sharing</span>
        {vacancy > 0 && vacancy <= 3 && (
          <span className="pg-room-card__vacancy">
            <span className="pg-room-card__vacancy-dot" aria-hidden="true" />
            {vacancy} bed{vacancy > 1 ? "s" : ""} left
          </span>
        )}
        {vacancy > 3 && (
          <span className="pg-room-card__vacancy pg-room-card__vacancy--ample">
            {vacancy} available
          </span>
        )}
      </div>
      <div className="pg-room-card__price">{rupees(rt.monthly_rent_paise)}</div>
      <div className="pg-room-card__period">per person / month</div>

      <div className="pg-room-card__features">
        <span className={`pg-room-feat${rt.ac ? " pg-room-feat--ac" : ""}`}>
          <Snowflake size={11} aria-hidden="true" /> {rt.ac ? "AC" : "Non-AC"}
        </span>
        {bathroomLabel && (
          <span
            className={`pg-room-feat${rt.bathroom_kind?.startsWith("attached") ? " pg-room-feat--attached" : ""}`}
          >
            <ShowerHead size={11} aria-hidden="true" />
            {bathroomLabel}
          </span>
        )}
        {furnishingLabel && (
          <span className="pg-room-feat pg-room-feat--furnished">{furnishingLabel}</span>
        )}
      </div>

      <div className="pg-room-card__footer">
        <span className="pg-room-card__avail">
          <Calendar size={11} aria-hidden="true" />
          {isAvailableNow ? "Available now" : `From ${availLabel}`}
        </span>
      </div>
    </div>
  );
}

function PgMealsSection({
  meals,
  mealChargesPaise
}: {
  meals: Record<string, unknown>;
  mealChargesPaise?: number | null;
}) {
  // FIX: writer stores "snack" (singular). Old code checked "snacks" and never matched.
  const MEAL_TIMES = [
    { key: "breakfast", label: "Breakfast" },
    { key: "lunch", label: "Lunch" },
    { key: "dinner", label: "Dinner" },
    { key: "snack", label: "Snacks" }
  ];
  const activeMeals = MEAL_TIMES.filter((m) => meals[m.key] === true);
  const vegOnly = meals.veg_only === true;

  return (
    <div className="pg-meals-card">
      <div className="pg-meals-icon" aria-hidden="true">
        <UtensilsCrossed size={24} />
      </div>
      <div>
        <p className="pg-meals-title">Meals Included</p>
        <p className="pg-meals-sub">Home-style food provided by the PG</p>
        <div className="pg-meal-chips">
          <span className={`pg-meal-diet ${vegOnly ? "pg-meal-diet--veg" : "pg-meal-diet--mixed"}`}>
            <Leaf size={11} aria-hidden="true" /> {vegOnly ? "Pure Veg" : "Veg & Non-veg"}
          </span>
          {(activeMeals.length > 0 ? activeMeals : [{ key: "all", label: "All meals" }]).map(
            (m) => (
              <span key={m.key} className="pg-meal-chip">
                <CheckCircle size={11} aria-hidden="true" /> {m.label}
              </span>
            )
          )}
        </div>
        {mealChargesPaise != null && mealChargesPaise > 0 && (
          <p className="pg-meals-charge">
            <Wallet size={13} aria-hidden="true" />
            {rupees(mealChargesPaise)} / month extra
          </p>
        )}
      </div>
    </div>
  );
}

function PgNearbySection({
  nearby
}: {
  nearby: NonNullable<PgPublicDetail["pg_details"]["nearby"]>;
}) {
  const groups = [
    { label: "Metro & Transit", Icon: TramFront, items: nearby.metro ?? [] },
    { label: "Colleges", Icon: GraduationCap, items: nearby.college ?? [] },
    { label: "Offices & IT Parks", Icon: Building2, items: nearby.office ?? [] }
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="pg-nearby-grid">
      {groups.map((g) => (
        <div key={g.label} className="pg-nearby-col">
          <div className="pg-nearby-col__head">
            <span className="pg-nearby-col__icon" aria-hidden="true">
              <g.Icon size={16} />
            </span>
            {g.label}
          </div>
          <div className="pg-nearby-chips">
            {g.items.map((item, i) => (
              <span key={i} className="pg-nearby-chip">
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PgHouseRulesSection({ rules }: { rules: Record<string, unknown> }) {
  const ruleFlags = Object.entries(RULE_LABELS).map(([key, label]) => ({
    key,
    label,
    allowed: rules[key] === true
  }));
  const allowed = ruleFlags.filter((r) => r.allowed);
  const blocked = ruleFlags.filter((r) => !r.allowed && rules[r.key] !== undefined);
  const quietHours = rules.quiet_hours as { from?: string; to?: string } | undefined;
  const curfew = typeof rules.curfew_time === "string" ? rules.curfew_time : null;
  const guests = typeof rules.guests_policy === "string" ? rules.guests_policy : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div className="pg-rules-columns">
        {allowed.length > 0 && (
          <div className="pg-rules-col pg-rules-col--allowed">
            <div className="pg-rules-col__head">
              <CheckCircle size={14} aria-hidden="true" /> Allowed
            </div>
            {allowed.map((r) => (
              <span key={r.key} className="pg-rule-chip pg-rule-chip--allowed">
                <CheckCircle size={13} aria-hidden="true" />
                {r.label}
              </span>
            ))}
          </div>
        )}
        {blocked.length > 0 && (
          <div className="pg-rules-col pg-rules-col--blocked">
            <div className="pg-rules-col__head">
              <XCircle size={14} aria-hidden="true" /> Not Allowed
            </div>
            {blocked.map((r) => (
              <span key={r.key} className="pg-rule-chip pg-rule-chip--blocked">
                <XCircle size={13} aria-hidden="true" />
                {r.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {(quietHours?.from && quietHours?.to) || curfew || guests ? (
        <div className="pg-rules-notes">
          {quietHours?.from && quietHours?.to && (
            <span className="pg-quiet-hours">
              <Clock size={16} aria-hidden="true" /> Quiet hours {quietHours.from}–{quietHours.to}
            </span>
          )}
          {curfew && (
            <span className="pg-quiet-hours">
              <Lock size={16} aria-hidden="true" /> Gate closes {curfew}
            </span>
          )}
          {guests && (
            <span className="pg-quiet-hours">
              <Users size={16} aria-hidden="true" /> {guests}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PgPolicyTerms({
  pd,
  totalFloors
}: {
  pd: PgPublicDetail["pg_details"];
  totalFloors: number | null;
}) {
  const items: Array<{ icon: React.ReactNode; iconCls: string; label: string; value: string }> = [];

  if (pd.security_deposit_paise != null)
    items.push({
      icon: <Shield size={16} />,
      iconCls: "pg-policy-item__icon--amber",
      label: "Security deposit",
      value: rupees(pd.security_deposit_paise)
    });
  if (pd.deposit_refundable_pct != null)
    items.push({
      icon: <ShieldCheck size={16} />,
      iconCls: "pg-policy-item__icon--trust",
      label: "Deposit refundable",
      value: `${pd.deposit_refundable_pct}%`
    });
  if (pd.notice_period_days != null)
    items.push({
      icon: <Calendar size={16} />,
      iconCls: "pg-policy-item__icon--blue",
      label: "Notice period",
      value: `${pd.notice_period_days} days`
    });
  if (pd.lock_in_months != null)
    items.push({
      icon: <Lock size={16} />,
      iconCls: "pg-policy-item__icon--amber",
      label: "Lock-in period",
      value: `${pd.lock_in_months} month${pd.lock_in_months !== 1 ? "s" : ""}`
    });
  if (pd.maintenance_paise != null && pd.maintenance_paise > 0)
    items.push({
      icon: <Wallet size={16} />,
      iconCls: "pg-policy-item__icon--blue",
      label: "Maintenance",
      value: `${rupees(pd.maintenance_paise)}/mo`
    });
  if (pd.electricity_mode)
    items.push({
      icon: <Zap size={16} />,
      iconCls: "pg-policy-item__icon--yellow",
      label: "Electricity",
      value: ELECTRICITY_LABEL[pd.electricity_mode] ?? toTitleCase(pd.electricity_mode)
    });
  if (pd.rent_due_day)
    items.push({
      icon: <CreditCard size={16} />,
      iconCls: "pg-policy-item__icon--trust",
      label: "Rent due",
      value: `${pd.rent_due_day}${pd.rent_due_day === 1 ? "st" : pd.rent_due_day === 2 ? "nd" : pd.rent_due_day === 3 ? "rd" : "th"} of month`
    });
  if (totalFloors != null && totalFloors > 0)
    items.push({
      icon: <Layers size={16} />,
      iconCls: "pg-policy-item__icon--blue",
      label: "Floors",
      value: `${totalFloors}`
    });

  if (items.length === 0) return null;

  return (
    <div className="pg-policy-grid">
      {items.map((item) => (
        <div key={item.label} className="pg-policy-item">
          <div className={`pg-policy-item__icon ${item.iconCls}`} aria-hidden="true">
            {item.icon}
          </div>
          <div className="pg-policy-item__label">{item.label}</div>
          <div className="pg-policy-item__value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function PgDetailClient({
  detail,
  city,
  locale
}: {
  detail: PgPublicDetail;
  city: string;
  locale: string;
}) {
  const [similar, setSimilar] = useState<PgCard[]>([]);
  const fired = useRef(false);
  const pd = detail.pg_details;

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackPgDetailView({ listing_id: detail.id, city });
  }, [detail.id, city]);

  useEffect(() => {
    let alive = true;
    searchPgListings({ city, page_size: "4" })
      .then((r) => {
        if (alive) setSimilar(r.items.filter((i) => i.id !== detail.id).slice(0, 3));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [city, detail.id]);

  const onShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: detail.title ?? "PG", url });
        trackPgShare({ listing_id: detail.id, method: "native" });
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      /* ignore */
    }
    trackPgShare({ listing_id: detail.id, method: "clipboard" });
  };

  const pgAmenities = extractPgAmenities(pd.amenities ?? {});

  const totalBeds =
    (pd.total_beds ?? 0) > 0
      ? pd.total_beds!
      : detail.room_types.reduce((acc, rt) => {
          const m = rt.sharing.match(/\d/);
          const n = m
            ? parseInt(m[0], 10)
            : rt.sharing.includes("single")
              ? 1
              : rt.sharing.includes("double")
                ? 2
                : rt.sharing.includes("triple")
                  ? 3
                  : 4;
          return acc + n;
        }, 0);

  const hasMeals = !!(pd.meals && Object.keys(pd.meals).length > 0);
  const mealsData = pd.meals as Record<string, unknown> | null;
  const mealChargesPaise = pd.meal_charges_paise ?? null;

  const hasRules = Object.keys(pd.house_rules ?? {}).length > 0;
  const hasNearby =
    !!pd.nearby && pd.nearby.metro.length + pd.nearby.college.length + pd.nearby.office.length > 0;
  const hasPolicyTerms =
    pd.security_deposit_paise != null ||
    pd.notice_period_days != null ||
    pd.lock_in_months != null ||
    pd.electricity_mode != null ||
    pd.maintenance_paise != null ||
    pd.deposit_refundable_pct != null ||
    (detail.total_floors ?? 0) > 0;

  const photoUrls = detail.photos.map((p) => photoUrl(p.blob_path));
  const cityDisplay = detail.city_slug ?? city;
  const locationLabel =
    [detail.locality_slug, detail.city_slug]
      .filter((s): s is string => Boolean(s))
      .map(toTitleCase)
      .join(", ") || "Location";

  const lowestPrice =
    detail.room_types.length > 0
      ? Math.min(...detail.room_types.map((r) => r.monthly_rent_paise))
      : null;
  const primaryRentPaise =
    lowestPrice != null
      ? lowestPrice
      : detail.monthly_rent != null
        ? detail.monthly_rent * 100
        : null;
  const monthlyAllInPaise =
    primaryRentPaise != null
      ? primaryRentPaise + Math.round((pd.security_deposit_paise ?? 0) / 11)
      : null;
  const primaryRentLabel =
    primaryRentPaise != null ? `from ${rupees(primaryRentPaise)}` : "Request price";
  const monthlyAllInLabel =
    monthlyAllInPaise != null ? `Total monthly cost ${rupees(monthlyAllInPaise)}/mo all-in` : null;

  const verif = VERIF_BADGE[detail.verification_status ?? "unverified"] ?? VERIF_BADGE.unverified;

  return (
    <>
      <div className="container ld-page tenant-detail-page tenant-detail-page--pg">
        {/* Breadcrumb */}
        <nav className="ld-crumb" aria-label="Breadcrumb">
          <Link href={`/${locale}` as Route}>Home</Link>
          <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
          <Link href={`/${locale}/pg` as Route}>PG</Link>
          <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
          <Link href={`/${locale}/pg/${cityDisplay}` as Route}>{toTitleCase(cityDisplay)}</Link>
          <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
          <span className="ld-crumb__current">{detail.title ?? "PG"}</span>
        </nav>

        {/* Hero header — carries the above-the-fold price */}
        <header className="pg-hero">
          <div className="pg-hero__main">
            <div className="pg-hero__badges">
              <span className={`badge badge--${verif.cls}`}>
                {verif.icon} {verif.label}
              </span>
              <span className="badge badge--brand">PG / Hostel</span>
            </div>
            <h1 className="pg-hero__title">{detail.title ?? "PG"}</h1>
            <div className="pg-hero__meta">
              <MapPin size={15} aria-hidden="true" />
              {locationLabel}
            </div>
          </div>
          <div className="pg-hero__aside">
            <button
              type="button"
              className="pg-hero__share"
              onClick={onShare}
              aria-label={t(locale as Locale, "shareListing")}
            >
              <Share2 size={16} aria-hidden="true" />
              {t(locale as Locale, "shareListing")}
            </button>
            <div className="pg-hero__pricecard" data-testid="pg-hero-price">
              <div className="pg-hero__price">
                <span>from</span>
                <strong>{primaryRentPaise != null ? rupees(primaryRentPaise) : "Request"}</strong>
                {primaryRentPaise != null && <span>/mo</span>}
              </div>
              <div className="pg-hero__pricesub">
                per person
                {pd.security_deposit_paise != null
                  ? ` · ${rupees(pd.security_deposit_paise)} deposit`
                  : ""}
              </div>
            </div>
          </div>
        </header>

        {/* Quick facts strip */}
        <PgQuickFacts pd={pd} totalBeds={totalBeds} hasMeals={hasMeals} />

        {/* Gallery */}
        <ListingGallery
          photos={photoUrls}
          title={detail.title ?? "PG"}
          locale={locale as Locale}
          onPhotoClick={(idx) => trackPgPhotoViewed(detail.id, idx)}
        />

        {/* Highlight chips */}
        <ListingHighlights
          locale={locale as Locale}
          listing_type="pg"
          pgTotalBeds={totalBeds || null}
        />

        {/* Cost summary strip */}
        <section className="tenant-cost-strip" aria-label="PG pricing and trust summary">
          <div className="tenant-cost-card tenant-cost-card--price">
            <span className="tenant-cost-card__icon" aria-hidden="true">
              <Wallet size={18} />
            </span>
            <span className="tenant-cost-card__label">Starting rent</span>
            <strong>{primaryRentLabel}</strong>
            <span className="tenant-cost-card__note">
              {monthlyAllInLabel ?? "Per person rent before move-in terms"}
            </span>
          </div>
          <div className="tenant-cost-card">
            <span
              className="tenant-cost-card__icon tenant-cost-card__icon--amber"
              aria-hidden="true"
            >
              <Shield size={18} />
            </span>
            <span className="tenant-cost-card__label">
              {pd.security_deposit_paise != null ? "Security deposit" : "Move-in terms"}
            </span>
            <strong>
              {pd.security_deposit_paise != null
                ? rupees(pd.security_deposit_paise)
                : pd.notice_period_days != null
                  ? `${pd.notice_period_days} days`
                  : "Ask owner"}
            </strong>
            <span className="tenant-cost-card__note">
              {pd.deposit_refundable_pct != null
                ? `${pd.deposit_refundable_pct}% refundable`
                : pd.notice_period_days != null
                  ? `${pd.notice_period_days} day notice period`
                  : "Terms shown before move-in"}
            </span>
          </div>
          <div className="tenant-cost-card">
            <span
              className="tenant-cost-card__icon tenant-cost-card__icon--trust"
              aria-hidden="true"
            >
              <ShieldCheck size={18} />
            </span>
            <span className="tenant-cost-card__label">PG trust</span>
            <strong>{verif.label}</strong>
            <span className="tenant-cost-card__note">Meals and sharing captured</span>
          </div>
        </section>

        {/* Detail layout */}
        <div className="detail-layout">
          <div className="detail-layout__content">
            {/* ── Room Options ── */}
            <section className="ld-section">
              <div className="ld-section__head">
                <div className="ld-section__title">
                  <span className="ld-section__icon ld-section__icon--blue" aria-hidden="true">
                    <BedDouble size={18} />
                  </span>
                  <div>
                    <h2>Room options</h2>
                    <p className="ld-section__sub">
                      {detail.room_types.length} type{detail.room_types.length !== 1 ? "s" : ""}{" "}
                      available
                    </p>
                  </div>
                </div>
              </div>
              <div className="pg-rooms-grid">
                {detail.room_types.map((rt, i) => (
                  <PgRoomCard key={`${rt.sharing}-${i}`} rt={rt} index={i} />
                ))}
              </div>
            </section>

            {/* ── Amenities ── */}
            {pgAmenities.length > 0 && (
              <section className="ld-section">
                <div className="ld-section__head">
                  <div className="ld-section__title">
                    <span className="ld-section__icon ld-section__icon--purple" aria-hidden="true">
                      <Sparkles size={18} />
                    </span>
                    <div>
                      <h2>{t(locale as Locale, "whatThisPlaceOffers")}</h2>
                      <p className="ld-section__sub">
                        {pgAmenities.length} {pgAmenities.length === 1 ? "amenity" : "amenities"}{" "}
                        available
                      </p>
                    </div>
                  </div>
                </div>
                <PgAmenitiesDisplay amenityKeys={pgAmenities} />
              </section>
            )}

            {/* ── Meals & Food ── */}
            {hasMeals && mealsData && (
              <section className="ld-section">
                <div className="ld-section__head">
                  <div className="ld-section__title">
                    <span className="ld-section__icon ld-section__icon--green" aria-hidden="true">
                      <UtensilsCrossed size={18} />
                    </span>
                    <h2>Food &amp; Meals</h2>
                  </div>
                </div>
                <PgMealsSection meals={mealsData} mealChargesPaise={mealChargesPaise} />
              </section>
            )}

            {/* ── What's nearby ── */}
            {hasNearby && pd.nearby && (
              <section className="ld-section">
                <div className="ld-section__head">
                  <div className="ld-section__title">
                    <span className="ld-section__icon ld-section__icon--blue" aria-hidden="true">
                      <Navigation size={18} />
                    </span>
                    <div>
                      <h2>What&apos;s nearby</h2>
                      <p className="ld-section__sub">Transit, colleges &amp; workplaces</p>
                    </div>
                  </div>
                </div>
                <PgNearbySection nearby={pd.nearby} />
              </section>
            )}

            {/* ── House Rules ── */}
            {hasRules && (
              <section className="ld-section">
                <div className="ld-section__head">
                  <div className="ld-section__title">
                    <span className="ld-section__icon ld-section__icon--amber" aria-hidden="true">
                      <Shield size={18} />
                    </span>
                    <h2>House rules</h2>
                  </div>
                </div>
                <PgHouseRulesSection rules={pd.house_rules as Record<string, unknown>} />
              </section>
            )}

            {/* ── Policy & Terms ── */}
            {hasPolicyTerms && (
              <section className="ld-section">
                <div className="ld-section__head">
                  <div className="ld-section__title">
                    <span className="ld-section__icon ld-section__icon--amber" aria-hidden="true">
                      <Wallet size={18} />
                    </span>
                    <h2>{t(locale as Locale, "thingsToKnow")}</h2>
                  </div>
                </div>
                <PgPolicyTerms pd={pd} totalFloors={detail.total_floors} />
                {pd.payment_modes?.length > 0 && (
                  <div style={{ marginTop: "var(--space-5)" }}>
                    <div className="pg-rail-label" style={{ marginBottom: 8 }}>
                      Payment accepted
                    </div>
                    <div className="pg-rail-payment-modes">
                      {pd.payment_modes.map((m) => (
                        <span key={m} className="pg-rail-mode">
                          {toTitleCase(m.replace(/_/g, " "))}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Location ── */}
            <section className="ld-section">
              <div className="ld-section__head">
                <div className="ld-section__title">
                  <span className="ld-section__icon ld-section__icon--slate" aria-hidden="true">
                    <MapPin size={18} />
                  </span>
                  <h2>{t(locale as Locale, "whereYoullBe")}</h2>
                </div>
              </div>
              <PgDetailLocationMap
                point={detail.location_point}
                citySlug={detail.city_slug}
                listingId={detail.id}
                locale={locale}
              />
            </section>
          </div>

          {/* ── Sticky sidebar ── */}
          <aside className="detail-layout__sidebar">
            <div className="detail-rail">
              <div>
                <div className="detail-rail__price">
                  <strong>
                    {primaryRentPaise != null ? primaryRentLabel : "Price on request"}
                  </strong>
                  {primaryRentPaise != null && <span>/mo rent</span>}
                </div>
                {monthlyAllInLabel && (
                  <div className="detail-rail__secondary">{monthlyAllInLabel}</div>
                )}
                {pd.security_deposit_paise != null && (
                  <div className="pg-rail-deposit">
                    <Shield size={13} aria-hidden="true" />
                    {rupees(pd.security_deposit_paise)} security deposit
                  </div>
                )}
              </div>

              <hr className="pg-rail-divider" />

              {detail.room_types.length > 0 && (
                <div>
                  <div className="pg-rail-label">All room types</div>
                  <div className="pg-rail-rooms">
                    {detail.room_types.map((rt, i) => {
                      const sharingKey = rt.sharing.toLowerCase();
                      const dotClass = `pg-rail-room__dot pg-rail-room__dot--${SHARING_COLORS[sharingKey] ?? "dorm"}`;
                      return (
                        <div key={i} className="pg-rail-room">
                          <div className="pg-rail-room__left">
                            <span className={dotClass} aria-hidden="true" />
                            <span className="pg-rail-room__type">{rt.sharing}</span>
                            <div className="pg-rail-room__badges">
                              {rt.ac && <span className="pg-rail-room__ac">AC</span>}
                            </div>
                          </div>
                          <span className="pg-rail-room__price">
                            {rupees(rt.monthly_rent_paise)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(pd.gender_policy || pd.tenant_type) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                  {pd.gender_policy && (
                    <span
                      className={`pg-fact ${GENDER_CONFIG[pd.gender_policy]?.cls ?? "pg-fact--any"}`}
                      style={{ fontSize: 12 }}
                    >
                      {GENDER_CONFIG[pd.gender_policy]?.label}
                    </span>
                  )}
                  {pd.tenant_type && TENANT_CONFIG[pd.tenant_type] && (
                    <span
                      className={`pg-fact ${TENANT_CONFIG[pd.tenant_type].cls}`}
                      style={{ fontSize: 12 }}
                    >
                      {TENANT_CONFIG[pd.tenant_type].icon}
                      {TENANT_CONFIG[pd.tenant_type].label}
                    </span>
                  )}
                </div>
              )}

              <hr className="pg-rail-divider" />

              <div className="detail-rail__panel">
                <PgInterestButton
                  listingId={detail.id}
                  locale={locale}
                  onBefore={() => trackPgInterestClicked(detail.id, "logged_in")}
                  onSuccess={() => trackPgInterestSubmitted(detail.id)}
                />
              </div>

              <div className="detail-rail__reassure">
                <Shield size={14} aria-hidden="true" />
                <span>
                  {t(locale as Locale, "noChargeUntilUnlock") || "Owner will contact you directly"}
                </span>
              </div>
            </div>
          </aside>
        </div>

        {/* Similar PGs */}
        {similar.length > 0 && (
          <section className="ld-section" style={{ borderTop: 0 }}>
            <h2 style={{ marginBottom: "var(--space-6)" }}>Similar PGs nearby</h2>
            <div className="listing-grid">
              {similar.map((s, i) => (
                <PgListingCard
                  key={s.id}
                  listing={s}
                  locale={locale}
                  position={i}
                  surface="pg_detail_similar"
                  filters={{}}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Mobile CTA bar */}
      <div className="cta-bar">
        <div>
          <div className="card__price">
            {primaryRentPaise != null ? primaryRentLabel : "Price on request"}
            {primaryRentPaise != null && <span className="card__price-period">/mo rent</span>}
          </div>
          {monthlyAllInLabel ? (
            <div className="body-sm text-secondary" style={{ fontSize: 12 }}>
              {monthlyAllInLabel}
            </div>
          ) : pd.security_deposit_paise != null ? (
            <div className="body-sm text-secondary" style={{ fontSize: 12 }}>
              {rupees(pd.security_deposit_paise)} {t(locale as Locale, "depositShort")}
            </div>
          ) : null}
        </div>
        <a
          href="#main-content"
          className="btn btn--primary btn--sm"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          Show Interest
        </a>
      </div>
    </>
  );
}
```

**Notes for the executor on B1:**

- New lucide imports added: `TramFront, Building2, Navigation, Layers, Leaf, UserCheck`. `UserCheck` is imported for future use but not referenced — remove it if the linter flags unused, or keep if `noUnusedLocals` is off (check `tsconfig`; if it errors, delete `UserCheck` from the import).
- The `PgQuickFacts` / rail room-type list / `extractPgAmenities` logic is unchanged from the original — only presentation and new sections changed.
- `pd.meal_charges_paise` is now a typed field (Task A2), replacing the old `(pd as Record<string, unknown>).meal_charges_paise` cast.

---

## SLICE C — CSS (append to end of `apps/web/app/globals.css`)

### Task C1: Append this block verbatim at the END of `globals.css`

```css
/* ============================================================
   PG DETAIL REDESIGN — appended so it wins the cascade over
   earlier .tenant-detail-page rules. Tokens only.
   ============================================================ */

/* Hero header with above-the-fold price */
.tenant-detail-page .pg-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
  margin-bottom: var(--space-4);
}
.pg-hero__main {
  min-width: 0;
}
.pg-hero__badges {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}
.pg-hero__title {
  margin: 0;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: clamp(24px, 3.2vw, 34px);
  line-height: 1.08;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  max-width: 760px;
}
.pg-hero__meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--space-2);
  font-size: 14px;
  color: var(--text-secondary);
}
.pg-hero__aside {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  flex-shrink: 0;
}
.pg-hero__share {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: background var(--transition-fast);
}
.pg-hero__share:hover {
  background: var(--surface-sunken);
  text-decoration: none;
}
.pg-hero__pricecard {
  text-align: right;
  background: linear-gradient(135deg, var(--brand-50), var(--surface));
  border: 1px solid rgba(0, 102, 255, 0.16);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-5);
  box-shadow: var(--shadow-xs);
}
.pg-hero__price {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 4px;
}
.pg-hero__price span {
  font-size: 14px;
  color: var(--text-secondary);
}
.pg-hero__price strong {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 30px;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  line-height: 1;
}
.pg-hero__pricesub {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-top: 3px;
}

@media (max-width: 640px) {
  .tenant-detail-page .pg-hero {
    flex-direction: column;
    gap: var(--space-3);
  }
  .pg-hero__aside {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .pg-hero__pricecard {
    padding: var(--space-2) var(--space-4);
  }
  .pg-hero__price strong {
    font-size: 24px;
  }
}

/* Room card — vacancy header row */
.pg-room-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.pg-room-card__vacancy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  color: var(--danger);
}
.pg-room-card__vacancy-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
  animation: pg-pulse 1.8s ease-in-out infinite;
}
.pg-room-card__vacancy--ample {
  color: var(--trust);
}
@keyframes pg-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

/* Premium amenity tiles */
.amenity-tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: var(--space-3);
}
.amenity-tile {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
}
.amenity-tile:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
  border-color: var(--border-strong);
}
.amenity-tile__icon {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--brand);
}
.amenity-tile__label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.25;
}
@media (max-width: 600px) {
  .amenity-tile-grid {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .amenity-tile {
    padding: var(--space-2);
    gap: var(--space-2);
  }
  .amenity-tile__icon {
    width: 32px;
    height: 32px;
  }
  .amenity-tile__label {
    font-size: 12.5px;
  }
}

/* What's nearby */
.pg-nearby-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-5);
}
.pg-nearby-col__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-heading);
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: var(--space-3);
}
.pg-nearby-col__icon {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--brand-50);
  color: var(--brand);
}
.pg-nearby-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pg-nearby-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* Meals — diet badge + notes row */
.pg-meal-diet {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 700;
}
.pg-meal-diet--veg {
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #86efac;
}
.pg-meal-diet--mixed {
  background: #fff7ed;
  color: #c2410c;
  border: 1px solid #fed7aa;
}

/* House rules — notes row (quiet hours / curfew / guests) */
.pg-rules-notes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
```

**Note:** `.pg-quiet-hours`, `.pg-rules-columns`, `.pg-rules-col*`, `.pg-rule-chip*`, `.pg-rail-*`, `.amenity-show-all`, `.pg-meals-*`, `.pg-policy-*` already exist in `globals.css` — do not redefine them; the block above only adds the genuinely new classes.

---

## SLICE D — Tests

### Task D1: Component tests — `apps/web/components/pg/__tests__/PgDetailClient.test.tsx`

Add/extend (the file already mocks `pg-public-api` and tracking). Use a `makeDetail()` helper that returns a full `PgPublicDetail`; assert the redesign behaviors:

```tsx
it("shows the starting price in the hero (above the gallery)", () => {
  render(<PgDetailClient detail={makeDetail()} city="lucknow" locale="en" />);
  const hero = screen.getByTestId("pg-hero-price");
  expect(hero).toHaveTextContent("from");
  expect(hero.textContent).toMatch(/₹\s?3,500/);
});

it("renders human bathroom labels, not raw enum values", () => {
  render(
    <PgDetailClient
      detail={makeDetail({ bathroom_kind: "shared_western" })}
      city="lucknow"
      locale="en"
    />
  );
  expect(screen.queryByText("shared_western")).toBeNull();
  expect(screen.getByText("Shared · Western")).toBeTruthy();
});

it("shows room vacancy when low", () => {
  render(<PgDetailClient detail={makeDetail({ vacancy_count: 2 })} city="lucknow" locale="en" />);
  expect(screen.getByText("2 beds left")).toBeTruthy();
});

it("renders the What's nearby section from nearby data", () => {
  render(
    <PgDetailClient
      detail={makeDetail({ nearby: { metro: ["Munshipulia"], college: [], office: [] } })}
      city="lucknow"
      locale="en"
    />
  );
  expect(screen.getByText("What's nearby")).toBeTruthy();
  expect(screen.getByText("Munshipulia")).toBeTruthy();
});

it("renders snacks meal chip (snack key)", () => {
  render(
    <PgDetailClient
      detail={makeDetail({ meals: { provided: true, snack: true } })}
      city="lucknow"
      locale="en"
    />
  );
  expect(screen.getByText("Snacks")).toBeTruthy();
});
```

Run `pnpm --filter @cribliv/web test -- PgDetail` → PASS.

---

## SLICE E — Verify (browser + build)

### Task E1: Typecheck + tests

- [ ] `pnpm typecheck` → PASS (new fields typed end to end).
- [ ] `pnpm --filter @cribliv/api test -- pg-public-detail` → PASS.
- [ ] `pnpm --filter @cribliv/web test -- PgDetail` → PASS.

### Task E2: Browser verification (use the preview tools; do not ask the user to check)

- [ ] Start the web dev server; open `/en/pg/lucknow/<a-real-listing-id>` (find one via `/en/pg?city=lucknow`).
- [ ] **Desktop (1280×800):** confirm the `from ₹X /mo` price is visible in the first viewport **without scrolling** (it sits in the hero, above the gallery). Screenshot.
- [ ] **Mobile (375×812):** confirm the price is visible above the gallery, and the bottom `.cta-bar` shows `from ₹X` + Show Interest. Screenshot.
- [ ] Confirm room cards show human bathroom labels (no `shared_western`), vacancy chips, AC/Non-AC.
- [ ] Confirm amenities render as icon tiles grouped by category.
- [ ] Confirm "What's nearby" renders when the listing has `nearby` data (seed one if needed).
- [ ] `read_console_messages` → no errors.

---

## Self-review (spec coverage)

- **Flaw 1 (price above the fold):** Hero header price card (Slice B `pg-hero__pricecard`) sits above the gallery on desktop and mobile; mobile also keeps the sticky `.cta-bar`. ✔
- **Flaw 2 (room cards):** Fixed `BATHROOM_LABEL`/`FURNISHING_LABEL` (no raw `shared_western`), added `vacancy_count` chip, AC/Non-AC clarity, color-accent + hover retained. ✔
- **Flaw 3 (premium amenities):** `amenity-tile` — icon in a soft rounded `surface-sunken` tile, grouped, hover-lift; lucide at `strokeWidth 1.6`. ✔
- **Flaw 4 (map all details):** Backend exposes `nearby`, `meal_charges_paise`, `deposit_refundable_pct`, `maintenance_paise`, `total_floors`; page adds "What's nearby", meal charges + veg badge + fixed snack, deposit-refundable/maintenance/floors in policy, curfew/guests in rules, real verification badge. ✔
- **Design system only:** every value is a token; two families (Manrope/Inter); coral reserved for the single Show-Interest CTA. ✔
- **Responsive:** hero stacks at 640px; amenity grid + rooms carousel + cost strip already collapse per existing breakpoints; sticky rail preserved on the PG page. ✔
- **No new deps, no migration, privacy fields still withheld.** ✔

## Out of scope (flag separately, do not build here)

- Adding wizard **inputs** for fields the self-serve wizard doesn't yet capture (`lock_in_months`, `rent_due_day`, `price_negotiable`, per-room `bathroom_kind`/`furnishing`/`available_from`) — capture-side gap, separate work.
- Persisting `formatted_address` (captured, dropped at write) — needs a privacy decision.
- The market-rate "good deal" meter from the reference (nice-to-have; needs a price-percentile data source).
