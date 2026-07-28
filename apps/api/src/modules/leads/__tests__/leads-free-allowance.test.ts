import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LeadsService } from "../leads.service";

/**
 * The first two leads per owner (lifetime) arrive un-blurred. Leads inherited
 * through an ownership transfer must NOT count toward that allowance, or a new
 * owner who inherits two leads has their first real lead arrive locked.
 */
describe("LeadsService.createLead — free-lead allowance", () => {
  beforeEach(() => {
    // Enable the lead management feature flag for these tests
    process.env.FF_LEAD_MANAGEMENT_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.FF_LEAD_MANAGEMENT_ENABLED;
  });

  function makeService(leadCount: number) {
    const query = vi.fn(async (sql: string) => {
      if (/SELECT id::text FROM leads/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/count\(\*\)::int AS n FROM leads/i.test(sql)) {
        return { rows: [{ n: leadCount }], rowCount: 1 };
      }
      if (/INSERT INTO leads/i.test(sql)) {
        return { rows: [{ id: "lead-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database = { isEnabled: () => true, query } as any;
    return { service: new LeadsService(database), query };
  }

  it("excludes transferred leads from the lifetime allowance count", async () => {
    const { service, query } = makeService(0);

    await service.createLead({
      listing_id: "11111111-1111-4111-8111-111111111111",
      owner_user_id: "22222222-2222-4222-8222-222222222222",
      tenant_user_id: "33333333-3333-4333-8333-333333333333"
    });

    const countCall = query.mock.calls.find(([sql]: [string]) =>
      /count\(\*\)::int AS n FROM leads/i.test(sql)
    );
    expect(countCall).toBeDefined();
    expect(countCall![0]).toContain("transferred_at IS NULL");
  });

  it("grants 'free' when the owner has no organic leads yet", async () => {
    const { service, query } = makeService(0);

    await service.createLead({
      listing_id: "11111111-1111-4111-8111-111111111111",
      owner_user_id: "22222222-2222-4222-8222-222222222222",
      tenant_user_id: "33333333-3333-4333-8333-333333333333"
    });

    const insertCall = query.mock.calls.find(([sql]: [string]) => /INSERT INTO leads/i.test(sql));
    expect(insertCall![1]).toContain("free");
  });

  it("grants 'locked' once two organic leads exist", async () => {
    const { service, query } = makeService(2);

    await service.createLead({
      listing_id: "11111111-1111-4111-8111-111111111111",
      owner_user_id: "22222222-2222-4222-8222-222222222222",
      tenant_user_id: "33333333-3333-4333-8333-333333333333"
    });

    const insertCall = query.mock.calls.find(([sql]: [string]) => /INSERT INTO leads/i.test(sql));
    expect(insertCall![1]).toContain("locked");
  });
});
