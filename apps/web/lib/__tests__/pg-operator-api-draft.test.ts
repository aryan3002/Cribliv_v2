import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ fetchApi: vi.fn() }));
import { fetchApi } from "../api";
import { putPgDraft, listPgDrafts, getPgDraft, deletePgDraft } from "../pg-operator-api";

const f = fetchApi as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => f.mockReset());

const PAYLOAD = {
  property: { display_name: "A", city_slug: "lko" },
  pg_details: { total_beds: 4 },
  room_types: []
} as any;
const DRAFT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("pg-operator-api draft fns", () => {
  it("putPgDraft sends PUT with Idempotency-Key", async () => {
    f.mockResolvedValueOnce({ draft_id: DRAFT_ID, updated_at: "t" });
    const r = await putPgDraft("tok", { payload: PAYLOAD, source: "manual" });
    expect(r.draft_id).toBe(DRAFT_ID);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe("/pg-operator/listings/draft");
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBeTruthy();
  });

  it("listPgDrafts sends GET and returns items array", async () => {
    f.mockResolvedValueOnce({ items: [{ draft_id: DRAFT_ID }] });
    const r = await listPgDrafts("tok");
    expect(r.items).toHaveLength(1);
    const [url] = f.mock.calls[0] as any;
    expect(url).toBe("/pg-operator/listings/drafts");
  });

  it("getPgDraft sends GET for specific draft", async () => {
    f.mockResolvedValueOnce({ draft_id: DRAFT_ID, payload: PAYLOAD });
    const r = await getPgDraft("tok", DRAFT_ID);
    expect(r.draft_id).toBe(DRAFT_ID);
    const [url] = f.mock.calls[0] as any;
    expect(url).toBe(`/pg-operator/listings/draft/${DRAFT_ID}`);
  });

  it("deletePgDraft sends DELETE", async () => {
    f.mockResolvedValueOnce(undefined);
    await deletePgDraft("tok", DRAFT_ID);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe(`/pg-operator/listings/draft/${DRAFT_ID}`);
    expect(init.method).toBe("DELETE");
  });
});
