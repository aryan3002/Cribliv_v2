import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, within, fireEvent } from "@testing-library/react";
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

  // Regression (final review I-1b). Escape means "keep this shut": a pointer
  // still resting on the bar must not be able to re-arm hover-open on its own.
  // Before the latch, the trigger re-firing mouseenter -- which a one-pixel
  // hand tremor is enough to do -- scheduled a fresh OPEN_DELAY_MS timer and
  // the dismissed panel sprang back open.
  //
  // These drive raw `mouseout` with an explicit `relatedTarget` instead of
  // userEvent's pointer API, and both details are load-bearing rather than
  // stylistic:
  //
  //   * userEvent/jsdom leave `relatedTarget` null, and React reads it to
  //     decide how far up the tree to synthesise enter/leave. Null means "came
  //     from outside the document", so under userEvent EVERY move fires enter
  //     and leave on the whole ancestor chain, `.nav-center` included -- a
  //     move between two children of the bar becomes indistinguishable from
  //     leaving the page and coming back, which is the exact distinction this
  //     latch is built on.
  //   * The event to dispatch is `mouseout`, not `mouseover`. React's
  //     EnterLeaveEventPlugin emits BOTH the leave and the enter side from the
  //     `mouseout` (from=target, to=relatedTarget) and deliberately early-
  //     returns on `mouseover` whenever its relatedTarget is a React-managed
  //     node, precisely to avoid dispatching twice. A `mouseover`-driven
  //     simulation therefore fires nothing at all and passes no matter what
  //     the component does -- verified by deleting the guard in `hoverOpen`
  //     and watching the test stay green.
  //
  // A real browser sends mouseout-on-the-element-being-left for each of these.
  it("stays closed when the pointer re-enters the trigger after Escape", async () => {
    const { user, container } = setup();
    const navCenter = container.querySelector(".nav-center") as HTMLElement;
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();

    // The pointer never leaves the bar: it slips off the trigger into the gap
    // beside it and straight back, which is all a resting hand has to do.
    // relatedTarget stays inside `.nav-center` throughout, so the bar's own
    // mouseleave never fires and the latch must survive.
    fireEvent.mouseOut(trigger, { relatedTarget: navCenter });
    fireEvent.mouseOut(navCenter, { relatedTarget: trigger });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  // The latch must not be a one-way door: leaving the bar and coming back is
  // the user deliberately re-initiating hover, and that has to work again.
  it("re-arms hover once the pointer leaves and re-enters the bar", async () => {
    const { user, container } = setup();
    const navCenter = container.querySelector(".nav-center") as HTMLElement;
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    // Out of the bar altogether, then back in. The return leg is a `mouseover`
    // because its relatedTarget (document.body) is NOT React-managed, so the
    // early-return described above does not apply and React handles this one
    // itself. It also could not be a mouseout on body: body is an ancestor of
    // React's root container, so an event dispatched there never reaches the
    // delegated listener at all.
    fireEvent.mouseOut(trigger, { relatedTarget: document.body });
    fireEvent.mouseOver(trigger, { relatedTarget: document.body });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await waitFor(() => expect(screen.getByRole("group")).toBeInTheDocument());
  });

  // A keyboard user whose pointer is nowhere near the bar has no stray
  // mouseenter to guard against, so Escape must not latch at all -- otherwise
  // their first hover afterwards would be silently dead.
  it("does not latch when Escape is pressed with the pointer off the bar", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("group")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.hover(trigger);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    await waitFor(() => expect(screen.getByRole("group")).toBeInTheDocument());
  });

  // Clicking is always an explicit request, so it must bypass the latch even
  // while the latch is set.
  it("still opens on click after Escape", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await user.click(trigger);
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  // I-2: the panel is rendered immediately after its OWN trigger, so a
  // keyboard user Tabs from the expanded trigger straight into the panel.
  // It used to render after all five triggers, putting four unrelated
  // triggers (each reporting aria-expanded="false") in the way.
  it("renders the open panel immediately after its own trigger in DOM order", async () => {
    const { user } = setup();
    const rent = screen.getByRole("button", { name: /rent/i });
    await user.click(rent);
    const panel = screen.getByRole("group");

    expect(rent.nextElementSibling).toBe(panel.parentElement);
    // Every other trigger follows the panel, not precedes it.
    expect(panel.compareDocumentPosition(screen.getByRole("button", { name: /^pg/i }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    // And the same holds for a trigger further along the row. Hover, not
    // click: with a panel already open the pointer landing on PG swaps to it
    // instantly, and the click that followed would then toggle it shut again.
    const pg = screen.getByRole("button", { name: /^pg/i });
    await user.hover(pg);
    expect(pg.nextElementSibling).toBe(screen.getByRole("group").parentElement);
    expect(rent.compareDocumentPosition(screen.getByRole("group"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
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
