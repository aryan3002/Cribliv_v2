import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname = "/en/owner/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "authenticated", data: { user: { role: "owner" } } })
}));

vi.mock("../header", () => ({
  Header: () => <header data-testid="public-header">Public header</header>
}));

vi.mock("../footer", () => ({
  Footer: () => <footer data-testid="public-footer">Public footer</footer>
}));

import { LocaleChrome } from "../locale-chrome";

describe("LocaleChrome owner routes", () => {
  it("LocaleChrome omits the public header and footer for /owner routes", () => {
    render(
      <LocaleChrome locale="en">
        <section>Owner route content</section>
      </LocaleChrome>
    );

    expect(screen.queryByTestId("public-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-footer")).not.toBeInTheDocument();
    expect(screen.getByText("Owner route content")).toBeInTheDocument();
  });
});
