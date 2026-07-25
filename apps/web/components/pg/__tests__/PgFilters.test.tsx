import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { PgFilters } from "../PgFilters";

beforeEach(() => push.mockClear());

describe("PgFilters", () => {
  it("pushes the gender filter into the /pg URL", () => {
    render(<PgFilters locale="en" filters={{ city: "lucknow" }} />);
    fireEvent.click(screen.getByRole("button", { name: /girls/i }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/en/pg?"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("gender_policy=girls"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("city=lucknow"));
  });

  it("toggles an active filter off when clicked again", () => {
    render(<PgFilters locale="en" filters={{ gender_policy: "girls" }} />);
    fireEvent.click(screen.getByRole("button", { name: /girls/i }));
    const url = push.mock.calls[0][0] as string;
    expect(url).not.toContain("gender_policy");
  });

  it("pushes both rent bounds for a bounded budget band", () => {
    render(<PgFilters locale="en" filters={{ city: "lucknow" }} />);
    fireEvent.click(screen.getByRole("button", { name: "₹5–10k" }));
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("min_rent=5000");
    expect(url).toContain("max_rent=10000");
    expect(url).toContain("city=lucknow");
  });

  it("pushes only the bound an open-ended band defines", () => {
    render(<PgFilters locale="en" filters={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Under ₹5k" }));
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("max_rent=5000");
    expect(url).not.toContain("min_rent");
  });

  it("clears both bounds when the active band is clicked again", () => {
    render(<PgFilters locale="en" filters={{ min_rent: "5000", max_rent: "10000" }} />);
    const band = screen.getByRole("button", { name: "₹5–10k" });
    expect(band).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(band);
    const url = push.mock.calls[0][0] as string;
    expect(url).not.toContain("min_rent");
    expect(url).not.toContain("max_rent");
  });

  it("marks no band active for a partial range that matches none exactly", () => {
    render(<PgFilters locale="en" filters={{ max_rent: "10000" }} />);
    for (const label of ["Under ₹5k", "₹5–10k", "₹10–15k", "₹15k+"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
  });
});
