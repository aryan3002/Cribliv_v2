"use client";

import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { useEffect, useState } from "react";
import { Drawer } from "../primitives/Drawer";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { formatDate } from "../../../lib/admin/format";
import {
  listCityLocalities,
  listCityLandmarks,
  listCityMetro,
  setSeoCityEnabled,
  fetchSeoCopyStatus,
  generateSeoCopyOne,
  generateSeoCopyBatchForCity,
  revalidateSeoPaths,
  type SeoCityConfigVm,
  type SeoLocalityRow,
  type SeoLandmarkRow,
  type SeoMetroRow,
  type SeoCopyProvenance
} from "../../../lib/admin-api";
import { SeoCopyEditModal } from "./SeoCopyEditModal";

interface Props {
  city: SeoCityConfigVm | null;
  accessToken: string;
  onClose: () => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
  onChanged: () => void;
}

type TabKey = "localities" | "landmarks" | "metro";
type Status = "idle" | "loading" | "loaded" | "error";

interface TabState<T> {
  status: Status;
  rows: T[];
  error: string | null;
}

const IDLE: TabState<never> = { status: "idle", rows: [], error: null };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function metroSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function coords(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return "-";
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function PreviewLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="admin-btn admin-btn--ghost admin-btn--sm"
    >
      Preview
    </a>
  );
}

const PROVENANCE_LABEL: Record<SeoCopyProvenance, string> = {
  override: "Override",
  ai: "AI",
  template: "Template"
};
const PROVENANCE_TONE: Record<SeoCopyProvenance, "brand" | "trust" | "muted"> = {
  override: "brand",
  ai: "trust",
  template: "muted"
};

function CopyStatusChips({
  status
}: {
  status?: { en: SeoCopyProvenance; hi: SeoCopyProvenance };
}) {
  if (!status) return <span className="admin-table__id">—</span>;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <StatusPill
        status={status.en}
        tone={PROVENANCE_TONE[status.en]}
        label={`EN · ${PROVENANCE_LABEL[status.en]}`}
        noDot
      />
      <StatusPill
        status={status.hi}
        tone={PROVENANCE_TONE[status.hi]}
        label={`HI · ${PROVENANCE_LABEL[status.hi]}`}
        noDot
      />
    </div>
  );
}

function localizedLocalityPaths(citySlug: string, slug: string): string[] {
  return [`/en/city/${citySlug}/${slug}`, `/hi/city/${citySlug}/${slug}`];
}

export function SeoCityReviewDrawer({ city, accessToken, onClose, onToast, onChanged }: Props) {
  const [tab, setTab] = useState<TabKey>("localities");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [localities, setLocalities] = useState<TabState<SeoLocalityRow>>(IDLE);
  const [landmarks, setLandmarks] = useState<TabState<SeoLandmarkRow>>(IDLE);
  const [metro, setMetro] = useState<TabState<SeoMetroRow>>(IDLE);
  const [copyStatus, setCopyStatus] = useState<
    Record<string, { en: SeoCopyProvenance; hi: SeoCopyProvenance }>
  >({});
  const [generatingSlug, setGeneratingSlug] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<{ generated: number; skipped: number } | null>(
    null
  );
  const [editing, setEditing] = useState<SeoLocalityRow | null>(null);

  const citySlug = city?.citySlug ?? null;

  // Reset every tab + notes and eager-load localities whenever the city changes.
  useEffect(() => {
    if (!citySlug) return;
    setTab("localities");
    setSearch("");
    setNotes(city?.notes ?? "");
    setLandmarks(IDLE);
    setMetro(IDLE);
    setCopyStatus({});
    setBatchResult(null);
    setEditing(null);

    let cancelled = false;
    setLocalities({ status: "loading", rows: [], error: null });
    listCityLocalities(citySlug)
      .then((rows) => {
        if (!cancelled) setLocalities({ status: "loaded", rows, error: null });
      })
      .catch((err) => {
        if (!cancelled) setLocalities({ status: "error", rows: [], error: errMsg(err) });
      });
    // Copy-status drives the per-locality chips; best-effort (chips show "—").
    fetchSeoCopyStatus(accessToken, citySlug)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, { en: SeoCopyProvenance; hi: SeoCopyProvenance }> = {};
        for (const r of rows) map[r.slug] = { en: r.en, hi: r.hi };
        setCopyStatus(map);
      })
      .catch(() => {
        if (!cancelled) setCopyStatus({});
      });
    return () => {
      cancelled = true;
    };
    // city.notes is intentionally read at city-change time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citySlug]);

  function loadLandmarks() {
    if (!citySlug || landmarks.status !== "idle") return;
    setLandmarks({ status: "loading", rows: [], error: null });
    listCityLandmarks(citySlug)
      .then((rows) => setLandmarks({ status: "loaded", rows, error: null }))
      .catch((err) => setLandmarks({ status: "error", rows: [], error: errMsg(err) }));
  }

  function loadMetro() {
    if (!citySlug || metro.status !== "idle") return;
    setMetro({ status: "loading", rows: [], error: null });
    listCityMetro(citySlug)
      .then((rows) => setMetro({ status: "loaded", rows, error: null }))
      .catch((err) => setMetro({ status: "error", rows: [], error: errMsg(err) }));
  }

  function selectTab(next: TabKey) {
    setTab(next);
    setSearch("");
    if (next === "landmarks") loadLandmarks();
    if (next === "metro") loadMetro();
  }

  async function approve() {
    if (!city) return;
    const willEnable = !city.programmaticEnabled;
    setSaving(true);
    try {
      await setSeoCityEnabled(
        accessToken,
        city.citySlug,
        willEnable,
        notes.trim() ? notes : undefined
      );
      onToast(`${city.nameEn} ${willEnable ? "enabled" : "disabled"}`, "trust");
      onChanged();
      onClose();
    } catch (err) {
      onToast(errMsg(err) || "Could not update city", "danger");
    } finally {
      setSaving(false);
    }
  }

  async function refreshCopyStatus() {
    if (!citySlug) return;
    try {
      const rows = await fetchSeoCopyStatus(accessToken, citySlug);
      const map: Record<string, { en: SeoCopyProvenance; hi: SeoCopyProvenance }> = {};
      for (const r of rows) map[r.slug] = { en: r.en, hi: r.hi };
      setCopyStatus(map);
    } catch {
      // Keep the existing chips on a transient failure.
    }
  }

  async function handleGenerate(r: SeoLocalityRow) {
    if (!citySlug) return;
    setGeneratingSlug(r.slug);
    try {
      await generateSeoCopyOne(accessToken, citySlug, r.slug);
      await revalidateSeoPaths(accessToken, localizedLocalityPaths(citySlug, r.slug));
      onToast(`Generated copy for ${r.name_en}`, "trust");
      await refreshCopyStatus();
    } catch (err) {
      onToast(errMsg(err) || "Generation failed", "danger");
    } finally {
      setGeneratingSlug(null);
    }
  }

  async function handleBatch() {
    if (!citySlug) return;
    setBatchRunning(true);
    setBatchResult(null);
    try {
      const res = await generateSeoCopyBatchForCity(accessToken, citySlug);
      setBatchResult(res);
      onToast(`Generated ${res.generated}, skipped ${res.skipped}`, "trust");
      await revalidateSeoPaths(accessToken, [`/en/city/${citySlug}`, `/hi/city/${citySlug}`]);
      await refreshCopyStatus();
    } catch (err) {
      onToast(errMsg(err) || "Batch generation failed", "danger");
    } finally {
      setBatchRunning(false);
    }
  }

  if (!city) return null;

  const enabled = city.programmaticEnabled;
  const q = search.trim().toLowerCase();
  // Admin-only preview tree, NOT the public path. Preview used to be
  // `/en/city/<city>/<slug>?adminPreview=1`, but a page that declares
  // `searchParams` is forced to render per request by Next, which opted all ~33k
  // public programmatic URLs out of ISR. The escape hatch now lives on its own
  // dynamic route so the public pages can be cached. See lib/admin-preview.ts.
  const previewBase = `/en/seo-preview/city/${city.citySlug}`;

  const localityCols: Column<SeoLocalityRow>[] = [
    {
      key: "name",
      header: "Locality",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name_en}</div>
          <div className="admin-table__id">{r.name_hi}</div>
        </div>
      )
    },
    { key: "listings", header: "Listings", align: "right", render: (r) => r.listing_count },
    {
      key: "indexable",
      header: "Indexable",
      align: "center",
      render: (r) => (r.listing_count >= INDEXABLE_MIN_LISTINGS ? "✓" : "✗")
    },
    {
      key: "copy",
      header: "Copy",
      render: (r) => <CopyStatusChips status={copyStatus[r.slug]} />
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => {
        const st = copyStatus[r.slug];
        const hasCopy = st ? st.en !== "template" || st.hi !== "template" : false;
        return (
          <div
            style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}
          >
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => void handleGenerate(r)}
              disabled={generatingSlug === r.slug}
            >
              {generatingSlug === r.slug ? "Generating…" : hasCopy ? "Regenerate" : "Generate"}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => setEditing(r)}
            >
              Edit
            </button>
            <PreviewLink href={`${previewBase}/${r.slug}`} />
          </div>
        );
      }
    }
  ];

  const landmarkCols: Column<SeoLandmarkRow>[] = [
    {
      key: "name",
      header: "Landmark",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.name_en}</div>
          <div className="admin-table__id">{r.name_hi}</div>
        </div>
      )
    },
    { key: "type", header: "Type", render: (r) => r.type },
    { key: "coords", header: "Coords", render: (r) => coords(r.lat, r.lng) },
    {
      key: "preview",
      header: "",
      align: "right",
      render: (r) => <PreviewLink href={`${previewBase}/near/${r.slug}`} />
    }
  ];

  const metroCols: Column<SeoMetroRow>[] = [
    { key: "station", header: "Station", render: (r) => r.station_name },
    { key: "line", header: "Line", render: (r) => r.line_name },
    { key: "coords", header: "Coords", render: (r) => coords(r.lat, r.lng) },
    {
      key: "preview",
      header: "",
      align: "right",
      render: (r) => <PreviewLink href={`${previewBase}/metro/${metroSlug(r.station_name)}`} />
    }
  ];

  const filteredLocalities = localities.rows.filter(
    (r) => !q || `${r.name_en} ${r.name_hi} ${r.slug}`.toLowerCase().includes(q)
  );
  const filteredLandmarks = landmarks.rows.filter(
    (r) => !q || `${r.name_en} ${r.name_hi} ${r.slug} ${r.type}`.toLowerCase().includes(q)
  );
  const filteredMetro = metro.rows.filter(
    (r) => !q || `${r.station_name} ${r.line_name}`.toLowerCase().includes(q)
  );

  const active = tab === "localities" ? localities : tab === "landmarks" ? landmarks : metro;

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "localities", label: "Localities", count: city.localityCount },
    { key: "landmarks", label: "Landmarks", count: city.landmarkCount },
    { key: "metro", label: "Metro", count: city.metroCount }
  ];

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={city.nameEn}
        subtitle={city.citySlug}
        footer={
          <div style={{ display: "flex", gap: 8, width: "100%", alignItems: "flex-end" }}>
            <textarea
              aria-label="Notes"
              placeholder="Approval notes (audited)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ flex: 1, resize: "vertical", font: "inherit", padding: "6px 8px" }}
            />
            <button
              type="button"
              className={`admin-btn ${enabled ? "admin-btn--danger" : "admin-btn--primary"}`}
              onClick={() => void approve()}
              disabled={saving}
              aria-label={`${enabled ? "Disable" : "Enable"} ${city.nameEn}`}
            >
              {saving ? "Saving…" : enabled ? "Disable" : "Enable"}
            </button>
          </div>
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <StatusPill
            status={enabled ? "active" : "draft"}
            label={enabled ? "Live" : "Draft"}
            tone={enabled ? "trust" : "muted"}
          />
          <span className="admin-table__id">Enabled {formatDate(city.enabledAt)}</span>
        </div>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            margin: "0 0 16px"
          }}
        >
          {[
            { label: "Localities", value: city.localityCount },
            { label: "Landmarks", value: city.landmarkCount },
            { label: "Metro", value: city.metroCount },
            { label: "Indexable", value: city.indexableCount }
          ].map((s) => (
            <div key={s.label}>
              <dt className="admin-table__id">{s.label}</dt>
              <dd style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>{s.value}</dd>
            </div>
          ))}
        </dl>

        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tab === t.key}
              className={`admin-btn admin-btn--sm ${tab === t.key ? "admin-btn--primary" : "admin-btn--ghost"}`}
              onClick={() => selectTab(t.key)}
            >
              {t.label} {t.count}
            </button>
          ))}
        </div>

        {tab === "localities" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              flexWrap: "wrap"
            }}
          >
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--sm"
              onClick={() => void handleBatch()}
              disabled={batchRunning}
            >
              {batchRunning ? "Generating…" : "Generate all missing (≥3 listings)"}
            </button>
            {batchResult && (
              <span className="admin-table__id">
                {batchResult.generated} generated · {batchResult.skipped} skipped
              </span>
            )}
          </div>
        )}

        <input
          type="search"
          placeholder={`Search ${tab}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={`Search ${tab}`}
          style={{ width: "100%", marginBottom: 10, padding: "6px 10px", font: "inherit" }}
        />

        {active.status === "loading" && <div className="admin-table__id">Loading…</div>}
        {active.status === "error" && (
          <div className="admin-error" role="alert">
            {active.error}
          </div>
        )}
        {active.status === "loaded" && tab === "localities" && (
          <DataTable
            columns={localityCols}
            rows={filteredLocalities}
            rowKey={(r) => r.slug}
            emptyState="No localities"
          />
        )}
        {active.status === "loaded" && tab === "landmarks" && (
          <DataTable
            columns={landmarkCols}
            rows={filteredLandmarks}
            rowKey={(r) => r.slug}
            emptyState="No landmarks"
          />
        )}
        {active.status === "loaded" && tab === "metro" && (
          <DataTable
            columns={metroCols}
            rows={filteredMetro}
            rowKey={(r) => `${r.line_name}::${r.station_name}`}
            emptyState="No metro stations"
          />
        )}
      </Drawer>
      {editing && citySlug && (
        <SeoCopyEditModal
          accessToken={accessToken}
          citySlug={citySlug}
          locality={{ slug: editing.slug, name_en: editing.name_en, name_hi: editing.name_hi }}
          onClose={() => setEditing(null)}
          onSaved={() => void refreshCopyStatus()}
          onToast={onToast}
        />
      )}
    </>
  );
}
