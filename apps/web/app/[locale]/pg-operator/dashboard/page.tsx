import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDashboard, listPgDrafts } from "@/lib/pg-operator-api";
import type { PgDashboardData } from "@cribliv/shared-types";
import ListingHealthCard from "@/components/pg-operator/dashboard/ListingHealthCard";
import ContinueDraftSection from "@/components/pg-operator/dashboard/ContinueDraftSection";
import LeadsInbox from "@/components/pg-operator/dashboard/LeadsInbox";
import { PortfolioSummary } from "@/components/pg-operator/dashboard/PortfolioSummary";
import { PortfolioTrendChart } from "@/components/pg-operator/dashboard/PortfolioTrendChart";
import { FunnelConversion } from "@/components/pg-operator/dashboard/FunnelConversion";
import { SearchInsights } from "@/components/pg-operator/dashboard/SearchInsights";
import { Plus } from "lucide-react";
import Link from "next/link";

export const revalidate = 60;

const EMPTY_DASHBOARD: PgDashboardData = {
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

  return (
    <main className="pgo-dashboard">
      {/* Hero */}
      <div className="pgo-dashboard__hero">
        <p className="pgo-dashboard__greeting">Welcome back 👋</p>
        <h1 className="pgo-dashboard__title">Your PG Dashboard</h1>
      </div>

      {/* Portfolio analytics — only meaningful once the operator has listings */}
      {hasListings && (
        <section className="pgo-analytics">
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

      {/* Bento grid */}
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
              {hasListings ? "Add Another Listing" : "Create Your First Listing"}
            </h3>
            <p className="pgo-desc" style={{ margin: "8px auto 0", fontSize: 13 }}>
              {hasListings
                ? "Expand your PG portfolio"
                : "Set up your property, rooms, and amenities in minutes"}
            </p>
          </div>
        </Link>
      </div>

      {/* Leads */}
      <div style={{ marginTop: 24 }}>
        <LeadsInbox leads={data.leads_inbox} token={(s as any)?.accessToken ?? undefined} />
      </div>
    </main>
  );
}
