"use client";

import { useEffect, useState } from "react";
import { fetchAdminListingDetail, type AdminListingDetailVm } from "../../../lib/admin-api";
import { StatusPill } from "../primitives/StatusPill";
import { PhotoGallery } from "./PhotoGallery";
import { OwnerTrustCard } from "./OwnerTrustCard";
import { PropertySpecs } from "./PropertySpecs";
import { PgDetailsBlock } from "./PgDetailsBlock";
import { LocationBlock } from "./LocationBlock";
import { VerificationEvidence, mapEvidence } from "./VerificationEvidence";
import { DecisionBar } from "./DecisionBar";
import { formatDate } from "../../../lib/admin/format";

const LISTING_ACTIONS = [
  { key: "pause", label: "Pause", variant: "ghost" as const, requiresReason: true },
  { key: "reject", label: "Reject", variant: "danger" as const, requiresReason: true },
  { key: "approve", label: "Approve & publish", variant: "primary" as const }
];

export function ListingReviewWorkspace({
  accessToken,
  listingId,
  onBack,
  onDecide,
  busy,
  onToast
}: {
  accessToken: string;
  listingId: string;
  onBack: () => void;
  onDecide: (decision: "approve" | "reject" | "pause", reason: string) => void;
  busy: string | null;
  onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
}) {
  const [detail, setDetail] = useState<AdminListingDetailVm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAdminListingDetail(accessToken, listingId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && onToast("Failed to load listing", "danger"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, listingId]);

  if (loading)
    return (
      <div style={{ padding: 24, color: "var(--ad-text-3)", fontSize: 13 }}>Loading listing…</div>
    );
  if (!detail)
    return (
      <div style={{ padding: 24, color: "var(--ad-text-3)", fontSize: 13 }}>Listing not found.</div>
    );

  const { listing, owner, photos, pg, location, verification } = detail;

  return (
    <div className="admin-main__section">
      <button
        type="button"
        className="admin-btn admin-btn--ghost admin-btn--sm"
        onClick={onBack}
        style={{ alignSelf: "flex-start" }}
      >
        ← Back to queue
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)",
          gap: 16,
          alignItems: "start"
        }}
      >
        {/* left: media */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PhotoGallery photos={photos} />
          <LocationBlock location={location} />
        </div>

        {/* right: info + decision */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ad-text)" }}>
              {listing.title_en ?? listing.title_hi ?? "Listing"}
            </div>
            {listing.title_hi && listing.title_en && (
              <div style={{ fontSize: 13, color: "var(--ad-text-3)" }}>{listing.title_hi}</div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              <StatusPill status={listing.listing_type} tone="muted" noDot />
              <StatusPill status={listing.status} />
              <StatusPill status={listing.verification_status} tone="muted" noDot />
            </div>
            <div style={{ fontSize: 11, color: "var(--ad-text-3)", marginTop: 4 }}>
              Submitted {formatDate(listing.created_at)} · {listing.id}
            </div>
          </div>

          <OwnerTrustCard owner={owner} />
          <PropertySpecs listing={listing} />
          {pg && <PgDetailsBlock pg={pg} />}

          <div>
            <div
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                color: "var(--ad-text-3)",
                fontWeight: 800,
                marginBottom: 6
              }}
            >
              Verification evidence
            </div>
            <VerificationEvidence
              accessToken={accessToken}
              onToast={onToast}
              items={verification.map(mapEvidence)}
            />
          </div>

          <DecisionBar
            actions={LISTING_ACTIONS}
            busy={busy}
            onDecide={(key, reason) => onDecide(key as "approve" | "reject" | "pause", reason)}
          />
        </div>
      </div>
    </div>
  );
}
