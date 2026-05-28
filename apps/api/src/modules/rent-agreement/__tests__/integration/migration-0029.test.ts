import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  resolve(
    __dirname,
    "../../../../../../../infra/migrations/0029_rent_agreement_payment_orders.sql"
  ),
  "utf8"
);

describe("migration 0029 — rent_agreement_payment_orders", () => {
  it("creates the rent_agreement_payment_orders table", () => {
    expect(/create\s+table\s+if\s+not\s+exists\s+rent_agreement_payment_orders/i.test(SQL)).toBe(
      true
    );
  });

  it("references users and rent_agreements", () => {
    expect(/references\s+users/i.test(SQL)).toBe(true);
    expect(/references\s+rent_agreements/i.test(SQL)).toBe(true);
  });

  it("enforces idempotency on (user_id, idempotency_key)", () => {
    expect(/unique\s*\(\s*user_id\s*,\s*idempotency_key\s*\)/i.test(SQL)).toBe(true);
  });

  it("constrains status to pending_payment / paid", () => {
    expect(/status[\s\S]*check[\s\S]*pending_payment[\s\S]*paid/i.test(SQL)).toBe(true);
  });

  it("indexes provider_order_id for webhook lookup", () => {
    expect(/index[\s\S]*provider_order_id/i.test(SQL)).toBe(true);
  });

  it("wraps the statements in a transaction", () => {
    expect(/begin;/i.test(SQL)).toBe(true);
    expect(/commit;/i.test(SQL)).toBe(true);
  });
});
