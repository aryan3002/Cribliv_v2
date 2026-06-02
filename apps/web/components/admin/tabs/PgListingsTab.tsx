"use client";

import { useEffect, useState } from "react";
import { getAdminPgAnalytics, type PgListingAnalytics } from "../../../lib/admin-api";
import { PgListingFunnel } from "../PgListingFunnel";
import { PgListingQuality } from "../PgListingQuality";
import { PgVoiceMetrics } from "../PgVoiceMetrics";
import { EmptyState } from "../primitives/EmptyState";

interface Props {
  accessToken: string;
}

const RANGES = [7, 30, 90] as const;

export function PgListingsTab({ accessToken }: Props) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<PgListingAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDisabled(false);
    getAdminPgAnalytics(accessToken, days)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setDisabled(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, days]);

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>PG Listings</h1>
        <span className="admin-page-title__sub">{loading ? "loading…" : ""}</span>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className="admin-chip"
            aria-pressed={r === days}
            onClick={() => setDays(r)}
          >
            {r}d
          </button>
        ))}
      </div>

      {disabled ? (
        <EmptyState
          title="Analytics unavailable"
          hint="Enable ff_pg_admin_analytics to view the PG listing funnel."
        />
      ) : data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PgListingFunnel data={data} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: 16
            }}
          >
            <PgListingQuality data={data} />
            <PgVoiceMetrics data={data} />
          </div>
        </div>
      ) : (
        !loading && <EmptyState title="No PG listing activity yet" />
      )}
    </div>
  );
}
