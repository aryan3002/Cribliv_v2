import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ fetchApi: vi.fn() }));
vi.mock("../api", () => ({ fetchApi: mocks.fetchApi }));

import { trackPgFunnel, setPgFunnelToken } from "../pg-funnel";

beforeEach(() => {
  mocks.fetchApi.mockReset();
  setPgFunnelToken(null);
});

describe("trackPgFunnel", () => {
  it("POSTs to /pg-operator/funnel with the event body", async () => {
    mocks.fetchApi.mockResolvedValueOnce({});
    await trackPgFunnel({ event_type: "wizard_started", source: "manual" });
    expect(mocks.fetchApi).toHaveBeenCalledWith(
      "/pg-operator/funnel",
      expect.objectContaining({ method: "POST" })
    );
    const opts = mocks.fetchApi.mock.calls[0][1];
    const body = JSON.parse(opts.body);
    expect(body.event_type).toBe("wizard_started");
    expect(body.source).toBe("manual");
  });

  it("attaches a Bearer token + keepalive once registered", async () => {
    mocks.fetchApi.mockResolvedValueOnce({});
    setPgFunnelToken("tok-123");
    await trackPgFunnel({ event_type: "draft_saved", source: "manual" });
    const opts = mocks.fetchApi.mock.calls[0][1];
    expect(opts.headers.Authorization).toBe("Bearer tok-123");
    expect(opts.keepalive).toBe(true);
  });

  it("omits Authorization when no token is registered", async () => {
    mocks.fetchApi.mockResolvedValueOnce({});
    await trackPgFunnel({ event_type: "wizard_started", source: "manual" });
    const opts = mocks.fetchApi.mock.calls[0][1];
    expect(opts.headers.Authorization).toBeUndefined();
  });

  it("swallows errors and resolves without throwing", async () => {
    mocks.fetchApi.mockRejectedValueOnce(new Error("404 not found"));
    await expect(
      trackPgFunnel({ event_type: "abandoned", source: "manual" })
    ).resolves.toBeUndefined();
  });
});
