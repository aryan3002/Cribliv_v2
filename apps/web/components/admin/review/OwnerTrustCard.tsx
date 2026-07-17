import type { AdminReviewOwnerVm } from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";
import { formatDate } from "../../../lib/admin/format";

function Row({
  label,
  value,
  danger
}: {
  label: string;
  value: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}
    >
      <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          color: danger ? "var(--ad-danger)" : "var(--ad-text)",
          textAlign: "right"
        }}
      >
        {value ?? "-"}
      </span>
    </div>
  );
}

export function OwnerTrustCard({ owner }: { owner: AdminReviewOwnerVm }) {
  return (
    <SectionCard title="Owner">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
        <Row label="Name" value={owner.name} />
        <Row
          label="Phone"
          value={
            owner.phone ? (
              <a href={`tel:${owner.phone}`} style={{ color: "var(--ad-trust)" }}>
                {owner.phone}
              </a>
            ) : (
              "-"
            )
          }
        />
        <Row label="WhatsApp" value={owner.whatsapp_opt_in ? "Opted in" : "No"} />
        <Row label="Language" value={owner.preferred_language ?? "-"} />
        <Row
          label="Member since"
          value={owner.member_since ? formatDate(owner.member_since) : "-"}
        />
        <Row label="Active listings" value={String(owner.active_listings)} />
        <Row label="Reports" value={String(owner.report_count)} danger={owner.report_count > 0} />
        {owner.is_blocked && <Row label="Status" value="BLOCKED" danger />}
      </div>
    </SectionCard>
  );
}
