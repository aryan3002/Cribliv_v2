import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDashboardService } from "../services/pg-dashboard.service";

function makeDeps() {
  const owner = {
    listOperatorListings: vi.fn(async () => [
      { id: "L1", status: "active", updated_at: "2026-01-01T00:00:00Z" }
    ])
  };
  const analytics = {
    listingMetrics7d: vi.fn(async () => [{ listing_id: "L1", views_7d: 42, contact_unlocks_7d: 3 }])
  };
  const leads = {
    inboxForOperator: vi.fn(async () => [
      {
        lead_id: "lead-1",
        source: "contact_unlock",
        status: "new",
        created_at: "2026-01-01T00:00:00Z",
        contact: { phone_masked: "+9198***234" }
      }
    ])
  };
  return { owner, analytics, leads };
}

describe("PgDashboardService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates listing health + leads inbox for an operator", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(d.owner as any, d.analytics as any, d.leads as any);
    const r = await svc.getDashboard("op-1");
    expect(r.listing_health[0].listing_id).toBe("L1");
    expect(r.listing_health[0].views_7d).toBe(42);
    expect(r.listing_health[0].contact_unlocks_7d).toBe(3);
    expect(r.leads_inbox.length).toBe(1);
  });

  it("returns cached payload within 60s for the same operator", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(d.owner as any, d.analytics as any, d.leads as any);
    await svc.getDashboard("op-1");
    await svc.getDashboard("op-1");
    expect(d.owner.listOperatorListings).toHaveBeenCalledOnce();
    expect(d.analytics.listingMetrics7d).toHaveBeenCalledOnce();
    expect(d.leads.inboxForOperator).toHaveBeenCalledOnce();
  });

  it("invalidates cache after 60s and refetches", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(d.owner as any, d.analytics as any, d.leads as any);
    await svc.getDashboard("op-1");
    vi.advanceTimersByTime(61_000);
    await svc.getDashboard("op-1");
    expect(d.owner.listOperatorListings).toHaveBeenCalledTimes(2);
  });

  it("treats different operators as separate cache keys", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(d.owner as any, d.analytics as any, d.leads as any);
    await svc.getDashboard("op-1");
    await svc.getDashboard("op-2");
    expect(d.owner.listOperatorListings).toHaveBeenCalledTimes(2);
  });

  it("skips analytics call when operator has zero listings", async () => {
    const d = makeDeps();
    d.owner.listOperatorListings.mockResolvedValueOnce([]);
    const svc = new PgDashboardService(d.owner as any, d.analytics as any, d.leads as any);
    const r = await svc.getDashboard("op-empty");
    expect(r.listing_health).toEqual([]);
    expect(d.analytics.listingMetrics7d).not.toHaveBeenCalled();
  });
});
