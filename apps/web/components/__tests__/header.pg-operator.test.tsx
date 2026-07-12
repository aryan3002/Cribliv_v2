import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

let pathname = "/en";
// Header now reads the session to gate the "+" CTA by role (owner/pg-operator
// vs. everyone-else → become-owner). Default to a logged-out session; the CTA on
// pg-operator routes is driven by the pathname, so these assertions hold.
const sessionState: { status: string; data: unknown } = {
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

describe("Header PG operator route chrome", () => {
  beforeEach(() => {
    pathname = "/en";
  });

  it("replaces public center links with PG dashboard section links", () => {
    pathname = "/en/pg-operator/dashboard";
    render(<Header locale="en" />);

    const primary = screen.getByRole("navigation", { name: /primary/i });
    expect(within(primary).getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#overview-section"
    );
    expect(within(primary).getByRole("link", { name: /analytics/i })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#analytics-section"
    );
    expect(within(primary).getByRole("link", { name: /listings/i })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#listings-section"
    );
    expect(within(primary).getByRole("link", { name: /leads/i })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#leads-section"
    );
    expect(within(primary).queryByRole("link", { name: /search/i })).toBeNull();
  });

  it("uses New listing as the right-side CTA on PG operator routes", () => {
    pathname = "/en/pg-operator/listings/new";
    render(<Header locale="en" />);

    expect(screen.getByRole("link", { name: /new listing/i })).toHaveAttribute(
      "href",
      "/en/pg-operator/listings/new"
    );
    expect(screen.queryByRole("link", { name: /post property/i })).toBeNull();
  });
});
