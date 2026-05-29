"use client";
import type { PgDashboardLead } from "@cribliv/shared-types";
export default function LeadsInbox({ leads }: { leads: PgDashboardLead[] }) {
  const sorted = [...leads].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  if (!sorted.length)
    return (
      <section className="pg-leads-inbox">
        <p>No leads yet.</p>
      </section>
    );
  return (
    <section className="pg-leads-inbox">
      <h3>Leads</h3>
      <ul>
        {sorted.map((l) => (
          <li key={l.lead_id}>
            <strong>{l.contact.phone_masked}</strong>
            <span> · {l.source}</span>
            <span> · {l.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
