import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getPgListingDetail, type PgListingDetail } from "@/lib/pg-operator-api";
import { ArrowLeft, Plus } from "lucide-react";
import PgPublishedBanner from "./PgPublishedBanner";
import PgSubmitForReview from "./PgSubmitForReview";

export const dynamic = "force-dynamic";

function rupees(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function flattenAmenities(a: Record<string, unknown> | undefined): string[] {
  if (!a) return [];
  const out: string[] = [];
  for (const v of Object.values(a)) {
    if (Array.isArray(v)) out.push(...(v as string[]));
  }
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
      <main className="pgo-dashboard">
        <div
          className="pgo-glass"
          style={{ padding: 32, textAlign: "center", maxWidth: 520, margin: "48px auto" }}
        >
          <h1 className="pgo-heading pgo-heading--md">Listing not found</h1>
          <p className="pgo-desc" style={{ marginTop: 8 }}>
            {error ?? "We couldn't find this listing on your account."}
          </p>
          <Link
            href={`/${params.locale}/pg-operator/dashboard`}
            className="pgo-btn pgo-btn--secondary"
            style={{ marginTop: 16 }}
          >
            <ArrowLeft size={16} /> Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const d = detail.pg_details;
  const amenities = flattenAmenities(d.amenities);
  const justPublished = searchParams.published === "1";

  return (
    <main className="pgo-dashboard">
      {justPublished && <PgPublishedBanner title={detail.title ?? "Your PG"} />}

      <div
        className="pgo-dashboard__hero"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12
        }}
      >
        <div>
          <Link
            href={`/${params.locale}/pg-operator/dashboard`}
            className="pgo-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              marginBottom: 8
            }}
          >
            <ArrowLeft size={14} /> Dashboard
          </Link>
          <h1 className="pgo-dashboard__title">{detail.title ?? "Untitled PG"}</h1>
          <p className="pgo-desc" style={{ marginTop: 4 }}>
            {titleCase(detail.locality_slug)}
            {detail.locality_slug ? ", " : ""}
            {titleCase(detail.city_slug)}
            {"  ·  "}
            <span
              className={`pgo-stat-card__badge-dot pgo-stat-card__badge-dot--${detail.status === "active" ? "active" : "pending"}`}
              style={{ display: "inline-block", marginRight: 4 }}
            />
            {titleCase(detail.status)}
          </p>
        </div>
        <Link
          href={`/${params.locale}/pg-operator/listings/new`}
          className="pgo-btn pgo-btn--secondary"
        >
          <Plus size={16} /> New listing
        </Link>
      </div>

      {detail.status === "draft" && (
        <PgSubmitForReview
          listingId={detail.id}
          token={accessToken ?? undefined}
          title={detail.title ?? "Your PG"}
        />
      )}

      {detail.status === "pending_review" && (
        <div
          className="pgo-glass"
          style={{ padding: 16, marginBottom: 20, borderLeft: "3px solid var(--pgo-brand)" }}
        >
          <strong>Pending admin approval.</strong>{" "}
          <span className="pgo-desc">
            Submitted for review — it goes live once our team approves it.
          </span>
        </div>
      )}

      {/* Overview */}
      <section className="pgo-review-grid">
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Total beds</div>
          <div className="pgo-review-item__value">{d.total_beds ?? "—"}</div>
        </div>
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Gender</div>
          <div className="pgo-review-item__value">{titleCase(d.gender_policy)}</div>
        </div>
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Tenant type</div>
          <div className="pgo-review-item__value">{titleCase(d.tenant_type)}</div>
        </div>
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Starting rent</div>
          <div className="pgo-review-item__value">
            {detail.room_types.length
              ? rupees(Math.min(...detail.room_types.map((r) => r.monthly_rent_paise)))
              : "—"}
            /mo
          </div>
        </div>
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Security deposit</div>
          <div className="pgo-review-item__value">{rupees(d.security_deposit_paise)}</div>
        </div>
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Notice / Lock-in</div>
          <div className="pgo-review-item__value">
            {d.notice_period_days ?? "—"}d / {d.lock_in_months ?? "—"}mo
          </div>
        </div>
      </section>

      {/* Rooms */}
      <section style={{ marginTop: 28 }}>
        <h2 className="pgo-heading pgo-heading--sm" style={{ marginBottom: 12 }}>
          Rooms & pricing
        </h2>
        {detail.room_types.length === 0 ? (
          <p className="pgo-desc">No room types configured.</p>
        ) : (
          <div
            style={{
              borderRadius: "var(--pgo-radius-lg)",
              overflow: "hidden",
              border: "1px solid var(--pgo-border)"
            }}
          >
            <table className="pgo-matrix">
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
                    <td>{r.available_from ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Amenities + payment */}
      <section
        style={{
          marginTop: 28,
          display: "grid",
          gap: 20,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))"
        }}
      >
        <div className="pgo-glass" style={{ padding: 20 }}>
          <h3 className="pgo-heading pgo-heading--xs" style={{ marginBottom: 10 }}>
            Amenities
          </h3>
          {amenities.length === 0 ? (
            <p className="pgo-desc">None listed.</p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {amenities.map((a) => (
                <span key={a} className="pgo-chip pgo-chip--static">
                  {titleCase(a)}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="pgo-glass" style={{ padding: 20 }}>
          <h3 className="pgo-heading pgo-heading--xs" style={{ marginBottom: 10 }}>
            Payment & food
          </h3>
          <p className="pgo-desc">
            Modes: {d.payment_modes.length ? d.payment_modes.map(titleCase).join(", ") : "—"}
          </p>
          <p className="pgo-desc">Electricity: {titleCase(d.electricity_mode)}</p>
          <p className="pgo-desc">
            Meals: {d.meals && (d.meals as any).provided ? "Provided" : "Not provided"}
          </p>
          <p className="pgo-desc">Negotiable: {d.price_negotiable ? "Yes" : "No"}</p>
        </div>
      </section>
    </main>
  );
}
