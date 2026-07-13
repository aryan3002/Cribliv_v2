import { describe, it, expect, vi, afterEach } from "vitest";
import { LeadsService } from "../leads.service";
import { AppStateService } from "../../../common/app-state.service";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

function svcWith(query: ReturnType<typeof vi.fn>, enabled = true) {
  const db = { isEnabled: () => enabled, query } as any;
  return new LeadsService(db);
}

describe("LeadsService.getListingLeadCounts", () => {
  it("counts leads per listing for the owner/operator", async () => {
    const query = vi.fn(async (_sql: string) => ({
      rows: [{ listing_id: "L1", count: 3 }],
      rowCount: 1
    }));
    const svc = svcWith(query);
    const r = await svc.getListingLeadCounts("op-1", ["L1"], new Date());
    expect(r).toEqual([{ listing_id: "L1", count: 3 }]);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/FROM leads/);
    expect(sql).toMatch(/owner_user_id/);
    expect(sql).toMatch(/listing_id = ANY/);
  });

  it("returns [] for empty listingIds without hitting the DB", async () => {
    const query = vi.fn();
    const svc = svcWith(query);
    expect(await svc.getListingLeadCounts("op-1", [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("LeadsService.openLeadForOperator", () => {
  const OLD_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
    delete process.env.PG_LEAD_DEV_REVEAL;
  });

  it("reveals the real tenant phone in non-production for an owned lead", async () => {
    process.env.NODE_ENV = "development";
    const query = vi.fn(async () => ({
      rows: [{ phone_e164: "+919999999999", tenant_name: "Asha" }],
      rowCount: 1
    }));
    const svc = svcWith(query);
    const r = await svc.openLeadForOperator(VALID_ID, "op-1");
    expect(r.phone).toBe("+919999999999");
    expect(r.tenant_name).toBe("Asha");
  });

  it("404s for a lead the operator doesn't own", async () => {
    process.env.NODE_ENV = "development";
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const svc = svcWith(query);
    await expect(svc.openLeadForOperator(VALID_ID, "op-1")).rejects.toThrow(/not.?found/i);
  });

  it("returns 402 payment_required in production without the dev flag", async () => {
    process.env.NODE_ENV = "production";
    const query = vi.fn();
    const svc = svcWith(query);
    try {
      await svc.openLeadForOperator(VALID_ID, "op-1");
      throw new Error("expected openLeadForOperator to throw");
    } catch (e: unknown) {
      const err = e as { getStatus?: () => number; getResponse?: () => { code?: string } };
      expect(err.getStatus?.()).toBe(402);
      expect(err.getResponse?.().code).toBe("payment_required");
    }
    expect(query).not.toHaveBeenCalled();
  });
});

describe("LeadsService.exportLeadsCsv", () => {
  it("exports real in-memory owner leads instead of an empty header", async () => {
    const state = new AppStateService();
    const owner = state.usersByPhone.get("+919999999901");
    const tenant = state.usersByPhone.get("+919999999902");
    const listing = [...state.listings.values()].find((item) => item.ownerUserId === owner?.id);
    if (!owner || !tenant || !listing) throw new Error("seed fixtures missing");
    tenant.full_name = 'Asha, "Tenant"';

    const { lead } = state.createOwnerLead({
      listingId: listing.id,
      ownerUserId: owner.id,
      tenantUserId: tenant.id,
      tenantPhoneMasked: "+91******9902"
    });
    state.updateOwnerLeadStatus(lead.id, owner.id, "contacted", "Called once");

    const service = new LeadsService({ isEnabled: () => false, query: vi.fn() } as any, state);
    const csv = await service.exportLeadsCsv(owner.id);

    expect(csv).toContain(lead.id);
    expect(csv).toContain(listing.title);
    expect(csv).toContain('"Asha, ""Tenant"""');
    expect(csv).toContain("contacted");
    expect(csv).toContain("Called once");
  });
});
