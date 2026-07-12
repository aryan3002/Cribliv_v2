import { describe, it, expect } from "vitest";
import { rolePath, canAccessPath, resolveAuthedDestination } from "../login-redirect";

describe("rolePath", () => {
  it("sends tenants and role-less users to the locale home", () => {
    expect(rolePath("tenant", "en")).toBe("/en");
    expect(rolePath(undefined, "en")).toBe("/en");
  });
  it("sends each dashboard role to its home", () => {
    expect(rolePath("owner", "en")).toBe("/en/owner/dashboard");
    expect(rolePath("pg_operator", "en")).toBe("/en/pg-operator/dashboard");
    expect(rolePath("admin", "en")).toBe("/en/admin");
  });
});

describe("canAccessPath", () => {
  it("blocks a tenant from an admin path but allows a public one", () => {
    expect(canAccessPath("tenant", "/en/admin")).toBe(false);
    expect(canAccessPath("tenant", "/en/search")).toBe(true);
  });
  it("lets any role reach the pg-operator self-upgrade gate", () => {
    expect(canAccessPath("tenant", "/en/pg-operator/become")).toBe(true);
    expect(canAccessPath("tenant", "/en/pg-operator/dashboard")).toBe(false);
  });
});

describe("resolveAuthedDestination", () => {
  it("sends an owner with no `from` to their dashboard", () => {
    expect(resolveAuthedDestination("owner", null, "en")).toBe("/en/owner/dashboard");
  });

  it("honors a role-allowed `from`", () => {
    expect(resolveAuthedDestination("owner", "/en/owner/leads", "en")).toBe("/en/owner/leads");
  });

  it("ignores a `from` the role cannot access, falling back to the role home", () => {
    expect(resolveAuthedDestination("owner", "/en/admin", "en")).toBe("/en/owner/dashboard");
    expect(resolveAuthedDestination("tenant", "/en/admin", "en")).toBe("/en");
  });

  it("keeps an admin on their allowed `from`", () => {
    expect(resolveAuthedDestination("admin", "/en/admin", "en")).toBe("/en/admin");
  });

  it("lets a would-be owner reach the pg-operator become gate", () => {
    expect(resolveAuthedDestination("tenant", "/en/pg-operator/become", "en")).toBe(
      "/en/pg-operator/become"
    );
  });

  it("uses `from` when the role is not yet known", () => {
    expect(resolveAuthedDestination(undefined, "/en/search", "en")).toBe("/en/search");
  });

  it("falls back to the locale home when there is no role and no `from`", () => {
    expect(resolveAuthedDestination(undefined, null, "en")).toBe("/en");
  });
});
