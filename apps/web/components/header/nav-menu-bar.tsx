"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { NavPanel } from "../../lib/nav/types";
import { NavPanelView } from "./nav-panel";

export interface NavMenuItem {
  id: string;
  label: string;
  panel: NavPanel | null;
  href?: string;
  className?: string;
  active?: boolean;
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
        // This wrapper carries no id of its own — NavPanelView's root is the
        // actual role="group" element, so the id triggers' aria-controls must
        // match lives there (passed through below), not on this plain div.
        <div onMouseEnter={clearTimer} onMouseLeave={hoverClose}>
          <NavPanelView
            id={`nav-panel-${openItem.id}`}
            panel={openItem.panel}
            labelledBy={`nav-trigger-${openItem.id}`}
            onNavigate={close}
          />
        </div>
      )}
    </div>
  );
}
