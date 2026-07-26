import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileCitySection } from "../mobile-city-section";
// Value-importing nav-model.ts is fine HERE: this is a test file, it never
// ships to a browser bundle — same note as city-chip.test.tsx, which this
// suite otherwise mirrors closely (same component family, same pathname
// mocking pattern).
import { cityChipLinks } from "../../../lib/nav/nav-model";

let pathname = "/en";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname
}));

const cities = cityChipLinks("en");

function renderSection(onNavigate: () => void = vi.fn()) {
  return render(<MobileCitySection locale="en" cities={cities} onNavigate={onNavigate} />);
}

describe("MobileCitySection", () => {
  beforeEach(() => {
    pathname = "/en";
  });

  it("shows the default city (Lucknow) in the trigger when the path has no city segment", () => {
    renderSection();
    expect(screen.getByRole("button", { name: /lucknow/i })).toBeInTheDocument();
  });

  it("derives the city from /en/city/jaipur, matching city-chip's own derivation", () => {
    pathname = "/en/city/jaipur";
    renderSection();
    expect(screen.getByRole("button", { name: /jaipur/i })).toBeInTheDocument();
  });

  it("derives the city from /en/pg/noida", () => {
    pathname = "/en/pg/noida";
    renderSection();
    expect(screen.getByRole("button", { name: /noida/i })).toBeInTheDocument();
  });

  it("starts collapsed with no city list in the document", () => {
    renderSection();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("expands on click to reveal all 8 cities, each linking to the href it was given", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("link")).toHaveLength(8);
    for (const city of cities) {
      expect(screen.getByRole("link", { name: city.label })).toHaveAttribute("href", city.href);
    }
  });

  it("clicking the trigger again collapses the list", async () => {
    const user = userEvent.setup();
    renderSection();
    const trigger = screen.getByRole("button");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("is a labelled group for assistive tech, matching MobileNavSections' accordion pattern", async () => {
    const user = userEvent.setup();
    renderSection();
    const trigger = screen.getByRole("button");

    await user.click(trigger);

    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("aria-labelledby", trigger.id);
  });

  it("calls onNavigate when a city link is clicked, closing the whole sheet", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderSection(onNavigate);

    await user.click(screen.getByRole("button"));
    await user.click(screen.getAllByRole("link")[0]);

    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("renders nothing when cities is empty, matching MobileNavSections' empty-safe default", () => {
    const { container } = render(
      <MobileCitySection locale="en" cities={[]} onNavigate={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a localized trigger label in Hindi", () => {
    pathname = "/hi";
    render(<MobileCitySection locale="hi" cities={cityChipLinks("hi")} onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: /शहर बदलें/ })).toBeInTheDocument();
  });
});
