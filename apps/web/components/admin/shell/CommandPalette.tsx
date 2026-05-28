"use client";

import { useEffect } from "react";
import { Command } from "cmdk";
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Coins,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Users,
  Wrench
} from "lucide-react";
import type { AdminTab } from "./AdminSidebar";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (tab: AdminTab) => void;
  onRefresh: () => void;
}

const TAB_ITEMS: Array<{ id: AdminTab; label: string; icon: typeof Activity; group: string }> = [
  { id: "live", label: "Live Ops", icon: Activity, group: "Navigate" },
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Navigate" },
  { id: "listings", label: "Listing Review", icon: ClipboardList, group: "Navigate" },
  { id: "verifications", label: "Verifications", icon: ShieldCheck, group: "Navigate" },
  { id: "leads", label: "CRM", icon: Users, group: "Navigate" },
  { id: "users", label: "Users", icon: Users, group: "Navigate" },
  { id: "revenue", label: "Revenue", icon: Coins, group: "Navigate" },
  { id: "fraud", label: "Fraud Feed", icon: AlertTriangle, group: "Navigate" },
  { id: "system", label: "System", icon: Wrench, group: "Navigate" }
];

export function CommandPalette({ open, onOpenChange, onNavigate, onRefresh }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape" && open) onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  function pick(action: () => void) {
    action();
    onOpenChange(false);
  }

  return (
    <div className="admin-cmd-backdrop" onClick={() => onOpenChange(false)}>
      <div onClick={(e) => e.stopPropagation()}>
        <Command className="admin-cmd" label="Admin command palette">
          <Command.Input placeholder="Jump to a tab, find a user, run an action…" autoFocus />
          <Command.List>
            <Command.Empty>No results.</Command.Empty>
            <Command.Group heading="Navigate">
              {TAB_ITEMS.map((it) => {
                const Icon = it.icon;
                return (
                  <Command.Item
                    key={it.id}
                    value={`${it.label} ${it.id}`}
                    onSelect={() => pick(() => onNavigate(it.id))}
                  >
                    <Icon size={14} aria-hidden="true" />
                    Go to {it.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
            <Command.Group heading="Actions">
              <Command.Item value="refresh all" onSelect={() => pick(() => onRefresh())}>
                <RefreshCw size={14} aria-hidden="true" />
                Refresh all
                <span className="admin-cmd__shortcut">R</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
