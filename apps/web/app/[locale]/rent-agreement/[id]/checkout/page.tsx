"use client";
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, CreditCard, FileDown } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api";
import { useCheckout } from "@/lib/rent-agreement/hooks/use-checkout";
import { useDownload } from "@/lib/rent-agreement/hooks/use-download";
import { useDraft } from "@/lib/rent-agreement/hooks/use-draft";
import { usePreview } from "@/lib/rent-agreement/hooks/use-preview";
import { useStatusPoll } from "@/lib/rent-agreement/hooks/use-status-poll";
import { newIdempotencyKey } from "@/lib/rent-agreement/state/idempotency";
import { isTerminal, statusLabel } from "@/lib/rent-agreement/state/status-machine";
import dynamic from "next/dynamic";
import { StatusBadge } from "../../_components/StatusBadge";
import { formatRupees, planLabel } from "../../_components/ui-copy";

// pdf.js touches browser-only globals (DOMMatrix) at import time — load the
// viewer on the client only so it never runs during server rendering.
const PdfPreview = dynamic(() => import("../../_components/PdfPreview").then((m) => m.PdfPreview), {
  ssr: false,
  loading: () => <p className="ra-loading">Loading viewer…</p>
});

export default function Page({ params }: { params: { locale: string; id: string } }) {
  const [idemKey] = useState(() => newIdempotencyKey("checkout"));
  const [polling, setPolling] = useState(false);
  const checkout = useCheckout();
  const download = useDownload();
  const draft = useDraft(params.id);
  const status = useStatusPoll(params.id, { enabled: polling });

  const s = status.data?.status;
  const ready = s === "generated" || draft.data?.status === "generated";
  const preview = usePreview(params.id, ready);

  const downloadCount = draft.data?.download_count ?? 0;
  const maxDownloads = draft.data?.max_downloads ?? 5;
  const noDownloadsLeft = downloadCount >= maxDownloads;

  async function pay() {
    await checkout.mutateAsync({
      agreementId: params.id,
      provider: "razorpay",
      idempotencyKey: idemKey
    });
    setPolling(true);
  }

  // The ONLY counted path. Server increments download_count (max 5) on
  // GET /download; we then save the file via a same-origin blob URL so the
  // browser downloads it rather than navigating to (and exposing) the URL.
  async function savePdf() {
    const r = await download.mutateAsync({ agreementId: params.id });
    const url = r.sas_url.startsWith("http")
      ? r.sas_url
      : `${getApiBaseUrl().replace(/\/v1$/, "")}${r.sas_url}`;
    const resp = await fetch(url);
    const blob = await resp.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = "rent-agreement.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  }

  const shownStatus = s ?? draft.data?.status;

  return (
    <>
      <div className="ra-topbar">
        <nav className="ra-breadcrumbs" aria-label="Breadcrumb">
          <Link href={`/${params.locale}/rent-agreement` as Route}>Rent agreements</Link>
          <span>/</span>
          <Link href={`/${params.locale}/rent-agreement/${params.id}` as Route}>Agreement</Link>
          <span>/</span>
          <span>Checkout</span>
        </nav>
        <Link
          href={`/${params.locale}/rent-agreement/${params.id}` as Route}
          className="ra-button-ghost"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Overview
        </Link>
      </div>

      <header className="ra-page-header">
        <div>
          <h1 className="ra-page-title">Checkout</h1>
          <p className="ra-page-copy">
            Complete payment, wait for PDF generation, then review and download the agreement.
          </p>
        </div>
        {shownStatus && <StatusBadge status={shownStatus} />}
      </header>

      <div className="ra-checkout-grid">
        <section className="ra-panel" aria-labelledby="checkout-action-title">
          <div className="ra-panel-header">
            <h2 id="checkout-action-title" className="ra-panel-title">
              Payment
            </h2>
          </div>
          <div className="ra-panel-body">
            <div className="ra-form">
              <button onClick={pay} disabled={checkout.isPending || ready} className="ra-button">
                <CreditCard size={17} aria-hidden="true" />
                {ready ? "Paid" : checkout.isPending ? "Submitting…" : "Pay now"}
              </button>
              {polling && !ready && (
                <p className="ra-muted">
                  Status: <b>{s ? statusLabel(s) : "Waiting for payment status…"}</b>
                </p>
              )}
              {s && isTerminal(s) && s !== "generated" && (
                <p className="ra-error-box" role="alert">
                  {statusLabel(s)}
                </p>
              )}
            </div>
          </div>
        </section>

        <aside className="ra-panel" aria-labelledby="checkout-summary-title">
          <div className="ra-panel-header">
            <h2 id="checkout-summary-title" className="ra-panel-title">
              Summary
            </h2>
          </div>
          <div className="ra-panel-body">
            {draft.isLoading && <p className="ra-muted">Loading summary…</p>}
            {draft.data && (
              <dl className="ra-summary-list">
                <div className="ra-summary-row">
                  <dt>Plan</dt>
                  <dd>{planLabel(draft.data.plan_id)}</dd>
                </div>
                <div className="ra-summary-row">
                  <dt>Monthly rent</dt>
                  <dd>{formatRupees(draft.data.rent_amount_paise)}</dd>
                </div>
                <div className="ra-summary-row">
                  <dt>Stamp duty</dt>
                  <dd>{formatRupees(draft.data.stamp_duty_paise)}</dd>
                </div>
                <div className="ra-summary-row">
                  <dt>Downloads</dt>
                  <dd>
                    {downloadCount}/{maxDownloads}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </aside>
      </div>

      {ready && (
        <section className="ra-panel" aria-labelledby="preview-title" style={{ marginTop: 16 }}>
          <div className="ra-panel-header">
            <h2 id="preview-title" className="ra-panel-title">
              Final agreement
            </h2>
            <button
              onClick={savePdf}
              disabled={download.isPending || noDownloadsLeft}
              className="ra-button"
            >
              <FileDown size={17} aria-hidden="true" />
              {download.isPending
                ? "Preparing…"
                : noDownloadsLeft
                  ? "Download limit reached"
                  : "Download PDF"}
            </button>
          </div>
          <div className="ra-panel-body">
            <p className="ra-muted">
              {downloadCount} of {maxDownloads} downloads used · preview is unlimited
            </p>
            {download.isError && (
              <p className="ra-error-box" role="alert">
                {(download.error as { code?: string }).code ?? "Download failed"}
              </p>
            )}
            {preview.isLoading && <p className="ra-loading">Loading preview…</p>}
            {preview.isError && <p className="ra-error">Could not load the preview.</p>}
            {preview.data && <PdfPreview bytes={preview.data} />}
          </div>
        </section>
      )}
    </>
  );
}
