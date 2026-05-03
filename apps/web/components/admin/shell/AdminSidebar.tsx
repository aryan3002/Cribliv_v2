"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Coins,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
  Wrench
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut } from "next-auth/react";

export type AdminTab =
  | "live"
  | "overview"
  | "listings"
  | "verifications"
  | "leads"
  | "users"
  | "revenue"
  | "fraud"
  | "system";

interface NavItem {
  id: AdminTab;
  label: string;
  icon: LucideIcon;
  count?: number;
}

interface Props {
  active: AdminTab;
  onChange: (tab: AdminTab) => void;
  counts: Partial<Record<AdminTab, number>>;
}

export function AdminSidebar({ active, onChange, counts }: Props) {
  const operate: NavItem[] = [
    { id: "live", label: "Live Ops", icon: Activity },
    { id: "overview", label: "Overview", icon: LayoutDashboard }
  ];
  const work: NavItem[] = [
    { id: "listings", label: "Listing Review", icon: ClipboardList, count: counts.listings },
    { id: "verifications", label: "Verifications", icon: ShieldCheck, count: counts.verifications },
    { id: "leads", label: "CRM", icon: Users, count: counts.leads },
    { id: "fraud", label: "Fraud Feed", icon: AlertTriangle, count: counts.fraud }
  ];
  const understand: NavItem[] = [
    { id: "revenue", label: "Revenue", icon: Coins },
    { id: "users", label: "Users", icon: Users }
  ];
  const ops: NavItem[] = [{ id: "system", label: "System", icon: Wrench }];

  return (
    <nav className="admin-sidebar" aria-label="Admin navigation">
      <div className="admin-sidebar__brand">
        <span className="admin-sidebar__brand-mark">C</span>
        <span>Cribliv Admin</span>
      </div>

      <Section title="Operate" items={operate} active={active} onChange={onChange} />
      <Section title="Work" items={work} active={active} onChange={onChange} />
      <Section title="Understand" items={understand} active={active} onChange={onChange} />
      <Section title="System" items={ops} active={active} onChange={onChange} />

      <div className="admin-sidebar__footer">
        <button
          type="button"
          className="admin-sidebar__item admin-sidebar__item--signout"
          onClick={() => void signOut({ callbackUrl: "/auth/login" })}
        >
          <span className="admin-sidebar__item-icon">
            <LogOut size={15} aria-hidden="true" />
          </span>
          <span className="admin-sidebar__item-label">Sign out</span>
        </button>
      </div>
    </nav>
  );
}

function Section({
  title,
  items,
  active,
  onChange
}: {
  title: string;
  items: NavItem[];
  active: AdminTab;
  onChange: (tab: AdminTab) => void;
}) {
  return (
    <>
      <div className="admin-sidebar__section">{title}</div>
      {items.map((it) => {
        const Icon = it.icon;
        const isActive = active === it.id;
        return (
          <button
            key={it.id}
            type="button"
            className={`admin-sidebar__item${isActive ? " admin-sidebar__item--active" : ""}`}
            onClick={() => onChange(it.id)}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="admin-sidebar__item-icon">
              <Icon size={15} aria-hidden="true" />
            </span>
            <span className="admin-sidebar__item-label">{it.label}</span>
            {typeof it.count === "number" && it.count > 0 && (
              <span className="admin-sidebar__item-count">{it.count}</span>
            )}
          </button>
        );
      })}
    </>
  );
}
