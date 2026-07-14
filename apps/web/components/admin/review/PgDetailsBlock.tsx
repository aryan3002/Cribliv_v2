import type { AdminListingDetailVm } from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";

type Pg = NonNullable<AdminListingDetailVm["pg"]>;

export function PgDetailsBlock({ pg }: { pg: Pg }) {
  const d = (pg.details ?? {}) as Record<string, unknown>;
  const rooms = pg.rooms ?? [];
  const fields: Array<[string, unknown]> = [
    ["Total beds", d.total_beds],
    ["Gender", d.gender_policy],
    ["Tenant type", d.tenant_type],
    ["Food included", d.food_included],
    ["Curfew", d.curfew_time],
    ["Notice period (days)", d.notice_period_days],
    ["Lock-in (months)", d.lock_in_months],
    ["Electricity", d.electricity_mode]
  ];
  return (
    <SectionCard title="PG details">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
        {fields.map(([label, value]) => (
          <div
            key={label}
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
              {value === null || value === undefined || value === "" ? "-" : String(value)}
            </span>
          </div>
        ))}
      </div>

      {rooms.length > 0 && (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Sharing", "AC", "Bathroom", "Rent", "Vacancy"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      color: "var(--ad-text-3)",
                      padding: "4px 6px",
                      borderBottom: "1px solid var(--ad-border)"
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rooms.map((r, i) => {
                const room = r as Record<string, unknown>;
                const paise = Number(room.monthly_rent_paise ?? 0);
                return (
                  <tr key={i}>
                    <td style={{ padding: "4px 6px" }}>{String(room.sharing ?? "-")}</td>
                    <td style={{ padding: "4px 6px" }}>{room.ac ? "Yes" : "No"}</td>
                    <td style={{ padding: "4px 6px" }}>{String(room.bathroom_kind ?? "-")}</td>
                    <td style={{ padding: "4px 6px" }}>
                      {paise ? `₹${(paise / 100).toLocaleString("en-IN")}` : "-"}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{String(room.vacancy_count ?? "-")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
