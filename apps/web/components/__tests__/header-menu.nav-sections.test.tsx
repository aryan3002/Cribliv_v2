import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null }),
  signOut: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/en"
}));

beforeEach(() => {
  if (typeof window !== "undefined" && !window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      })
    });
  }
});

import { HeaderMenu } from "../header-menu";
// Value-importing the server-side builder is fine HERE: a test never ships to
// a browser bundle. HeaderMenu itself must only ever receive this as a prop —
// see the bundle-size note in lib/nav/nav-data.ts.
import { buildNavData } from "../../lib/nav/nav-data";

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: /open menu/i }));
}

/**
 * The plumbing that gets the desktop mega-menu's panel data into the mobile
 * sheet: app/[locale]/layout.tsx builds NavData once and it must flow
 * Header -> HeaderMenu -> MobileNavSections. This pins the HeaderMenu leg of
 * that chain specifically.
 */
describe("HeaderMenu nav accordions (plumbing)", () => {
  it("renders the Rent/PG/Owners accordion triggers when navData is supplied", () => {
    render(<HeaderMenu locale="en" navData={buildNavData("en")} />);
    openMenu();

    expect(screen.getByRole("button", { name: "Rent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PG & Co-living" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "For owners" })).toBeInTheDocument();
  });

  it("renders no accordion triggers when navData is omitted, matching the pre-existing sheet", () => {
    render(<HeaderMenu locale="en" />);
    openMenu();

    expect(screen.queryByRole("button", { name: "Rent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "PG & Co-living" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "For owners" })).not.toBeInTheDocument();
  });
});
