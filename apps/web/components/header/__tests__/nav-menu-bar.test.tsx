import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, within } from "@testing-library/react";
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

// ── Custom panel bodies (Cribliv Times) ─────────────────────────────────────
// renderPanel is the escape hatch a panel with non-static content (Times'
// hover-loaded posts) uses instead of NavPanelView. It receives the same
// id/labelledBy identity NavPanelView takes as props, and — like
// NavPanelView — is responsible for putting id/role="group"/aria-labelledby
// on its OWN root rather than leaving a wrapper to carry them (a wrapper
// with no CSS class of its own has no layout box that would size to an
// absolutely positioned child — see the long comment on
// NavMenuItem.renderPanel for the bug this contract replaced). These pin
// that: the real ARIA-labelled node is whatever renderPanel returns, nested
// in the exact same hover-intent wrapper Rent/PG use — not a parallel,
// divergent one.

describe("NavMenuBar — custom renderPanel", () => {
  const customItems: NavMenuItem[] = [
    {
      id: "times",
      label: "Times",
      panel: { id: "times", columns: [] },
      renderPanel: ({ id, labelledBy, close }) => (
        <div id={id} role="group" aria-labelledby={labelledBy}>
          <button type="button" onClick={close}>
            Custom panel body
          </button>
        </div>
      )
    },
    { id: "map", label: "Map", panel: null, href: "/en/map" }
  ];

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders the custom body in place of NavPanelView, with the same aria-controls pairing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<NavMenuBar items={customItems} />);

    const trigger = screen.getByRole("button", { name: "Times" });
    await user.click(trigger);

    const group = screen.getByRole("group");
    expect(within(group).getByText("Custom panel body")).toBeInTheDocument();
    expect(group).toHaveAttribute("aria-labelledby", trigger.id);
    expect(trigger).toHaveAttribute("aria-controls", group.id);
  });

  it("closes the menu when the custom panel invokes the close callback it was given", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<NavMenuBar items={customItems} />);

    await user.click(screen.getByRole("button", { name: "Times" }));
    await user.click(screen.getByRole("button", { name: "Custom panel body" }));

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});
