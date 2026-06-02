import { describe, it, expect, vi } from "vitest";
import { PgFunnelService } from "../src/modules/pg-operator/services/pg-funnel.service";

function dbStub(routes: Record<string, any[]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    isEnabled: () => true,
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (/INSERT INTO pg_listing_funnel_events/i.test(sql)) return { rows: [] };
      if (/funnel_rollup/.test(sql)) return { rows: routes.rollup ?? [] };
      if (/funnel_quality/.test(sql)) return { rows: routes.quality ?? [] };
      if (/funnel_ttp/.test(sql)) return { rows: routes.ttp ?? [] };
      if (/funnel_missing/.test(sql)) return { rows: routes.missing ?? [] };
      if (/voice_metrics/.test(sql)) return { rows: routes.voice ?? [] };
      if (/score_health/.test(sql)) return { rows: routes.score ?? [] };
      return { rows: [] };
    })
  } as any;
}

describe("PgFunnelService.track", () => {
  it("inserts a funnel row with operator + event fields", async () => {
    const db = dbStub({});
    const svc = new PgFunnelService(db);
    await svc.track("op-1", {
      event_type: "step_completed",
      source: "manual",
      step_no: 2,
      draft_id: "d1",
      metadata: { foo: "bar" }
    });
    const ins = db.calls.find((c) => /INSERT INTO pg_listing_funnel_events/i.test(c.sql));
    expect(ins).toBeTruthy();
    expect(ins!.params).toContain("op-1");
    expect(ins!.params).toContain("step_completed");
    expect(ins!.params).toContain("manual");
    expect(ins!.params).toContain(2);
  });

  it("is a no-op when DB disabled (no throw)", async () => {
    const svc = new PgFunnelService({ isEnabled: () => false, query: vi.fn() } as any);
    await expect(
      svc.track("op-1", { event_type: "wizard_started", source: "voice" })
    ).resolves.toBeUndefined();
  });

  it("swallows insert errors (fire-and-forget)", async () => {
    const db = {
      isEnabled: () => true,
      query: vi.fn(async () => {
        throw new Error("boom");
      })
    } as any;
    const svc = new PgFunnelService(db);
    await expect(
      svc.track("op-1", { event_type: "submitted", source: "manual" })
    ).resolves.toBeUndefined();
  });
});

describe("PgFunnelService.trackPublished", () => {
  it("recovers operator/draft/source from the committed draft and inserts published", async () => {
    const db = {
      calls: [] as Array<{ sql: string; params: unknown[] }>,
      isEnabled: () => true,
      query: vi.fn(async function (this: any, sql: string, params: unknown[]) {
        db.calls.push({ sql, params });
        if (/FROM pg_listing_drafts/i.test(sql)) {
          return { rows: [{ id: "draft-9", operator_user_id: "op-5", source: "voice" }] };
        }
        return { rows: [] };
      })
    } as any;
    const svc = new PgFunnelService(db);
    await svc.trackPublished("listing-1");
    const ins = db.calls.find((c) => /INSERT INTO pg_listing_funnel_events/i.test(c.sql));
    expect(ins).toBeTruthy();
    expect(ins!.params).toContain("op-5"); // operator recovered from draft
    expect(ins!.params).toContain("listing-1");
    expect(ins!.params).toContain("draft-9");
    expect(ins!.params).toContain("voice");
    expect(ins!.params).toContain("published");
  });

  it("falls back to null operator / manual when no draft is found", async () => {
    const db = {
      calls: [] as Array<{ sql: string; params: unknown[] }>,
      isEnabled: () => true,
      query: vi.fn(async function (sql: string, params: unknown[]) {
        db.calls.push({ sql, params });
        return { rows: [] };
      })
    } as any;
    const svc = new PgFunnelService(db);
    await svc.trackPublished("listing-2");
    const ins = db.calls.find((c) => /INSERT INTO pg_listing_funnel_events/i.test(c.sql));
    expect(ins).toBeTruthy();
    expect(ins!.params).toContain("manual");
  });
});

describe("PgFunnelService.getAnalytics", () => {
  it("assembles funnel, conversion, by_source, quality, voice, score_health", async () => {
    const db = dbStub({
      rollup: [
        { event_type: "wizard_started", source: "manual", step_no: null, c: 80 },
        { event_type: "wizard_started", source: "voice", step_no: null, c: 20 },
        { event_type: "step_completed", source: "manual", step_no: 1, c: 70 },
        { event_type: "step_completed", source: "manual", step_no: 2, c: 50 },
        { event_type: "submitted", source: "manual", step_no: null, c: 30 },
        { event_type: "submitted", source: "voice", step_no: null, c: 5 },
        { event_type: "published", source: "manual", step_no: null, c: 25 },
        { event_type: "abandoned", source: "manual", step_no: null, c: 40 }
      ],
      quality: [{ geocode_rate: 0.6, avg_photos: 4.5 }],
      ttp: [{ median: 540 }],
      missing: [
        { field: "house_rules", c: 12 },
        { field: "amenities", c: 8 }
      ],
      voice: [{ sessions: 20, completed: 13 }],
      score: [{ active_pg: 50, with_score: 47, avg_composite: 0.62, high: 18, mid: 22, low: 10 }]
    });
    const svc = new PgFunnelService(db);
    const a = await svc.getAnalytics(30);

    expect(a.funnel.wizard_started).toBe(100);
    expect(a.funnel.submitted).toBe(35);
    expect(a.funnel.published).toBe(25);
    expect(a.funnel.abandoned).toBe(40);
    expect(a.funnel.step_completed_by_step["2"]).toBe(50);
    expect(a.by_source).toEqual({ manual: 80, voice: 20 });
    expect(a.conversion).toBeCloseTo(0.35, 5); // 35/100
    expect(a.publish_conversion).toBeCloseTo(0.25, 5);
    expect(a.median_time_to_publish_sec).toBe(540);
    expect(a.quality.geocode_rate).toBe(0.6);
    expect(a.quality.avg_photos).toBe(4.5);
    expect(a.quality.missing_field_heatmap[0]).toEqual({ field: "house_rules", count: 12 });
    expect(a.voice.sessions).toBe(20);
    expect(a.voice.completion_rate).toBeCloseTo(13 / 20, 5);
    // fallback derived from voice funnel: 1 - submitted_voice/started_voice = 1 - 5/20
    expect(a.voice.fallback_rate).toBeCloseTo(1 - 5 / 20, 5);
    expect(a.score_health.active_pg).toBe(50);
    expect(a.score_health.with_score).toBe(47);
    expect(a.score_health.without_score).toBe(3);
    expect(a.score_health.avg_composite).toBeCloseTo(0.62, 5);
    expect(a.score_health.distribution).toEqual([
      { bucket: "high", count: 18 },
      { bucket: "mid", count: 22 },
      { bucket: "low", count: 10 }
    ]);
  });

  it("handles empty data without dividing by zero", async () => {
    const svc = new PgFunnelService(dbStub({}));
    const a = await svc.getAnalytics(7);
    expect(a.funnel.wizard_started).toBe(0);
    expect(a.conversion).toBe(0);
    expect(a.voice.completion_rate).toBe(0);
    expect(a.score_health.without_score).toBe(0);
  });
});
