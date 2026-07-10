"use client";

import { useState } from "react";
import { fetchApi } from "../../lib/api";

interface LeadCreditsPanelProps {
  accessToken: string;
  onPurchased?: () => void;
}

interface PurchaseIntentResponse {
  order_id: string;
  amount_paise: number;
  credits_to_grant: number;
  provider_payload?: { deep_link?: string };
}

function createClientKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
}

/**
 * Owner-side lead-credit purchase: same purchase-intent + UPI deep-link + poll
 * flow the tenant unlock panel uses, pinned to the leads_5 pack.
 */
export function LeadCreditsPanel({ accessToken, onPurchased }: LeadCreditsPanelProps) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => createClientKey());
  const [intent, setIntent] = useState<PurchaseIntentResponse | null>(null);
  const [state, setState] = useState<
    "idle" | "creating" | "pending" | "checking" | "done" | "failed"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(0);

  async function readBalance() {
    const wallet = await fetchApi<{ balance_credits: number }>("/wallet", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return wallet.balance_credits;
  }

  async function startPurchase() {
    setState("creating");
    setError(null);
    try {
      setBaseline(await readBalance());
      const res = await fetchApi<PurchaseIntentResponse>("/wallet/purchase-intents", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ plan_id: "leads_5", provider: "upi" })
      });
      setIntent(res);
      setState("pending");
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Unable to start purchase");
    }
  }

  async function checkStatus() {
    setState("checking");
    try {
      const balance = await readBalance();
      if (balance > baseline) {
        setState("done");
        setIdempotencyKey(createClientKey());
        onPurchased?.();
      } else {
        setState("pending");
      }
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Unable to refresh balance");
    }
  }

  return (
    <div
      className="alert alert--warning"
      data-testid="lead-credits-panel"
      style={{ marginTop: "var(--space-3)" }}
    >
      <p style={{ fontWeight: 600 }}>Not enough lead credits</p>
      <p className="caption" style={{ color: "var(--text-secondary)" }}>
        Buy 5 lead credits for ₹299 to unlock tenant contacts instantly.
      </p>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
        <button
          className="btn btn--primary btn--sm"
          onClick={startPurchase}
          disabled={state === "creating" || state === "checking"}
        >
          {state === "creating" ? "Creating…" : "Buy 5 credits — ₹299"}
        </button>
        <button
          className="btn btn--secondary btn--sm"
          onClick={checkStatus}
          disabled={state === "idle" || state === "creating" || state === "checking"}
        >
          {state === "checking" ? "Checking…" : "I've paid — refresh"}
        </button>
      </div>
      {intent?.provider_payload?.deep_link ? (
        <a
          href={intent.provider_payload.deep_link}
          target="_blank"
          rel="noreferrer"
          className="btn btn--secondary btn--sm"
          style={{ display: "inline-flex", marginTop: "var(--space-2)", textDecoration: "none" }}
        >
          Open UPI App
        </a>
      ) : null}
      {state === "done" ? (
        <p className="caption" style={{ marginTop: "var(--space-2)" }}>
          Credits added — unlock the lead now.
        </p>
      ) : null}
      {error ? (
        <p className="alert alert--error" style={{ marginTop: "var(--space-2)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
