"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  PgMaintenanceCategory,
  PgMaintenancePriority,
  PgMaintenanceQueueFilters,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import styles from "./MaintenanceQueue.module.css";

export type MaintenanceQueueFilterState = {
  status: PgMaintenanceStatus | "all" | "active";
  priority: PgMaintenancePriority | "";
  category_slug: string;
  sla_state: NonNullable<PgMaintenanceQueueFilters["sla_state"]> | "";
  tenant_query: string;
  sort: NonNullable<PgMaintenanceQueueFilters["sort"]>;
};

type Props = {
  categories: PgMaintenanceCategory[];
  value: MaintenanceQueueFilterState;
  onChange(next: MaintenanceQueueFilterState): void;
  onSheetOpenChange?(open: boolean): void;
};

export const DEFAULT_QUEUE_FILTERS: MaintenanceQueueFilterState = {
  status: "active",
  priority: "",
  category_slug: "",
  sla_state: "",
  tenant_query: "",
  sort: "sla_due"
};

export function toMaintenanceQueueFilters(
  value: MaintenanceQueueFilterState,
  view: "list" | "kanban",
  cursor?: string
): PgMaintenanceQueueFilters {
  const includeClosed =
    value.status === "all" || value.status === "closed" || value.status === "cancelled";
  return {
    ...(value.status !== "all" && value.status !== "active" ? { status: value.status } : {}),
    ...(includeClosed ? { include_closed: true } : {}),
    ...(value.priority ? { priority: value.priority } : {}),
    ...(value.category_slug ? { category_slug: value.category_slug } : {}),
    ...(value.sla_state ? { sla_state: value.sla_state } : {}),
    ...(value.tenant_query.trim() ? { tenant_query: value.tenant_query.trim() } : {}),
    sort: value.sort,
    view,
    limit: 25,
    ...(cursor ? { cursor } : {})
  };
}

export default function MaintenanceQueueFilters({
  categories,
  value,
  onChange,
  onSheetOpenChange
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const activeCount = useMemo(
    () =>
      Object.entries(value).filter(
        ([key, item]) => item !== DEFAULT_QUEUE_FILTERS[key as keyof MaintenanceQueueFilterState]
      ).length,
    [value]
  );
  function update<Key extends keyof MaintenanceQueueFilterState>(
    key: Key,
    nextValue: MaintenanceQueueFilterState[Key]
  ) {
    onChange({ ...value, [key]: nextValue });
  }
  function openSheet() {
    setOpen(true);
    onSheetOpenChange?.(true);
  }
  function closeSheet() {
    setOpen(false);
    onSheetOpenChange?.(false);
    triggerRef.current?.focus();
  }
  function handleSheetKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]"
      ) ?? []
    );
    if (focusable.length === 0) return;
    event.preventDefault();
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? current <= 0
        ? focusable.length - 1
        : current - 1
      : current === focusable.length - 1
        ? 0
        : current + 1;
    focusable[next].focus();
  }

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  return (
    <div className={styles.filterShell}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.filterTrigger}
        aria-expanded={open}
        aria-controls="maintenance-queue-filters"
        onClick={openSheet}
      >
        Filters{activeCount ? ` (${activeCount})` : ""}
      </button>
      {open ? (
        <button
          type="button"
          className={styles.sheetBackdrop}
          aria-label="Dismiss filter sheet"
          onClick={closeSheet}
        />
      ) : null}
      <div
        id="maintenance-queue-filters"
        ref={sheetRef}
        className={`${styles.filters} ${open ? styles.filtersOpen : ""}`}
        role={open ? "dialog" : undefined}
        aria-label={open ? "Filters" : undefined}
        aria-modal={open || undefined}
        onKeyDown={open ? handleSheetKeyDown : undefined}
      >
        <div className={styles.filterSheetHeader}>
          <span>Filters</span>
          <button
            ref={closeRef}
            type="button"
            className={styles.sheetClose}
            onClick={closeSheet}
            aria-label="Close filters"
          >
            Close
          </button>
        </div>
        <label className={styles.field}>
          <span>Status</span>
          <select
            aria-label="Status"
            value={value.status}
            onChange={(event) =>
              update("status", event.target.value as MaintenanceQueueFilterState["status"])
            }
          >
            <option value="active">Active work</option>
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="waiting_on_tenant">Waiting on tenant</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Priority</span>
          <select
            aria-label="Priority"
            value={value.priority}
            onChange={(event) =>
              update("priority", event.target.value as MaintenanceQueueFilterState["priority"])
            }
          >
            <option value="">All priorities</option>
            <option value="emergency">Emergency</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Category</span>
          <select
            aria-label="Category"
            value={value.category_slug}
            onChange={(event) => update("category_slug", event.target.value)}
          >
            <option value="">All categories</option>
            {categories
              .filter((category) => category.active)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.display_name}
                </option>
              ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>SLA</span>
          <select
            aria-label="SLA"
            value={value.sla_state}
            onChange={(event) =>
              update("sla_state", event.target.value as MaintenanceQueueFilterState["sla_state"])
            }
          >
            <option value="">All SLA states</option>
            <option value="overdue">Overdue</option>
            <option value="due_today">Due today</option>
            <option value="on_track">On track</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Tenant</span>
          <input
            aria-label="Tenant"
            value={value.tenant_query}
            onChange={(event) => update("tenant_query", event.target.value)}
            placeholder="Name or phone"
          />
        </label>
        <label className={styles.field}>
          <span>Sort</span>
          <select
            aria-label="Sort"
            value={value.sort}
            onChange={(event) =>
              update("sort", event.target.value as MaintenanceQueueFilterState["sort"])
            }
          >
            <option value="sla_due">SLA due first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </div>
    </div>
  );
}
