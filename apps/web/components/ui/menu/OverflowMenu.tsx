"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./overflow-menu.module.css";

export type OverflowMenuItem = { label: string; onSelect: () => void; disabled?: boolean };

export function OverflowMenu({
  ariaLabel,
  items
}: {
  ariaLabel: string;
  items: OverflowMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const firstEnabled = items.findIndex((item) => !item.disabled);
  const lastEnabled = items.length - 1 - [...items].reverse().findIndex((item) => !item.disabled);

  const close = (returnFocus = true) => {
    setOpen(false);
    setFocusIndex(null);
    if (returnFocus) triggerRef.current?.focus();
  };
  const positionMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 200) });
  }, []);
  const openAt = (index: number) => {
    if (index < 0) return;
    positionMenu();
    setOpen(true);
    setFocusIndex(index);
  };
  const moveFocus = (from: number, direction: 1 | -1) => {
    for (let offset = 1; offset <= items.length; offset += 1) {
      const index = (from + direction * offset + items.length) % items.length;
      if (!items[index].disabled) return setFocusIndex(index);
    }
  };
  const activate = (index: number) => {
    if (!items[index]?.disabled) {
      items[index].onSelect();
      close();
    }
  };

  useEffect(() => {
    if (focusIndex !== null) itemRefs.current[focusIndex]?.focus();
  }, [focusIndex, open]);
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (open && !rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        close(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const updatePosition = () => positionMenu();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, positionMenu]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(firstEnabled))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openAt(firstEnabled);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            openAt(lastEnabled);
          }
        }}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className={styles.menu}
            role="menu"
            style={{ position: "fixed", top: position.top, left: position.left }}
            onKeyDown={(event) => {
              const current = focusIndex ?? firstEnabled;
              if (event.key === "Tab") {
                event.preventDefault();
                moveFocus(current, event.shiftKey ? -1 : 1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(current, 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(current, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                setFocusIndex(firstEnabled);
              } else if (event.key === "End") {
                event.preventDefault();
                setFocusIndex(lastEnabled);
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate(current);
              }
            }}
          >
            {items.map((item, index) => (
              <button
                key={item.label}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                className={styles.item}
                disabled={item.disabled}
                onClick={() => activate(index)}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
