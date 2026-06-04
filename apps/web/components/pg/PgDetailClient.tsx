"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  type LucideIcon
} from "lucide-react";
import type { PgPublicDetail, PgCard } from "../../lib/pg-public-api";
import { searchPgListings } from "../../lib/pg-public-api";
import { PgInterestButton } from "./PgInterestButton";
import { PgListingCard } from "./PgListingCard";
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

const RULE_LABELS: Record<string, string> = {
  smoking: "Smoking",
  alcohol: "Alcohol",
  non_veg: "Non-veg food",
  pets: "Pets",
  cooking_in_room: "Cooking in room"
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
      for (const item of value) {
        if (typeof item === "string") found.push(item);
      }
    } else if (value === true || value === 1) {
      found.push(key);
    }
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
      return unknown.length > 0 ? [{ label: "Other", items: unknown }] : [];
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
            <div className="amenity-grid--detail">
              {group.items.map((key) => {
                const label = PG_AMENITY_LABEL[key] ?? key;
                const Icon = PG_AMENITY_ICON[key] ?? Sparkles;
                return (
                  <div key={key} className="amenity-row">
                    <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
                    <span className="amenity-row__label">{label}</span>
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

  const furnishingMap: Record<string, string> = {
    fully_furnished: "Furnished",
    semi_furnished: "Semi-Furn",
    unfurnished: "Unfurnished"
  };
  const bathroomMap: Record<string, string> = {
    attached: "Attached Bath",
    shared: "Shared Bath"
  };

  return (
    <div className={`pg-room-card ${colorClass}`} style={{ animationDelay: `${index * 60}ms` }}>
      <div className="pg-room-card__label">{rt.sharing} sharing</div>
      <div className="pg-room-card__price">{rupees(rt.monthly_rent_paise)}</div>
      <div className="pg-room-card__period">per person / month</div>

      <div className="pg-room-card__features">
        {rt.ac && (
          <span className="pg-room-feat pg-room-feat--ac">
            <Snowflake size={11} aria-hidden="true" /> AC
          </span>
        )}
        {rt.bathroom_kind && (
          <span
            className={`pg-room-feat${rt.bathroom_kind === "attached" ? " pg-room-feat--attached" : ""}`}
          >
            <ShowerHead size={11} aria-hidden="true" />
            {bathroomMap[rt.bathroom_kind] ?? rt.bathroom_kind}
          </span>
        )}
        {rt.furnishing && rt.furnishing !== "unfurnished" && (
          <span className="pg-room-feat pg-room-feat--furnished">
            {furnishingMap[rt.furnishing] ?? rt.furnishing}
          </span>
        )}
      </div>

      <div className="pg-room-card__footer">
        <span className="pg-room-card__avail">
          <Calendar size={11} aria-hidden="true" />
          From {availLabel}
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
  const MEAL_TIMES = [
    { key: "breakfast", label: "Breakfast" },
    { key: "lunch", label: "Lunch" },
    { key: "dinner", label: "Dinner" },
    { key: "snacks", label: "Snacks" }
  ];
  const activeMeals = MEAL_TIMES.filter((m) => meals[m.key] === true);

  return (
    <div className="pg-meals-card">
      <div className="pg-meals-icon" aria-hidden="true">
        <UtensilsCrossed size={24} />
      </div>
      <div>
        <p className="pg-meals-title">Meals Included</p>
        <p className="pg-meals-sub">Home-style food provided by the PG</p>
        {activeMeals.length > 0 ? (
          <div className="pg-meal-chips">
            {activeMeals.map((m) => (
              <span key={m.key} className="pg-meal-chip">
                <CheckCircle size={11} aria-hidden="true" /> {m.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="pg-meal-chips">
            <span className="pg-meal-chip">
              <CheckCircle size={11} aria-hidden="true" /> All meals
            </span>
          </div>
        )}
        {mealChargesPaise && mealChargesPaise > 0 && (
          <p className="pg-meals-charge">
            <Wallet size={13} aria-hidden="true" />
            {rupees(mealChargesPaise)} / month extra
          </p>
        )}
      </div>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      <div className="pg-rules-columns">
        {allowed.length > 0 && (
          <div className="pg-rules-col pg-rules-col--allowed">
            <div className="pg-rules-col__head">
              <CheckCircle size={14} aria-hidden="true" />
              Allowed
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
              <XCircle size={14} aria-hidden="true" />
              Not Allowed
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
      {quietHours?.from && quietHours?.to && (
        <div>
          <div className="pg-rules-group__label" style={{ marginBottom: 8 }}>
            Quiet hours
          </div>
          <span className="pg-quiet-hours">
            <Clock size={16} aria-hidden="true" />
            {quietHours.from} — {quietHours.to}
          </span>
        </div>
      )}
    </div>
  );
}

function PgPolicyTerms({ pd }: { pd: PgPublicDetail["pg_details"] }) {
  const items: Array<{ icon: React.ReactNode; iconCls: string; label: string; value: string }> = [];

  if (pd.security_deposit_paise != null)
    items.push({
      icon: <Shield size={16} />,
      iconCls: "pg-policy-item__icon--amber",
      label: "Security deposit",
      value: rupees(pd.security_deposit_paise)
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
  if (pd.electricity_mode)
    items.push({
      icon: <Zap size={16} />,
      iconCls: "pg-policy-item__icon--yellow",
      label: "Electricity",
      value: pd.electricity_mode
    });
  if (pd.rent_due_day)
    items.push({
      icon: <CreditCard size={16} />,
      iconCls: "pg-policy-item__icon--trust",
      label: "Rent due",
      value: `${pd.rent_due_day}${pd.rent_due_day === 1 ? "st" : pd.rent_due_day === 2 ? "nd" : pd.rent_due_day === 3 ? "rd" : "th"} of month`
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
  const mealChargesPaise = (pd as Record<string, unknown>).meal_charges_paise as number | null;

  const hasRules = Object.keys(pd.house_rules ?? {}).length > 0;
  const hasPolicyTerms =
    pd.security_deposit_paise != null ||
    pd.notice_period_days != null ||
    pd.lock_in_months != null ||
    pd.electricity_mode != null;

  const photoUrls = detail.photos.map((p) => photoUrl(p.blob_path));
  const cityDisplay = detail.city_slug ?? city;
  const lowestPrice =
    detail.room_types.length > 0
      ? Math.min(...detail.room_types.map((r) => r.monthly_rent_paise))
      : null;

  return (
    <>
      <div className="container ld-page">
        {/* Breadcrumb */}
        <nav className="ld-crumb" aria-label="Breadcrumb">
          <Link href={`/${locale}`}>Home</Link>
          <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
          <Link href={`/${locale}/pg`}>PG</Link>
          <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
          <Link href={`/${locale}/pg/${cityDisplay}`}>{toTitleCase(cityDisplay)}</Link>
          <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
          <span className="ld-crumb__current">{detail.title ?? "PG"}</span>
        </nav>

        {/* Title toolbar */}
        <div className="listing-toolbar">
          <div className="listing-toolbar__heading">
            <div
              className="flex items-center gap-2"
              style={{ flexWrap: "wrap", marginBottom: "var(--space-2)" }}
            >
              <span className="badge badge--verified">
                <ShieldCheck size={14} style={{ marginRight: 4 }} aria-hidden="true" /> Verified
              </span>
              <span className="badge badge--brand">PG / Hostel</span>
            </div>
            <h1>{detail.title ?? "PG"}</h1>
            <div className="listing-toolbar__meta">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <MapPin size={14} aria-hidden="true" />
                {[detail.locality_slug, detail.city_slug]
                  .filter((s): s is string => Boolean(s))
                  .map(toTitleCase)
                  .join(", ") || "Location"}
              </span>
            </div>
          </div>
          <div className="listing-toolbar__actions">
            <button
              type="button"
              className="listing-toolbar__btn"
              onClick={onShare}
              aria-label={t(locale as Locale, "shareListing")}
            >
              <Share2 size={16} aria-hidden="true" />
              {t(locale as Locale, "shareListing")}
            </button>
          </div>
        </div>

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
                <PgPolicyTerms pd={pd} />
                {pd.payment_modes?.length > 0 && (
                  <div style={{ marginTop: "var(--space-5)" }}>
                    <div className="pg-rail-label" style={{ marginBottom: 8 }}>
                      Payment accepted
                    </div>
                    <div className="pg-rail-payment-modes">
                      {pd.payment_modes.map((m) => (
                        <span key={m} className="pg-rail-mode">
                          {m}
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--text-secondary)"
                }}
              >
                <MapPin size={18} aria-hidden="true" />
                <span>
                  {[detail.locality_slug, detail.city_slug]
                    .filter((s): s is string => Boolean(s))
                    .map(toTitleCase)
                    .join(", ") || "Location"}
                </span>
              </div>
            </section>
          </div>

          {/* ── Sticky sidebar ── */}
          <aside className="detail-layout__sidebar">
            <div className="detail-rail">
              {/* Price block */}
              <div>
                <div className="detail-rail__price">
                  <strong>
                    {lowestPrice != null
                      ? `from ${rupees(lowestPrice)}`
                      : detail.monthly_rent != null
                        ? `from ₹${detail.monthly_rent.toLocaleString("en-IN")}`
                        : "Price on request"}
                  </strong>
                  {(lowestPrice != null || detail.monthly_rent != null) && (
                    <span>{t(locale as Locale, "perMonth")}</span>
                  )}
                </div>
                {pd.security_deposit_paise != null && (
                  <div className="pg-rail-deposit">
                    <Shield size={13} aria-hidden="true" />
                    {rupees(pd.security_deposit_paise)} security deposit
                  </div>
                )}
              </div>

              <hr className="pg-rail-divider" />

              {/* Room tiers list */}
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

              {/* Gender + tenant info */}
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

              {/* CTA */}
              <div className="detail-rail__panel">
                <PgInterestButton
                  listingId={detail.id}
                  locale={locale}
                  onBefore={() => trackPgInterestClicked(detail.id, "logged_in")}
                  onSuccess={() => trackPgInterestSubmitted(detail.id)}
                />
              </div>

              {/* Reassurance */}
              <div className="detail-rail__reassure">
                <Shield size={14} aria-hidden="true" />
                <span>
                  {t(locale as Locale, "noChargeUntilUnlock") || "Owner will contact you directly"}
                </span>
              </div>

              {/* Payment modes */}
              {pd.payment_modes?.length > 0 && (
                <>
                  <hr className="pg-rail-divider" />
                  <div>
                    <div className="pg-rail-label">Payment modes</div>
                    <div className="pg-rail-payment-modes">
                      {pd.payment_modes.map((m) => (
                        <span key={m} className="pg-rail-mode">
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
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
            {lowestPrice != null
              ? `${rupees(lowestPrice)}`
              : detail.monthly_rent != null
                ? `₹${detail.monthly_rent.toLocaleString("en-IN")}`
                : "Price on request"}
            {(lowestPrice != null || detail.monthly_rent != null) && (
              <span className="card__price-period">/mo</span>
            )}
          </div>
          {pd.security_deposit_paise != null && (
            <div className="body-sm text-secondary" style={{ fontSize: 12 }}>
              {rupees(pd.security_deposit_paise)} {t(locale as Locale, "depositShort")}
            </div>
          )}
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
