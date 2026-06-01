"use client";
import { useState } from "react";
import type { PgDashboardLead } from "@cribliv/shared-types";
import { motion } from "framer-motion";
import { Users, Phone, MapPin, Tag, Eye, Loader2 } from "lucide-react";
import { openPgLead } from "@/lib/pg-operator-api";

type Revealed = { phone: string | null; tenant_name: string };

export default function LeadsInbox({ leads, token }: { leads: PgDashboardLead[]; token?: string }) {
  const sorted = [...leads].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function reveal(leadId: string) {
    if (revealed[leadId] || busy) return;
    setBusy(leadId);
    setErrors((e) => ({ ...e, [leadId]: "" }));
    try {
      const r = await openPgLead(leadId, token);
      setRevealed((prev) => ({
        ...prev,
        [leadId]: { phone: r.phone, tenant_name: r.tenant_name }
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not open lead";
      // 402 from the API once the V1.5 paywall is live.
      setErrors((e) => ({
        ...e,
        [leadId]: /payment_required/i.test(msg) ? "Requires a plan to open (coming soon)" : msg
      }));
    } finally {
      setBusy(null);
    }
  }

  if (!sorted.length) {
    return (
      <motion.section
        className="pgo-glass"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="pgo-empty">
          <div className="pgo-empty__icon">
            <Users size={24} />
          </div>
          <p className="pgo-empty__text">
            No leads yet. They will appear here when tenants contact you.
          </p>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      className="pgo-glass"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      <h2 className="pgo-heading pgo-heading--sm" style={{ marginBottom: 20 }}>
        <Users size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
        Recent Leads ({sorted.length})
      </h2>

      <ul className="pgo-leads-list pgo-stagger">
        {sorted.map((l) => {
          const open = revealed[l.lead_id];
          const err = errors[l.lead_id];
          return (
            <li key={l.lead_id} className="pgo-lead-row">
              <div className="pgo-lead-row__left">
                <div className="pgo-lead-row__avatar">
                  <Phone size={18} />
                </div>
                <div className="pgo-lead-row__info">
                  <span className="pgo-lead-row__phone">
                    {open ? (open.phone ?? "No phone on file") : l.contact.phone_masked}
                  </span>
                  <div className="pgo-lead-row__meta">
                    {open && (
                      <span className="pgo-lead-row__meta-item">
                        <Users size={12} /> {open.tenant_name}
                      </span>
                    )}
                    <span className="pgo-lead-row__meta-item">
                      <MapPin size={12} /> {l.source}
                    </span>
                    <span className="pgo-lead-row__meta-item">
                      <Tag size={12} /> {new Date(l.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {err && (
                    <span className="pgo-desc" style={{ color: "#ef4444", fontSize: 12 }}>
                      {err}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {!open && (
                  <button
                    type="button"
                    className="pgo-btn pgo-btn--secondary"
                    style={{ padding: "6px 12px", fontSize: 13 }}
                    disabled={busy === l.lead_id}
                    onClick={() => reveal(l.lead_id)}
                  >
                    {busy === l.lead_id ? (
                      <Loader2 size={14} className="pgo-spin" />
                    ) : (
                      <>
                        <Eye size={14} /> Open
                      </>
                    )}
                  </button>
                )}
                <span
                  className={`pgo-lead-row__badge pgo-lead-row__badge--${l.status === "new" ? "new" : "contacted"}`}
                >
                  {l.status}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
