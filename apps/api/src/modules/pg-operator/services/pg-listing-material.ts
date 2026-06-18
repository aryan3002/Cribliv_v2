import type { PgListingPayload } from "@cribliv/shared-types";

/**
 * MATERIAL-EDIT rule (spec §2). Pure, separately unit-tested. Answers: did the
 * operator change anything a tenant relies on for a trust / safety / financial
 * decision? If so the edit must re-review (→ pending_review); otherwise a live
 * listing stays live.
 *
 * Material  : title; property display_name/city/locality/lat/lng; all room types
 *             (stored fields only); total_beds, gender_policy, tenant_type, all
 *             deposits + PgPaymentTerms, amenities, nearby.
 * Non-material (ignored here): internal_code, total_floors, formatted_address,
 *             price_negotiable, late_fee_policy, meals, meal_charges_paise,
 *             house_rules. (meals/meal_charges/house_rules moved out 2026-06-16
 *             per owner — owner-chosen, low bait-and-switch risk.)
 *
 * NOTE: per-room security_deposit_paise / deposit_refundable_pct are NOT stored
 * by writeRoomTypes, so the room tuple is compared on stored fields only —
 * including them would create a phantom diff (before=absent vs after=present).
 */
export function isMaterialChange(before: PgListingPayload, next: PgListingPayload): boolean {
  const str = (v: unknown): string => (v == null ? "" : String(v));
  const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

  // title (free text — highest-risk material field)
  if (str(before.title) !== str(next.title)) return true;

  // property (visible location identity)
  const bp = before.property;
  const np = next.property;
  if (bp.display_name !== np.display_name) return true;
  if (str(bp.city_slug) !== str(np.city_slug)) return true;
  if (str(bp.locality_slug) !== str(np.locality_slug)) return true;
  if (numOrNull(bp.lat) !== numOrNull(np.lat)) return true;
  if (numOrNull(bp.lng) !== numOrNull(np.lng)) return true;

  // pg_details — material subset (deposits + payment terms + amenities + nearby
  // + the first-class filter fields). payment_modes is order-insensitive.
  const bd = before.pg_details as unknown as Record<string, unknown>;
  const nd = next.pg_details as unknown as Record<string, unknown>;
  const scalarKeys = [
    "total_beds",
    "gender_policy",
    "tenant_type",
    "security_deposit_paise",
    "deposit_refundable_pct",
    "notice_period_days",
    "lock_in_months",
    "electricity_mode",
    "maintenance_paise",
    "rent_due_day",
    "amenities",
    "nearby"
  ];
  for (const k of scalarKeys) {
    if (JSON.stringify(bd[k] ?? null) !== JSON.stringify(nd[k] ?? null)) return true;
  }
  const modes = (v: unknown): string => JSON.stringify([...((v as string[]) ?? [])].sort());
  if (modes(bd.payment_modes) !== modes(nd.payment_modes)) return true;

  // room types as an order-insensitive set of STORED fields
  if (normRooms(before.room_types) !== normRooms(next.room_types)) return true;

  return false;
}

function normRooms(rts: PgListingPayload["room_types"]): string {
  return JSON.stringify(
    [...rts]
      .map((r) => ({
        sharing: r.sharing,
        ac: r.ac,
        bathroom_kind: r.bathroom_kind ?? null,
        furnishing: r.furnishing ?? null,
        monthly_rent_paise: r.monthly_rent_paise,
        vacancy_count: r.vacancy_count,
        available_from: r.available_from ?? null
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
}
