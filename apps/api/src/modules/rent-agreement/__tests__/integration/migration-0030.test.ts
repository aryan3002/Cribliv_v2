import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  resolve(
    __dirname,
    "../../../../../../../infra/migrations/0030_rent_agreements_payment_order_fk.sql"
  ),
  "utf8"
);

describe("migration 0030 — payment_order_id FK re-point", () => {
  it("drops the old FK constraint", () => {
    expect(
      /drop\s+constraint\s+if\s+exists\s+rent_agreements_payment_order_id_fkey/i.test(SQL)
    ).toBe(true);
  });

  it("adds an FK to rent_agreement_payment_orders", () => {
    expect(/references\s+rent_agreement_payment_orders/i.test(SQL)).toBe(true);
  });

  it("wraps the statements in a transaction", () => {
    expect(/begin;/i.test(SQL)).toBe(true);
    expect(/commit;/i.test(SQL)).toBe(true);
  });
});
