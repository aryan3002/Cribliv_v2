import type { AdminListingDetailVm } from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";
import { LocationMapPicker } from "../pg-properties/LocationMapPicker";

type Loc = NonNullable<AdminListingDetailVm["location"]>;

export function LocationBlock({ location }: { location: Loc | null }) {
  if (!location)
    return (
      <SectionCard title="Location">
        <p style={{ fontSize: 13, color: "var(--ad-text-3)" }}>No location on file.</p>
      </SectionCard>
    );
  const rows: Array<[string, unknown]> = [
    ["Full address", location.address_line1],
    [
      "Locality / City",
      [location.locality_name, location.city_name].filter(Boolean).join(" · ") || null
    ],
    ["Pincode", location.pincode],
    ["Landmark", location.landmark],
    ["Masked (public)", location.masked_address]
  ];
  const lat = typeof location.lat === "number" ? location.lat : null;
  const lng = typeof location.lng === "number" ? location.lng : null;
  return (
    <SectionCard title="Location">
      {lat != null && lng != null && (
        <div style={{ marginBottom: 12 }}>
          <LocationMapPicker lat={lat} lng={lng} height={180} />
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
            <span style={{ fontSize: 13, color: "var(--ad-text)", textAlign: "right" }}>
              {value ? String(value) : "-"}
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
