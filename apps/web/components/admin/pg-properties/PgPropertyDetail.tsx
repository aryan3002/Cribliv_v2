"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchAdminPgListing,
  fetchAdminPgListingAnalytics,
  updateAdminPgProperty
} from "../../../lib/admin-api";
import type {
  PgAdminListingDetail as Detail,
  PgAdminListingAnalytics,
  PgPropertyStatus
} from "@cribliv/shared-types";
import { SectionCard } from "../primitives/SectionCard";
import { StatCard } from "../primitives/StatCard";
import { StatusPill } from "../primitives/StatusPill";
import { AreaChart } from "../charts/AreaChart";
import { ConfirmDialog } from "../primitives/ConfirmDialog";
import { VisibilityControls } from "./VisibilityControls";
import { formatDate } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  listingId: string;
  onBack: () => void;
  onToast?: (msg: string, kind?: "success" | "error") => void;
}

type RangeDays = 7 | 30 | 90;
const RANGES: RangeDays[] = [7, 30, 90];

type MetricKey = "views" | "leads" | "appearances" | "clicks";
const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "views", label: "Views", color: "#0066FF" },
  { key: "leads", label: "Leads", color: "#0D9F4F" },
  { key: "appearances", label: "Appearances", color: "#7C3AED" },
  { key: "clicks", label: "Clicks", color: "#E88C00" }
];

const nf = (n: number) => n.toLocaleString("en-IN");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Delta % between the recent half and the prior half of a series. null when no baseline. */
function halfDelta(series: number[]): { value: number } | null {
  if (series.length < 4) return null;
  const mid = Math.floor(series.length / 2);
  const prev = series.slice(0, mid).reduce((a, b) => a + b, 0);
  const recent = series.slice(mid).reduce((a, b) => a + b, 0);
  if (prev === 0) return recent > 0 ? { value: 100 } : null;
  return { value: Math.round(((recent - prev) / prev) * 100) };
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#065F46" : score >= 40 ? "#92400E" : "#991B1B";
  const bg = score >= 70 ? "#D1FAE5" : score >= 40 ? "#FEF3C7" : "#FEE2E2";
  const border = score >= 70 ? "#6EE7B7" : score >= 40 ? "#FDE68A" : "#FECACA";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 12px",
        borderRadius: 20,
        background: bg,
        color,
        fontWeight: 700,
        fontSize: 12,
        border: `1px solid ${border}`
      }}
    >
      Score {score}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--ad-text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 4
      }}
    >
      {children}
    </div>
  );
}

/** Horizontal conversion funnel: Appearances → Clicks → Views → Leads. */
function ConversionFunnel({ a }: { a: PgAdminListingAnalytics }) {
  const stages = [
    { label: "Appearances", value: a.appearances, color: "#7C3AED" },
    { label: "Clicks", value: a.clicks, color: "#E88C00" },
    { label: "Views", value: a.views, color: "#0066FF" },
    { label: "Leads", value: a.leads, color: "#0D9F4F" }
  ];
  const top = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {stages.map((s, i) => {
        const w = Math.max(6, (s.value / top) * 100);
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <div key={s.label}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ad-text-2)" }}>
                {s.label}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                {conv != null && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ad-text-3)",
                      fontVariantNumeric: "tabular-nums"
                    }}
                  >
                    {conv}% ↓
                  </span>
                )}
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--ad-text)",
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  {nf(s.value)}
                </span>
              </span>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 6,
                background: "var(--ad-surface-2)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${w}%`,
                  height: "100%",
                  borderRadius: 6,
                  background: `linear-gradient(90deg, ${s.color}, ${s.color}CC)`,
                  transition: "width .5s cubic-bezier(.4,0,.2,1)"
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PgPropertyDetail({ accessToken, listingId, onBack, onToast }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [analytics, setAnalytics] = useState<PgAdminListingAnalytics | null>(null);
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [metric, setMetric] = useState<MetricKey>("views");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [form, setForm] = useState({
    display_name: "",
    status: "active" as PgPropertyStatus,
    lat: "",
    lng: "",
    total_floors: ""
  });
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    Promise.all([
      fetchAdminPgListing(accessToken, listingId),
      fetchAdminPgListingAnalytics(accessToken, listingId, 30)
    ])
      .then(([d, a]) => {
        if (cancelled) return;
        setDetail(d);
        setAnalytics(a);
        if (d.property) {
          setForm({
            display_name: d.property.display_name ?? "",
            status: d.property.status,
            lat: d.property.lat != null ? String(d.property.lat) : "",
            lng: d.property.lng != null ? String(d.property.lng) : "",
            total_floors: d.property.total_floors != null ? String(d.property.total_floors) : ""
          });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, listingId]);

  useEffect(() => {
    let cancelled = false;
    setAnalyticsLoading(true);
    fetchAdminPgListingAnalytics(accessToken, listingId, rangeDays)
      .then((a) => {
        if (!cancelled) setAnalytics(a);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, listingId, rangeDays]);

  const series = useMemo(() => {
    const t = analytics?.trend ?? [];
    const pick = (k: MetricKey) =>
      t.map((p) => (p as unknown as Record<MetricKey, number>)[k] ?? 0);
    return {
      views: pick("views"),
      leads: pick("leads"),
      appearances: pick("appearances"),
      clicks: pick("clicks")
    };
  }, [analytics]);

  const save = async () => {
    if (!detail?.property) return;
    setSaving(true);
    try {
      await updateAdminPgProperty(accessToken, detail.property.id, {
        display_name: form.display_name || undefined,
        status: form.status,
        lat: form.lat !== "" ? Number(form.lat) : null,
        lng: form.lng !== "" ? Number(form.lng) : null,
        total_floors: form.total_floors !== "" ? Number(form.total_floors) : null
      });
      const fresh = await fetchAdminPgListing(accessToken, listingId);
      setDetail(fresh);
      onToast?.("Property updated", "success");
    } catch {
      onToast?.("Failed to save changes", "error");
    } finally {
      setSaving(false);
      setConfirmSave(false);
    }
  };

  const copyId = () => {
    void navigator.clipboard?.writeText(listingId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const backBtn = (
    <button type="button" className="admin-chip" onClick={onBack} style={{ flexShrink: 0 }}>
      ← Back to listings
    </button>
  );

  if (loadError) {
    return (
      <div
        className="admin-main__section"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {backBtn}
        <div
          style={{
            padding: "48px 0",
            textAlign: "center",
            color: "var(--ad-text-3)",
            fontSize: 13
          }}
        >
          Failed to load listing. Check network or try refreshing.
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div
        className="admin-main__section"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {backBtn}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
          {[120, 220, 200].map((h, i) => (
            <div
              key={i}
              className="admin-card"
              style={{
                height: h,
                background: "linear-gradient(90deg,#F3F4F6 25%,#E9EBEE 50%,#F3F4F6 75%)",
                backgroundSize: "200% 100%",
                animation: "pg-skel-shimmer 1.4s ease-in-out infinite"
              }}
            />
          ))}
        </div>
        <style>{`@keyframes pg-skel-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      </div>
    );
  }

  const hasProperty = detail.property != null;
  const a = analytics;
  const activeMetric = METRICS.find((m) => m.key === metric)!;
  const currentState = `${detail.property?.display_name ?? "—"} · ${form.status} · lat:${detail.property?.lat ?? "—"} lng:${detail.property?.lng ?? "—"}`;
  const proposedState = `${form.display_name || "—"} · ${form.status} · lat:${form.lat || "—"} lng:${form.lng || "—"}`;

  return (
    <div
      className="admin-main__section"
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <style>{`
        @keyframes pg-pulse-amber { 0%,100% { opacity:1; } 50% { opacity:.6; } }
        .pgd-grid { display:grid; grid-template-columns: minmax(0,1fr) 340px; gap:16px; align-items:start; }
        @media (max-width: 1080px) { .pgd-grid { grid-template-columns: 1fr; } }
        .pgd-aside { display:flex; flex-direction:column; gap:16px; position:sticky; top:16px; }
        @media (max-width: 1080px) { .pgd-aside { position:static; } }
        .pgd-kpis { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; }
        @media (max-width: 720px) { .pgd-kpis { grid-template-columns: repeat(2,1fr); } }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        {backBtn}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "var(--ad-text)",
                fontFamily: "var(--font-heading, inherit)"
              }}
            >
              {detail.listing.title || "Untitled listing"}
            </h1>
            <StatusPill status={detail.listing.status} />
            {a?.composite_score != null && <ScoreBadge score={Math.round(a.composite_score)} />}
            {detail.overrides.global && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--ad-warning)",
                  background: "var(--ad-warning-soft)",
                  border: "1px solid #FDE68A",
                  borderRadius: 20,
                  padding: "3px 10px"
                }}
              >
                Operator analytics cut
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 13,
              color: "var(--ad-text-2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap"
            }}
          >
            <span>
              {[detail.property?.display_name, detail.locality_slug, detail.city_slug]
                .filter(Boolean)
                .join(" · ") || "—"}
            </span>
            <button
              type="button"
              className="admin-chip admin-btn--sm"
              onClick={copyId}
              style={{ fontSize: 11 }}
            >
              {copied ? "Copied ✓" : "Copy listing ID"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className="admin-chip"
              aria-pressed={rangeDays === r}
              onClick={() => setRangeDays(r)}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {/* ── Two-column body ─────────────────────────────────────── */}
      <div className="pgd-grid">
        {/* MAIN */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {/* KPI grid */}
          <div className="pgd-kpis">
            <StatCard
              label="Appearances"
              value={a ? nf(a.appearances) : "—"}
              spark={series.appearances}
              delta={a ? halfDelta(series.appearances) : null}
            />
            <StatCard
              label="Clicks"
              value={a ? nf(a.clicks) : "—"}
              spark={series.clicks}
              delta={a ? halfDelta(series.clicks) : null}
              tone="warn"
            />
            <StatCard
              label="Views"
              value={a ? nf(a.views) : "—"}
              spark={series.views}
              delta={a ? halfDelta(series.views) : null}
              tone="brand"
            />
            <StatCard
              label="Leads"
              value={a ? nf(a.leads) : "—"}
              spark={series.leads}
              delta={a ? halfDelta(series.leads) : null}
              tone="trust"
            />
            <StatCard
              label="CTR"
              value={a ? pct(a.ctr) : "—"}
              tone={a && a.ctr >= 0.05 ? "trust" : "warn"}
            />
            <StatCard label="Interest rate" value={a ? pct(a.interest_rate) : "—"} />
            <StatCard label="Conversion" value={a ? pct(a.conversion) : "—"} tone="brand" />
            <StatCard
              label="Listing score"
              value={a?.composite_score != null ? Math.round(a.composite_score) : "—"}
            />
          </div>

          {/* Trend with metric toggle */}
          <SectionCard
            title="Performance trend"
            subtitle={`Last ${rangeDays} days${analyticsLoading ? " · refreshing…" : ""}`}
            action={
              <div style={{ display: "flex", gap: 6 }}>
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className="admin-chip"
                    aria-pressed={metric === m.key}
                    onClick={() => setMetric(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            }
          >
            {a && a.trend.length > 0 ? (
              <AreaChart
                data={a.trend as unknown as Array<Record<string, string | number>>}
                xKey="day"
                yKey={metric}
                height={200}
                color={activeMetric.color}
                xTickFormatter={(d) => d.slice(5)}
              />
            ) : (
              <div
                style={{
                  padding: "28px 0",
                  textAlign: "center",
                  color: "var(--ad-text-3)",
                  fontSize: 13
                }}
              >
                No daily activity in this range yet.
              </div>
            )}
          </SectionCard>

          {/* Conversion funnel */}
          <SectionCard
            title="Conversion funnel"
            subtitle="Stage-to-stage drop-off across the discovery → lead journey."
          >
            {a ? (
              <ConversionFunnel a={a} />
            ) : (
              <div style={{ color: "var(--ad-text-3)", fontSize: 13 }}>—</div>
            )}
          </SectionCard>
        </div>

        {/* SIDEBAR */}
        <aside className="pgd-aside">
          {/* Property & location */}
          <SectionCard
            title="Property & location"
            subtitle="Shared by every listing this operator owns. Geo/locality propagate to public listings."
          >
            {hasProperty ? (
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <FieldLabel>Property name</FieldLabel>
                  <input
                    className="admin-input"
                    value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <FieldLabel>Property status</FieldLabel>
                  <select
                    className="admin-input"
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as PgPropertyStatus })
                    }
                    style={{ width: "100%" }}
                  >
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <FieldLabel>Latitude</FieldLabel>
                    <input
                      className="admin-input"
                      value={form.lat}
                      onChange={(e) => setForm({ ...form, lat: e.target.value })}
                      placeholder="26.8467"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <FieldLabel>Longitude</FieldLabel>
                    <input
                      className="admin-input"
                      value={form.lng}
                      onChange={(e) => setForm({ ...form, lng: e.target.value })}
                      placeholder="80.9462"
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
                <div style={{ maxWidth: 140 }}>
                  <FieldLabel>Total floors</FieldLabel>
                  <input
                    className="admin-input"
                    type="number"
                    min={1}
                    value={form.total_floors}
                    onChange={(e) => setForm({ ...form, total_floors: e.target.value })}
                    placeholder="—"
                    style={{ width: "100%" }}
                  />
                </div>
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  disabled={saving}
                  onClick={() => setConfirmSave(true)}
                  style={{ width: "fit-content", minWidth: 120 }}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            ) : (
              <div style={{ color: "var(--ad-text-3)", fontSize: 13 }}>
                This listing has no linked PG property, so location/geo can’t be edited here.
              </div>
            )}
          </SectionCard>

          {/* Owner */}
          <SectionCard title="Owner">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { label: "Name", value: detail.owner.name },
                { label: "Phone", value: detail.owner.phone },
                { label: "Email", value: detail.owner.email },
                { label: "Total properties", value: String(detail.owner.property_count) },
                { label: "Verification", value: detail.owner.verification_status },
                { label: "Member since", value: formatDate(detail.owner.created_at) }
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "baseline"
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
                  <span
                    style={{
                      fontSize: 13,
                      color: value ? "var(--ad-text)" : "var(--ad-text-3)",
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums"
                    }}
                  >
                    {value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Analytics visibility */}
          <SectionCard
            title="Analytics visibility"
            subtitle="Non-destructive — data keeps collecting; restoring shows full history instantly."
          >
            <VisibilityControls
              accessToken={accessToken}
              detail={detail}
              onChanged={setDetail}
              onToast={onToast}
            />
          </SectionCard>
        </aside>
      </div>

      {/* Save confirm */}
      <ConfirmDialog
        open={confirmSave}
        title="Save property changes?"
        body={
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <div>
              <span style={{ fontWeight: 600, color: "var(--ad-text-2)" }}>Current: </span>
              <code
                style={{
                  fontSize: 12,
                  background: "var(--ad-surface-2)",
                  padding: "2px 7px",
                  borderRadius: 4,
                  color: "var(--ad-text-2)"
                }}
              >
                {currentState}
              </code>
            </div>
            <div>
              <span style={{ fontWeight: 600, color: "var(--ad-brand)" }}>After: </span>
              <code
                style={{
                  fontSize: 12,
                  background: "var(--ad-brand-soft)",
                  padding: "2px 7px",
                  borderRadius: 4,
                  color: "var(--ad-brand)"
                }}
              >
                {proposedState}
              </code>
            </div>
          </div>
        }
        confirmLabel="Save changes"
        busy={saving}
        onCancel={() => setConfirmSave(false)}
        onConfirm={save}
      />
    </div>
  );
}
