import { ArrowUpRight, Clock3, UsersRound } from "lucide-react";
import type { AdminHomeDetail } from "@cribliv/shared-types";
import { formatDate, formatMinutes, formatNumber, formatPct } from "../../../lib/admin/format";
import { EmptyState } from "../primitives/EmptyState";
import { SectionCard } from "../primitives/SectionCard";
import { StatCard } from "../primitives/StatCard";
import { StatusPill } from "../primitives/StatusPill";

export function HomeLeadsTab({
  detail,
  onOpenLeadCenter
}: {
  detail: AdminHomeDetail;
  onOpenLeadCenter: () => void;
}) {
  const totalRecent = detail.metrics_30d.leads;
  const calledRate = totalRecent > 0 ? detail.lead_summary.called / totalRecent : 0;
  const recentLeads = [...detail.recent_leads]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 10);

  return (
    <div className="admin-home-workspace__stack">
      <div className="admin-home-workspace__section-head">
        <div>
          <h2>Lead operations</h2>
          <p>Metrics and previews only. Operational actions stay in Lead Center.</p>
        </div>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={onOpenLeadCenter}>
          <ArrowUpRight size={16} aria-hidden="true" />
          Manage in Lead Center
        </button>
      </div>

      <div className="admin-stat-grid">
        <StatCard label="Leads 30d" value={formatNumber(totalRecent)} tone="brand" />
        <StatCard label="Called" value={formatNumber(detail.lead_summary.called)} />
        <StatCard label="Uncalled" value={formatNumber(detail.lead_summary.uncalled)} tone="warn" />
        <StatCard label="Refunded" value={formatNumber(detail.lead_summary.refunded)} />
        <StatCard label="Open now" value={formatNumber(detail.lead_summary.open)} tone="warn" />
        <StatCard label="Called rate" value={formatPct(calledRate, 1)} />
        <StatCard
          label="Median response"
          value={formatMinutes(detail.lead_summary.median_response_minutes)}
        />
      </div>

      <div className="admin-home-workspace__grid">
        <SectionCard title="Status breakdown" subtitle="Leads created in the last 30 days">
          <Breakdown rows={Object.entries(detail.lead_summary.by_status)} />
        </SectionCard>
        <SectionCard title="Access breakdown" subtitle="Current access state">
          <Breakdown rows={Object.entries(detail.lead_summary.by_access_state)} />
        </SectionCard>
      </div>

      <SectionCard
        title="Recent lead previews"
        subtitle="Phone numbers and lead actions are available only in Lead Center."
        flush
      >
        {recentLeads.length === 0 ? (
          <EmptyState
            title="No recent leads"
            hint="New listing-scoped leads will appear here when they are created."
            icon={<UsersRound size={18} aria-hidden="true" />}
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-home-workspace__lead-table">
              <thead>
                <tr>
                  <th scope="col">Seeker</th>
                  <th scope="col">Access</th>
                  <th scope="col">Status</th>
                  <th scope="col">Called</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {recentLeads.map((lead) => (
                  <tr key={lead.lead_id}>
                    <td>{lead.seeker_name}</td>
                    <td>
                      <StatusPill status={lead.access_state} />
                    </td>
                    <td>
                      <StatusPill status={lead.status} />
                    </td>
                    <td>{lead.called_at ? formatDate(lead.called_at) : "Not called"}</td>
                    <td>{formatDate(lead.response_deadline_at)}</td>
                    <td>{formatDate(lead.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="admin-home-workspace__lead-note">
        <Clock3 size={16} aria-hidden="true" />
        Lead previews intentionally exclude seeker phone numbers, call controls, refunds, and
        nudges.
      </div>
    </div>
  );
}

function Breakdown({ rows }: { rows: Array<[string, number]> }) {
  return (
    <dl className="admin-home-workspace__breakdown">
      {rows.map(([label, count]) => (
        <div key={label}>
          <dt>{label.replace(/_/g, " ")}</dt>
          <dd>{formatNumber(count)}</dd>
        </div>
      ))}
    </dl>
  );
}
