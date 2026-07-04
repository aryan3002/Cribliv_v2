"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatCard } from "../primitives/StatCard";
import { StatusPill } from "../primitives/StatusPill";
import { listSeoCities, setSeoCityEnabled, type SeoCityConfigVm } from "../../../lib/admin-api";
import { formatDate, formatNumber } from "../../../lib/admin/format";
import { SeoCityReviewDrawer } from "./SeoCityReviewDrawer";

interface Props {
  accessToken: string;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

export function SeoProgrammaticPages({ accessToken, onToast }: Props) {
  const [rows, setRows] = useState<SeoCityConfigVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<SeoCityConfigVm | null>(null);
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
        const next = await listSeoCities(accessToken);
        if (!cancelled) setRows(next);
      } catch (err) {
        if (!cancelled) {
          onToastRef.current(
            err instanceof Error ? err.message : "Could not load SEO cities",
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
  }, [accessToken, reloadKey]);

  const stats = useMemo(() => {
    return {
      configured: rows.length,
      live: rows.filter((row) => row.programmaticEnabled).length,
      indexable: rows.reduce((sum, row) => sum + row.indexableCount, 0)
    };
  }, [rows]);

  async function toggle(row: SeoCityConfigVm) {
    const nextEnabled = !row.programmaticEnabled;
    setPendingSlugs((prev) => new Set(prev).add(row.citySlug));
    setRows((prev) =>
      prev.map((item) =>
        item.citySlug === row.citySlug ? { ...item, programmaticEnabled: nextEnabled } : item
      )
    );

    try {
      const next = await setSeoCityEnabled(accessToken, row.citySlug, nextEnabled, undefined);
      setRows((prev) =>
        prev.map((item) =>
          item.citySlug === row.citySlug ? { ...item, ...next, nameEn: item.nameEn } : item
        )
      );
      onToast(`${row.nameEn} ${nextEnabled ? "enabled" : "disabled"}`, "trust");
    } catch (err) {
      setRows((prev) =>
        prev.map((item) =>
          item.citySlug === row.citySlug
            ? { ...item, programmaticEnabled: row.programmaticEnabled }
            : item
        )
      );
      onToast(err instanceof Error ? err.message : "Could not update city", "danger");
    } finally {
      setPendingSlugs((prev) => {
        const next = new Set(prev);
        next.delete(row.citySlug);
        return next;
      });
    }
  }

  const columns: Column<SeoCityConfigVm>[] = [
    {
      key: "city",
      header: "City",
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.nameEn}</div>
          <div className="admin-table__id">{row.citySlug}</div>
        </div>
      ),
      sortValue: (row) => row.nameEn.toLowerCase()
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusPill
          status={row.programmaticEnabled ? "active" : "draft"}
          label={row.programmaticEnabled ? "Live" : "Draft"}
          tone={row.programmaticEnabled ? "trust" : "muted"}
        />
      ),
      sortValue: (row) => (row.programmaticEnabled ? 1 : 0)
    },
    {
      key: "localities",
      header: "Localities",
      align: "right",
      render: (row) => formatNumber(row.localityCount),
      sortValue: (row) => row.localityCount
    },
    {
      key: "landmarks",
      header: "Landmarks",
      align: "right",
      render: (row) => formatNumber(row.landmarkCount),
      sortValue: (row) => row.landmarkCount
    },
    {
      key: "metro",
      header: "Metro",
      align: "right",
      render: (row) => formatNumber(row.metroCount),
      sortValue: (row) => row.metroCount
    },
    {
      key: "indexable",
      header: "Indexable",
      align: "right",
      render: (row) => formatNumber(row.indexableCount),
      sortValue: (row) => row.indexableCount
    },
    {
      key: "enabled",
      header: "Enabled date",
      render: (row) => formatDate(row.enabledAt),
      sortValue: (row) => row.enabledAt ?? ""
    },
    {
      key: "action",
      header: "",
      align: "right",
      render: (row) => {
        const willEnable = !row.programmaticEnabled;
        const busy = pendingSlugs.has(row.citySlug);
        return (
          <button
            type="button"
            className={`admin-btn ${willEnable ? "admin-btn--primary" : "admin-btn--ghost"} admin-btn--sm`}
            onClick={(e) => {
              e.stopPropagation();
              void toggle(row);
            }}
            disabled={busy}
            aria-label={`${willEnable ? "Enable" : "Disable"} ${row.nameEn}`}
          >
            {busy ? "Saving..." : willEnable ? "Enable" : "Disable"}
          </button>
        );
      }
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Programmatic SEO</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading..." : `${stats.live} live of ${stats.configured} configured`}
        </span>
      </div>

      <div className="admin-stat-grid">
        <StatCard label="Cities configured" value={formatNumber(stats.configured)} />
        <StatCard label="Live" value={formatNumber(stats.live)} tone="trust" />
        <StatCard label="Indexable" value={formatNumber(stats.indexable)} tone="brand" />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.citySlug}
        onRowClick={(row) => setSelected(row)}
        emptyState="No cities configured"
        initialSort={{ key: "status", dir: "desc" }}
      />

      <SeoCityReviewDrawer
        key={selected?.citySlug ?? "none"}
        city={selected}
        accessToken={accessToken}
        onClose={() => setSelected(null)}
        onToast={onToast}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}
