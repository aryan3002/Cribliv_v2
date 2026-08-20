"use client";

import { useState } from "react";
import type { PgAdminListingDetail } from "@cribliv/shared-types";
import { SectionCard } from "../../primitives/SectionCard";
import { formatDate } from "../../../../lib/admin/format";
import { transferPgOperator } from "../../../../lib/admin-api";
import { PgTransferOwnerModal } from "../PgTransferOwnerModal";

export function OwnerSection({
  detail,
  accessToken,
  onTransferred
}: {
  detail: PgAdminListingDetail;
  accessToken: string;
  onTransferred: () => void;
}) {
  const o = detail.owner;
  const [transferOpen, setTransferOpen] = useState(false);
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Name", value: o.name },
    { label: "Phone", value: o.phone },
    { label: "Email", value: o.email },
    { label: "Total properties", value: String(o.property_count) },
    { label: "Verification", value: o.verification_status },
    { label: "Member since", value: formatDate(o.created_at) }
  ];
  return (
    <SectionCard
      title="Owner"
      subtitle="The operator who owns this listing and its shared property."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 460 }}>
        {rows.map(({ label, value }) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "baseline"
            }}
          >
            <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
            <span
              style={{
                fontSize: 13,
                color: value ? "var(--ad-text)" : "var(--ad-text-3)",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums"
              }}
            >
              {value ?? "-"}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="admin-btn admin-btn--ghost"
        style={{ marginTop: 16 }}
        onClick={() => setTransferOpen(true)}
      >
        Transfer ownership
      </button>

      {transferOpen ? (
        <PgTransferOwnerModal
          listingId={detail.listing.id}
          currentOwnerName={o.name}
          currentOwnerPhone={o.phone}
          onClose={() => setTransferOpen(false)}
          onTransferred={onTransferred}
          onTransfer={(listingId, phone, fullName) =>
            transferPgOperator(accessToken, listingId, phone, fullName)
          }
        />
      ) : null}
    </SectionCard>
  );
}
