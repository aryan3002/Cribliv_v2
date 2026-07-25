import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavMenuBar, type NavMenuItem } from "../nav-menu-bar";
import { buildRentPanel, buildPgPanel } from "../../../lib/nav/nav-model";

const items: NavMenuItem[] = [
  { id: "rent", label: "Rent", panel: buildRentPanel("en", "lucknow") },
  { id: "pg", label: "PG", panel: buildPgPanel("en", "lucknow") },
  { id: "map", label: "CriblMap", panel: null, href: "/en/map" }
];

function setup() {
  return {
    user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }),
    ...render(<NavMenuBar items={items} />)
  };
}

describe("NavMenuBar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders a button per panel item and a link for panel-less items", () => {
    render(<NavMenuBar items={items} />);
    expect(screen.getByRole("button", { name: /rent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pg/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /criblmap/i })).toHaveAttribute("href", "/en/map");
  });

  it("starts with every panel closed and aria-expanded false", () => {
    render(<NavMenuBar items={items} />);
    expect(screen.getByRole("button", { name: /rent/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("does not open on a hover shorter than the intent delay", async () => {
    const { user } = setup();
    await user.hover(screen.getByRole("button", { name: /rent/i }));
    // Advancing fake timers directly (not through userEvent) fires the
    // component's setTimeout callback outside of any act() batching React
    // already knows about, so the update must be wrapped explicitly here.
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("opens after the intent delay", async () => {
    const { user } = setup();
    await user.hover(screen.getByRole("button", { name: /rent/i }));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    await waitFor(() => expect(screen.getByRole("group")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /rent/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens immediately on click, without waiting for hover intent", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("click toggles closed again", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("swaps panels instantly when moving to another trigger while open", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    await user.hover(screen.getByRole("button", { name: /^pg/i }));
    expect(screen.getByRole("button", { name: /^pg/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /rent/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("moves focus between triggers with arrow keys", async () => {
    const { user } = setup();
    const rent = screen.getByRole("button", { name: /rent/i });
    rent.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: /^pg/i })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(rent).toHaveFocus();
  });

  it("wraps arrow navigation at both ends", async () => {
    const { user } = setup();
    screen.getByRole("button", { name: /rent/i }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("link", { name: /criblmap/i })).toHaveFocus();
  });

  it("links the panel to its trigger for assistive tech", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    expect(screen.getByRole("group")).toHaveAttribute("aria-labelledby", trigger.id);
    expect(trigger).toHaveAttribute("aria-controls", screen.getByRole("group").id);
  });

  it("closes when a panel link is followed", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    await user.click(screen.getAllByRole("link", { name: /BHK|Flats/i })[0]);
    await waitFor(() => expect(screen.queryByRole("group")).not.toBeInTheDocument());
  });
});
