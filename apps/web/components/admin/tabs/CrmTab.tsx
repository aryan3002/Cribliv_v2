"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "../primitives/SectionCard";
import { fetchAdminLeads, updateAdminLeadStatus, type AdminLeadVm } from "../../../lib/admin-api";
import { formatRelativeTime } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const STAGES: Array<{ id: AdminLeadVm["status"]; label: string }> = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "qualified", label: "Qualified" },
  { id: "closed_won", label: "Closed Won" },
  { id: "closed_lost", label: "Closed Lost" }
];

export function CrmTab({ accessToken, onCountChange, onToast }: Props) {
  const [items, setItems] = useState<AdminLeadVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchAdminLeads(accessToken);
      setItems(r.items);
      onCountChange?.(r.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const grouped = useMemo(() => {
    const byStage = new Map<string, AdminLeadVm[]>(STAGES.map((s) => [s.id, []]));
    for (const lead of items) {
      const list = byStage.get(lead.status) ?? [];
      list.push(lead);
      byStage.set(lead.status, list);
    }
    return byStage;
  }, [items]);

  async function move(lead: AdminLeadVm, status: AdminLeadVm["status"]) {
    if (lead.status === status) return;
    setMoving(lead.id);
    setItems((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status } : l)));
    try {
      await updateAdminLeadStatus(accessToken, lead.id, status);
      onToast(`Moved to ${status.replace("_", " ")}`, "trust");
    } catch (err) {
      // revert on failure
      setItems((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: lead.status } : l)));
      onToast(err instanceof Error ? err.message : "Move failed", "danger");
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Sales Pipeline</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading…" : `${items.length} leads`}
        </span>
      </div>

      <SectionCard flush>
        <div className="admin-kanban">
          {STAGES.map((stage) => {
            const stageItems = grouped.get(stage.id) ?? [];
            return (
              <div key={stage.id} className="admin-kanban__col">
                <div className="admin-kanban__col-head">
                  <span>{stage.label}</span>
                  <span className="admin-kanban__count">{stageItems.length}</span>
                </div>
                {stageItems.length === 0 ? (
                  <div
                    style={{
                      color: "var(--ad-text-3)",
                      fontSize: 12,
                      padding: "12px 4px",
                      textAlign: "center"
                    }}
                  >
                    nothing here yet
                  </div>
                ) : (
                  stageItems.map((lead) => (
                    <article key={lead.id} className="admin-kanban__card">
                      <span className="admin-kanban__card-id">
                        {lead.source.replace(/_/g, " ")}
                      </span>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>
                        {lead.notes ?? lead.id.slice(0, 8) + "…"}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--ad-text-3)",
                          fontFamily: "var(--font-mono)"
                        }}
                      >
                        {formatRelativeTime(lead.createdAt)}
                      </div>
                      <select
                        value={lead.status}
                        onChange={(e) => void move(lead, e.target.value as AdminLeadVm["status"])}
                        disabled={moving === lead.id}
                        style={{
                          marginTop: 6,
                          padding: "4px 6px",
                          borderRadius: 6,
                          border: "1px solid var(--ad-border)",
                          background: "var(--ad-surface-2)",
                          fontSize: 11.5,
                          fontFamily: "inherit"
                        }}
                      >
                        {STAGES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </article>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
