import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("../../auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }));

import { isAdminPreview } from "../admin-preview";

beforeEach(() => {
  authMock.mockReset();
});

describe("isAdminPreview", () => {
  it("returns false and does not call auth() when adminPreview is absent", async () => {
    await expect(isAdminPreview(undefined)).resolves.toBe(false);
    await expect(isAdminPreview({})).resolves.toBe(false);
    expect(authMock).not.toHaveBeenCalled();
  });

  it('returns false and does not call auth() when adminPreview is not "1"', async () => {
    await expect(isAdminPreview({ adminPreview: "" })).resolves.toBe(false);
    await expect(isAdminPreview({ adminPreview: "0" })).resolves.toBe(false);
    await expect(isAdminPreview({ adminPreview: "true" })).resolves.toBe(false);
    expect(authMock).not.toHaveBeenCalled();
  });

  it("returns false for a null session", async () => {
    authMock.mockResolvedValueOnce(null);
    await expect(isAdminPreview({ adminPreview: "1" })).resolves.toBe(false);
  });

  it('returns false for a session with role "tenant"', async () => {
    authMock.mockResolvedValueOnce({ user: { role: "tenant" } });
    await expect(isAdminPreview({ adminPreview: "1" })).resolves.toBe(false);
  });

  it('returns false for a session with role "owner"', async () => {
    authMock.mockResolvedValueOnce({ user: { role: "owner" } });
    await expect(isAdminPreview({ adminPreview: "1" })).resolves.toBe(false);
  });

  it("returns false for a session with an undefined role", async () => {
    authMock.mockResolvedValueOnce({ user: {} });
    await expect(isAdminPreview({ adminPreview: "1" })).resolves.toBe(false);
  });

  it('returns true only for adminPreview:"1" and a session with role:"admin"', async () => {
    authMock.mockResolvedValueOnce({ user: { role: "admin" } });
    await expect(isAdminPreview({ adminPreview: "1" })).resolves.toBe(true);
    expect(authMock).toHaveBeenCalledTimes(1);
  });

  it('accepts adminPreview as ["1"] (array form)', async () => {
    authMock.mockResolvedValueOnce({ user: { role: "admin" } });
    await expect(isAdminPreview({ adminPreview: ["1"] })).resolves.toBe(true);
  });

  it('returns false when adminPreview array\'s first element is not "1"', async () => {
    await expect(isAdminPreview({ adminPreview: ["0"] })).resolves.toBe(false);
    await expect(isAdminPreview({ adminPreview: [] })).resolves.toBe(false);
    expect(authMock).not.toHaveBeenCalled();
  });

  it("returns false if auth() throws", async () => {
    authMock.mockRejectedValueOnce(new Error("session store unavailable"));
    await expect(isAdminPreview({ adminPreview: "1" })).resolves.toBe(false);
  });
});
