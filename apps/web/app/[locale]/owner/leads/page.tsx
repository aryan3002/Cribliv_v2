"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { LeadsPipeline } from "../../../../components/owner/leads-pipeline";
import { LeadStatsWidget } from "../../../../components/owner/lead-stats-widget";

export default function OwnerLeadsPage({ params }: { params: { locale: string } }) {
  const { data: session, status } = useSession();
  const accessToken = session?.accessToken ?? null;
  const locale = params.locale;

  if (status === "loading") {
    return (
      <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "var(--space-3)",
            marginBottom: "var(--space-5)"
          }}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="skeleton-card"
              style={{ height: 88, borderRadius: "var(--radius-lg)" }}
            />
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "var(--space-4)"
          }}
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="skeleton-card"
              style={{ height: 180, borderRadius: "var(--radius-lg)" }}
            />
          ))}
        </div>
      </section>
    );
  }

  if (!accessToken) {
    return (
      <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
        <div className="alert alert--error">Please log in to view leads.</div>
      </section>
    );
  }

  return (
    <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "var(--space-4)",
          marginBottom: "var(--space-5)"
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              marginBottom: "var(--space-1)"
            }}
          >
            <Link
              href={`/${locale}/owner/dashboard`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 13,
                color: "var(--text-tertiary)",
                fontWeight: 500
              }}
            >
              ← Dashboard
            </Link>
          </div>
          <h1 className="h2" style={{ margin: 0 }}>
            Leads Pipeline
          </h1>
          <p
            className="caption"
            style={{ color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}
          >
            Manage all tenant enquiries across your listings
          </p>
        </div>

        <a href={`/v1/owner/leads/export`} className="btn btn--secondary btn--sm" download>
          ↓ Export CSV
        </a>
      </div>

      {/* Stats */}
      <LeadStatsWidget accessToken={accessToken} />

      {/* Pipeline */}
      <div style={{ marginTop: "var(--space-2)" }}>
        <LeadsPipeline accessToken={accessToken} />
      </div>
    </section>
  );
}
