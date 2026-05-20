"use client";
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, CreditCard, FileDown } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api";
import { useCheckout } from "@/lib/rent-agreement/hooks/use-checkout";
import { useDownload } from "@/lib/rent-agreement/hooks/use-download";
import { useDraft } from "@/lib/rent-agreement/hooks/use-draft";
import { useStatusPoll } from "@/lib/rent-agreement/hooks/use-status-poll";
import { newIdempotencyKey } from "@/lib/rent-agreement/state/idempotency";
import { isTerminal, statusLabel } from "@/lib/rent-agreement/state/status-machine";
import { StatusBadge } from "../../_components/StatusBadge";
import { formatRupees, planLabel } from "../../_components/ui-copy";

export default function Page({ params }: { params: { locale: string; id: string } }) {
  const [idemKey] = useState(() => newIdempotencyKey("checkout"));
  const [polling, setPolling] = useState(false);
  const checkout = useCheckout();
  const download = useDownload();
  const draft = useDraft(params.id);
  const status = useStatusPoll(params.id, { enabled: polling });

  async function pay() {
    await checkout.mutateAsync({
      agreementId: params.id,
      provider: "razorpay",
      idempotencyKey: idemKey
    });
    setPolling(true);
  }

  async function fetchSas() {
    const r = await download.mutateAsync({ agreementId: params.id });
    // D3: dev sas_url is relative ("/v1/rent-agreement/_dev/pdf-bytes/...").
    // getApiBaseUrl() already carries the /v1 suffix the relative path repeats,
    // so strip it before joining.
    const url = r.sas_url.startsWith("http")
      ? r.sas_url
      : `${getApiBaseUrl().replace(/\/v1$/, "")}${r.sas_url}`;
    window.open(url, "_blank");
  }

  const s = status.data?.status;
  const ready = s === "generated";
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
            Complete payment, wait for PDF generation, then open the final agreement.
          </p>
        </div>
        {shownStatus && <StatusBadge status={shownStatus} />}
      </header>

      <div className="ra-checkout-grid">
        <section className="ra-panel" aria-labelledby="checkout-action-title">
          <div className="ra-panel-header">
            <h2 id="checkout-action-title" className="ra-panel-title">
              Payment and PDF
            </h2>
          </div>
          <div className="ra-panel-body">
            <div className="ra-form">
              <button onClick={pay} disabled={checkout.isPending} className="ra-button">
                <CreditCard size={17} aria-hidden="true" />
                {checkout.isPending ? "Submitting…" : "Pay now"}
              </button>
              {polling && (
                <p className="ra-muted">
                  Status: <b>{s ? statusLabel(s) : "Waiting for payment status…"}</b>
                </p>
              )}
              {ready && (
                <button
                  onClick={fetchSas}
                  disabled={download.isPending}
                  className="ra-button-secondary"
                >
                  <FileDown size={17} aria-hidden="true" />
                  {download.isPending ? "Fetching…" : "Open PDF"}
                </button>
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
                    {draft.data.download_count}/{draft.data.max_downloads}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
