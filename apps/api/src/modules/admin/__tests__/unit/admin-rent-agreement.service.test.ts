import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../config/feature-flags", () => ({ readFeatureFlags: vi.fn() }));

import { AdminRentAgreementService } from "../../admin-rent-agreement.service";
import { readFeatureFlags } from "../../../../config/feature-flags";
import type { DatabaseService } from "../../../../common/database.service";
import type { SasIssuerPort } from "../../../rent-agreement/downloads/sas-issuer.port";

const mockedFlags = vi.mocked(readFeatureFlags);

function setup(opts: { ff?: boolean; db?: boolean } = {}) {
  mockedFlags.mockReturnValue({
    ff_rent_agreement_admin_enabled: opts.ff ?? true
  } as ReturnType<typeof readFeatureFlags>);
  const query = vi.fn();
  const database = {
    isEnabled: () => opts.db ?? true,
    query
  } as unknown as DatabaseService;
  const issue = vi.fn().mockResolvedValue({
    sasUrl: "https://example/sas",
    expiresAt: new Date("2026-05-21T13:00:00Z")
  });
  const sasIssuer: SasIssuerPort = { issue };
  return { svc: new AdminRentAgreementService(database, sasIssuer), query, issue };
}

function queueSummary(
  query: ReturnType<typeof vi.fn>,
  opts: { started: number; completed: number; revenue: number; median?: number | null }
) {
  query
    .mockResolvedValueOnce({
      rows: [
        {
          drafts_started: opts.started,
          drafts_completed: opts.completed,
          drafts_abandoned: 2,
          e_sign_completed: 1,
          e_stamp_issued: 3
        }
      ]
    })
    .mockResolvedValueOnce({ rows: [{ total_sessions: 50 }] })
    .mockResolvedValueOnce({ rows: [{ total_revenue_paise: String(opts.revenue) }] })
    .mockResolvedValueOnce({ rows: [{ avg_completion_ms: opts.median ?? null }] })
    .mockResolvedValueOnce({
      rows: [{ plan_id: "premium", count: 3, revenue_paise: "150000" }]
    })
    .mockResolvedValueOnce({ rows: [{ state_code: "MH", count: 5 }] })
    .mockResolvedValueOnce({ rows: [{ locale: "en", count: 8 }] })
    .mockResolvedValueOnce({ rows: [{ status: "generated", count: 4 }] });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminRentAgreementService.getSummary", () => {
  it("returns null when the feature flag is off", async () => {
    const { svc, query } = setup({ ff: false });
    expect(await svc.getSummary()).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns null when the DB is disabled", async () => {
    const { svc, query } = setup({ db: false });
    expect(await svc.getSummary()).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("conversion_rate is 0 when no drafts were started", async () => {
    const { svc, query } = setup();
    queueSummary(query, { started: 0, completed: 0, revenue: 0 });
    const summary = await svc.getSummary();
    expect(summary?.conversion_rate).toBe(0);
    expect(summary?.arpu_paise).toBe(0);
  });

  it("computes conversion_rate and arpu_paise from the query rows", async () => {
    const { svc, query } = setup();
    queueSummary(query, { started: 10, completed: 4, revenue: 200000 });
    const summary = await svc.getSummary();
    expect(summary?.drafts_started).toBe(10);
    expect(summary?.drafts_completed).toBe(4);
    expect(summary?.conversion_rate).toBeCloseTo(0.4);
    expect(summary?.total_revenue_paise).toBe(200000);
    expect(summary?.arpu_paise).toBe(50000);
  });

  it("arpu_paise is 0 when there are no completions", async () => {
    const { svc, query } = setup();
    queueSummary(query, { started: 5, completed: 0, revenue: 100000 });
    expect((await svc.getSummary())?.arpu_paise).toBe(0);
  });

  it("maps the split breakdowns with numeric coercion", async () => {
    const { svc, query } = setup();
    queueSummary(query, { started: 3, completed: 3, revenue: 150000, median: 42000 });
    const summary = await svc.getSummary();
    expect(summary?.by_plan).toEqual([{ plan_id: "premium", count: 3, revenue_paise: 150000 }]);
    expect(summary?.by_state).toEqual([{ state_code: "MH", count: 5 }]);
    expect(summary?.avg_completion_ms).toBe(42000);
    expect(summary?.e_sign_completed).toBe(1);
    expect(summary?.e_stamp_issued).toBe(3);
  });
});

function queueFunnel(
  query: ReturnType<typeof vi.fn>,
  opts: {
    stepRows: Array<Record<string, number>>;
    errorRows?: Array<{ step: number; code: string; count: number }>;
  }
) {
  query
    .mockResolvedValueOnce({ rows: opts.stepRows })
    .mockResolvedValueOnce({ rows: opts.errorRows ?? [] });
}

describe("AdminRentAgreementService.getFunnel", () => {
  it("returns an empty array when the feature flag is off", async () => {
    const { svc, query } = setup({ ff: false });
    expect(await svc.getFunnel()).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 7 labelled steps, filling missing steps with zeros", async () => {
    const { svc, query } = setup();
    queueFunnel(query, {
      stepRows: [
        { step: 1, agreements_reached: 100, advanced: 90, blocked_events: 10, reverted_events: 2 }
      ]
    });
    const funnel = await svc.getFunnel();
    expect(funnel).toHaveLength(7);
    expect(funnel[0].label).toBe("Step 1: Parties");
    expect(funnel[6].label).toBe("Step 7: Review");
    expect(funnel[0].agreements_reached).toBe(100);
    expect(funnel[1].agreements_reached).toBe(0);
  });

  it("computes drop_rate from consecutive steps, clamped to 0..1", async () => {
    const { svc, query } = setup();
    queueFunnel(query, {
      stepRows: [
        { step: 1, agreements_reached: 100, advanced: 80, blocked_events: 0, reverted_events: 0 },
        { step: 2, agreements_reached: 60, advanced: 50, blocked_events: 0, reverted_events: 0 },
        // step 3 reached MORE than step 2 — drop would be negative, must clamp to 0
        { step: 3, agreements_reached: 70, advanced: 65, blocked_events: 0, reverted_events: 0 }
      ]
    });
    const funnel = await svc.getFunnel();
    expect(funnel[0].drop_rate).toBeCloseTo(0.4);
    expect(funnel[1].drop_rate).toBe(0); // 60 -> 70, clamped
    expect(funnel[6].drop_rate).toBe(0); // last step
    for (const step of funnel) {
      expect(step.drop_rate).toBeGreaterThanOrEqual(0);
      expect(step.drop_rate).toBeLessThanOrEqual(1);
    }
  });

  it("caps top_errors at 3, highest count first", async () => {
    const { svc, query } = setup();
    queueFunnel(query, {
      stepRows: [
        { step: 1, agreements_reached: 50, advanced: 40, blocked_events: 15, reverted_events: 0 }
      ],
      errorRows: [
        { step: 1, code: "a", count: 5 },
        { step: 1, code: "b", count: 4 },
        { step: 1, code: "c", count: 3 },
        { step: 1, code: "d", count: 2 },
        { step: 1, code: "e", count: 1 }
      ]
    });
    const funnel = await svc.getFunnel();
    expect(funnel[0].top_errors).toHaveLength(3);
    expect(funnel[0].top_errors[0]).toEqual({ code: "a", count: 5 });
  });
});

describe("AdminRentAgreementService.getTimeSeries", () => {
  it("returns an empty array when the feature flag is off", async () => {
    const { svc, query } = setup({ ff: false });
    expect(await svc.getTimeSeries()).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("maps day rows with numeric coercion (empty days stay 0)", async () => {
    const { svc, query } = setup();
    query.mockResolvedValueOnce({
      rows: [
        { date: "2026-05-19", drafts_started: 4, drafts_completed: 2, revenue_paise: "100000" },
        { date: "2026-05-20", drafts_started: 0, drafts_completed: 0, revenue_paise: "0" },
        { date: "2026-05-21", drafts_started: 7, drafts_completed: 5, revenue_paise: "250000" }
      ]
    });
    const series = await svc.getTimeSeries();
    expect(series).toHaveLength(3);
    expect(series[1]).toEqual({
      date: "2026-05-20",
      drafts_started: 0,
      drafts_completed: 0,
      revenue_paise: 0
    });
    expect(series[2].revenue_paise).toBe(250000);
  });
});

describe("AdminRentAgreementService.getOperational", () => {
  it("returns an all-zero shape when the feature flag is off", async () => {
    const { svc, query } = setup({ ff: false });
    const op = await svc.getOperational();
    expect(op).toEqual({
      pdf_jobs: { pending: 0, processing: 0, failed: 0, done: 0 },
      expiring_soon: 0,
      total_downloads: 0,
      at_download_limit: 0
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("assembles the operational shape from the queries", async () => {
    const { svc, query } = setup();
    query
      .mockResolvedValueOnce({
        rows: [
          { status: "pending", count: 2 },
          { status: "done", count: 9 }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ n: 3 }] })
      .mockResolvedValueOnce({ rows: [{ n: 41 }] })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] });
    const op = await svc.getOperational();
    expect(op.pdf_jobs).toEqual({ pending: 2, processing: 0, failed: 0, done: 9 });
    expect(op.expiring_soon).toBe(3);
    expect(op.total_downloads).toBe(41);
    expect(op.at_download_limit).toBe(1);
  });
});

describe("AdminRentAgreementService.listAgreements", () => {
  it("returns an empty page when the feature flag is off", async () => {
    const { svc, query } = setup({ ff: false });
    expect(await svc.listAgreements({})).toEqual({ items: [], total: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  it("applies status / plan / state / date / search filters with parameters", async () => {
    const { svc, query } = setup();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listAgreements({
      status: "draft",
      plan_id: "premium",
      state_code: "MH",
      date_from: "2026-01-01",
      date_to: "2026-12-31",
      search: "Sharma"
    });
    const [sql, args] = query.mock.calls[0];
    expect(sql).toMatch(/ra\.status = \$\d/);
    expect(sql).toMatch(/ra\.plan_id = \$\d/);
    expect(sql).toMatch(/ra\.state_code = \$\d/);
    expect(sql).toMatch(/ra\.created_at >= \$\d/);
    expect(sql).toMatch(/ra\.created_at <= \$\d/);
    expect(sql.toLowerCase()).toContain("ilike");
    expect(args).toContain("draft");
    expect(args).toContain("premium");
    expect(args).toContain("%Sharma%");
  });

  it("clamps limit to 100 and defaults page to 1", async () => {
    const { svc, query } = setup();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listAgreements({ limit: 500 });
    const args = query.mock.calls[0][1] as unknown[];
    expect(args).toContain(100); // limit clamped
    expect(args).toContain(0); // offset for page 1
  });

  it("computes offset from page and limit", async () => {
    const { svc, query } = setup();
    query.mockResolvedValueOnce({ rows: [] });
    await svc.listAgreements({ page: 3, limit: 20 });
    expect(query.mock.calls[0][1]).toContain(40); // (3-1) * 20
  });

  it("returns mapped items and total from COUNT(*) OVER()", async () => {
    const { svc, query } = setup();
    query.mockResolvedValueOnce({
      rows: [
        {
          id: "agr-1",
          status: "generated",
          plan_id: "premium",
          locale: "en",
          current_step: 7,
          owner_full_name: "Owner",
          stamp_duty_paise: 30000,
          download_count: 1,
          pdf_ready: true,
          created_at: new Date("2026-05-21T09:00:00Z"),
          updated_at: new Date("2026-05-21T10:00:00Z"),
          payment_amount_paise: "199900",
          total_count: "1"
        }
      ]
    });
    const result = await svc.listAgreements({});
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("agr-1");
    expect(result.items[0].pdf_ready).toBe(true);
    expect(result.items[0].payment_amount_paise).toBe(199900);
  });
});

describe("AdminRentAgreementService.getAgreementDetail", () => {
  it("returns null when the feature flag is off", async () => {
    const { svc } = setup({ ff: false });
    expect(await svc.getAgreementDetail("agr-1")).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    const { svc, query } = setup();
    query.mockResolvedValueOnce({ rows: [] });
    expect(await svc.getAgreementDetail("nope")).toBeNull();
  });

  it("includes the step_audit timeline when found", async () => {
    const { svc, query } = setup();
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "agr-1",
            status: "draft",
            plan_id: "basic",
            locale: "en",
            current_step: 3,
            stamp_duty_paise: 0,
            download_count: 0,
            pdf_ready: false,
            created_at: new Date("2026-05-21T09:00:00Z"),
            updated_at: new Date("2026-05-21T09:30:00Z"),
            step_validated_at: { "1": "2026-05-21T09:05:00Z" }
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            step: 1,
            outcome: "advanced",
            error_codes: [],
            created_at: new Date("2026-05-21T09:05:00Z")
          }
        ]
      });
    const detail = await svc.getAgreementDetail("agr-1");
    expect(detail?.id).toBe("agr-1");
    expect(detail?.step_audit).toHaveLength(1);
    expect(detail?.step_audit[0].outcome).toBe("advanced");
  });
});

describe("AdminRentAgreementService.getAgreementDownloadLink", () => {
  it("returns null when the feature flag is off", async () => {
    const { svc } = setup({ ff: false });
    expect(await svc.getAgreementDownloadLink("agr-1")).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    const { svc, query, issue } = setup();
    query.mockResolvedValueOnce({ rows: [] });
    expect(await svc.getAgreementDownloadLink("nope")).toBeNull();
    expect(issue).not.toHaveBeenCalled();
  });

  it("returns null when the agreement has no pdf_blob_path", async () => {
    const { svc, query, issue } = setup();
    query.mockResolvedValueOnce({ rows: [{ pdf_blob_path: null }] });
    expect(await svc.getAgreementDownloadLink("agr-1")).toBeNull();
    expect(issue).not.toHaveBeenCalled();
  });

  it("issues a SAS link when the agreement has a blob path", async () => {
    const { svc, query, issue } = setup();
    query.mockResolvedValueOnce({ rows: [{ pdf_blob_path: "2026/05/agr-1.pdf" }] });
    const link = await svc.getAgreementDownloadLink("agr-1");
    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ blobPath: "2026/05/agr-1.pdf" }));
    expect(link).toEqual({
      sas_url: "https://example/sas",
      expires_at: "2026-05-21T13:00:00.000Z"
    });
  });
});
