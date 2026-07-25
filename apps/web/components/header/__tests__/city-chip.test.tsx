import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CityChip } from "../city-chip";
// Value-importing nav-model.ts is fine HERE: this is a test file, it never
// ships to a browser bundle. The component under test must not do this
// itself — see the bundle-size note in city-chip.tsx.
import { cityChipLinks } from "../../../lib/nav/nav-model";

let pathname = "/en";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname
}));

const links = cityChipLinks("en");

describe("CityChip", () => {
  beforeEach(() => {
    pathname = "/en";
  });

  it("renders the default city (Lucknow) when the path has no city segment", () => {
    render(<CityChip locale="en" links={links} hidden={false} />);
    expect(screen.getByRole("button", { name: /lucknow/i })).toBeInTheDocument();
  });

  it("derives the city from /en/city/jaipur", () => {
    pathname = "/en/city/jaipur";
    render(<CityChip locale="en" links={links} hidden={false} />);
    expect(screen.getByRole("button", { name: /jaipur/i })).toBeInTheDocument();
  });

  it("derives the city from /en/pg/noida", () => {
    pathname = "/en/pg/noida";
    render(<CityChip locale="en" links={links} hidden={false} />);
    expect(screen.getByRole("button", { name: /noida/i })).toBeInTheDocument();
  });

  it("derives the city from /en/rent-in/delhi", () => {
    pathname = "/en/rent-in/delhi";
    render(<CityChip locale="en" links={links} hidden={false} />);
    expect(screen.getByRole("button", { name: /delhi/i })).toBeInTheDocument();
  });

  it("derives the city using the given locale rather than a hardcoded one", () => {
    pathname = "/hi/city/jaipur";
    render(<CityChip locale="hi" links={links} hidden={false} />);
    expect(screen.getByRole("button", { name: /jaipur/i })).toBeInTheDocument();
  });

  it("opens on click and lists exactly 8 cities, each linking to /{locale}/city/{slug}, with Varanasi absent", async () => {
    const user = userEvent.setup();
    render(<CityChip locale="en" links={links} hidden={false} />);

    await user.click(screen.getByRole("button", { name: /lucknow/i }));

    const popoverLinks = screen.getAllByRole("link");
    expect(popoverLinks).toHaveLength(8);

    for (const link of links) {
      expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
    }
    for (const rendered of popoverLinks) {
      expect(rendered.getAttribute("href")).toMatch(/^\/en\/city\/[a-z-]+$/);
    }
    expect(screen.queryByText(/varanasi/i)).not.toBeInTheDocument();
  });

  it("closes when a city link is clicked", async () => {
    const user = userEvent.setup();
    render(<CityChip locale="en" links={links} hidden={false} />);
    await user.click(screen.getByRole("button", { name: /lucknow/i }));
    await user.click(screen.getAllByRole("link")[0]);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<CityChip locale="en" links={links} hidden={false} />);
    const trigger = screen.getByRole("button", { name: /lucknow/i });

    await user.click(trigger);
    expect(screen.getByRole("group")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on outside pointerdown", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <CityChip locale="en" links={links} hidden={false} />
        <button type="button">Outside</button>
      </div>
    );

    await user.click(screen.getByRole("button", { name: /lucknow/i }));
    expect(screen.getByRole("group")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("renders nothing when hidden is true", () => {
    const { container } = render(<CityChip locale="en" links={links} hidden={true} />);
    expect(container).toBeEmptyDOMElement();
  });
});
