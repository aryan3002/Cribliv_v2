import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Test doubles ─────────────────────────────────────────────────────────────

let pathname = "/en";
let searchParams = new URLSearchParams();
let sessionState: { status: string; data: { user?: { role?: string } } | null } = {
  status: "unauthenticated",
  data: null
};
// Drives the mocked matchMedia below. The composed header must not mount a
// panel under 900px, so the tests flip this rather than resizing jsdom.
let desktopViewport = true;

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams
}));

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState
}));

// forwardRef, not a plain function: NavMenuBar hands its panel-less items a
// ref, and a non-forwarding stub would log a React warning on every render.
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  return {
    default: forwardRef<HTMLAnchorElement, Record<string, unknown>>(function MockLink(
      { href, children, prefetch: _prefetch, ...props },
      ref
    ) {
      return createElement(
        "a",
        {
          ...props,
          ref,
          href: typeof href === "string" ? href : (href as { pathname?: string })?.pathname
        },
        children as never
      );
    })
  };
});

vi.mock("../../header-menu", () => ({
  HeaderMenu: () => <button type="button">Open menu</button>
}));

vi.mock("../../brand/brand-lockup", () => ({
  BrandLockup: () => <span>Cribliv</span>
}));

import { Header, DESKTOP_MEDIA_QUERY } from "../header";
// Value-importing the server-side model is fine HERE: a test never ships to a
// browser bundle. The header itself must only ever receive this as a prop —
// see the bundle-size note at the top of header.tsx.
import { buildNavData } from "../../../lib/nav/nav-data";

const navData = buildNavData("en");

function setSession(role?: string) {
  sessionState = role
    ? { status: "authenticated", data: { user: { role } } }
    : { status: "unauthenticated", data: null };
}

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
}

/** Scroll past the header's 8px threshold and let its listener react. */
function scrollDown() {
  setScrollY(64);
  fireEvent.scroll(window);
}

beforeEach(() => {
  pathname = "/en";
  searchParams = new URLSearchParams();
  desktopViewport = true;
  setSession(undefined);
  setScrollY(0);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query === DESKTOP_MEDIA_QUERY ? desktopViewport : !desktopViewport,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
});

// ── The centre nav ───────────────────────────────────────────────────────────

describe("Header composition — centre nav", () => {
  it("renders all five centre items on desktop", () => {
    render(<Header locale="en" navData={navData} />);
    const primary = screen.getByRole("navigation", { name: /primary/i });

    expect(within(primary).getByRole("button", { name: "Rent" })).toBeInTheDocument();
    expect(within(primary).getByRole("button", { name: "PG & Co-living" })).toBeInTheDocument();
    expect(within(primary).getByRole("button", { name: "For owners" })).toBeInTheDocument();
    expect(within(primary).getByRole("link", { name: /criblmap/i })).toHaveAttribute(
      "href",
      "/en/map"
    );
    expect(within(primary).getByRole("link", { name: /cribliv times/i })).toHaveAttribute(
      "href",
      "/en/blog"
    );
  });

  it("opens the Rent panel with a real Lucknow locality link", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" navData={navData} />);

    await user.click(screen.getByRole("button", { name: "Rent" }));

    const panel = screen.getByRole("group");
    const localities = navData.rent.columns.find((c) => c.title === "Popular localities");
    expect(localities?.links.length).toBeGreaterThan(0);
    const first = localities!.links[0];
    // A real /city/lucknow/{locality} page, not a guessed slug.
    expect(first.href).toMatch(/^\/en\/city\/lucknow\/[a-z0-9-]+$/);
    expect(within(panel).getByRole("link", { name: first.label })).toHaveAttribute(
      "href",
      first.href
    );
  });

  it("keeps the CriblMap and Times chips panel-less in this slice", () => {
    render(<Header locale="en" navData={navData} />);

    // A panel-less item renders as a plain link, never a nav-trigger button —
    // there is no disclosure for a panel to hang off.
    for (const name of [/criblmap/i, /cribliv times/i]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-expanded");
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("does not mount any panel below 900px", () => {
    desktopViewport = false;
    render(<Header locale="en" navData={navData} />);

    // With no panel every trigger degrades to a plain link to its section's
    // landing page, so there is nothing that could open one.
    expect(screen.getByRole("link", { name: "Rent" })).toHaveAttribute("href", "/en/search");
    expect(screen.getByRole("link", { name: "PG & Co-living" })).toHaveAttribute("href", "/en/pg");
    expect(screen.getByRole("link", { name: "For owners" })).toHaveAttribute(
      "href",
      "/en/become-owner"
    );
    expect(screen.queryByRole("button", { name: "Rent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});

// ── Scroll-driven left cluster ───────────────────────────────────────────────

describe("Header composition — city chip, search pill, language pill", () => {
  it("shows the city chip and language pill, and no search pill, at rest on the homepage", () => {
    render(<Header locale="en" navData={navData} />);

    expect(screen.getByRole("button", { name: /lucknow/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /switch to hindi/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /search rentals/i })).not.toBeInTheDocument();
  });

  it("swaps the city chip and language pill for the search pill once scrolled", () => {
    render(<Header locale="en" navData={navData} />);
    scrollDown();

    expect(screen.queryByRole("button", { name: /lucknow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /switch to hindi/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /search rentals/i })).toHaveAttribute(
      "href",
      "/en/search"
    );
  });

  it("shows the search pill on an inner page regardless of scroll", () => {
    pathname = "/en/search";
    searchParams = new URLSearchParams({ bhk: "2", locality: "gomti-nagar" });
    render(<Header locale="en" navData={navData} />);

    expect(screen.getByRole("link", { name: /2 BHK in Gomti Nagar/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lucknow/i })).not.toBeInTheDocument();
  });

  it("lists the hub cities in the city-chip popover", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" navData={navData} />);

    await user.click(screen.getByRole("button", { name: /lucknow/i }));
    const popover = screen.getByRole("group");
    for (const city of navData.cities) {
      expect(within(popover).getByRole("link", { name: city.label })).toHaveAttribute(
        "href",
        city.href
      );
    }
  });

  it("renders the Saved heart in the right-hand cluster", () => {
    render(<Header locale="en" navData={navData} />);
    expect(screen.getByRole("link", { name: /saved/i })).toHaveAttribute("href", "/en/shortlist");
  });
});

// ── Preserved behaviour ──────────────────────────────────────────────────────

describe("Header composition — Post Property gating survives the move", () => {
  it.each([
    ["guest", undefined, /post property/i, "/en/become-owner"],
    ["tenant", "tenant", /post property/i, "/en/become-owner"],
    ["admin", "admin", /post property/i, "/en/become-owner"],
    ["owner", "owner", /post property/i, "/en/owner/dashboard"],
    ["pg_operator", "pg_operator", /new listing/i, "/en/pg-operator/listings/new"]
  ] as const)("sends a %s to %s", (_role, session, name, href) => {
    setSession(session);
    render(<Header locale="en" navData={navData} />);
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  });
});

describe("Header composition — PG operator routes", () => {
  it("replaces the whole public centre nav with the PG dashboard links", () => {
    pathname = "/en/pg-operator/dashboard";
    render(<Header locale="en" navData={navData} />);

    const primary = screen.getByRole("navigation", { name: /primary/i });
    expect(within(primary).getByRole("link", { name: /analytics/i })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#analytics-section"
    );
    expect(within(primary).queryByRole("button", { name: "Rent" })).not.toBeInTheDocument();
    // No city chip / search pill / saved heart on the operator workspace —
    // exactly the set the old header withheld there.
    expect(screen.queryByRole("button", { name: /lucknow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /saved/i })).not.toBeInTheDocument();
  });
});

describe("Header composition — navData is optional", () => {
  it("renders without navData instead of throwing, with no panels to open", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" />);

    expect(screen.getByRole("button", { name: "Rent" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rent" }));
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /post property/i })).toBeInTheDocument();
  });
});
