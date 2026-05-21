import { describe, expect, it } from "vitest";

import {
  mapToSummary,
  mapToFull,
  type RentAgreementRow,
  type DraftSummary,
  type DraftFull
} from "../../drafts/draft-summary.mapper";

function buildRow(overrides: Partial<RentAgreementRow> = {}): RentAgreementRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "22222222-2222-2222-2222-222222222222",
    plan_id: "standard",
    locale: "en",
    idempotency_key: "idem-abc-123",
    current_step: 3,
    step_validated_at: { "1": "2026-05-17T10:00:00Z", "2": "2026-05-17T10:05:00Z" },
    status: "draft",
    owner_full_name: "John Doe",
    owner_father_name: "Sam Doe",
    owner_age: 35,
    owner_phone: "+919876543210",
    owner_email: "john@example.com",
    owner_permanent_address: "123 MG Road, Bangalore",
    owner_pan_ct: Buffer.from([1, 2, 3, 4]),
    owner_aadhaar_last4: "1234",
    tenant_full_name: "Jane Smith",
    tenant_father_name: "Bob Smith",
    tenant_age: 28,
    tenant_phone: "+919876543211",
    tenant_email: null,
    tenant_permanent_address: "456 Park St, Mumbai",
    tenant_pan_ct: null,
    tenant_aadhaar_last4: null,
    tenant_company_name: null,
    property_full_address: "Plot 12, MG Road, Bangalore, KA 560001",
    property_type: "flat",
    property_area_sqft: 850,
    property_furnishing: "semi_furnished",
    property_purpose: "residential",
    property_parking: "four_wheeler",
    property_floor_number: 3,
    property_total_floors: 10,
    property_flat_number: "302",
    property_municipal_number: null,
    property_survey_number: null,
    agreement_type: "new",
    agreement_date: "2026-05-01",
    commencement_date: "2026-06-01",
    tenure_months: 11,
    lock_in_months: 6,
    notice_period_months: 2,
    rent_amount_paise: 2_500_000,
    security_deposit_paise: 5_000_000,
    annual_increment_pct: 5,
    state_code: "KA",
    city: "Bangalore",
    acknowledge_registration_required: false,
    inventory_items: [],
    rent_due_day: 5,
    rent_payment_method: "upi",
    maintenance_included: true,
    maintenance_paise: null,
    electricity_allocation: "tenant",
    water_allocation: "tenant",
    gas_allocation: "tenant",
    society_charges_allocation: "shared",
    late_payment_penalty_pct: 2.5,
    pets_allowed: true,
    subletting_allowed: false,
    renovation_allowed: false,
    commercial_use_allowed: false,
    max_occupants: 4,
    additional_terms: [],
    witness_1: null,
    witness_2: null,
    stamp_duty_paise: 25000,
    payment_order_id: null,
    pdf_blob_path: null,
    pdf_generated_at: null,
    download_count: 0,
    max_downloads: 5,
    expires_at: null,
    e_stamp_reference: null,
    e_sign_session_id: null,
    e_sign_completed_at: null,
    created_at: "2026-05-17T09:00:00Z",
    updated_at: "2026-05-17T10:05:00Z",
    ...overrides
  };
}

describe("mapToSummary", () => {
  it("emits minimal list-view fields", () => {
    const summary: DraftSummary = mapToSummary(buildRow());
    expect(summary.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(summary.plan_id).toBe("standard");
    expect(summary.current_step).toBe(3);
    expect(summary.status).toBe("draft");
    expect(summary.locale).toBe("en");
    expect(summary.stamp_duty_paise).toBe(25000);
    expect(summary.rent_amount_paise).toBe(2_500_000);
    expect(summary.created_at).toBe("2026-05-17T09:00:00Z");
    expect(summary.updated_at).toBe("2026-05-17T10:05:00Z");
  });

  it("never includes PAN ciphertext columns", () => {
    const summary: DraftSummary = mapToSummary(buildRow());
    expect(Object.keys(summary)).not.toContain("owner_pan_ct");
    expect(Object.keys(summary)).not.toContain("tenant_pan_ct");
  });

  it("emits has_owner_pan / has_tenant_pan booleans", () => {
    const summary = mapToSummary(buildRow());
    expect(summary.has_owner_pan).toBe(true);
    expect(summary.has_tenant_pan).toBe(false);
  });

  it("survives null/empty step_validated_at", () => {
    const summary = mapToSummary(buildRow({ step_validated_at: {} }));
    expect(summary.id).toBeDefined();
  });
});

describe("mapToFull", () => {
  it("emits all primary form fields", () => {
    const full: DraftFull = mapToFull(buildRow());
    expect(full.owner_full_name).toBe("John Doe");
    expect(full.owner_phone).toBe("+919876543210");
    expect(full.tenant_full_name).toBe("Jane Smith");
    expect(full.property_full_address).toBe("Plot 12, MG Road, Bangalore, KA 560001");
    expect(full.tenure_months).toBe(11);
    expect(full.state_code).toBe("KA");
    expect(full.witness_1).toBeNull();
    expect(full.inventory_items).toEqual([]);
  });

  it("never includes PAN ciphertext columns", () => {
    const full = mapToFull(buildRow());
    expect(Object.keys(full)).not.toContain("owner_pan_ct");
    expect(Object.keys(full)).not.toContain("tenant_pan_ct");
  });

  it("emits has_owner_pan / has_tenant_pan flags", () => {
    const full = mapToFull(buildRow());
    expect(full.has_owner_pan).toBe(true);
    expect(full.has_tenant_pan).toBe(false);
  });

  it("preserves nested jsonb (inventory_items, witnesses)", () => {
    const full = mapToFull(
      buildRow({
        inventory_items: [{ item: "Bed", quantity: 1, condition: "good" }],
        witness_1: { name: "W1", father_name: "F1", address: "X" },
        witness_2: { name: "W2", father_name: "F2", address: "Y" }
      })
    );
    expect(full.inventory_items).toEqual([{ item: "Bed", quantity: 1, condition: "good" }]);
    expect(full.witness_1).toEqual({ name: "W1", father_name: "F1", address: "X" });
    expect(full.witness_2).toEqual({ name: "W2", father_name: "F2", address: "Y" });
  });

  it("preserves e-Stamping / eSign reference columns", () => {
    const full = mapToFull(
      buildRow({
        e_stamp_reference: "ES-12345",
        e_sign_session_id: "sess-abc",
        e_sign_completed_at: "2026-05-17T11:00:00Z"
      })
    );
    expect(full.e_stamp_reference).toBe("ES-12345");
    expect(full.e_sign_session_id).toBe("sess-abc");
    expect(full.e_sign_completed_at).toBe("2026-05-17T11:00:00Z");
  });

  it("includes idempotency_key but omits user_id from outgoing shape", () => {
    const full = mapToFull(buildRow());
    expect(full.idempotency_key).toBe("idem-abc-123");
    expect((full as Record<string, unknown>).user_id).toBeUndefined();
  });
});

describe("mapToFull: PAN redaction is non-bypassable", () => {
  it("strips ciphertext even when caller passes large buffers", () => {
    const big = Buffer.alloc(1024, 0xff);
    const full = mapToFull(buildRow({ owner_pan_ct: big, tenant_pan_ct: big }));
    expect(Object.keys(full)).not.toContain("owner_pan_ct");
    expect(Object.keys(full)).not.toContain("tenant_pan_ct");
    expect(full.has_owner_pan).toBe(true);
    expect(full.has_tenant_pan).toBe(true);
  });

  it("treats zero-length buffer as 'no PAN'", () => {
    const empty = Buffer.alloc(0);
    const full = mapToFull(buildRow({ owner_pan_ct: empty, tenant_pan_ct: null }));
    expect(full.has_owner_pan).toBe(false);
    expect(full.has_tenant_pan).toBe(false);
  });
});
