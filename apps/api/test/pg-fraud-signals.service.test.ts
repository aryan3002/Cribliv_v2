import { describe, it, expect, vi } from "vitest";
import { PgFraudSignalsService } from "../src/modules/pg-operator/services/pg-fraud-signals.service";

function makeService(dbRows: Record<string, unknown>[] = [], dbEnabled = true) {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    isEnabled: () => dbEnabled,
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (/INSERT INTO fraud_flags/i.test(sql)) {
        inserts.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      return { rows: dbRows, rowCount: dbRows.length };
    })
  };
  const svc = new PgFraudSignalsService(db as never);
  return { svc, inserts, db };
}

describe("PgFraudSignalsService", () => {
  describe("priceAnomaly", () => {
    it("does NOT flag when rent is within normal range (z-score <= 3)", async () => {
      // avg=1000000, stddev=50000, our rent=1100000 → z=(1100000-1000000)/50000=2.0
      const { svc, inserts } = makeService([{ avg: 1000000, stddev: 50000 }]);
      const r = await svc.priceAnomaly("list-1", "single", 1100000, "delhi");
      expect(r.flagged).toBe(false);
      expect(inserts).toHaveLength(0);
    });

    it("flags when rent is a severe outlier (|z| > 3)", async () => {
      // avg=1000000, stddev=50000, our rent=1300000 → z=6.0
      process.env["FF_PG_FRAUD_AI"] = "true";
      const { svc, inserts } = makeService([{ avg: 1000000, stddev: 50000 }]);
      const r = await svc.priceAnomaly("list-1", "single", 1300000, "delhi");
      expect(r.flagged).toBe(true);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].params[1]).toBe("price_anomaly");
      delete process.env["FF_PG_FRAUD_AI"];
    });
  });

  describe("contactReuse", () => {
    it("does NOT flag when fewer than 3 listings share contact", async () => {
      const { svc, inserts } = makeService([{ count: 2 }]);
      const r = await svc.contactReuse("list-1", "op-1");
      expect(r.flagged).toBe(false);
      expect(inserts).toHaveLength(0);
    });

    it("flags when 3+ active listings share the operator contact", async () => {
      process.env["FF_PG_FRAUD_AI"] = "true";
      const { svc, inserts } = makeService([{ count: 3 }]);
      const r = await svc.contactReuse("list-1", "op-1");
      expect(r.flagged).toBe(true);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].params[1]).toBe("contact_reuse");
      delete process.env["FF_PG_FRAUD_AI"];
    });
  });

  describe("scamText", () => {
    it("does NOT flag clean description text", async () => {
      const { svc, inserts } = makeService();
      const r = await svc.scamText("list-1", "Spacious PG with wifi and meals.");
      expect(r.flagged).toBe(false);
      expect(inserts).toHaveLength(0);
    });

    it("flags description with multiple scam markers", async () => {
      process.env["FF_PG_FRAUD_AI"] = "true";
      const { svc, inserts } = makeService();
      const scamDesc =
        "100% guaranteed advance booking required. Pay now via UPI. No visits. Very urgent deal limited time offer. Free gift if you pay today.";
      const r = await svc.scamText("list-1", scamDesc);
      expect(r.flagged).toBe(true);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].params[1]).toBe("suspicious_text");
      delete process.env["FF_PG_FRAUD_AI"];
    });
  });

  describe("DB disabled", () => {
    it("returns not flagged without hitting DB when disabled", async () => {
      process.env["FF_PG_FRAUD_AI"] = "true";
      const { svc, inserts } = makeService([], false);
      const r = await svc.contactReuse("list-1", "op-1");
      expect(r.flagged).toBe(false);
      expect(inserts).toHaveLength(0);
      delete process.env["FF_PG_FRAUD_AI"];
    });
  });
});
