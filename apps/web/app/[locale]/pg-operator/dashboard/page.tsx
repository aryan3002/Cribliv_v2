import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDashboard, listPgDrafts } from "@/lib/pg-operator-api";
import type { PgDashboardData } from "@cribliv/shared-types";
import ListingHealthCard from "@/components/pg-operator/dashboard/ListingHealthCard";
import ContinueDraftSection from "@/components/pg-operator/dashboard/ContinueDraftSection";
import PgLeadsBoard from "@/components/pg-operator/dashboard/PgLeadsBoard";
import PgInsights from "@/components/pg-operator/dashboard/PgInsights";
import { PortfolioSummary } from "@/components/pg-operator/dashboard/PortfolioSummary";
import { PortfolioTrendChart } from "@/components/pg-operator/dashboard/PortfolioTrendChart";
import { FunnelConversion } from "@/components/pg-operator/dashboard/FunnelConversion";
import { SearchInsights } from "@/components/pg-operator/dashboard/SearchInsights";
import { Plus } from "lucide-react";
import Link from "next/link";
import styles from "./pg-dashboard.module.css";

// Authed, per-operator dashboard. Must be dynamic so admin analytics
// cuts/restores reflect on the operator's next load (no static caching).
export const dynamic = "force-dynamic";

const EMPTY_DASHBOARD: PgDashboardData = {
  analytics_status: "live",
  listing_health: [],
  leads_inbox: [],
  portfolio: {
    appearances: 0,
    clicks: 0,
    views: 0,
    leads: 0,
    ctr: 0,
    interest_rate: 0,
    conversion: 0,
    deltas: { appearances: null, views: null, leads: null }
  },
  trend_30d: [],
  search_insights: { top_queries: [], top_filters: [], zero_result_queries: [] }
};

export default async function Page({ params }: { params: { locale: string } }) {
  const s = await auth();
  if (s?.user?.role !== "pg_operator") redirect(`/${params.locale}/pg-operator/become`);
  let data: PgDashboardData;
  try {
    data = await getDashboard((s as any)?.accessToken ?? undefined);
  } catch {
    data = EMPTY_DASHBOARD;
  }

  const drafts = await listPgDrafts((s as any)?.accessToken ?? undefined)
    .then((r) => r.items)
    .catch(() => [] as any[]);

  const hasListings = data.listing_health.length > 0;

  const operatorName = s?.user?.name?.split(/\s+/)[0];

  return (
    <main className={styles.dashboardPage}>
      <div className={styles.inner}>
        {/* Header */}
        <header className={styles.header}>
          <div>
            <p className={styles.greeting}>
              Welcome back{operatorName ? `, ${operatorName}` : ""} 👋
            </p>
            <h1 className={styles.title}>Your PG dashboard</h1>
            <p className={styles.subtitle}>
              {hasListings
                ? "Track performance, leads, and listing health at a glance."
                : "Create your first listing to start receiving verified tenant leads."}
            </p>
          </div>
          <Link href={`/${params.locale}/pg-operator/listings/new`} className={styles.newBtn}>
            <Plus size={16} /> New listing
          </Link>
        </header>

        {/* Derived insights — portfolio health at a glance */}
        {hasListings && (
          <section>
            <h2 className={styles.sectionTitle}>Insights</h2>
            <PgInsights data={data} />
          </section>
        )}

        {/* Portfolio analytics — only meaningful once the operator has listings */}
        {hasListings && (
          <section className={styles.analytics}>
            {data.analytics_status === "restricted" && (
              <div
                role="status"
                style={{
                  padding: "10px 16px",
                  background: "#FEF3C7",
                  color: "#92400E",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                  border: "1px solid #FDE68A"
                }}
              >
                <span style={{ fontSize: 16 }}>⚠️</span>
                Analytics are temporarily under review.
              </div>
            )}
            <PortfolioSummary portfolio={data.portfolio} />
            <div className="pgo-analytics__grid">
              <PortfolioTrendChart trend={data.trend_30d} />
              <FunnelConversion portfolio={data.portfolio} />
            </div>
            <SearchInsights insights={data.search_insights} />
          </section>
        )}

        {/* Continue draft */}
        <ContinueDraftSection drafts={drafts} locale={params.locale} />

        {/* Listings */}
        <section>
          <h2 className={styles.sectionTitle}>{hasListings ? "Your listings" : "Get started"}</h2>
          <div className="pgo-bento">
            {data.listing_health.map((lh) => (
              <Link
                key={lh.listing_id}
                href={`/${params.locale}/pg-operator/listings/${lh.listing_id}` as any}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <ListingHealthCard data={lh} />
              </Link>
            ))}

            {/* CTA card */}
            <Link
              href={`/${params.locale}/pg-operator/listings/new`}
              className="pgo-glass pgo-glass--interactive pgo-cta-card"
            >
              <div className="pgo-cta-card__content">
                <div
                  className="pgo-splash__icon-ring pgo-splash__icon-ring--brand"
                  style={{ margin: "0 auto 16px", width: 56, height: 56 }}
                >
                  <Plus size={28} />
                </div>
                <h3 className="pgo-heading pgo-heading--sm">
                  {hasListings ? "Add another listing" : "Create your first listing"}
                </h3>
                <p className="pgo-desc" style={{ margin: "8px auto 0", fontSize: 13 }}>
                  {hasListings
                    ? "Expand your PG portfolio"
                    : "Set up your property, rooms, and amenities in minutes"}
                </p>
              </div>
            </Link>
          </div>
        </section>

        {/* Leads pipeline */}
        <section>
          <h2 className={styles.sectionTitle}>Leads pipeline</h2>
          <PgLeadsBoard leads={data.leads_inbox} token={(s as any)?.accessToken ?? undefined} />
        </section>
      </div>
    </main>
  );
}
