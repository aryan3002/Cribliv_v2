import { describe, it, expect } from "vitest";
import { computePgListingScore } from "@cribliv/shared-types";
import type { PgListingPayload, PgScoreSignals } from "@cribliv/shared-types";

// The step-level deposit input was removed from the wizard — deposit is now
// entered per room. The completeness score must credit a per-room deposit the
// same as the old property-level one, so the wizard's live score stops nagging
// operators to "add a deposit" they already set on a room.

const SIGNALS: PgScoreSignals = {
  verification_status: "verified",
  has_exact_geo: true,
  photo_count: 10
};

function payload(overrides: {
  propDepositPaise?: number;
  roomDepositPaise?: number;
}): PgListingPayload {
  return {
    property: { display_name: "Deposit PG", city_slug: "lucknow", lat: 26.8, lng: 80.9 },
    pg_details: {
      total_beds: 10,
      gender_policy: "boys",
      tenant_type: "students",
      security_deposit_paise: overrides.propDepositPaise ?? null,
      house_rules: { smoking: false },
      meals: { provided: true },
      amenities: {
        core: ["wifi", "hot_water", "power_backup", "cctv", "security_guard"],
        room: ["study_table"]
      }
    },
    room_types: [
      {
        sharing: "single",
        ac: true,
        monthly_rent_paise: 800_000,
        vacancy_count: 2,
        security_deposit_paise: overrides.roomDepositPaise
      }
    ]
  } as PgListingPayload;
}

describe("computePgListingScore — deposit completeness", () => {
  it("credits a per-room deposit the same as a property-level deposit", () => {
    const roomOnly = computePgListingScore(payload({ roomDepositPaise: 1_500_000 }), SIGNALS);
    const propOnly = computePgListingScore(payload({ propDepositPaise: 1_500_000 }), SIGNALS);
    expect(roomOnly.composite).toBe(propOnly.composite);
  });

  it("docks completeness when no deposit is set anywhere", () => {
    const withDeposit = computePgListingScore(payload({ roomDepositPaise: 1_500_000 }), SIGNALS);
    const noDeposit = computePgListingScore(payload({}), SIGNALS);
    expect(noDeposit.composite).toBeLessThan(withDeposit.composite);
  });
});
