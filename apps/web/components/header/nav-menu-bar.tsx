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
   * identically either way. Receives the same `close` NavPanelView is given
   * as onNavigate, so a custom panel can close the menu on link click exactly
   * like the built-in one does. Only ever invoked while `panel` is truthy —
   * see the guard below — so it is safe to build from data that assumes that.
   */
  renderPanel?: (close: () => void) => ReactNode;
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
        <div
          onMouseEnter={clearTimer}
          onMouseLeave={hoverClose}
          // NavPanelView's own root is the actual role="group" element the
          // trigger's aria-controls points at (id passed through below), so
          // this wrapper stays id-less in that case. A custom renderPanel has
          // no root of its own to carry that pairing, so it moves up to this
          // wrapper instead — same id, same aria-labelledby, same trigger.
          {...(openItem.renderPanel
            ? {
                id: `nav-panel-${openItem.id}`,
                role: "group" as const,
                "aria-labelledby": `nav-trigger-${openItem.id}`
              }
            : {})}
        >
          {openItem.renderPanel ? (
            openItem.renderPanel(close)
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
