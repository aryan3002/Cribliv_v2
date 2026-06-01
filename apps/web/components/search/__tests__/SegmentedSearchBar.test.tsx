import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { SegmentedSearchBar } from "../SegmentedSearchBar";

beforeEach(() => push.mockClear());

describe("SegmentedSearchBar", () => {
  it("marks the active segment as pressed", () => {
    render(<SegmentedSearchBar locale="en" segment="pg" params={{}} />);
    expect(screen.getByRole("button", { name: /^PG$/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /homes/i }).getAttribute("aria-pressed")).toBe(
      "false"
    );
  });

  it("submitting sets the city param (not q) and preserves the segment's other filters", () => {
    render(
      <SegmentedSearchBar
        locale="en"
        segment="pg"
        params={{ city: "lucknow", gender_policy: "girls" }}
      />
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Noida" } });
    fireEvent.submit(input.closest("form")!);
    const url = push.mock.calls[0][0] as string;
    expect(url.startsWith("/en/pg")).toBe(true);
    expect(url).toContain("city=noida");
    expect(url).toContain("gender_policy=girls");
    expect(url).not.toContain("q=");
  });

  it("toggling keeps the city constant and drops segment-specific filters", () => {
    render(
      <SegmentedSearchBar
        locale="en"
        segment="pg"
        params={{ city: "lucknow", gender_policy: "girls" }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /homes/i }));
    const url = push.mock.calls[0][0] as string;
    expect(url.startsWith("/en/search")).toBe(true);
    expect(url).toContain("city=lucknow");
    expect(url).not.toContain("gender_policy");
    expect(url).not.toContain("q=");
  });

  it("falls back to q for an unknown place (locality/keyword), not a bogus city", () => {
    render(<SegmentedSearchBar locale="en" segment="pg" params={{ city: "lucknow" }} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Gomti Nagar" } });
    fireEvent.submit(input.closest("form")!);
    const url = push.mock.calls[0][0] as string;
    expect(url.startsWith("/en/pg")).toBe(true);
    expect(url).toContain("q=Gomti+Nagar");
    expect(url).not.toContain("city=");
  });

  it("resolves typed text to a city slug when toggling segments", () => {
    render(<SegmentedSearchBar locale="en" segment="homes" params={{ city: "delhi" }} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Lucknow" } });
    fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
    const url = push.mock.calls[0][0] as string;
    expect(url.startsWith("/en/pg")).toBe(true);
    expect(url).toContain("city=lucknow");
    expect(url).not.toContain("q=");
  });
});
