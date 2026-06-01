import { describe, it, expect, vi } from "vitest";
import { PgPublicController } from "../pg-public.controller";

function makeReq(): any {
  return { headers: { "user-agent": "UA", "x-forwarded-for": "9.9.9.9" }, ip: "9.9.9.9" };
}
function makeCtrl(trackSearch = vi.fn(async () => {})) {
  const analytics = { trackSearch } as any;
  const search = {} as any;
  const listings = {} as any;
  return { ctrl: new PgPublicController(search, listings, analytics), trackSearch };
}

describe("POST /pg/analytics/search", () => {
  it("returns {tracked:true} and forwards body + ip/ua", async () => {
    const { ctrl, trackSearch } = makeCtrl();
    const res = await ctrl.trackSearch(
      { session_id: "s1", city: "pune", result_count: 3, shown_listing_ids: ["a"] } as any,
      makeReq()
    );
    expect(res).toEqual({ data: { tracked: true }, meta: undefined });
    expect(trackSearch).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "s1", city: "pune", ip: "9.9.9.9", user_agent: "UA" })
    );
  });

  it("injects a synthetic session_id when missing", async () => {
    const { ctrl, trackSearch } = makeCtrl();
    await ctrl.trackSearch({} as any, makeReq());
    const arg = (trackSearch.mock.calls as any)[0][0] as { session_id: string };
    expect(typeof arg.session_id).toBe("string");
    expect(arg.session_id.length).toBeGreaterThan(0);
  });

  it("still returns 200 even if the service throws (fire-and-forget)", async () => {
    const { ctrl } = makeCtrl(
      vi.fn(() => {
        throw new Error("boom");
      })
    );
    const res = await ctrl.trackSearch({ session_id: "s2" } as any, makeReq());
    expect(res).toEqual({ data: { tracked: true }, meta: undefined });
  });
});
