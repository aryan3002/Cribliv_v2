"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { NavPanel } from "../../lib/nav/types";
import { NavPanelView } from "./nav-panel";

export interface NavMenuItem {
  id: string;
  // ReactNode, not string: the CriblMap and Cribliv Times chips need an icon
  // (and CriblMap a live-inventory dot) alongside their text. Both usages
  // below are pure rendering — nothing here keys, compares, or reads this as
  // a string — so widening it is safe. Icons in a custom label MUST be
  // aria-hidden, the same way the sibling nav-tab icons are: this is the only
  // thing standing between the accessible name and the text content.
  label: ReactNode;
  panel: NavPanel | null;
  href?: string;
  className?: string;
  active?: boolean;
  /**
   * Escape hatch for a panel body that is not static NavPanel data — Cribliv
   * Times' desks-plus-hover-loaded-posts panel is the first user. When
   * present it renders in place of NavPanelView, inside the exact same
   * hover-intent wrapper below, so outside-pointerdown/Escape close it
   * identically either way. Receives the same identity NavPanelView is given
   * directly as props — `id` and `labelledBy` — plus `close` (the same
   * callback NavPanelView is given as onNavigate).
   *
   * A custom panel MUST put `id`/`role="group"`/`aria-labelledby` on its OWN
   * root, the same way NavPanelView does (see nav-panel.tsx), rather than
   * leaving them for a wrapper here to carry. The wrapper below has no CSS
   * class of its own; if it held the ARIA identity while the real
   * `.nav-panel` (position: absolute) box was merely its child, the
   * wrapper's own layout box would collapse to 0x0 — an absolutely
   * positioned child contributes nothing to a `position: static` parent's
   * auto content size, even though the child still paints correctly on
   * screen via its own positioning. This is exactly the bug that shipped
   * here once (S3 Task 4 gate report) and was fixed by moving the identity
   * from the wrapper onto TimesPanel's own root.
   *
   * Only ever invoked while `panel` is truthy — see the guard below — so it
   * is safe to build from data that assumes that.
   */
  renderPanel?: (ctx: { id: string; labelledBy: string; close: () => void }) => ReactNode;
}

// Exported so the test can assert against the real constants instead of
// hard-coded numbers — see the brief's note on flaky timing tests.
export const OPEN_DELAY_MS = 120;
export const CLOSE_GRACE_MS = 200;

export function NavMenuBar({ items }: { items: NavMenuItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLElement>());

  /**
   * Escape means "I want this closed". Without a latch, a pointer that is
   * merely still resting on the bar can re-arm `hoverOpen` from a single
   * stray `mouseenter` — a one-pixel hand tremor is enough — and the panel
   * the user just dismissed springs back open OPEN_DELAY_MS later.
   *
   * Set on Escape, and only when the pointer is actually on the bar: with the
   * pointer elsewhere there is no stray `mouseenter` to guard against, and
   * latching anyway would leave hover dead for a keyboard user who never had
   * the pointer here in the first place.
   *
   * Released on `.nav-center`'s mouseleave — the pointer leaving the bar
   * entirely is the deliberate re-initiation that re-arms hover. Deliberately
   * NOT released on `.nav-center`'s mouseenter: entering a trigger from the
   * gap beside it does not fire that, so it would look like it works while
   * silently doing nothing in exactly the case that matters.
   *
   * The other close paths need no latch: outside-pointerdown leaves the
   * pointer off the bar anyway, and clicking a trigger re-opens through
   * `setOpenId` directly, which never consults this ref.
   */
  const hoverSuppressed = useRef(false);

  /**
   * Whether the pointer is currently within the bar (the panel counts: it is
   * a DOM descendant of `.nav-center`, so React does not fire the bar's
   * mouseleave while the pointer is over the panel body, even though the
   * panel paints outside the bar's own box).
   */
  const pointerInsideBar = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Belt-and-suspenders: also clear on unmount so a pending open/close never
  // fires setState after the component is gone.
  useEffect(() => clearTimer, [clearTimer]);

  // Hover open. If a panel is already open, switching triggers is instant —
  // the delay exists to stop a cursor crossing the bar from strobing panels,
  // and once one is open that ambiguity is gone.
  const hoverOpen = useCallback(
    (id: string) => {
      clearTimer();
      if (openId !== null) {
        // A panel is already on screen, so the user is clearly still using
        // the bar — swapping is always allowed, latch or no latch.
        setOpenId(id);
        return;
      }
      if (hoverSuppressed.current) return;
      timer.current = setTimeout(() => setOpenId(id), OPEN_DELAY_MS);
    },
    [openId, clearTimer]
  );

  // Grace period so a diagonal path from trigger into the panel body doesn't
  // dismiss it mid-move.
  const hoverClose = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setOpenId(null), CLOSE_GRACE_MS);
  }, [clearTimer]);

  const onBarEnter = useCallback(() => {
    pointerInsideBar.current = true;
    clearTimer();
  }, [clearTimer]);

  const onBarLeave = useCallback(() => {
    pointerInsideBar.current = false;
    hoverSuppressed.current = false;
    hoverClose();
  }, [hoverClose]);

  const close = useCallback(() => {
    clearTimer();
    setOpenId(null);
  }, [clearTimer]);

  useEffect(() => {
    if (openId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const id = openId;
      hoverSuppressed.current = pointerInsideBar.current;
      close();
      triggerRefs.current.get(id)?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openId, close]);

  const onTriggerKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next: number | null = null;
    if (delta !== 0) next = (index + delta + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    triggerRefs.current.get(items[next].id)?.focus();
  };

  return (
    <div className="nav-center" ref={rootRef} onMouseLeave={onBarLeave} onMouseEnter={onBarEnter}>
      {items.map((item, index) => {
        const triggerId = `nav-trigger-${item.id}`;
        const panelId = `nav-panel-${item.id}`;
        const isOpen = openId === item.id;
        const ref = (el: HTMLElement | null) => {
          if (el) triggerRefs.current.set(item.id, el);
          else triggerRefs.current.delete(item.id);
        };

        if (!item.panel) {
          return (
            <Link
              key={item.id}
              id={triggerId}
              ref={ref as React.Ref<HTMLAnchorElement>}
              href={(item.href ?? "/") as Route}
              className={item.className ?? "nav-tab"}
              onMouseEnter={hoverClose}
              onKeyDown={(e) => onTriggerKeyDown(e, index)}
            >
              {item.label}
            </Link>
          );
        }

        return (
          // The open panel is rendered immediately after ITS OWN trigger, not
          // once after the whole row. Tab from an expanded "Rent" must land in
          // the Rent panel; rendering the panel last put four unrelated
          // triggers (each reporting aria-expanded="false") in front of it.
          // `.nav-panel` is positioned against `.nav-row`, never against its
          // DOM parent, so this is a pure DOM-order change with no visual
          // effect — see the `.nav-panel-mount` rule in globals.css.
          <Fragment key={item.id}>
            <button
              id={triggerId}
              ref={ref as React.Ref<HTMLButtonElement>}
              type="button"
              className={`nav-trigger${isOpen ? " nav-trigger--open" : ""}`}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onMouseEnter={() => hoverOpen(item.id)}
              onClick={() => (isOpen ? close() : (clearTimer(), setOpenId(item.id)))}
              onKeyDown={(e) => onTriggerKeyDown(e, index)}
            >
              <span>{item.label}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>

            {isOpen && (
              // `.nav-panel-mount` is `display: contents` and carries only the
              // hover-intent mouse handlers. It must contribute no layout box:
              // as an ordinary flex item it consumed one `.nav-center` gap
              // (4px) purely by existing, which moved every trigger 2px the
              // moment a panel opened. The id/role="group"/aria-labelledby
              // triple lives on the panel's own root in both branches below —
              // NavPanelView's root for the built-in path, whatever
              // renderPanel returns for the escape hatch — so the
              // ARIA-labelled node is always the same node CSS positions as
              // `.nav-panel`. See the renderPanel doc comment above for why
              // that matters.
              <div className="nav-panel-mount" onMouseEnter={clearTimer} onMouseLeave={hoverClose}>
                {item.renderPanel ? (
                  item.renderPanel({ id: panelId, labelledBy: triggerId, close })
                ) : (
                  <NavPanelView
                    id={panelId}
                    panel={item.panel}
                    labelledBy={triggerId}
                    onNavigate={close}
                  />
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
