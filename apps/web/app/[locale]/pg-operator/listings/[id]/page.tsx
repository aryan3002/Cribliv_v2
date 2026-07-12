import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  BedDouble,
  MapPin,
  Sparkles,
  ScrollText,
  Wallet,
  Settings2,
  UtensilsCrossed
} from "lucide-react";
import { getPgListingDetail, type PgListingDetail } from "@/lib/pg-operator-api";
import { computePgListingScore } from "@cribliv/shared-types";
import PgPublishedBanner from "./PgPublishedBanner";
import PgSubmitForReview from "./PgSubmitForReview";
import PgListingControls from "./PgListingControls";
import { PgManageRequestPanel } from "@/components/pg-operator/manage/PgManageRequestPanel";
import styles from "./pg-listing-manage.module.css";

export const dynamic = "force-dynamic";

const PHOTO_BASE = (process.env.NEXT_PUBLIC_PHOTO_BASE_URL || "").replace(/\/+$/, "");
const photoUrl = (b: string) =>
  /^https?:\/\//i.test(b) ? b : PHOTO_BASE ? `${PHOTO_BASE}/${b.replace(/^\/+/, "")}` : b;

function rupees(paise: number | null | undefined): string {
  if (paise == null) return "-";
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}
function titleCase(s: string | null | undefined): string {
  if (!s) return "-";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function flattenAmenities(a: Record<string, unknown> | undefined): string[] {
  if (!a) return [];
  const out: string[] = [];
  for (const v of Object.values(a)) if (Array.isArray(v)) out.push(...(v as string[]));
  return out;
}

export default async function Page({
  params,
  searchParams
}: {
  params: { locale: string; id: string };
  searchParams: { published?: string };
}) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  const accessToken = (s as any)?.accessToken ?? null;

  let detail: PgListingDetail | null = null;
  let error: string | null = null;
  try {
    detail = await getPgListingDetail(params.id, accessToken ?? undefined);
  } catch (e) {
    error = (e as Error).message;
  }

  if (!detail) {
    return (
      <main className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.card} style={{ textAlign: "center", padding: 36 }}>
            <h1 className={styles.heroTitle}>Listing not found</h1>
            <p className={styles.controlNote} style={{ marginTop: 8 }}>
              {error ?? "We couldn't find this listing on your account."}
            </p>
            <Link
              href={`/${params.locale}/pg-operator/dashboard`}
              className={`${styles.btn}`}
              style={{ marginTop: 16 }}
            >
              <ArrowLeft size={16} /> Back to dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const d = detail.pg_details;
  const amenities = flattenAmenities(d.amenities);
  const justPublished = searchParams.published === "1";
  const photos = (detail.photos ?? [])
    .slice()
    .sort((a, b) => Number(b.is_cover) - Number(a.is_cover));
  const startingRent = detail.room_types.length
    ? Math.min(...detail.room_types.map((r) => r.monthly_rent_paise))
    : null;
  const totalVacancy = detail.room_types.reduce((n, r) => n + (r.vacancy_count ?? 0), 0);

  // Display the persisted quality score (same column as dashboard — always in sync).
  // Recommendations are computed live with real signals so they show actionable
  // guidance without false "verify/pin" prompts on an already-verified listing.
  const composite = detail.composite_score ?? 0;
  const verif: "unverified" | "pending" | "verified" =
    detail.verification_status === "verified"
      ? "verified"
      : detail.verification_status === "pending"
        ? "pending"
        : "unverified";
  const { recommendations } = computePgListingScore(
    {
      property: {
        display_name: detail.title ?? "",
        city_slug: detail.city_slug ?? "",
        locality_slug: detail.locality_slug ?? undefined
      },
      pg_details: { ...d, total_beds: d.total_beds ?? 0 } as any,
      room_types: detail.room_types as any
    } as any,
    {
      verification_status: verif,
      has_exact_geo: detail.has_exact_geo,
      photo_count: photos.length
    }
  );
  const scoreColor = composite >= 70 ? "#10b981" : composite >= 40 ? "#f59e0b" : "#ef4444";
  const tier = composite >= 70 ? "Excellent" : composite >= 40 ? "Good" : "Basic";

  const statusCls =
    detail.status === "active"
      ? styles.stActive
      : detail.status === "paused"
        ? styles.stPaused
        : styles.stOther;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {justPublished && <PgPublishedBanner title={detail.title ?? "Your PG"} />}

        <Link href={`/${params.locale}/pg-operator/dashboard`} className={styles.back}>
          <ArrowLeft size={14} /> Dashboard
        </Link>

        {/* Hero */}
        <header className={styles.hero}>
          <div>
            <span className={`${styles.statusBadge} ${statusCls}`}>
              <span className={styles.statusDot} /> {titleCase(detail.status)}
            </span>
            <h1 className={styles.heroTitle}>{detail.title ?? "Untitled PG"}</h1>
            <span className={styles.heroLoc}>
              <MapPin size={14} />
              {[titleCase(detail.locality_slug), titleCase(detail.city_slug)]
                .filter((x) => x !== "-")
                .join(", ") || "Location not set"}
            </span>
          </div>
        </header>

        {detail.status === "draft" && (
          <PgSubmitForReview
            listingId={detail.id}
            token={accessToken ?? undefined}
            title={detail.title ?? "Your PG"}
          />
        )}
        {detail.status === "pending_review" && (
          <div className={`${styles.banner} ${styles.bannerInfo}`}>
            Submitted for review. It goes live once our team approves it.
          </div>
        )}

        <PgManageRequestPanel
          listingId={detail.id}
          locale={params.locale}
          accessToken={accessToken ?? undefined}
        />

        {/* Gallery */}
        {photos.length > 0 ? (
          <div className={styles.gallery}>
            {photos.slice(0, 5).map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={photoUrl(p.blob_path)}
                alt=""
                className={`${styles.gimg} ${i === 0 ? styles.galleryMain : ""}`}
              />
            ))}
          </div>
        ) : (
          <div className={styles.galleryEmpty}>
            <Building2 size={30} strokeWidth={1.5} />
          </div>
        )}

        {/* Controls + score */}
        <div className={styles.grid2}>
          {(detail.status === "active" ||
            detail.status === "paused" ||
            detail.status === "archived") && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>
                  <Settings2 size={18} className={styles.cardIcon} /> Visibility & controls
                </h2>
              </div>
              <PgListingControls
                listingId={detail.id}
                status={detail.status}
                locale={params.locale}
                token={accessToken ?? undefined}
              />
            </div>
          )}

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>
                <Sparkles size={18} className={styles.cardIcon} /> Listing quality
              </h2>
            </div>
            <div className={styles.scoreTop}>
              <span style={{ color: "var(--m-text-soft)", fontWeight: 600, fontSize: 13 }}>
                {tier}
              </span>
              <span className={styles.scoreNum} style={{ color: scoreColor }}>
                {composite}
                <span style={{ fontSize: 12, color: "var(--m-text-soft)", fontWeight: 600 }}>
                  /100
                </span>
              </span>
            </div>
            <div className={styles.barTrack}>
              <div
                className={styles.barFill}
                style={{ width: `${composite}%`, background: scoreColor }}
              />
            </div>
            <div className={styles.tiers}>
              <span>Basic</span>
              <span>Good</span>
              <span>Excellent</span>
            </div>
            {recommendations.length > 0 && (
              <div className={styles.recs}>
                {recommendations.slice(0, 4).map((rec) => (
                  <div key={rec.id} className={styles.rec}>
                    <Sparkles size={12} style={{ color: scoreColor }} />
                    {rec.label}
                    <span className={styles.recPts}>+{rec.points}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Overview stats */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Starting rent</div>
            <div className={styles.statVal}>
              {startingRent != null ? `${rupees(startingRent)}/mo` : "-"}
            </div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Total beds</div>
            <div className={styles.statVal}>{d.total_beds ?? "-"}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Vacancies</div>
            <div className={styles.statVal}>{totalVacancy}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Gender</div>
            <div className={styles.statVal}>{titleCase(d.gender_policy)}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Tenant</div>
            <div className={styles.statVal}>{titleCase(d.tenant_type)}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>Deposit</div>
            <div className={styles.statVal}>{rupees(d.security_deposit_paise)}</div>
          </div>
        </div>

        {/* Rooms */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>
              <BedDouble size={18} className={styles.cardIcon} /> Rooms & pricing
            </h2>
          </div>
          {detail.room_types.length === 0 ? (
            <p className={styles.controlNote}>No room types configured.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Sharing</th>
                    <th>Type</th>
                    <th>Rent / mo</th>
                    <th>Vacancy</th>
                    <th>Available</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.room_types.map((r, i) => (
                    <tr key={i}>
                      <td>{titleCase(r.sharing)}</td>
                      <td>{r.ac ? "AC" : "Non-AC"}</td>
                      <td>{rupees(r.monthly_rent_paise)}</td>
                      <td>{r.vacancy_count}</td>
                      <td>{r.available_from ?? "Now"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Amenities + agreement */}
        <div className={styles.grid2}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>
                <UtensilsCrossed size={18} className={styles.cardIcon} /> Food & amenities
              </h2>
            </div>
            <div className={styles.kv}>
              <span className={styles.kvLabel}>Meals</span>
              <span className={styles.kvVal}>
                {d.meals && (d.meals as any).provided
                  ? (d.meals as any).veg_only
                    ? "Veg only"
                    : "Provided"
                  : "Not provided"}
              </span>
            </div>
            {amenities.length > 0 ? (
              <div className={styles.chips} style={{ marginTop: 12 }}>
                {amenities.map((a) => (
                  <span key={a} className={styles.chip}>
                    {titleCase(a)}
                  </span>
                ))}
              </div>
            ) : (
              <p className={styles.controlNote} style={{ marginTop: 8 }}>
                No amenities listed.
              </p>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>
                <Wallet size={18} className={styles.cardIcon} /> Agreement & payment
              </h2>
            </div>
            <div className={styles.kv}>
              <span className={styles.kvLabel}>Notice / Lock-in</span>
              <span className={styles.kvVal}>
                {d.notice_period_days ?? "-"}d / {d.lock_in_months ?? "-"}mo
              </span>
            </div>
            <div className={styles.kv}>
              <span className={styles.kvLabel}>Electricity</span>
              <span className={styles.kvVal}>{titleCase(d.electricity_mode)}</span>
            </div>
            <div className={styles.kv}>
              <span className={styles.kvLabel}>Payment modes</span>
              <span className={styles.kvVal}>
                {d.payment_modes.length ? d.payment_modes.map(titleCase).join(", ") : "-"}
              </span>
            </div>
            <div className={styles.kv}>
              <span className={styles.kvLabel}>Price negotiable</span>
              <span className={styles.kvVal}>{d.price_negotiable ? "Yes" : "No"}</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
