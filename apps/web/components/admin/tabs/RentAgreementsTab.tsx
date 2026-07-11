"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { StatCard } from "../primitives/StatCard";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { Drawer } from "../primitives/Drawer";
import { AreaChart } from "../charts/AreaChart";
import { BarChart } from "../charts/BarChart";
import { DataTable, type Column } from "../primitives/DataTable";
import {
  fetchRentAgreementSummary,
  fetchRentAgreementFunnel,
  fetchRentAgreementTimeSeries,
  fetchRentAgreementOperational,
  fetchRentAgreements,
  fetchRentAgreementDetail,
  fetchRentAgreementDownloadLink,
  type RaSummaryVm,
  type RaFunnelStepVm,
  type RaTimePointVm,
  type RaOperationalVm,
  type RaListItemVm,
  type RaDetailVm
} from "../../../lib/admin-api";
import { formatINR, formatNumber, formatPct, formatDate } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
}

const DAY_RANGES = [7, 30, 90];
const STATUS_OPTIONS = ["", "draft", "pending_payment", "paid", "generating_pdf", "generated"];
const PLAN_OPTIONS = ["", "basic", "standard", "premium"];
const PAGE_SIZE = 20;

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  const mins = ms / 60000;
  if (mins >= 60) return `${(mins / 60).toFixed(1)}h`;
  if (mins >= 1) return `${mins.toFixed(1)}m`;
  return `${Math.round(ms / 1000)}s`;
}

export function RentAgreementsTab({ accessToken }: Props) {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<RaSummaryVm | null>(null);
  const [funnel, setFunnel] = useState<RaFunnelStepVm[]>([]);
  const [series, setSeries] = useState<RaTimePointVm[]>([]);
  const [operational, setOperational] = useState<RaOperationalVm | null>(null);
  const [loading, setLoading] = useState(true);

  // History table state.
  const [items, setItems] = useState<RaListItemVm[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fStatus, setFStatus] = useState("");
  const [fPlan, setFPlan] = useState("");
  const [fState, setFState] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [listLoading, setListLoading] = useState(true);

  // Detail drawer.
  const [detail, setDetail] = useState<RaDetailVm | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Analytics block (re-fetch on day-range change) ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchRentAgreementSummary(accessToken, days),
      fetchRentAgreementFunnel(accessToken, days),
      fetchRentAgreementTimeSeries(accessToken, days),
      fetchRentAgreementOperational(accessToken)
    ])
      .then(([s, f, t, o]) => {
        if (cancelled) return;
        setSummary(s);
        setFunnel(f);
        setSeries(t);
        setOperational(o);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, days]);

  // ── History table (debounced re-fetch on filter / page change) ─────────────
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    const timer = setTimeout(() => {
      fetchRentAgreements(accessToken, {
        status: fStatus || undefined,
        planId: fPlan || undefined,
        stateCode: fState || undefined,
        search: fSearch || undefined,
        page,
        limit: PAGE_SIZE
      })
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setTotal(res.total);
        })
        .finally(() => {
          if (!cancelled) setListLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, page, fStatus, fPlan, fState, fSearch]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [fStatus, fPlan, fState, fSearch]);

  const openDetail = useCallback(
    (id: string) => {
      setDrawerOpen(true);
      setDetail(null);
      setDetailLoading(true);
      fetchRentAgreementDetail(accessToken, id)
        .then((d) => setDetail(d))
        .finally(() => setDetailLoading(false));
    },
    [accessToken]
  );

  const downloadPdf = useCallback(
    async (id: string) => {
      const link = await fetchRentAgreementDownloadLink(accessToken, id);
      if (link) window.open(link.sasUrl, "_blank", "noopener");
    },
    [accessToken]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<RaListItemVm>[] = useMemo(
    () => [
      {
        key: "parties",
        header: "Owner → Tenant",
        render: (r) => (
          <div>
            <div>{r.ownerFullName ?? "-"}</div>
            <div style={{ color: "var(--ad-text-3)", fontSize: 12 }}>
              → {r.tenantFullName ?? "-"}
            </div>
          </div>
        )
      },
      { key: "plan", header: "Plan", render: (r) => r.planId, sortValue: (r) => r.planId },
      {
        key: "status",
        header: "Status",
        render: (r) => <span className="admin-pill">{r.status}</span>,
        sortValue: (r) => r.status
      },
      {
        key: "step",
        header: "Step",
        align: "right",
        render: (r) => `${r.currentStep}/7`,
        sortValue: (r) => r.currentStep
      },
      {
        key: "state",
        header: "State",
        render: (r) => r.stateCode ?? "-",
        sortValue: (r) => r.stateCode ?? ""
      },
      {
        key: "rent",
        header: "Rent",
        align: "right",
        render: (r) =>
          r.rentAmountPaise == null ? (
            "-"
          ) : (
            <span className="admin-table__amount">{formatINR(r.rentAmountPaise)}</span>
          ),
        sortValue: (r) => r.rentAmountPaise ?? 0
      },
      {
        key: "payment",
        header: "Payment",
        render: (r) => r.paymentStatus ?? "-",
        sortValue: (r) => r.paymentStatus ?? ""
      },
      {
        key: "pdf",
        header: "PDF",
        render: (r) => (r.pdfReady ? "✓ ready" : "-"),
        sortValue: (r) => (r.pdfReady ? 1 : 0)
      },
      {
        key: "created",
        header: "Created",
        align: "right",
        render: (r) => formatDate(r.createdAt),
        sortValue: (r) => r.createdAt
      }
    ],
    []
  );

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Rent Agreements</h1>
        <span className="admin-page-title__sub">{loading ? "loading…" : ""}</span>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {DAY_RANGES.map((d) => (
          <button
            key={d}
            type="button"
            className="admin-chip"
            aria-pressed={d === days}
            onClick={() => setDays(d)}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────────── */}
      <div className="admin-stat-grid">
        <StatCard label="Sessions" value={formatNumber(summary?.totalSessions ?? 0)} tone="trust" />
        <StatCard label="Drafts Started" value={formatNumber(summary?.draftsStarted ?? 0)} />
        <StatCard
          label="Completed"
          value={formatNumber(summary?.draftsCompleted ?? 0)}
          tone="brand"
        />
        <StatCard
          label="Abandoned"
          value={formatNumber(summary?.draftsAbandoned ?? 0)}
          tone={summary && summary.draftsAbandoned > 0 ? "warn" : "default"}
        />
        <StatCard label="Conversion" value={formatPct(summary?.conversionRate ?? 0, 1)} />
        <StatCard
          label={`Revenue · ${days}d`}
          value={formatINR(summary?.totalRevenuePaise ?? 0)}
          tone="brand"
        />
        <StatCard label="ARPU" value={formatINR(summary?.arpuPaise ?? 0)} />
        <StatCard label="Avg Completion" value={formatDuration(summary?.avgCompletionMs ?? null)} />
      </div>

      {/* ── Funnel ──────────────────────────────────────────────────────── */}
      <SectionCard title="Wizard funnel" subtitle="Agreements reaching each step">
        {funnel.length > 0 && funnel.some((s) => s.agreementsReached > 0) ? (
          <>
            <BarChart
              data={funnel.map((s) => ({
                step: `S${s.step}`,
                reached: s.agreementsReached
              }))}
              xKey="step"
              yKey="reached"
              tooltipFormatter={(v) => `${v} agreements`}
            />
            <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
              {funnel.map((s) => (
                <div
                  key={s.step}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    color: "var(--ad-text-2)"
                  }}
                >
                  <span>{s.label}</span>
                  <span>
                    {formatNumber(s.agreementsReached)} reached · {formatNumber(s.blockedEvents)}{" "}
                    blocked · drop {formatPct(s.dropRate, 0)}
                    {s.topErrors.length > 0 && (
                      <span style={{ color: "var(--ad-text-3)" }}>
                        {" "}
                        · {s.topErrors.map((e) => `${e.code}(${e.count})`).join(", ")}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState title="No funnel activity in range" />
        )}
      </SectionCard>

      {/* ── Trend ───────────────────────────────────────────────────────── */}
      <SectionCard title={`Daily trend · ${days}d`}>
        {series.length > 0 ? (
          <AreaChart
            data={series.map((p) => ({ date: p.date, started: p.draftsStarted }))}
            xKey="date"
            yKey="started"
            tooltipFormatter={(v) => `${v} drafts started`}
          />
        ) : (
          <EmptyState title="No trend data" />
        )}
      </SectionCard>

      {/* ── Splits ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16
        }}
      >
        <SectionCard title="By plan">
          {summary && summary.byPlan.length > 0 ? (
            <div style={{ display: "grid", gap: 6 }}>
              {summary.byPlan.map((p) => (
                <Row key={p.planId} label={p.planId}>
                  {formatNumber(p.count)} · {formatINR(p.revenuePaise)}
                </Row>
              ))}
            </div>
          ) : (
            <EmptyState title="No plan data" />
          )}
        </SectionCard>
        <SectionCard title="By state">
          {summary && summary.byState.length > 0 ? (
            <BarChart
              data={summary.byState.map((s) => ({ state: s.stateCode, count: s.count }))}
              xKey="state"
              yKey="count"
              color="#0D9F4F"
              tooltipFormatter={(v) => `${v} agreements`}
            />
          ) : (
            <EmptyState title="No state data" />
          )}
        </SectionCard>
        <SectionCard title="By locale">
          {summary && summary.byLocale.length > 0 ? (
            <div style={{ display: "grid", gap: 6 }}>
              {summary.byLocale.map((l) => (
                <Row key={l.locale} label={l.locale}>
                  {formatNumber(l.count)}
                </Row>
              ))}
            </div>
          ) : (
            <EmptyState title="No locale data" />
          )}
        </SectionCard>
        <SectionCard title="By status">
          {summary && summary.byPaymentStatus.length > 0 ? (
            <div style={{ display: "grid", gap: 6 }}>
              {summary.byPaymentStatus.map((s) => (
                <Row key={s.status} label={s.status}>
                  {formatNumber(s.count)}
                </Row>
              ))}
            </div>
          ) : (
            <EmptyState title="No status data" />
          )}
        </SectionCard>
      </div>

      {/* ── Operational ─────────────────────────────────────────────────── */}
      <SectionCard title="Operational health">
        <div className="admin-stat-grid">
          <StatCard label="PDF: pending" value={formatNumber(operational?.pdfJobs.pending ?? 0)} />
          <StatCard
            label="PDF: processing"
            value={formatNumber(operational?.pdfJobs.processing ?? 0)}
          />
          <StatCard
            label="PDF: failed"
            value={formatNumber(operational?.pdfJobs.failed ?? 0)}
            tone={operational && operational.pdfJobs.failed > 0 ? "danger" : "default"}
          />
          <StatCard label="PDF: done" value={formatNumber(operational?.pdfJobs.done ?? 0)} />
          <StatCard
            label="Expiring ≤7d"
            value={formatNumber(operational?.expiringSoon ?? 0)}
            tone={operational && operational.expiringSoon > 0 ? "warn" : "default"}
          />
          <StatCard
            label="Total downloads"
            value={formatNumber(operational?.totalDownloads ?? 0)}
          />
          <StatCard
            label="At download limit"
            value={formatNumber(operational?.atDownloadLimit ?? 0)}
          />
        </div>
      </SectionCard>

      {/* ── History table ───────────────────────────────────────────────── */}
      <SectionCard
        title="Agreement history"
        subtitle={`${formatNumber(total)} total${listLoading ? " · loading…" : ""}`}
        flush
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            padding: "12px 16px",
            borderBottom: "1px solid var(--ad-border)"
          }}
        >
          <select
            className="admin-input"
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "" ? "All statuses" : s}
              </option>
            ))}
          </select>
          <select
            className="admin-input"
            value={fPlan}
            onChange={(e) => setFPlan(e.target.value)}
            aria-label="Filter by plan"
          >
            {PLAN_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p === "" ? "All plans" : p}
              </option>
            ))}
          </select>
          <input
            className="admin-input"
            placeholder="State (e.g. MH)"
            value={fState}
            onChange={(e) => setFState(e.target.value.toUpperCase())}
            style={{ width: 120 }}
            aria-label="Filter by state code"
          />
          <input
            className="admin-input"
            placeholder="Search name / phone / email"
            value={fSearch}
            onChange={(e) => setFSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
            aria-label="Search agreements"
          />
        </div>
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(r) => r.id}
          onRowClick={(r) => openDetail(r.id)}
          emptyState={listLoading ? "Loading…" : "No agreements match the filters"}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 16px"
          }}
        >
          <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>
            Page {page} of {totalPages}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </SectionCard>

      {/* ── Detail drawer ───────────────────────────────────────────────── */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={detail ? `${detail.ownerFullName ?? "Agreement"} · ${detail.planId}` : "Agreement"}
        subtitle={detail?.id}
        footer={
          detail?.pdfReady ? (
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={() => void downloadPdf(detail.id)}
            >
              Download PDF
            </button>
          ) : undefined
        }
      >
        {detailLoading && <div style={{ color: "var(--ad-text-3)" }}>Loading…</div>}
        {!detailLoading && !detail && <EmptyState title="Agreement not found" />}
        {detail && (
          <div style={{ display: "grid", gap: 16 }}>
            <DetailGroup title="Parties">
              <Row label="Owner">
                {detail.ownerFullName ?? "-"} · {detail.ownerPhone ?? "-"}
              </Row>
              <Row label="Tenant">
                {detail.tenantFullName ?? "-"} · {detail.tenantPhone ?? "-"}
              </Row>
            </DetailGroup>
            <DetailGroup title="Property & terms">
              <Row label="Address">{detail.propertyFullAddress ?? "-"}</Row>
              <Row label="State / City">
                {detail.stateCode ?? "-"} / {detail.city ?? "-"}
              </Row>
              <Row label="Rent">
                {detail.rentAmountPaise == null ? "-" : formatINR(detail.rentAmountPaise)}
              </Row>
              <Row label="Stamp duty">{formatINR(detail.stampDutyPaise)}</Row>
            </DetailGroup>
            <DetailGroup title="Payment">
              <Row label="Status">{detail.paymentStatus ?? "-"}</Row>
              <Row label="Amount">
                {detail.paymentAmountPaise == null ? "-" : formatINR(detail.paymentAmountPaise)}
              </Row>
              <Row label="Provider">{detail.paymentProvider ?? "-"}</Row>
            </DetailGroup>
            <DetailGroup title="e-Stamp / e-Sign">
              <Row label="e-Stamp ref">{detail.eStampReference ?? "-"}</Row>
              <Row label="e-Sign session">{detail.eSignSessionId ?? "-"}</Row>
              <Row label="e-Sign completed">{formatDate(detail.eSignCompletedAt)}</Row>
            </DetailGroup>
            <DetailGroup title="Step audit timeline">
              {detail.stepAudit.length === 0 ? (
                <div style={{ color: "var(--ad-text-3)", fontSize: 12 }}>No audit entries</div>
              ) : (
                detail.stepAudit.map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--ad-text-2)" }}>
                    Step {a.step} · <strong>{a.outcome}</strong> · {formatDate(a.createdAt)}
                    {a.errorCodes.length > 0 && (
                      <span style={{ color: "var(--ad-text-3)" }}>
                        {" "}
                        · {a.errorCodes.join(", ")}
                      </span>
                    )}
                  </div>
                ))
              )}
            </DetailGroup>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
      <span style={{ color: "var(--ad-text-3)" }}>{label}</span>
      <span style={{ textAlign: "right" }}>{children}</span>
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ad-text-3)" }}>{title}</div>
      {children}
    </div>
  );
}
