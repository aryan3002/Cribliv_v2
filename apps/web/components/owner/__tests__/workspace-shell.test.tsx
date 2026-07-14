import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let pathname = "/en/owner/dashboard";
let searchParams = new URLSearchParams();
let sessionState: { status: string; data: { user?: { name?: string; phone?: string } } | null } = {
  status: "authenticated",
  data: { user: { name: "Asha Owner", phone: "+919999999901" } }
};

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => searchParams
}));

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={typeof href === "string" ? href : href?.pathname} {...props}>
      {children}
    </a>
  )
}));

import { OwnerWorkspaceShell } from "../workspace-shell";

const expectedHrefs = [
  "/en/owner/dashboard",
  "/en/owner/listings",
  "/en/owner/listings/new",
  "/en/owner/leads",
  "/en/owner/verification"
];

const ownerWorkspaceCss = readFileSync(
  resolve(process.cwd(), "components/owner/owner-workspace.css"),
  "utf8"
);

function renderShell(children = <section>Owner page body</section>) {
  return render(<OwnerWorkspaceShell locale="en">{children}</OwnerWorkspaceShell>);
}

function navHrefs(navName: RegExp) {
  return within(screen.getByRole("navigation", { name: navName }))
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

function cssBlocks(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(ownerWorkspaceCss.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))).map(
    (match) => match[1]
  );
}

function maxPxValue(selector: string, property: string) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Math.max(
    0,
    ...cssBlocks(selector).map((block) =>
      Number(block.match(new RegExp(`${escaped}\\s*:\\s*(\\d+)px`))?.[1] ?? 0)
    )
  );
}

describe("OwnerWorkspaceShell", () => {
  beforeEach(() => {
    pathname = "/en/owner/dashboard";
    searchParams = new URLSearchParams();
    sessionState = {
      status: "authenticated",
      data: { user: { name: "Asha Owner", phone: "+919999999901" } }
    };
  });

  it("renders owner navigation with overview, listings, add, leads and verify links", () => {
    renderShell();

    expect(navHrefs(/owner workspace/i)).toEqual(expectedHrefs);
    expect(navHrefs(/owner mobile/i)).toEqual(expectedHrefs);
  });

  it("marks the current owner destination with aria-current=page", () => {
    pathname = "/en/owner/listings";
    renderShell();

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(2);
    expect(current.map((link) => link.getAttribute("href"))).toEqual([
      "/en/owner/listings",
      "/en/owner/listings"
    ]);
  });

  it("hides the mobile bottom navigation on /owner/listings/new", () => {
    pathname = "/en/owner/listings/new";
    renderShell();

    expect(screen.queryByRole("navigation", { name: /owner mobile/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("owner-workspace-shell")).toHaveAttribute("data-focus-flow", "true");
  });

  it("keeps the owner shell content inside main#main-content", () => {
    renderShell(<section data-testid="owner-child">Owner page body</section>);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(within(main).getByTestId("owner-child")).toBeInTheDocument();
  });

  it("keeps mobile header touch targets at least 44 by 44 CSS pixels", () => {
    expect(maxPxValue(".ows__mobile-title", "min-height")).toBeGreaterThanOrEqual(44);
    expect(maxPxValue(".ows__mobile-account", "width")).toBeGreaterThanOrEqual(44);
    expect(maxPxValue(".ows__mobile-account", "height")).toBeGreaterThanOrEqual(44);
  });

  it("shows the current screen title in the mobile header", () => {
    pathname = "/en/owner/leads";
    const { container } = renderShell();

    const mobileTitle = container.querySelector(".ows__mobile-title");
    expect(mobileTitle).toHaveAttribute("href", "/en/owner/dashboard");
    expect(mobileTitle).toHaveTextContent("Leads");
  });

  it("preserves the current owner route when switching language", () => {
    pathname = "/en/owner/verification";
    searchParams = new URLSearchParams("listing=listing-1");
    renderShell();

    expect(screen.getByRole("link", { name: /switch to hindi/i })).toHaveAttribute(
      "href",
      "/hi/owner/verification?listing=listing-1"
    );
  });
});
