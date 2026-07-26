import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("../../auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }));

const notFoundMock = vi.fn(() => {
  // Mirrors next/navigation: notFound() throws to halt rendering.
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

import { isAdminSession, requireAdminPreview } from "../admin-preview";

beforeEach(() => {
  authMock.mockReset();
  notFoundMock.mockClear();
});

describe("isAdminSession", () => {
  it("returns false for a null session", async () => {
    authMock.mockResolvedValueOnce(null);
    await expect(isAdminSession()).resolves.toBe(false);
  });

  it.each(["tenant", "owner", "pg_operator"])(
    'returns false for a session with role "%s"',
    async (role) => {
      authMock.mockResolvedValueOnce({ user: { role } });
      await expect(isAdminSession()).resolves.toBe(false);
    }
  );

  it("returns false for a session with an undefined role", async () => {
    authMock.mockResolvedValueOnce({ user: {} });
    await expect(isAdminSession()).resolves.toBe(false);
  });

  it('returns true only for a session with role "admin"', async () => {
    authMock.mockResolvedValueOnce({ user: { role: "admin" } });
    await expect(isAdminSession()).resolves.toBe(true);
    expect(authMock).toHaveBeenCalledTimes(1);
  });

  it("returns false if auth() throws (never 500s the preview route)", async () => {
    authMock.mockRejectedValueOnce(new Error("session store unavailable"));
    await expect(isAdminSession()).resolves.toBe(false);
  });
});

describe("requireAdminPreview", () => {
  it("resolves without calling notFound() for an admin", async () => {
    authMock.mockResolvedValueOnce({ user: { role: "admin" } });
    await expect(requireAdminPreview()).resolves.toBeUndefined();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  // The security property that matters: a non-admin must not be able to see an
  // unpublished city's page by guessing a /seo-preview/* URL.
  it.each([
    ["logged out", null],
    ["tenant", { user: { role: "tenant" } }],
    ["owner", { user: { role: "owner" } }]
  ])("calls notFound() for %s", async (_label, session) => {
    authMock.mockResolvedValueOnce(session);
    await expect(requireAdminPreview()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
