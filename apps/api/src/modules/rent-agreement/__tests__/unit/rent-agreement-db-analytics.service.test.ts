import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../common/telemetry", () => ({ logTelemetry: vi.fn() }));

import { RentAgreementDbAnalyticsService } from "../../analytics/rent-agreement-db-analytics.service";
import { logTelemetry } from "../../../../common/telemetry";
import type { DatabaseService } from "../../../../common/database.service";

function mockDb(opts: { enabled?: boolean; reject?: boolean } = {}) {
  const query = opts.reject
    ? vi.fn().mockRejectedValue(new Error("db down"))
    : vi.fn().mockResolvedValue({ rows: [] });
  return {
    isEnabled: () => opts.enabled ?? true,
    query
  } as unknown as DatabaseService & { query: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RentAgreementDbAnalyticsService.emit", () => {
  it("inserts a non-session event into rent_agreement_event_log", async () => {
    const db = mockDb();
    await new RentAgreementDbAnalyticsService(db).emit("ra.checkout_started", {
      agreement_id: "agr-1",
      user_id: "u-1"
    });
    expect(db.query).toHaveBeenCalledOnce();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/insert into rent_agreement_event_log/i);
    expect(params[0]).toBe("ra.checkout_started");
    expect(params[1]).toBe("agr-1");
    expect(params[2]).toBe("u-1");
  });

  it("passes a null agreement_id for a session event", async () => {
    const db = mockDb();
    await new RentAgreementDbAnalyticsService(db).emit("ra.session_started", { user_id: "u-1" });
    expect(db.query.mock.calls[0][1][1]).toBeNull();
  });

  it("dedupes ra.session_started with an INSERT ... WHERE NOT EXISTS", async () => {
    const db = mockDb();
    await new RentAgreementDbAnalyticsService(db).emit("ra.session_started", { user_id: "u-1" });
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql.toLowerCase()).toContain("not exists");
    expect(sql).toContain("ra.session_started");
  });

  it("does not touch the DB when disabled", async () => {
    const db = mockDb({ enabled: false });
    await new RentAgreementDbAnalyticsService(db).emit("ra.checkout_started", {});
    expect(db.query).not.toHaveBeenCalled();
  });

  it("never throws on a DB error and logs ra.analytics_write_failed", async () => {
    const db = mockDb({ reject: true });
    await expect(
      new RentAgreementDbAnalyticsService(db).emit("ra.checkout_started", {})
    ).resolves.toBeUndefined();
    expect(logTelemetry).toHaveBeenCalledWith(
      "ra.analytics_write_failed",
      expect.objectContaining({ event: "ra.checkout_started" })
    );
  });
});

describe("RentAgreementDbAnalyticsService.emitStepAudit", () => {
  it("inserts into rent_agreement_step_audit with outcome + error_codes", async () => {
    const db = mockDb();
    await new RentAgreementDbAnalyticsService(db).emitStepAudit({
      agreementId: "agr-1",
      step: 3,
      outcome: "blocked",
      actorUserId: "u-1",
      errorCodes: ["isPositive", "isString"]
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/insert into rent_agreement_step_audit/i);
    expect(params[1]).toBe(3);
    expect(params[2]).toBe("blocked");
    expect(params[3]).toEqual(["isPositive", "isString"]);
    expect(params[4]).toBe("u-1");
  });

  it("defaults error_codes to an empty array", async () => {
    const db = mockDb();
    await new RentAgreementDbAnalyticsService(db).emitStepAudit({
      agreementId: "agr-1",
      step: 1,
      outcome: "advanced",
      actorUserId: "u-1"
    });
    expect(db.query.mock.calls[0][1][3]).toEqual([]);
  });

  it("does not touch the DB when disabled", async () => {
    const db = mockDb({ enabled: false });
    await new RentAgreementDbAnalyticsService(db).emitStepAudit({
      agreementId: "agr-1",
      step: 1,
      outcome: "advanced",
      actorUserId: "u-1"
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("never throws on a DB error and logs ra.analytics_write_failed", async () => {
    const db = mockDb({ reject: true });
    await expect(
      new RentAgreementDbAnalyticsService(db).emitStepAudit({
        agreementId: "agr-1",
        step: 1,
        outcome: "advanced",
        actorUserId: "u-1"
      })
    ).resolves.toBeUndefined();
    expect(logTelemetry).toHaveBeenCalledWith(
      "ra.analytics_write_failed",
      expect.objectContaining({ event: "step_audit" })
    );
  });
});
