"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { DataTable, type Column } from "../primitives/DataTable";
import { SectionCard } from "../primitives/SectionCard";
import { StatCard } from "../primitives/StatCard";
import { StatusPill } from "../primitives/StatusPill";
import {
  fetchIndexingQueue,
  fetchSearchPerformance,
  fetchSearchPerformanceCsv,
  fetchSeoCoverage,
  retryIndexingUrl,
  submitIndexingUrl,
  type IndexingQueueRowVm,
  type SearchPerformanceRowVm
} from "../../../lib/admin-api";
import { formatDate, formatNumber } from "../../../lib/admin/format";

const fieldStyle: CSSProperties = {
  height: 34,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid var(--ad-border)",
  background: "var(--ad-surface)",
  fontSize: 13,
  fontFamily: "inherit"
};

interface Props {
  accessToken: string;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

export function SearchPerformanceTab({ accessToken, onToast }: Props) {
  const [rows, setRows] = useState<SearchPerformanceRowVm[]>([]);
  const [totals, setTotals] = useState({
    totalImpressions: 0,
    totalClicks: 0,
    avgPosition: null as number | null
  });
  const [coverage, setCoverage] = useState<{
    indexedCount: number | null;
    submittedCount: number | null;
  }>({ indexedCount: null, submittedCount: null });
  const [queue, setQueue] = useState<IndexingQueueRowVm[]>([]);
  const [queueSummary, setQueueSummary] = useState({
    countsByStatus: {} as Record<string, number>,
    submittedToday: 0,
    dailyQuota: 200
  });
  const [quickWins, setQuickWins] = useState(false);
  const [loading, setLoading] = useState(true);
  const [manualUrl, setManualUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
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
        const [performance, cov] = await Promise.all([
          fetchSearchPerformance(accessToken, { quickWins: quickWins || undefined }),
          fetchSeoCoverage(accessToken)
        ]);
        if (!cancelled) {
          setRows(performance.items);
          setTotals(performance.totals);
          setCoverage(cov);
        }
      } catch (err) {
        if (!cancelled) {
          onToastRef.current(
            err instanceof Error ? err.message : "Could not load search performance",
            "danger"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken, quickWins, reloadKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadQueue() {
      try {
        const result = await fetchIndexingQueue(accessToken, {});
        if (!cancelled) {
          setQueue(result.items);
          setQueueSummary(result.summary);
        }
      } catch (err) {
        if (!cancelled) {
          onToastRef.current(
            err instanceof Error ? err.message : "Could not load indexing queue",
            "danger"
          );
        }
      }
    }

    void loadQueue();
    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadKey]);

  const quickWinsCount = useMemo(
    () => rows.filter((row) => row.position >= 11 && row.position <= 30).length,
    [rows]
  );

  async function handleSubmitUrl() {
    if (!manualUrl.trim()) return;
    setSubmitting(true);
    try {
      await submitIndexingUrl(accessToken, manualUrl.trim(), undefined);
      setManualUrl("");
      onToast("URL submitted for indexing", "trust");
      setReloadKey((k) => k + 1);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not submit URL", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetry(row: IndexingQueueRowVm) {
    setRetryingId(row.id);
    try {
      await retryIndexingUrl(accessToken, row.id);
      onToast(`${row.url} queued for retry`, "trust");
      setReloadKey((k) => k + 1);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not retry URL", "danger");
    } finally {
      setRetryingId(null);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const csv = await fetchSearchPerformanceCsv(accessToken, {
        quickWins: quickWins || undefined
      });
      const blobUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "search-performance.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not export CSV", "danger");
    } finally {
      setExporting(false);
    }
  }

  const rankingColumns: Column<SearchPerformanceRowVm>[] = [
    {
      key: "keyword",
      header: "Keyword",
      render: (row) => row.keyword,
      sortValue: (row) => row.keyword
    },
    {
      key: "page",
      header: "Page",
      render: (row) => <span className="admin-table__id">{row.page}</span>,
      sortValue: (row) => row.page
    },
    { key: "locale", header: "Locale", render: (row) => row.locale.toUpperCase() },
    {
      key: "position",
      header: "Position",
      align: "right",
      render: (row) => row.position.toFixed(1),
      sortValue: (row) => row.position
    },
    {
      key: "impressions",
      header: "Impressions",
      align: "right",
      render: (row) => formatNumber(row.impressions),
      sortValue: (row) => row.impressions
    },
    {
      key: "clicks",
      header: "Clicks",
      align: "right",
      render: (row) => formatNumber(row.clicks),
      sortValue: (row) => row.clicks
    },
    {
      key: "ctr",
      header: "CTR",
      align: "right",
      render: (row) => `${(row.ctr * 100).toFixed(1)}%`,
      sortValue: (row) => row.ctr
    },
    {
      key: "captured",
      header: "Captured",
      render: (row) => formatDate(row.capturedAt),
      sortValue: (row) => row.capturedAt
    }
  ];

  const queueColumns: Column<IndexingQueueRowVm>[] = [
    {
      key: "url",
      header: "URL",
      render: (row) => <span className="admin-table__id">{row.url}</span>,
      sortValue: (row) => row.url
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusPill
          status={row.status}
          label={row.status}
          tone={
            row.status === "submitted"
              ? "trust"
              : row.status === "failed"
                ? "danger"
                : row.status === "skipped"
                  ? "warn"
                  : "muted"
          }
        />
      ),
      sortValue: (row) => row.status
    },
    { key: "reason", header: "Reason", render: (row) => row.reason ?? "-" },
    {
      key: "attempts",
      header: "Attempts",
      align: "right",
      render: (row) => row.attempts,
      sortValue: (row) => row.attempts
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (row) =>
        row.status === "failed" ? (
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => void handleRetry(row)}
            disabled={retryingId === row.id}
          >
            {retryingId === row.id ? "Retrying..." : "Retry"}
          </button>
        ) : null
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Search Performance</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading..." : `${formatNumber(totals.totalImpressions)} impressions (28d)`}
        </span>
      </div>

      <div className="admin-stat-grid">
        <StatCard label="Indexed pages" value={formatNumber(coverage.indexedCount ?? 0)} />
        <StatCard
          label="Submitted today"
          value={`${formatNumber(queueSummary.submittedToday)} / ${formatNumber(queueSummary.dailyQuota)}`}
          tone="trust"
        />
        <StatCard label="Quick wins" value={formatNumber(quickWinsCount)} tone="brand" />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className={`admin-btn admin-btn--sm ${
            !quickWins ? "admin-btn--primary" : "admin-btn--ghost"
          }`}
          onClick={() => setQuickWins(false)}
        >
          All rankings
        </button>
        <button
          type="button"
          className={`admin-btn admin-btn--sm ${
            quickWins ? "admin-btn--primary" : "admin-btn--ghost"
          }`}
          onClick={() => setQuickWins(true)}
        >
          Quick wins
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={() => void handleExportCsv()}
          disabled={exporting}
        >
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      <DataTable
        columns={rankingColumns}
        rows={rows}
        rowKey={(row) => `${row.keyword}::${row.page}::${row.locale}`}
        emptyState={quickWins ? "No quick-win keywords yet" : "No ranking data yet"}
        initialSort={{ key: "impressions", dir: "desc" }}
      />

      <SectionCard title="Indexing queue">
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="https://cribliv.com/..."
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            style={{ ...fieldStyle, flex: 1 }}
          />
          <button
            type="button"
            className="admin-btn admin-btn--primary admin-btn--sm"
            onClick={() => void handleSubmitUrl()}
            disabled={submitting || !manualUrl.trim()}
          >
            {submitting ? "Submitting..." : "Submit URL"}
          </button>
        </div>

        <DataTable
          columns={queueColumns}
          rows={queue}
          rowKey={(row) => row.id}
          emptyState="No indexing queue entries"
        />
      </SectionCard>
    </div>
  );
}
