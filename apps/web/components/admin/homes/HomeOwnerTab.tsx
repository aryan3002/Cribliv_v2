"use client";

import { useState } from "react";
import { MessageCircle, ShieldAlert, UserRound } from "lucide-react";
import type { AdminHomeDetail } from "@cribliv/shared-types";
import { transferHomeOwner } from "../../../lib/admin-api";
import {
  formatDate,
  formatMinutes,
  formatNumber,
  formatPct,
  formatPhone
} from "../../../lib/admin/format";
import { SectionCard } from "../primitives/SectionCard";
import { StatCard } from "../primitives/StatCard";
import { StatusPill } from "../primitives/StatusPill";
import { TransferOwnerModal } from "./TransferOwnerModal";

export function HomeOwnerTab({
  detail,
  accessToken,
  onOwnerChanged
}: {
  detail: AdminHomeDetail;
  accessToken: string;
  onOwnerChanged: () => void;
}) {
  const { owner } = detail;
  const [transferOpen, setTransferOpen] = useState(false);

  return (
    <div className="admin-home-workspace__stack">
      <div className="admin-home-workspace__grid">
        <SectionCard title="Owner identity" subtitle="Admin-only contact information">
          <dl className="admin-home-workspace__details">
            <Detail label="Owner ID" value={owner.id} />
            <Detail label="Name" value={owner.name ?? "-"} />
            <Detail label="Phone" value={formatPhone(owner.phone)} />
            <Detail label="Role" value={owner.role} />
            <Detail label="Language" value={owner.preferred_language ?? "-"} />
            <Detail label="Member since" value={formatDate(owner.member_since)} />
            <Detail label="Last login" value={formatDate(owner.last_login_at)} />
            <Detail
              label="Last listing activity"
              value={formatDate(detail.listing.last_owner_activity_at)}
            />
          </dl>
          <div className="admin-home-workspace__pills">
            <StatusPill
              status={owner.whatsapp_opt_in ? "enabled" : "off"}
              label={owner.whatsapp_opt_in ? "WhatsApp enabled" : "WhatsApp off"}
              tone={owner.whatsapp_opt_in ? "trust" : "muted"}
              noDot
            />
            <StatusPill
              status={owner.is_blocked ? "blocked" : "active"}
              label={owner.is_blocked ? "Blocked" : "Not blocked"}
              tone={owner.is_blocked ? "danger" : "trust"}
              noDot
            />
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => setTransferOpen(true)}
          >
            Transfer ownership
          </button>
          {transferOpen ? (
            <TransferOwnerModal
              listingId={detail.listing.id}
              currentOwnerName={owner.name}
              currentOwnerPhone={owner.phone}
              accessToken={accessToken}
              onClose={() => setTransferOpen(false)}
              onTransferred={onOwnerChanged}
              onTransfer={(listingId, phone, fullName) =>
                transferHomeOwner(accessToken, listingId, phone, fullName)
              }
            />
          ) : null}
        </SectionCard>

        <SectionCard title="Portfolio" subtitle="All flat and house listings">
          <div className="admin-home-workspace__summary-list">
            <SummaryRow
              icon={<UserRound size={16} aria-hidden="true" />}
              label="Active homes"
              value={formatNumber(owner.active_homes)}
            />
            <SummaryRow
              icon={<UserRound size={16} aria-hidden="true" />}
              label="Paused homes"
              value={formatNumber(owner.paused_homes)}
            />
            <SummaryRow
              icon={<UserRound size={16} aria-hidden="true" />}
              label="Archived homes"
              value={formatNumber(owner.archived_homes)}
            />
            <SummaryRow
              icon={<ShieldAlert size={16} aria-hidden="true" />}
              label="Reports"
              value={formatNumber(owner.report_count)}
            />
          </div>
        </SectionCard>
      </div>

      <div className="admin-stat-grid">
        <StatCard label="Health score" value={owner.lead_health.health_score ?? "-"} tone="trust" />
        <StatCard label="Lead grade" value={owner.lead_health.health_grade ?? "-"} />
        <StatCard label="Leads 30d" value={formatNumber(owner.lead_health.leads_30d)} />
        <StatCard label="Called rate" value={formatPct(owner.lead_health.called_rate_30d, 1)} />
        <StatCard label="Refund rate" value={formatPct(owner.lead_health.refund_rate_30d, 1)} />
        <StatCard
          label="Median response"
          value={formatMinutes(owner.lead_health.median_response_minutes_30d)}
        />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="admin-home-workspace__summary-row">
      <span className="admin-home-workspace__summary-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
