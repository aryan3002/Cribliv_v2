import { describe, it, expect, vi } from "vitest";
import { BlogBriefService } from "../src/modules/blog/blog-brief.service";

function svc(query = vi.fn(), enabled = true) {
  const db = { isEnabled: () => enabled, query } as never;
  return { service: new BlogBriefService(db), query };
}

const BRIEF = {
  id: "b1",
  target_keyword: "2bhk rent noida",
  intent: null,
  outline: [],
  required_data: [],
  internal_link_targets: [],
  source: "gsc_quickwin",
  status: "pending",
  city_slug: "noida",
  category_slug: "data-reports",
  post_type: "data_report",
  notes: null,
  created_at: "t",
  updated_at: "t"
};

describe("BlogBriefService", () => {
  it("createBrief inserts with ON CONFLICT DO NOTHING and returns the row", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [BRIEF] });
    const { service } = svc(query);
    const row = await service.createBrief({
      target_keyword: "2bhk rent noida",
      source: "gsc_quickwin",
      city_slug: "noida",
      post_type: "data_report"
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO blog_briefs/i);
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(params).toContain("2bhk rent noida");
    expect(row?.id).toBe("b1");
  });

  it("createBrief returns null on dedupe conflict (no rows)", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const { service } = svc(query);
    const row = await service.createBrief({ target_keyword: "dup", source: "evergreen" });
    expect(row).toBeNull();
  });

  it("claimNextPending flips one brief to generating via SKIP LOCKED", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ ...BRIEF, status: "generating" }] });
    const { service } = svc(query);
    const row = await service.claimNextPending();
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sql).toMatch(/status\s*=\s*'generating'/i);
    expect(row?.status).toBe("generating");
  });

  it("returns null / [] without querying when DB disabled", async () => {
    const { service, query } = svc(vi.fn(), false);
    await expect(service.listPending()).resolves.toEqual([]);
    await expect(service.claimNextPending()).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
