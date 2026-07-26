import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchApi, UNAUTHORIZED_EVENT } from "../api";

/**
 * A 401 from the API means the bearer token is dead. Nothing in the app used to
 * notice, so the admin portal rendered a full shell whose every panel silently
 * failed. Broadcasting the 401 lets an authenticated surface react — refresh the
 * session (which heals a dropped rotation) or sign out.
 */

function stubResponse(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    }))
  );
}

let listener: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listener = vi.fn();
  window.addEventListener(UNAUTHORIZED_EVENT, listener);
});

afterEach(() => {
  window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  vi.unstubAllGlobals();
});

describe("fetchApi unauthorized signal", () => {
  it("broadcasts when the API rejects the token", async () => {
    stubResponse(401, { error: { code: "unauthorized", message: "Unauthorized" } });

    await expect(fetchApi("/admin/homes")).rejects.toMatchObject({ status: 401 });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a forbidden response", async () => {
    // 403 means the token is valid but the role is wrong — signing out would be
    // the wrong reaction.
    stubResponse(403, { error: { code: "forbidden", message: "Forbidden" } });

    await expect(fetchApi("/admin/homes")).rejects.toMatchObject({ status: 403 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("stays quiet for other failures", async () => {
    stubResponse(500, { error: { code: "server_error" } });

    await expect(fetchApi("/admin/homes")).rejects.toMatchObject({ status: 500 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("stays quiet on success", async () => {
    stubResponse(200, { data: { ok: true } });

    await expect(fetchApi("/admin/homes")).resolves.toEqual({ ok: true });

    expect(listener).not.toHaveBeenCalled();
  });
});
