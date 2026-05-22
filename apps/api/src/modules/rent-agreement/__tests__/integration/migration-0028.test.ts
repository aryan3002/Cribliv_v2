import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  resolve(
    __dirname,
    "../../../../../../../infra/migrations/0028_rent_agreement_persistence_analytics.sql"
  ),
  "utf8"
);

describe("migration 0028 — structural contract", () => {
  const indexes = [
    "idx_rent_agreements_admin_list",
    "idx_rent_agreements_plan_status",
    "idx_rent_agreements_abandoned",
    "idx_rent_agreements_created_at",
    "idx_ra_event_log_session",
    "idx_ra_step_audit_funnel_agg"
  ];

  for (const idx of indexes) {
    it(`creates ${idx}`, () => {
      expect(new RegExp(`create\\s+index[\\s\\S]*?${idx}\\b`, "i").test(SQL)).toBe(true);
    });
  }

  it("wraps the statements in a transaction", () => {
    expect(/begin;/i.test(SQL)).toBe(true);
    expect(/commit;/i.test(SQL)).toBe(true);
  });

  it("uses IF NOT EXISTS for idempotent re-runs", () => {
    const creates = SQL.match(/create\s+index/gi) ?? [];
    const guarded = SQL.match(/create\s+index\s+if\s+not\s+exists/gi) ?? [];
    expect(guarded.length).toBe(creates.length);
  });
});
