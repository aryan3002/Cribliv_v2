import { describe, it, expect, vi, beforeEach } from "vitest";

const trackMock = vi.fn();
vi.mock("../track", () => ({
  track: (...a: unknown[]) => trackMock(...a),
  getSessionId: () => "sess-1"
}));
const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.stubGlobal("fetch", fetchMock);
vi.mock("../api", () => ({ getApiBaseUrl: () => "http://api.test" }));

import { trackPgDetailView, trackPgShare, trackPgSearch, trackPgCardClick } from "../pg-track";

beforeEach(() => {
  trackMock.mockClear();
  fetchMock.mockClear();
});

describe("trackPgDetailView", () => {
  it("fires pg_detail_viewed AND a listing view", () => {
    trackPgDetailView({ listing_id: "L1", city: "pune" });
    expect(trackMock).toHaveBeenCalledWith("pg_detail_viewed", { listing_id: "L1", city: "pune" });
    expect(trackMock).toHaveBeenCalledWith("view", { listing_id: "L1" });
  });
});

describe("trackPgShare", () => {
  it("fires pg_shared AND a listing share", () => {
    trackPgShare({ listing_id: "L1", method: "native" });
    expect(trackMock).toHaveBeenCalledWith("pg_shared", { listing_id: "L1", method: "native" });
    expect(trackMock).toHaveBeenCalledWith("share", { listing_id: "L1" });
  });
});

describe("trackPgSearch", () => {
  it("fires pg_search_executed + POSTs the search event", () => {
    trackPgSearch({
      city: "pune",
      query: "metro",
      filters: { g: "girls" },
      result_count: 4,
      shown_listing_ids: ["a", "b"]
    });
    expect(trackMock).toHaveBeenCalledWith(
      "pg_search_executed",
      expect.objectContaining({ city: "pune", result_count: 4 })
    );
    expect(trackMock).not.toHaveBeenCalledWith("pg_zero_results", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/pg/analytics/search",
      expect.objectContaining({ method: "POST", keepalive: true })
    );
    const body = JSON.parse((fetchMock.mock.calls as any)[0][1].body);
    expect(body.session_id).toBe("sess-1");
    expect(body.shown_listing_ids).toEqual(["a", "b"]);
  });

  it("also fires pg_zero_results when result_count is 0", () => {
    trackPgSearch({ city: "pune", filters: {}, result_count: 0, shown_listing_ids: [] });
    expect(trackMock).toHaveBeenCalledWith(
      "pg_zero_results",
      expect.objectContaining({ city: "pune" })
    );
  });
});

describe("trackPgCardClick", () => {
  it("posts clicked id + position and sets filters_active correctly", () => {
    trackPgCardClick({
      listing_id: "L9",
      position: 2,
      surface: "pg_search",
      city: "pune",
      filters: { g: "girls" }
    });
    expect(trackMock).toHaveBeenCalledWith(
      "pg_card_clicked",
      expect.objectContaining({ filters_active: true })
    );
    const body = JSON.parse((fetchMock.mock.calls as any)[0][1].body);
    expect(body.clicked_listing_id).toBe("L9");
    expect(body.clicked_position).toBe(2);
  });

  it("filters_active is false when filters empty", () => {
    trackPgCardClick({ listing_id: "L9", position: 0, surface: "pg_search", filters: {} });
    expect(trackMock).toHaveBeenCalledWith(
      "pg_card_clicked",
      expect.objectContaining({ filters_active: false })
    );
  });
});

describe("postSearchEvent resilience", () => {
  it("swallows fetch rejection", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("net")));
    expect(() =>
      trackPgSearch({ filters: {}, result_count: 1, shown_listing_ids: ["a"] })
    ).not.toThrow();
  });
});
