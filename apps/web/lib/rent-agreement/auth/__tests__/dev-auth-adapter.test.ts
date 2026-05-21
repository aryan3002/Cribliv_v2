import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevAuthAdapter } from "../dev-auth-adapter";

beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function mockBootstrap(token = "acc_abc") {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      data: { access_token: token, refresh_token: "ref_x", user: { id: "u1", role: "tenant" } }
    })
  } as Response);
}

describe("DevAuthAdapter", () => {
  it("fetches token from /_dev/bootstrap on first getAccessToken", async () => {
    mockBootstrap("acc_first");
    const auth = new DevAuthAdapter("http://api.test/v1");
    expect(await auth.getAccessToken()).toBe("acc_first");
  });

  it("caches token across subsequent calls (one fetch only)", async () => {
    mockBootstrap("acc_only");
    const auth = new DevAuthAdapter("http://api.test/v1");
    await auth.getAccessToken();
    await auth.getAccessToken();
    await auth.getAccessToken();
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("getUser returns the bootstrapped user", async () => {
    mockBootstrap();
    const auth = new DevAuthAdapter("http://api.test/v1");
    await auth.getAccessToken();
    const user = await auth.getUser();
    expect(user).toEqual({ id: "u1", role: "tenant" });
  });

  it("signOut clears the cached token", async () => {
    mockBootstrap("acc_1");
    const auth = new DevAuthAdapter("http://api.test/v1");
    await auth.getAccessToken();
    await auth.signOut();
    mockBootstrap("acc_2");
    expect(await auth.getAccessToken()).toBe("acc_2");
  });
});
