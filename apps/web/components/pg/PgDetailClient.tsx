"use client";
import { useEffect, useRef, useState } from "react";
import {
  Wifi,
  ParkingSquare,
  WashingMachine,
  Cctv,
  Dumbbell,
  ChefHat,
  Droplets,
  Zap,
  CheckCircle,
  Share2,
  MapPin,
  BedDouble,
  Snowflake
} from "lucide-react";
import type { PgPublicDetail, PgCard } from "../../lib/pg-public-api";
import { searchPgListings } from "../../lib/pg-public-api";
import { PgInterestButton } from "./PgInterestButton";
import { PgListingCard } from "./PgListingCard";
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

const AMENITY_ICON: Record<string, typeof Wifi> = {
  wifi: Wifi,
  parking: ParkingSquare,
  laundry: WashingMachine,
  cctv: Cctv,
  gym: Dumbbell,
  cook: ChefHat,
  hot_water: Droplets,
  power_backup: Zap
};

export function PgDetailClient({
  detail,
  city,
  locale
}: {
  detail: PgPublicDetail;
  city: string;
  locale: string;
}) {
  const [activePhoto, setActivePhoto] = useState(0);
  const [similar, setSimilar] = useState<PgCard[]>([]);
  const fired = useRef(false);
  const pd = detail.pg_details;

  // Fire view exactly once (StrictMode/re-render safe).
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackPgDetailView({ listing_id: detail.id, city });
  }, [detail.id, city]);

  // Similar PGs (client fetch, exclude self, take 3).
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

  const onThumb = (i: number) => {
    setActivePhoto(i);
    trackPgPhotoViewed(detail.id, i);
  };

  const onShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: detail.title ?? "PG", url });
        trackPgShare({ listing_id: detail.id, method: "native" });
        return;
      } catch {
        /* user cancelled — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
    } catch {
      /* ignore */
    }
    trackPgShare({ listing_id: detail.id, method: "clipboard" });
  };

  const totalVacancy = detail.room_types.reduce((s, r) => s + (r.vacancy_count ?? 0), 0);
  const showVacancy = totalVacancy > 0 && totalVacancy <= 3;

  const facts: Array<{ label: string; value: string }> = [];
  if (pd.security_deposit_paise != null)
    facts.push({ label: "Security deposit", value: rupees(pd.security_deposit_paise) });
  if (pd.notice_period_days != null)
    facts.push({ label: "Notice period", value: `${pd.notice_period_days} days` });
  if (pd.lock_in_months != null)
    facts.push({ label: "Lock-in period", value: `${pd.lock_in_months} months` });
  if (pd.electricity_mode) facts.push({ label: "Electricity", value: pd.electricity_mode });

  const amenities = Object.entries(pd.amenities ?? {})
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k);
  const rules = Object.entries(pd.house_rules ?? {}).filter(([, v]) => v != null && v !== "");

  return (
    <div
      className="container"
      style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-16)" }}
    >
      <div
        style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <h1 style={{ marginBottom: "var(--space-2)" }}>{detail.title ?? "PG"}</h1>
          <p className="text-secondary" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <MapPin size={14} />{" "}
            {[detail.locality_slug, detail.city_slug].filter(Boolean).join(", ") || "Location"}
          </p>
        </div>
        <button type="button" className="btn btn--secondary pg-detail__share" onClick={onShare}>
          <Share2 size={16} /> Share
        </button>
      </div>

      {showVacancy && (
        <div className="pg-detail__vacancy">
          Only {totalVacancy} bed{totalVacancy === 1 ? "" : "s"} left
        </div>
      )}

      {/* Photo mosaic */}
      {detail.photos.length > 0 && (
        <div className="pg-detail__mosaic" style={{ marginTop: "var(--space-4)" }}>
          <div className="pg-detail__mosaic-main">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl(detail.photos[activePhoto]?.blob_path ?? detail.photos[0].blob_path)}
              alt={detail.title ?? "PG"}
            />
          </div>
          {detail.photos.slice(0, 3).map((p, i) => (
            <div
              key={i}
              className="pg-detail__mosaic-thumb"
              data-testid={`pg-thumb-${i}`}
              onClick={() => onThumb(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl(p.blob_path)} alt={`Photo ${i + 1}`} loading="lazy" />
            </div>
          ))}
        </div>
      )}

      {/* Facts strip */}
      {facts.length > 0 && (
        <div className="pg-detail__facts">
          {facts.map((f) => (
            <div key={f.label} className="pg-detail__fact">
              <div className="pg-detail__fact-label">{f.label}</div>
              <div className="pg-detail__fact-value">{f.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Payment modes */}
      {pd.payment_modes?.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "var(--space-3) 0" }}>
          {pd.payment_modes.map((m) => (
            <span key={m} className="pg-badge pg-badge--sharing">
              {m}
            </span>
          ))}
        </div>
      )}

      {/* Amenities */}
      {amenities.length > 0 && (
        <>
          <h2 style={{ marginTop: "var(--space-6)" }}>Amenities</h2>
          <div className="pg-detail__amenities">
            {amenities.map((k) => {
              const Icon = AMENITY_ICON[k] ?? CheckCircle;
              return (
                <span key={k} className="pg-detail__amenity">
                  <Icon size={14} /> {k}
                </span>
              );
            })}
          </div>
        </>
      )}

      {/* Rooms */}
      <h2 style={{ marginTop: "var(--space-6)", marginBottom: "var(--space-3)" }}>Room options</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {detail.room_types.map((rt, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "10px 14px",
              border: "1px solid var(--border)",
              borderRadius: 10
            }}
          >
            <BedDouble size={16} />
            <strong style={{ textTransform: "capitalize" }}>{rt.sharing}</strong>
            {rt.ac && (
              <span className="pg-badge pg-badge--sharing">
                <Snowflake size={11} /> AC
              </span>
            )}
            <span style={{ marginLeft: "auto", fontWeight: 700 }}>
              {rupees(rt.monthly_rent_paise)}/mo
            </span>
          </div>
        ))}
      </div>

      {/* House rules */}
      {rules.length > 0 && (
        <details className="pg-detail__rules" style={{ marginTop: "var(--space-6)" }}>
          <summary>House rules</summary>
          <ul>
            {rules.map(([k, v]) => (
              <li key={k}>
                {k.replace(/_/g, " ")}: {String(v)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Interest (inline + sticky on mobile) */}
      <div style={{ marginTop: "var(--space-8)" }}>
        <PgInterestButton
          listingId={detail.id}
          locale={locale}
          onBefore={() => trackPgInterestClicked(detail.id, "logged_in")}
          onSuccess={() => trackPgInterestSubmitted(detail.id)}
        />
      </div>

      {/* Similar PGs */}
      {similar.length > 0 && (
        <>
          <h2 style={{ marginTop: "var(--space-10)" }}>Similar PGs nearby</h2>
          <div className="pg-detail__similar">
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
        </>
      )}

      {/* Sticky mobile CTA */}
      <div className="pg-detail__sticky-cta">
        <span className="pg-detail__sticky-price">
          {detail.monthly_rent != null
            ? `from ₹${detail.monthly_rent.toLocaleString("en-IN")}/mo`
            : "Price on request"}
        </span>
        <PgInterestButton
          listingId={detail.id}
          locale={locale}
          onBefore={() => trackPgInterestClicked(detail.id, "logged_in")}
          onSuccess={() => trackPgInterestSubmitted(detail.id)}
        />
      </div>
    </div>
  );
}
