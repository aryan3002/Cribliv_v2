"use client";
import { useState } from "react";
import { getApiBaseUrl } from "@/lib/api";
import { useCheckout } from "@/lib/rent-agreement/hooks/use-checkout";
import { useDownload } from "@/lib/rent-agreement/hooks/use-download";
import { useStatusPoll } from "@/lib/rent-agreement/hooks/use-status-poll";
import { newIdempotencyKey } from "@/lib/rent-agreement/state/idempotency";
import { isTerminal, statusLabel } from "@/lib/rent-agreement/state/status-machine";

export default function Page({ params }: { params: { locale: string; id: string } }) {
  const [idemKey] = useState(() => newIdempotencyKey("checkout"));
  const [polling, setPolling] = useState(false);
  const checkout = useCheckout();
  const download = useDownload();
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

  return (
    <div className="space-y-3">
      <h2 className="font-semibold">Checkout</h2>
      <button
        onClick={pay}
        disabled={checkout.isPending}
        className="px-3 py-1 bg-blue-600 text-white rounded"
      >
        {checkout.isPending ? "Submitting…" : "Pay (mock)"}
      </button>
      {polling && (
        <p className="text-sm">
          Status: <b>{s ? statusLabel(s) : "…"}</b>
        </p>
      )}
      {ready && (
        <button
          onClick={fetchSas}
          disabled={download.isPending}
          className="px-3 py-1 bg-green-700 text-white rounded"
        >
          {download.isPending ? "Fetching…" : "Open PDF"}
        </button>
      )}
      {s && isTerminal(s) && s !== "generated" && <p className="text-red-700">{statusLabel(s)}</p>}
    </div>
  );
}
