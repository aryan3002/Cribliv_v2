"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DataTable, type Column } from "../primitives/DataTable";
import { SectionCard } from "../primitives/SectionCard";
import { StatCard } from "../primitives/StatCard";
import { StatusPill } from "../primitives/StatusPill";
import {
  approveBlogPost,
  archiveBlogPost,
  fetchAdminBlogPosts,
  publishBlogPost,
  type AdminBlogRowVm
} from "../../../lib/admin-api";
import { formatDate } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const DESK_LABEL: Record<string, string> = {
  "data-reports": "Data Reports",
  "local-guides": "Local Guides",
  tenancy: "Tenancy",
  "market-updates": "Market Updates"
};

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "pending", label: "Review queue" },
  { value: "draft", label: "Draft" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "in_review", label: "In review" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" }
];

const PENDING = new Set(["draft", "needs_attention", "in_review"]);

const fieldStyle: CSSProperties = {
  height: 34,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--ad-border)",
  background: "var(--ad-surface)",
  fontSize: 13,
  fontFamily: "inherit"
};

const btnStyle: CSSProperties = {
  height: 28,
  padding: "0 10px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid var(--ad-border)",
  background: "var(--ad-surface)",
  color: "var(--ad-text, inherit)",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center"
};

export function BlogReviewTab({ accessToken, onToast }: Props) {
  const [all, setAll] = useState<AdminBlogRowVm[]>([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const onToastRef = useRef(onToast);

  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const items = await fetchAdminBlogPosts(accessToken);
        if (!cancelled) setAll(items);
      } catch (err) {
        if (!cancelled) {
          onToastRef.current(err instanceof Error ? err.message : "Failed to load posts", "danger");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of all) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [all]);

  const rows = useMemo(() => {
    if (filter === "all") return all;
    if (filter === "pending") return all.filter((p) => PENDING.has(p.status));
    return all.filter((p) => p.status === filter);
  }, [all, filter]);

  const act = useCallback(
    async (
      id: string,
      fn: (token: string, id: string) => Promise<AdminBlogRowVm>,
      okMsg: string
    ) => {
      setActingId(id);
      try {
        await fn(accessToken, id);
        onToastRef.current(okMsg, "trust");
        setReloadKey((k) => k + 1);
      } catch (err) {
        onToastRef.current(err instanceof Error ? err.message : "Action failed", "danger");
      } finally {
        setActingId(null);
      }
    },
    [accessToken]
  );

  const columns: Column<AdminBlogRowVm>[] = [
    {
      key: "title",
      header: "Post",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.title}</div>
          <div style={{ fontSize: 12, color: "var(--ad-text-muted, #64748b)" }}>
            {DESK_LABEL[r.categorySlug ?? ""] ?? "—"}
            {r.citySlug ? ` · ${r.citySlug}` : ""}
            {r.author ? ` · ${r.author}` : ""}
          </div>
        </div>
      )
    },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
    {
      key: "quality",
      header: "Quality",
      align: "right",
      render: (r) => (r.qualityScore != null ? r.qualityScore.toFixed(2) : "—")
    },
    { key: "updated", header: "Updated", render: (r) => formatDate(r.updatedAt) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => {
        const busy = actingId === r.id;
        return (
          <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
            {(r.status === "draft" || r.status === "needs_attention") && (
              <button
                type="button"
                style={btnStyle}
                disabled={busy}
                onClick={() => act(r.id, approveBlogPost, "Moved to review")}
              >
                Approve
              </button>
            )}
            {(r.status === "draft" || r.status === "in_review") && (
              <button
                type="button"
                style={{
                  ...btnStyle,
                  borderColor: "var(--ad-trust, #0d9f4f)",
                  color: "var(--ad-trust, #0d9f4f)"
                }}
                disabled={busy}
                onClick={() => act(r.id, publishBlogPost, "Published")}
              >
                Publish
              </button>
            )}
            {r.status === "published" && (
              <a style={btnStyle} href={`/en/blog/${r.slug}`} target="_blank" rel="noreferrer">
                View
              </a>
            )}
            {r.status !== "archived" && (
              <button
                type="button"
                style={btnStyle}
                disabled={busy}
                onClick={() => act(r.id, archiveBlogPost, "Archived")}
              >
                Archive
              </button>
            )}
          </div>
        );
      }
    }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12
        }}
      >
        <StatCard label="Drafts" value={counts.draft ?? 0} />
        <StatCard label="Needs attention" value={counts.needs_attention ?? 0} />
        <StatCard label="In review" value={counts.in_review ?? 0} />
        <StatCard label="Published" value={counts.published ?? 0} />
      </div>

      <SectionCard
        title="Blog review queue"
        subtitle="Human-approve AI drafts before they go live — publishing is the only path to a public post."
        action={
          <select
            style={fieldStyle}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter by status"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyState={loading ? "Loading…" : "No posts in this view."}
        />
      </SectionCard>
    </div>
  );
}
