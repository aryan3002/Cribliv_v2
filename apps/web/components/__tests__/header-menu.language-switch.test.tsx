import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Same doubles as header-menu.pg-split.test.tsx: HeaderMenu needs a session
// and a pathname just to render.
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

// Not `{ name: /open menu/i }`: the trigger's own aria-label is localized
// (menuOpen -> "मेनू खोलें" for hi), so an English-only name matcher would
// wrongly fail to find it when testing the Hindi locale. Before the sheet
// opens the trigger is the only button in the tree, so a bare role query is
// both correct and locale-agnostic.
function openMenu() {
  fireEvent.click(screen.getByRole("button"));
}

/**
 * header.tsx's top-bar language pill is hidden whenever `compact` is true —
 * which is every scrolled or inner page (/search, /city/*, /pg, all ~33k
 * programmatic SEO pages). The design intent (see globals.css's "language
 * switch moves into the hamburger menu" comment on .nav-host-link) was for
 * HeaderMenu to carry the switch there, but nothing ever did — grep found no
 * language item in this file. That left those pages with no way to switch
 * language at all. These tests pin its presence so it cannot disappear again
 * by omission.
 */
describe("HeaderMenu language switch", () => {
  it("offers a Hindi link, mirroring the top-bar pill's target and wording", () => {
    render(<HeaderMenu locale="en" />);
    openMenu();

    const link = screen.getByRole("link", { name: "Switch to Hindi" });
    expect(link).toHaveAttribute("href", "/hi");
    expect(link).toHaveTextContent("हिंदी");
  });

  it("offers an English link, mirroring the top-bar pill's target and wording", () => {
    render(<HeaderMenu locale="hi" />);
    openMenu();

    const link = screen.getByRole("link", { name: "Switch to English" });
    expect(link).toHaveAttribute("href", "/en");
    expect(link).toHaveTextContent("EN");
  });
});
