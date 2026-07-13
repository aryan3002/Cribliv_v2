import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

let pathname = "/en/owner/dashboard";
let sessionState: { status: string; data: { user?: { name?: string; phone?: string } } | null } = {
  status: "authenticated",
  data: { user: { name: "Asha Owner", phone: "+919999999901" } }
};

vi.mock("next/navigation", () => ({
  usePathname: () => pathname
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

function renderShell(children = <section>Owner page body</section>) {
  return render(<OwnerWorkspaceShell locale="en">{children}</OwnerWorkspaceShell>);
}

function navHrefs(navName: RegExp) {
  return within(screen.getByRole("navigation", { name: navName }))
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

describe("OwnerWorkspaceShell", () => {
  beforeEach(() => {
    pathname = "/en/owner/dashboard";
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
});
