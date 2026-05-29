import { describe, it, expect } from "vitest";
import { listAPgHref } from "../listAPgHref";

describe("listAPgHref — role-aware 'List a PG' CTA target", () => {
  it.each([
    [null, "en", "/en/auth/login?from=/pg-operator/become"],
    [undefined, "en", "/en/auth/login?from=/pg-operator/become"],
    ["tenant", "en", "/en/pg-operator/become"],
    ["owner", "en", "/en/pg-operator/become"], // lands on blocker
    ["pg_operator", "en", "/en/pg-operator/listings/new"],
    ["admin", "en", "/en/pg-operator/become"]
  ])("role=%s locale=en → %s", (role, locale, expected) => {
    expect(listAPgHref(role as any, locale)).toBe(expected);
  });

  it.each([
    [null, "hi", "/hi/auth/login?from=/pg-operator/become"],
    ["tenant", "hi", "/hi/pg-operator/become"],
    ["pg_operator", "hi", "/hi/pg-operator/listings/new"]
  ])("role=%s locale=hi → %s", (role, locale, expected) => {
    expect(listAPgHref(role as any, locale)).toBe(expected);
  });
});
