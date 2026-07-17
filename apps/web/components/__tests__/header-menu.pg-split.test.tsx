import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Stub next-auth/react: useSession returns whatever the current test set on
// `__sessionState`. signOut is a no-op so the menu component can import it.
let __sessionState: {
  status: "authenticated" | "unauthenticated" | "loading";
  data: unknown;
} = { status: "unauthenticated", data: null };
let __pathname = "/en";

vi.mock("next-auth/react", () => ({
  useSession: () => __sessionState,
  signOut: vi.fn()
}));

// Stub next/navigation usePathname — the component only reads pathname to close
// the menu on route change; a stable string is enough.
vi.mock("next/navigation", () => ({
  usePathname: () => __pathname
}));

// Polyfill window.matchMedia for jsdom — the header menu uses it to decide
// whether to portal the popover to <body> on mobile.
beforeEach(() => {
  __pathname = "/en";
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
import { SessionBanner } from "../session-banner";

function setSession(role: "owner" | "pg_operator" | "tenant" | "admin" | null) {
  if (role === null) {
    __sessionState = { status: "unauthenticated", data: null };
  } else {
    __sessionState = {
      status: "authenticated",
      data: { user: { role, phone: "+919999988888", name: "Test" } }
    };
  }
}

// Helper: open the header menu so its items become rendered.
function openMenu() {
  const trigger = screen.getByRole("button", { name: /open menu/i });
  fireEvent.click(trigger);
}

// Helper: collect href attributes of all rendered <a> tags in document.body
// (the menu may be portaled outside the test container).
function allHrefs(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
    (a) => a.getAttribute("href") || ""
  );
}

// ── HeaderMenu role split ────────────────────────────────────────────────────

describe("HeaderMenu role split", () => {
  it.each(["tenant", "owner", "pg_operator", "admin"] as const)(
    "uses the %s avatar in the trigger and menu header",
    (role) => {
      setSession(role);
      render(<HeaderMenu locale="en" />);

      expect(document.querySelectorAll(`[data-role-avatar="${role}"]`)).toHaveLength(1);

      openMenu();

      expect(document.querySelectorAll(`[data-role-avatar="${role}"]`)).toHaveLength(2);
      expect(screen.queryByText("8")).not.toBeInTheDocument();
    }
  );

  it("keeps the existing generic icon for logged-out users", () => {
    setSession(null);
    render(<HeaderMenu locale="en" />);

    expect(document.querySelector("[data-role-avatar]")).toBeNull();
  });

  it("pg_operator sees PG dashboard link, not owner dashboard", () => {
    setSession("pg_operator");
    render(<HeaderMenu locale="en" />);
    openMenu();

    const hrefs = allHrefs();
    expect(hrefs).toContain("/en/pg-operator/dashboard");
    expect(hrefs).toContain("/en/pg-operator/listings/new");
    expect(hrefs).not.toContain("/en/owner/dashboard");
  });

  it("pg_operator on PG routes sees mobile links for PG dashboard sections", () => {
    __pathname = "/en/pg-operator/dashboard";
    setSession("pg_operator");
    render(<HeaderMenu locale="en" />);
    openMenu();

    const hrefs = allHrefs();
    expect(hrefs).toContain("/en/pg-operator/dashboard#overview-section");
    expect(hrefs).toContain("/en/pg-operator/dashboard#analytics-section");
    expect(hrefs).toContain("/en/pg-operator/dashboard#listings-section");
    expect(hrefs).toContain("/en/pg-operator/dashboard#leads-section");
  });

  it("owner sees owner dashboard link, not PG dashboard", () => {
    setSession("owner");
    render(<HeaderMenu locale="en" />);
    openMenu();

    const hrefs = allHrefs();
    expect(hrefs).toContain("/en/owner/dashboard");
    expect(hrefs).not.toContain("/en/pg-operator/dashboard");
    expect(hrefs).not.toContain("/en/pg-operator/listings/new");
  });

  it("tenant sees their PG residence link, not operator or owner dashboard links", () => {
    setSession("tenant");
    render(<HeaderMenu locale="en" />);
    openMenu();

    const hrefs = allHrefs();
    expect(hrefs).toContain("/en/tenant/pg-residence");
    expect(hrefs).not.toContain("/en/owner/dashboard");
    expect(hrefs).not.toContain("/en/pg-operator/dashboard");
    expect(hrefs).not.toContain("/en/pg-operator/listings/new");
  });

  it("non-tenant account menus do not show the PG residence link", () => {
    for (const role of ["owner", "pg_operator", "admin"] as const) {
      document.body.innerHTML = "";
      setSession(role);
      render(<HeaderMenu locale="en" />);
      openMenu();

      expect(allHrefs()).not.toContain("/en/tenant/pg-residence");
    }
  });

  it("admin sees admin link, not PG or owner dashboard", () => {
    setSession("admin");
    render(<HeaderMenu locale="en" />);
    openMenu();

    const hrefs = allHrefs();
    expect(hrefs).toContain("/en/admin");
    expect(hrefs).not.toContain("/en/owner/dashboard");
    expect(hrefs).not.toContain("/en/pg-operator/dashboard");
  });
});

// ── SessionBanner role split ─────────────────────────────────────────────────

describe("SessionBanner role split", () => {
  it("owner CTA points at /owner/dashboard", () => {
    setSession("owner");
    const { container } = render(<SessionBanner locale="en" />);
    const hrefs = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
      (a) => a.getAttribute("href") || ""
    );

    expect(hrefs).toContain("/en/owner/dashboard");
    expect(hrefs).toContain("/en/owner/listings/new");
    expect(hrefs).not.toContain("/en/pg-operator/dashboard");
    expect(hrefs).not.toContain("/en/pg-operator/listings/new");
  });

  it("pg_operator CTA points at /pg-operator/dashboard", () => {
    setSession("pg_operator");
    const { container } = render(<SessionBanner locale="en" />);
    const hrefs = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
      (a) => a.getAttribute("href") || ""
    );

    expect(hrefs).toContain("/en/pg-operator/dashboard");
    expect(hrefs).toContain("/en/pg-operator/listings/new");
    expect(hrefs).not.toContain("/en/owner/dashboard");
    expect(hrefs).not.toContain("/en/owner/listings/new");
  });

  it("pg_operator still gets the PG Operator badge label (display-only branch is shared)", () => {
    setSession("pg_operator");
    const { container } = render(<SessionBanner locale="en" />);
    // The role badge is rendered as a <span class="badge ...">
    expect(within(container).getByText("PG Operator")).toBeInTheDocument();
  });
});
