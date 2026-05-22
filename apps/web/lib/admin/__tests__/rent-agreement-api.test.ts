import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  fetchApi: vi.fn(),
  buildSearchQuery: (params: Record<string, unknown>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      s.set(k, String(v));
    }
    return s.toString();
  }
}));

import { fetchApi } from "../../api";
import {
  fetchRentAgreementSummary,
  fetchRentAgreementFunnel,
  fetchRentAgreementTimeSeries,
  fetchRentAgreementOperational,
  fetchRentAgreements,
  fetchRentAgreementDetail,
  fetchRentAgreementDownloadLink
} from "../../admin-api";

const mockedFetch = vi.mocked(fetchApi);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRentAgreementSummary", () => {
  it("maps snake_case to camelCase", async () => {
    mockedFetch.mockResolvedValueOnce({
      total_sessions: 50,
      drafts_started: 20,
      drafts_completed: 8,
      drafts_abandoned: 3,
      conversion_rate: 0.4,
      total_revenue_paise: 400000,
      arpu_paise: 50000,
      avg_completion_ms: 90000,
      by_plan: [{ plan_id: "premium", count: 5, revenue_paise: 250000 }],
      by_state: [{ state_code: "MH", count: 9 }],
      by_locale: [{ locale: "en", count: 18 }],
      by_payment_status: [{ status: "generated", count: 8 }],
      e_sign_completed: 2,
      e_stamp_issued: 4
    });
    const vm = await fetchRentAgreementSummary("tok", 30);
    expect(vm?.totalSessions).toBe(50);
    expect(vm?.conversionRate).toBe(0.4);
    expect(vm?.byPlan).toEqual([{ planId: "premium", count: 5, revenuePaise: 250000 }]);
    expect(vm?.byState).toEqual([{ stateCode: "MH", count: 9 }]);
    expect(vm?.eSignCompleted).toBe(2);
  });

  it("returns null when the API returns null (FF off)", async () => {
    mockedFetch.mockResolvedValueOnce(null);
    expect(await fetchRentAgreementSummary("tok")).toBeNull();
  });

  it("applies zero defaults for missing numeric fields", async () => {
    mockedFetch.mockResolvedValueOnce({ by_plan: null, by_state: null });
    const vm = await fetchRentAgreementSummary("tok");
    expect(vm?.totalSessions).toBe(0);
    expect(vm?.byPlan).toEqual([]);
    expect(vm?.avgCompletionMs).toBeNull();
  });
});

describe("fetchRentAgreementFunnel", () => {
  it("maps funnel steps", async () => {
    mockedFetch.mockResolvedValueOnce([
      {
        step: 1,
        label: "Step 1: Parties",
        agreements_reached: 100,
        advanced: 90,
        blocked_events: 10,
        reverted_events: 2,
        drop_rate: 0.1,
        top_errors: [{ code: "isString", count: 4 }]
      }
    ]);
    const steps = await fetchRentAgreementFunnel("tok");
    expect(steps[0].agreementsReached).toBe(100);
    expect(steps[0].dropRate).toBe(0.1);
    expect(steps[0].topErrors).toEqual([{ code: "isString", count: 4 }]);
  });

  it("returns an empty array when the API returns null", async () => {
    mockedFetch.mockResolvedValueOnce(null);
    expect(await fetchRentAgreementFunnel("tok")).toEqual([]);
  });
});

describe("fetchRentAgreementTimeSeries / Operational", () => {
  it("maps time-series points", async () => {
    mockedFetch.mockResolvedValueOnce([
      { date: "2026-05-21", drafts_started: 4, drafts_completed: 2, revenue_paise: 100000 }
    ]);
    const series = await fetchRentAgreementTimeSeries("tok");
    expect(series[0]).toEqual({
      date: "2026-05-21",
      draftsStarted: 4,
      draftsCompleted: 2,
      revenuePaise: 100000
    });
  });

  it("maps the operational shape", async () => {
    mockedFetch.mockResolvedValueOnce({
      pdf_jobs: { pending: 1, processing: 0, failed: 2, done: 7 },
      expiring_soon: 3,
      total_downloads: 12,
      at_download_limit: 1
    });
    const op = await fetchRentAgreementOperational("tok");
    expect(op.pdfJobs).toEqual({ pending: 1, processing: 0, failed: 2, done: 7 });
    expect(op.expiringSoon).toBe(3);
    expect(op.atDownloadLimit).toBe(1);
  });
});

describe("fetchRentAgreements", () => {
  it("passes filter / page / limit query params", async () => {
    mockedFetch.mockResolvedValueOnce({ items: [], total: 0 });
    await fetchRentAgreements("tok", {
      status: "draft",
      planId: "premium",
      search: "Sharma",
      page: 2,
      limit: 25
    });
    const path = mockedFetch.mock.calls[0][0] as string;
    expect(path).toContain("/admin/rent-agreements/list?");
    expect(path).toContain("status=draft");
    expect(path).toContain("plan_id=premium");
    expect(path).toContain("search=Sharma");
    expect(path).toContain("page=2");
    expect(path).toContain("limit=25");
  });

  it("maps rows and total", async () => {
    mockedFetch.mockResolvedValueOnce({
      items: [
        {
          id: "agr-1",
          status: "generated",
          plan_id: "premium",
          locale: "en",
          current_step: 7,
          owner_full_name: "Owner",
          rent_amount_paise: 2500000,
          stamp_duty_paise: 30000,
          download_count: 1,
          pdf_ready: true,
          created_at: "2026-05-21T09:00:00Z",
          updated_at: "2026-05-21T10:00:00Z",
          payment_amount_paise: 199900
        }
      ],
      total: 1
    });
    const result = await fetchRentAgreements("tok", {});
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("agr-1");
    expect(result.items[0].ownerFullName).toBe("Owner");
    expect(result.items[0].pdfReady).toBe(true);
    expect(result.items[0].paymentAmountPaise).toBe(199900);
  });

  it("returns an empty page when the API returns null", async () => {
    mockedFetch.mockResolvedValueOnce(null);
    expect(await fetchRentAgreements("tok", {})).toEqual({ items: [], total: 0 });
  });
});

describe("fetchRentAgreementDetail", () => {
  it("returns null when not found", async () => {
    mockedFetch.mockResolvedValueOnce(null);
    expect(await fetchRentAgreementDetail("tok", "nope")).toBeNull();
  });

  it("maps detail with step audit timeline", async () => {
    mockedFetch.mockResolvedValueOnce({
      id: "agr-1",
      status: "draft",
      plan_id: "basic",
      locale: "en",
      current_step: 3,
      stamp_duty_paise: 0,
      download_count: 0,
      pdf_ready: false,
      created_at: "2026-05-21T09:00:00Z",
      updated_at: "2026-05-21T09:30:00Z",
      step_validated_at: { "1": "2026-05-21T09:05:00Z" },
      step_audit: [
        { step: 1, outcome: "advanced", error_codes: [], created_at: "2026-05-21T09:05:00Z" }
      ]
    });
    const detail = await fetchRentAgreementDetail("tok", "agr-1");
    expect(detail?.id).toBe("agr-1");
    expect(detail?.stepValidatedAt).toEqual({ "1": "2026-05-21T09:05:00Z" });
    expect(detail?.stepAudit).toEqual([
      { step: 1, outcome: "advanced", errorCodes: [], createdAt: "2026-05-21T09:05:00Z" }
    ]);
  });
});

describe("fetchRentAgreementDownloadLink", () => {
  it("maps the SAS link", async () => {
    mockedFetch.mockResolvedValueOnce({
      sas_url: "https://example/sas",
      expires_at: "2026-05-21T13:00:00Z"
    });
    const link = await fetchRentAgreementDownloadLink("tok", "agr-1");
    expect(link).toEqual({ sasUrl: "https://example/sas", expiresAt: "2026-05-21T13:00:00Z" });
  });

  it("returns null when the API returns null", async () => {
    mockedFetch.mockResolvedValueOnce(null);
    expect(await fetchRentAgreementDownloadLink("tok", "agr-1")).toBeNull();
  });
});
