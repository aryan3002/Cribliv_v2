"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Eye, PauseCircle, X } from "lucide-react";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { StatusPill } from "../primitives/StatusPill";
import {
  fetchAdminFraudFeed,
  resolveAdminFraudFlag,
  type FraudFeedItem,
  type FraudFeedItemKind
} from "../../../lib/admin-api";
import { formatRelativeTime } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const FILTERS: Array<{ id: FraudFeedItemKind | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "multi_listing_burst", label: "Multi-listing burst" },
  { id: "multi_report", label: "Multi-report" },
  { id: "inactive_owner", label: "Inactive owner" },
  { id: "raw_flag", label: "Raw flags" }
];

const KIND_LABEL: Record<FraudFeedItemKind, string> = {
  raw_flag: "Raw flag",
  multi_listing_burst: "Listing burst",
  multi_report: "Tenant reports",
  inactive_owner: "Inactive owner"
};

export function FraudTab({ accessToken, onToast }: Props) {
  const [items, setItems] = useState<FraudFeedItem[]>([]);
  const [filter, setFilter] = useState<FraudFeedItemKind | "all">("all");
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetchAdminFraudFeed(accessToken, 60);
        if (!cancelled) setItems(r.items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [accessToken]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.kind === filter)),
    [items, filter]
  );

  const counts = useMemo(() => {
    const c: Partial<Record<FraudFeedItemKind | "all", number>> = { all: items.length };
    for (const it of items) c[it.kind] = (c[it.kind] ?? 0) + 1;
    return c;
  }, [items]);

  async function handleDismiss(item: FraudFeedItem) {
    if (item.kind !== "raw_flag") {
      // Synthesized signals can't be "resolved" — they re-emerge until the
      // underlying data changes. We just drop them locally.
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onToast("Hidden until next refresh", "trust");
      return;
    }
    const flagId = item.id.replace(/^raw:/, "");
    setResolving(item.id);
    try {
      await resolveAdminFraudFlag(accessToken, flagId);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      onToast("Flag resolved", "trust");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not resolve", "danger");
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Fraud Intelligence</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading…" : `${filtered.length} signals · auto-refresh 60s`}
        </span>
      </div>

      <SectionCard flush title="Filter" subtitle="Live feed of synthesized + raw signals">
        <div className="admin-chip-row">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="admin-chip"
              aria-pressed={f.id === filter}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="admin-chip__count">{counts[f.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard flush>
        {filtered.length === 0 ? (
          <EmptyState
            title="All quiet on this filter"
            hint="Either the system isn't seeing fraud signals, or this filter excludes them."
          />
        ) : (
          <div className="admin-feed">
            {filtered.map((item) => (
              <FraudRow
                key={item.id}
                item={item}
                onDismiss={() => handleDismiss(item)}
                busy={resolving === item.id}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function FraudRow({
  item,
  onDismiss,
  busy
}: {
  item: FraudFeedItem;
  onDismiss: () => void;
  busy: boolean;
}) {
  return (
    <div className="admin-feed__item">
      <span className="admin-feed__dot" data-severity={item.severity} aria-hidden="true" />
      <div>
        <div className="admin-feed__summary">{item.summary}</div>
        <div className="admin-feed__meta">
          <StatusPill status={item.kind} label={KIND_LABEL[item.kind]} tone="muted" noDot />
          <StatusPill status={item.severity} tone={severityTone(item.severity)} noDot />
          {item.related_ids.phone && (
            <span className="admin-feed__chip">{item.related_ids.phone}</span>
          )}
          {item.related_ids.listing_ids && item.related_ids.listing_ids.length > 0 && (
            <span className="admin-feed__chip">
              {item.related_ids.listing_ids.length} listing
              {item.related_ids.listing_ids.length === 1 ? "" : "s"}
            </span>
          )}
          <span>{describeWhen(item)}</span>
        </div>
      </div>
      <div className="admin-feed__actions">
        {item.related_ids.listing_ids && item.related_ids.listing_ids[0] && (
          <a
            className="admin-btn admin-btn--ghost admin-btn--sm"
            href={`/en/listing/${item.related_ids.listing_ids[0]}`}
            target="_blank"
            rel="noreferrer"
          >
            <Eye size={12} aria-hidden="true" /> Review
          </a>
        )}
        {item.kind === "multi_report" && (
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" disabled>
            <PauseCircle size={12} aria-hidden="true" /> Pause
          </button>
        )}
        {item.kind === "multi_listing_burst" && (
          <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" disabled>
            <Ban size={12} aria-hidden="true" /> Block phone
          </button>
        )}
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          onClick={onDismiss}
          disabled={busy}
          aria-label="Dismiss"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function severityTone(s: FraudFeedItem["severity"]): "danger" | "warn" | "muted" {
  if (s === "high") return "danger";
  if (s === "medium") return "warn";
  return "muted";
}

function describeWhen(item: FraudFeedItem): string {
  // Inactive-owner signals fall back to epoch when last_login_at is null —
  // that would render as "56y ago", which is meaningless. Prefer "never seen".
  if (item.kind === "inactive_owner") {
    const lastSeen = (item.evidence as { last_seen?: string | null }).last_seen;
    if (!lastSeen) return "never seen";
    return `last seen ${formatRelativeTime(lastSeen)}`;
  }
  return formatRelativeTime(item.detected_at);
}
