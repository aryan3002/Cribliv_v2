"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { Drawer } from "../primitives/Drawer";
import { HealthBadge } from "../owner-health/HealthBadge";
import { HealthDrawer } from "../owner-health/HealthDrawer";
import {
  changeAdminUserRole,
  createAdminUser,
  decideAdminRoleRequest,
  fetchAdminOwnerHealth,
  fetchAdminRoleRequests,
  fetchAdminUsers,
  type AdminRoleRequestVm,
  type AdminUserVm,
  type OwnerHealthRow
} from "../../../lib/admin-api";
import { formatDate, formatPhone, formatRelativeTime } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const ROLES = ["tenant", "owner", "pg_operator", "admin"] as const;
type RoleStr = (typeof ROLES)[number];

export function UsersTab({ accessToken, onToast }: Props) {
  const [users, setUsers] = useState<AdminUserVm[]>([]);
  const [health, setHealth] = useState<Map<string, OwnerHealthRow>>(new Map());
  const [requests, setRequests] = useState<AdminRoleRequestVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | RoleStr>("all");
  const [healthDetail, setHealthDetail] = useState<OwnerHealthRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [u, h, r] = await Promise.all([
        fetchAdminUsers(accessToken),
        fetchAdminOwnerHealth(accessToken, { limit: 200 }),
        fetchAdminRoleRequests(accessToken).catch(() => [])
      ]);
      setUsers(u);
      const map = new Map<string, OwnerHealthRow>();
      for (const row of h.items) map.set(row.owner_user_id, row);
      setHealth(map);
      setRequests(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.phone.toLowerCase().includes(q) ||
        (u.fullName ?? "").toLowerCase().includes(q) ||
        u.id.toLowerCase().startsWith(q)
      );
    });
  }, [users, search, roleFilter]);

  async function changeRole(user: AdminUserVm, role: string) {
    if (user.role === role) return;
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)));
    try {
      await changeAdminUserRole(accessToken, user.id, role);
      onToast(`Role updated to ${role}`, "trust");
    } catch (err) {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: user.role } : u)));
      onToast(err instanceof Error ? err.message : "Update failed", "danger");
    }
  }

  const columns: Column<AdminUserVm>[] = [
    {
      key: "phone",
      header: "Phone",
      render: (u) => <span style={{ fontFamily: "var(--font-mono)" }}>{formatPhone(u.phone)}</span>,
      sortValue: (u) => u.phone
    },
    {
      key: "name",
      header: "Name",
      render: (u) => u.fullName ?? <span style={{ color: "var(--ad-text-3)" }}>—</span>,
      sortValue: (u) => u.fullName ?? ""
    },
    {
      key: "role",
      header: "Role",
      render: (u) => <StatusPill status={u.role} tone="muted" noDot />,
      sortValue: (u) => u.role
    },
    {
      key: "health",
      header: "Health",
      render: (u) => {
        const h = health.get(u.id);
        if (!h) {
          if (u.role === "owner" || u.role === "pg_operator") {
            return <span style={{ color: "var(--ad-text-3)", fontSize: 12 }}>—</span>;
          }
          return <span style={{ color: "var(--ad-text-3)", fontSize: 12 }}>n/a</span>;
        }
        return <HealthBadge score={h.score} grade={h.grade} onClick={() => setHealthDetail(h)} />;
      },
      sortValue: (u) => health.get(u.id)?.score ?? -1
    },
    {
      key: "joined",
      header: "Joined",
      align: "right",
      render: (u) => formatDate(u.createdAt),
      sortValue: (u) => u.createdAt
    },
    {
      key: "change",
      header: "Change role",
      align: "right",
      render: (u) => (
        <select
          value={u.role}
          onChange={(e) => void changeRole(u, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--ad-border)",
            background: "var(--ad-surface)",
            fontSize: 12,
            fontFamily: "inherit"
          }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      )
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Users</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading…" : `${filtered.length} of ${users.length}`}
        </span>
      </div>

      {requests.length > 0 && (
        <SectionCard
          title="Role requests"
          subtitle={`${requests.filter((r) => r.status === "pending").length} pending`}
          flush
        >
          <div className="admin-feed">
            {requests
              .filter((r) => r.status === "pending")
              .map((r) => (
                <RoleRequestRow
                  key={r.id}
                  request={r}
                  accessToken={accessToken}
                  onDone={(decision) => {
                    setRequests((prev) =>
                      prev.map((x) => (x.id === r.id ? { ...x, status: decision } : x))
                    );
                    onToast(`Request ${decision}d`, "trust");
                  }}
                  onError={(msg) => onToast(msg, "danger")}
                />
              ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        flush
        action={
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-btn--sm"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={12} aria-hidden="true" />
            Add user
          </button>
        }
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: 12,
            borderBottom: "1px solid var(--ad-border)"
          }}
        >
          <input
            type="search"
            placeholder="Search by phone, name, or id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              border: "1px solid var(--ad-border)",
              fontSize: 13,
              fontFamily: "inherit"
            }}
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
            style={{
              height: 32,
              padding: "0 10px",
              borderRadius: 8,
              border: "1px solid var(--ad-border)",
              fontSize: 13,
              fontFamily: "inherit",
              background: "var(--ad-surface)"
            }}
          >
            <option value="all">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No matching users" />
        ) : (
          <DataTable columns={columns} rows={filtered} rowKey={(u) => u.id} />
        )}
      </SectionCard>

      <HealthDrawer
        owner={healthDetail}
        onClose={() => setHealthDetail(null)}
        onAdjustWallet={(id) =>
          onToast(`Open System tab to adjust wallet for ${id.slice(0, 8)}…`, "warn")
        }
      />

      <AddUserDrawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        accessToken={accessToken}
        onCreated={(_phone) => {
          onToast("User created", "trust");
          void load();
        }}
        onError={(msg) => onToast(msg, "danger")}
      />
    </div>
  );
}

function RoleRequestRow({
  request,
  accessToken,
  onDone,
  onError
}: {
  request: AdminRoleRequestVm;
  accessToken: string;
  onDone: (decision: "approve" | "reject") => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    try {
      await decideAdminRoleRequest(accessToken, request.id, decision);
      onDone(decision);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-feed__item">
      <span className="admin-feed__dot" data-severity="low" aria-hidden="true" />
      <div>
        <div className="admin-feed__summary">
          {formatPhone(request.phone)} requesting{" "}
          <strong>{request.requestedRole.replace(/_/g, " ")}</strong>
        </div>
        <div className="admin-feed__meta">
          <span>{formatRelativeTime(request.createdAt)}</span>
        </div>
      </div>
      <div className="admin-feed__actions">
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          onClick={() => void decide("reject")}
          disabled={!!busy}
        >
          Reject
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--primary admin-btn--sm"
          onClick={() => void decide("approve")}
          disabled={!!busy}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

function AddUserDrawer({
  open,
  onClose,
  accessToken,
  onCreated,
  onError
}: {
  open: boolean;
  onClose: () => void;
  accessToken: string;
  onCreated: (phone: string) => void;
  onError: (msg: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<RoleStr>("tenant");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const p = phone.trim();
    if (!/^\+91\d{10}$/.test(p)) {
      onError("Phone must be in +91XXXXXXXXXX format");
      return;
    }
    setBusy(true);
    try {
      await createAdminUser(accessToken, p, role, name.trim() || undefined);
      onCreated(p);
      setPhone("");
      setName("");
      setRole("tenant");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add user"
      footer={
        <>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Phone (E.164)">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919876543210"
            style={fieldStyle}
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as RoleStr)}
            style={fieldStyle}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name (optional)">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aryan Tripathi"
            style={fieldStyle}
          />
        </Field>
      </div>
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ad-text-2)" }}>{label}</span>
      {children}
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--ad-border)",
  background: "var(--ad-surface)",
  fontSize: 13,
  fontFamily: "inherit"
};
