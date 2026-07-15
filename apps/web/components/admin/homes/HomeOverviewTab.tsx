import { CheckCircle2, Clock3, MapPinned, ShieldCheck, UserRound } from "lucide-react";
import type { AdminHomeDetail } from "@cribliv/shared-types";
import { formatDate, formatINRPrecise, formatNumber, formatPct } from "../../../lib/admin/format";
import { EmptyState } from "../primitives/EmptyState";
import { SectionCard } from "../primitives/SectionCard";

export function HomeOverviewTab({ detail }: { detail: AdminHomeDetail }) {
  const title = detail.listing.title_en ?? detail.listing.title_hi ?? "Untitled verified home";
  const cover =
    detail.photos.find((photo) => photo.is_cover && photo.url) ??
    detail.photos.find((photo) => photo.url);
  const gallery = detail.photos.filter((photo) => photo.url).slice(0, 4);

  return (
    <div className="admin-home-workspace__grid">
      <div className="admin-home-workspace__stack">
        <SectionCard title="Home overview" subtitle="Read-only listing summary">
          <div className="admin-home-workspace__overview-media">
            {cover?.url ? (
              <>
                {/* Admin photo URLs are dynamic Azure/CDN values not covered by a fixed Next image host. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover.url} alt={`${title} cover`} />
                {gallery.length > 1 && (
                  <div
                    className="admin-home-workspace__gallery-preview"
                    aria-label="Listing photo preview"
                  >
                    {gallery.slice(1).map((photo, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={photo.id ?? `${photo.sort_order}-${index}`}
                        src={photo.url!}
                        alt={`Listing photo ${index + 2}`}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                title="No listing photos"
                hint="The verified home has no visible photo assets."
              />
            )}
          </div>
          <dl className="admin-home-workspace__details">
            <Detail
              label="Monthly rent"
              value={formatINRPrecise(detail.listing.monthly_rent * 100)}
            />
            <Detail
              label="Deposit"
              value={
                detail.listing.security_deposit == null
                  ? "-"
                  : formatINRPrecise(detail.listing.security_deposit * 100)
              }
            />
            <Detail label="Availability" value={formatDate(detail.listing.available_from)} />
            <Detail
              label="Home"
              value={
                [detail.listing.bhk ? `${detail.listing.bhk} BHK` : null, detail.listing.furnishing]
                  .filter(Boolean)
                  .join(" · ") || "-"
              }
            />
          </dl>
        </SectionCard>

        <SectionCard title="Location" subtitle="Admin-visible address">
          <div className="admin-home-workspace__summary-list">
            <SummaryRow
              icon={<MapPinned size={16} aria-hidden="true" />}
              label="Address"
              value={
                [
                  detail.location?.address_line1,
                  detail.location?.locality_name,
                  detail.location?.city_name,
                  detail.location?.pincode
                ]
                  .filter(Boolean)
                  .join(", ") || "Location unavailable"
              }
            />
            <SummaryRow
              icon={<MapPinned size={16} aria-hidden="true" />}
              label="Landmark"
              value={detail.location?.landmark ?? "-"}
            />
          </div>
        </SectionCard>
      </div>

      <div className="admin-home-workspace__stack">
        <SectionCard title="Lead health" subtitle="Current listing response snapshot">
          <div className="admin-home-workspace__summary-list">
            <SummaryRow
              icon={<Clock3 size={16} aria-hidden="true" />}
              label="Open leads"
              value={formatNumber(detail.metrics_30d.open_leads)}
            />
            <SummaryRow
              icon={<CheckCircle2 size={16} aria-hidden="true" />}
              label="Called rate"
              value={formatPct(
                detail.lead_summary.called + detail.lead_summary.uncalled > 0
                  ? detail.lead_summary.called /
                      (detail.lead_summary.called + detail.lead_summary.uncalled)
                  : 0,
                1
              )}
            />
            <SummaryRow
              icon={<UserRound size={16} aria-hidden="true" />}
              label="Owner health"
              value={
                detail.owner.lead_health.health_score == null
                  ? "-"
                  : `${detail.owner.lead_health.health_grade ?? ""} · ${detail.owner.lead_health.health_score}`
              }
            />
          </div>
        </SectionCard>

        <SectionCard title="Verification" subtitle="Latest verified state">
          <div className="admin-home-workspace__summary-list">
            <SummaryRow
              icon={<ShieldCheck size={16} aria-hidden="true" />}
              label="Status"
              value="Verified"
            />
            <SummaryRow
              icon={<ShieldCheck size={16} aria-hidden="true" />}
              label="Completed"
              value={formatDate(detail.verified_at)}
            />
            <SummaryRow
              icon={<ShieldCheck size={16} aria-hidden="true" />}
              label="Attempts"
              value={formatNumber(detail.verification_attempts.length)}
            />
          </div>
        </SectionCard>
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
