"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
        setOpenId(id);
        return;
      }
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

  const openItem = items.find((i) => i.id === openId) ?? null;

  return (
    <div className="nav-center" ref={rootRef} onMouseLeave={hoverClose} onMouseEnter={clearTimer}>
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
          <button
            key={item.id}
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
        );
      })}

      {openItem?.panel && (
        // Plain wrapper: only the hover-intent mouse handlers live here. The
        // id/role="group"/aria-labelledby triple lives on the panel's own
        // root in both branches below — NavPanelView's root for the built-in
        // path, whatever renderPanel returns for the escape hatch — so the
        // ARIA-labelled node is always the same node CSS positions as
        // `.nav-panel`. See the renderPanel doc comment above for why that
        // matters.
        <div onMouseEnter={clearTimer} onMouseLeave={hoverClose}>
          {openItem.renderPanel ? (
            openItem.renderPanel({
              id: `nav-panel-${openItem.id}`,
              labelledBy: `nav-trigger-${openItem.id}`,
              close
            })
          ) : (
            <NavPanelView
              id={`nav-panel-${openItem.id}`}
              panel={openItem.panel}
              labelledBy={`nav-trigger-${openItem.id}`}
              onNavigate={close}
            />
          )}
        </div>
      )}
    </div>
  );
}
