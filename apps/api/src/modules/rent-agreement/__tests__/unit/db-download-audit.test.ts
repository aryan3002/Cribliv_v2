import { describe, expect, it, vi } from "vitest";

import { makeDbDownloadAuditRecorder } from "../../downloads/db-download-audit";
import type { DatabaseService } from "../../../../common/database.service";

function mockDb() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { query } as unknown as DatabaseService & { query: ReturnType<typeof vi.fn> };
}

describe("makeDbDownloadAuditRecorder", () => {
  it("inserts a row into rent_agreement_downloads", async () => {
    const db = mockDb();
    const record = makeDbDownloadAuditRecorder(db);
    await record({
      agreement_id: "agr-1",
      ip_hash: "hash-abc",
      user_agent: "Mozilla/5.0",
      sas_expires_at: new Date("2026-05-21T13:00:00.000Z"),
      created_at: new Date("2026-05-21T12:00:00.000Z")
    });
    expect(db.query).toHaveBeenCalledOnce();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/insert into rent_agreement_downloads/i);
    expect(params).toEqual([
      "agr-1",
      "hash-abc",
      "Mozilla/5.0",
      "2026-05-21T13:00:00.000Z",
      "2026-05-21T12:00:00.000Z"
    ]);
  });

  it("passes a null user_agent through", async () => {
    const db = mockDb();
    const record = makeDbDownloadAuditRecorder(db);
    await record({
      agreement_id: "agr-2",
      ip_hash: "hash-xyz",
      user_agent: null,
      sas_expires_at: new Date("2026-05-21T13:00:00.000Z"),
      created_at: new Date("2026-05-21T12:00:00.000Z")
    });
    expect(db.query.mock.calls[0][1][2]).toBeNull();
  });
});
