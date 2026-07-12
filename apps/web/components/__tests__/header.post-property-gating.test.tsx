import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Bug 6: the header "+" (Post Property) used to link every role to
// /owner/dashboard, which middleware then 403s for tenants/guests — a dead-end.
// The fix gates the target by role. These tests pin that behaviour.

let pathname = "/en";
let sessionState: { status: string; data: { user?: { role?: string } } | null } = {
  status: "unauthenticated",
  data: null
};

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={typeof href === "string" ? href : href?.pathname} {...props}>
      {children}
    </a>
  )
}));

vi.mock("../header-menu", () => ({
  HeaderMenu: () => <button type="button">Open menu</button>
}));

vi.mock("../brand/brand-lockup", () => ({
  BrandLockup: () => <span>Cribliv</span>
}));

import { Header } from "../header";

function setSession(role?: string) {
  sessionState = role
    ? { status: "authenticated", data: { user: { role } } }
    : { status: "unauthenticated", data: null };
}

describe("Header — Post Property (+) role gating", () => {
  beforeEach(() => {
    pathname = "/en";
    setSession(undefined);
  });

  it("routes a logged-out guest to the become-owner funnel, not the owner dashboard", () => {
    setSession(undefined);
    render(<Header locale="en" />);

    const cta = screen.getByRole("link", { name: /post property/i });
    expect(cta).toHaveAttribute("href", "/en/become-owner");
    // Never dead-ends the guest at an owner-only route.
    expect(screen.queryByRole("link", { name: /post property/i })).not.toHaveAttribute(
      "href",
      "/en/owner/dashboard"
    );
  });

  it("routes a tenant to the become-owner funnel instead of the 403 dead-end", () => {
    setSession("tenant");
    render(<Header locale="en" />);

    expect(screen.getByRole("link", { name: /post property/i })).toHaveAttribute(
      "href",
      "/en/become-owner"
    );
  });

  it("sends an owner straight to the owner dashboard", () => {
    setSession("owner");
    render(<Header locale="en" />);

    expect(screen.getByRole("link", { name: /post property/i })).toHaveAttribute(
      "href",
      "/en/owner/dashboard"
    );
  });

  it("gives a pg-operator the New listing CTA", () => {
    setSession("pg_operator");
    render(<Header locale="en" />);

    expect(screen.getByRole("link", { name: /new listing/i })).toHaveAttribute(
      "href",
      "/en/pg-operator/listings/new"
    );
    expect(screen.queryByRole("link", { name: /post property/i })).toBeNull();
  });
});
