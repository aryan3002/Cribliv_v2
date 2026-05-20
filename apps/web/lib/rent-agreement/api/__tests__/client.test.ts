import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client";

const BASE = "http://api.test/v1";

beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function mockJson(status: number, body: unknown): void {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response);
}

describe("ApiClient.request", () => {
  it("unwraps the envelope on 2xx", async () => {
    mockJson(200, { data: { plans: [] } });
    const client = new ApiClient(BASE, async () => null);
    const r = await client.request<{ plans: unknown[] }>({ method: "GET", path: "/x" });
    expect(r).toEqual({ data: { plans: [] } });
  });

  it("attaches Authorization header when token is supplied", async () => {
    mockJson(200, { data: {} });
    const client = new ApiClient(BASE, async () => "acc_xyz");
    await client.request({ method: "GET", path: "/x" });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers.Authorization).toBe("Bearer acc_xyz");
  });

  it("attaches Idempotency-Key when supplied", async () => {
    mockJson(201, { data: {} });
    const client = new ApiClient(BASE, async () => null);
    await client.request({ method: "POST", path: "/x", body: { a: 1 }, idempotencyKey: "k1" });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].headers["Idempotency-Key"]).toBe("k1");
  });

  it("throws RaError on 4xx with the parsed code", async () => {
    mockJson(404, { ok: false, error: { code: "RENT_AGREEMENT_NOT_FOUND", message: "not found" } });
    const client = new ApiClient(BASE, async () => "t");
    await expect(client.request({ method: "GET", path: "/x" })).rejects.toMatchObject({
      code: "RENT_AGREEMENT_NOT_FOUND",
      httpStatus: 404
    });
  });

  it("constructs URL as baseUrl + path", async () => {
    mockJson(200, { data: {} });
    const client = new ApiClient(BASE, async () => null);
    await client.request({ method: "GET", path: "/rent-agreement/plans" });
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "http://api.test/v1/rent-agreement/plans"
    );
  });
});
