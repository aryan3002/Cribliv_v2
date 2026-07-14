import type { AdminListingDetailVm } from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";
import { formatDate, formatINRPrecise } from "../../../lib/admin/format";

type Listing = AdminListingDetailVm["listing"];

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        borderBottom: "1px dashed var(--ad-border)",
        padding: "4px 0"
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--ad-text)", textAlign: "right" }}>
        {value ?? "-"}
      </span>
    </div>
  );
}

export function PropertySpecs({ listing }: { listing: Listing }) {
  const amenities = Array.isArray(listing.amenities) ? listing.amenities : [];
  return (
    <SectionCard title="Property details">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
        <Cell
          label="Monthly rent"
          value={listing.monthly_rent != null ? formatINRPrecise(listing.monthly_rent * 100) : "-"}
        />
        <Cell
          label="Deposit"
          value={
            listing.security_deposit != null
              ? formatINRPrecise(listing.security_deposit * 100)
              : "-"
          }
        />
        <Cell label="BHK" value={listing.bhk ?? "-"} />
        <Cell label="Bathrooms" value={listing.bathrooms ?? "-"} />
        <Cell label="Area" value={listing.area_sqft ? `${listing.area_sqft} ft²` : "-"} />
        <Cell label="Furnishing" value={listing.furnishing ?? "-"} />
        <Cell
          label="Available from"
          value={listing.available_from ? formatDate(listing.available_from) : "-"}
        />
        <Cell label="Preferred tenant" value={listing.preferred_tenant ?? "-"} />
        <Cell label="WhatsApp enquiries" value={listing.whatsapp_available ? "Enabled" : "Off"} />
      </div>

      {(listing.description_en || listing.description_hi) && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{ fontSize: 12, fontWeight: 600, color: "var(--ad-text-2)", marginBottom: 4 }}
          >
            Description
          </div>
          <p style={{ fontSize: 13, color: "var(--ad-text-2)", margin: 0 }}>
            {listing.description_en ?? listing.description_hi}
          </p>
        </div>
      )}

      {amenities.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {amenities.map((a) => (
            <span
              key={a}
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--ad-brand)",
                background: "var(--ad-brand-soft)",
                borderRadius: 999,
                padding: "2px 9px"
              }}
            >
              {a}
            </span>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
