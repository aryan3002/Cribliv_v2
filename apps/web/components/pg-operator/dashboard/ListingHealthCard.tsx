"use client";
import type { PgDashboardListingHealth } from "@cribliv/shared-types";

function relative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export default function ListingHealthCard({ data }: { data: PgDashboardListingHealth }) {
  return (
    <article className="pg-listing-health-card">
      <header>
        <span data-status={data.status}>{data.status}</span>
      </header>
      <dl>
        <div>
          <dt>Views (7d)</dt>
          <dd>{data.views_7d}</dd>
        </div>
        <div>
          <dt>Contact unlocks (7d)</dt>
          <dd>{data.contact_unlocks_7d}</dd>
        </div>
      </dl>
      <footer>Updated {relative(data.last_updated)}</footer>
    </article>
  );
}
