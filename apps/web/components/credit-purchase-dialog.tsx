"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "../lib/i18n";
import { fetchApi } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { loadRazorpayScript, openRazorpayCheckout } from "../lib/razorpay";
import {
  confirmRazorpayPurchase,
  createCreditPurchaseIntent,
  createIdempotencyKey,
  fetchCreditPlans,
  pollCreditPurchaseStatus,
  type CreditPlanDto,
  type CreditPurchaseIntent,
  type RazorpayCheckoutHandlerResponse
} from "../lib/credit-purchase";

export interface CreditPurchaseCapturedResult {
  planId: string;
  credits: number;
  balanceCredits?: number;
}

export interface CreditPurchaseDialogProps {
  open: boolean;
  accessToken: string;
  locale: Locale;
  audience: "tenant" | "owner";
  /** Pre-selects a plan on open (e.g. deep-linked from a "buy N credits" CTA). */
  initialPlanId?: string;
  onClose: () => void;
  onCaptured: (result: CreditPurchaseCapturedResult) => void;
}

type DialogStatus =
  | "idle"
  | "creating_intent"
  | "confirming"
  | "polling"
  | "captured"
  | "failed"
  | "cancelled"
  | "pending_webhook"
  | "razorpay_unavailable"
  | "creating_upi_intent"
  | "upi_ready";

const BUSY_STATUSES: ReadonlySet<DialogStatus> = new Set([
  "creating_intent",
  "confirming",
  "polling",
  "creating_upi_intent"
]);

const RETRY_LABEL_STATUSES: ReadonlySet<DialogStatus> = new Set([
  "failed",
  "cancelled",
  "pending_webhook",
  "razorpay_unavailable"
]);

function formatRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * Shared Razorpay/UPI credit purchase flow for both tenant callback credits
 * and owner lead credits. Crediting is webhook-only on the API side, so a
 * successful Checkout handler is not itself success here — the dialog polls
 * purchase-intent status and only reports `onCaptured` once the order
 * actually reaches `captured`.
 */
export function CreditPurchaseDialog({
  open,
  accessToken,
  locale,
  audience,
  initialPlanId,
  onClose,
  onCaptured
}: CreditPurchaseDialogProps) {
  const [plans, setPlans] = useState<CreditPlanDto[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [status, setStatus] = useState<DialogStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [upiRevealed, setUpiRevealed] = useState(false);
  const [upiIntent, setUpiIntent] = useState<CreditPurchaseIntent | null>(null);

  // Attempt-generation guard: incremented on every open-transition reset and
  // on every new pay attempt (Razorpay or UPI). The detached async chains
  // (Checkout handler → confirm → poll, plus their setState calls) capture the
  // generation they started under and bail silently once it goes stale — so a
  // previous attempt's poll resolving `captured` after the dialog was closed
  // and reopened can never stomp a live attempt's state or fire onCaptured
  // for the wrong plan/order.
  const attemptGenerationRef = useRef(0);
  const isStale = (generation: number) => attemptGenerationRef.current !== generation;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    attemptGenerationRef.current += 1;
    setStatus("idle");
    setErrorMessage(null);
    setUpiIntent(null);
    setUpiRevealed(false);
    setPlansError(null);
    setPlansLoading(true);

    Promise.all([
      fetchCreditPlans(accessToken),
      fetchApi<{ balance_credits: number }>("/wallet", {
        headers: { Authorization: `Bearer ${accessToken}` }
      }).catch(() => null)
    ])
      .then(([items, wallet]) => {
        if (cancelled) return;
        setPlans(items);
        setBalance(wallet?.balance_credits ?? null);
        const preferred =
          (initialPlanId && items.find((plan) => plan.plan_id === initialPlanId)) ||
          items.find((plan) => plan.recommended) ||
          items[0];
        setSelectedPlanId(preferred?.plan_id ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setPlansError(err instanceof Error ? err.message : "Unable to load credit plans");
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accessToken, initialPlanId]);

  if (!open) return null;

  const selectedPlan = plans.find((plan) => plan.plan_id === selectedPlanId) ?? null;
  const busy = BUSY_STATUSES.has(status);
  const razorpayLabel = BUSY_STATUSES.has(status)
    ? t(locale, "cpLoading")
    : RETRY_LABEL_STATUSES.has(status)
      ? t(locale, "cpRetry")
      : t(locale, "cpPaySecurely");

  async function handleRazorpaySuccess(
    plan: CreditPlanDto,
    orderId: string,
    response: RazorpayCheckoutHandlerResponse,
    generation: number
  ) {
    if (isStale(generation)) return;
    setStatus("confirming");
    setErrorMessage(null);
    try {
      await confirmRazorpayPurchase(accessToken, orderId, response);
      if (isStale(generation)) return;
      setStatus("polling");
      const result = await pollCreditPurchaseStatus({ accessToken, orderId });
      if (isStale(generation)) return;

      if (result.status === "captured") {
        setStatus("captured");
        let balanceCredits: number | undefined;
        try {
          const wallet = await fetchApi<{ balance_credits: number }>("/wallet", {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          balanceCredits = wallet.balance_credits;
          if (!isStale(generation)) setBalance(wallet.balance_credits);
        } catch {
          // Best-effort balance refresh — the purchase itself already succeeded.
        }
        if (isStale(generation)) return;
        if (audience === "owner") {
          trackEvent("lead_pack_purchased", {
            plan_id: plan.plan_id,
            credits: result.credits_to_grant,
            order_id: orderId
          });
        }
        onCaptured({
          planId: plan.plan_id,
          credits: result.credits_to_grant,
          balanceCredits
        });
      } else if (result.status === "failed") {
        setStatus("failed");
      } else {
        // Non-terminal after exhausting the poll budget (or an unexpected
        // status like `refunded`) — never treat this as success.
        setStatus("pending_webhook");
      }
    } catch (err) {
      if (isStale(generation)) return;
      setStatus("failed");
      setErrorMessage(err instanceof Error ? err.message : "Unable to confirm payment");
    }
  }

  async function handleRazorpayPay() {
    const plan = selectedPlan;
    if (!plan || busy) return;

    const generation = ++attemptGenerationRef.current;
    setErrorMessage(null);
    setStatus("creating_intent");
    try {
      const idempotencyKey = createIdempotencyKey();
      const intent = await createCreditPurchaseIntent(
        accessToken,
        plan.plan_id,
        "razorpay",
        idempotencyKey
      );
      const payload = intent.provider_payload;
      if (payload.provider !== "razorpay") {
        throw new Error("Unexpected provider payload for a Razorpay purchase");
      }

      const loaded = await loadRazorpayScript();
      if (isStale(generation)) return;
      if (!loaded) {
        setUpiRevealed(true);
        setStatus("razorpay_unavailable");
        return;
      }

      openRazorpayCheckout({
        key: payload.key_id,
        amount: payload.amount_paise,
        currency: payload.currency,
        name: "Cribliv",
        description: plan.label,
        order_id: payload.order_id,
        handler: (response) => {
          void handleRazorpaySuccess(plan, intent.order_id, response, generation);
        },
        modal: {
          ondismiss: () => {
            if (!isStale(generation)) setStatus("cancelled");
          }
        }
      });
    } catch (err) {
      if (isStale(generation)) return;
      setStatus("failed");
      setErrorMessage(err instanceof Error ? err.message : "Unable to start payment");
    }
  }

  async function handleUpiPay() {
    const plan = selectedPlan;
    if (!plan || busy) return;

    const generation = ++attemptGenerationRef.current;
    setErrorMessage(null);
    setStatus("creating_upi_intent");
    try {
      const idempotencyKey = createIdempotencyKey();
      const intent = await createCreditPurchaseIntent(
        accessToken,
        plan.plan_id,
        "upi",
        idempotencyKey
      );
      if (isStale(generation)) return;
      setUpiIntent(intent);
      setStatus("upi_ready");
    } catch (err) {
      if (isStale(generation)) return;
      setStatus("failed");
      setErrorMessage(err instanceof Error ? err.message : "Unable to start UPI payment");
    }
  }

  let statusMessage: string | null = null;
  switch (status) {
    case "cancelled":
      statusMessage = t(locale, "cpCancelled");
      break;
    case "pending_webhook":
      statusMessage = t(locale, "cpPendingWebhook");
      break;
    case "captured":
      statusMessage = t(locale, "cpCaptured");
      break;
    case "failed":
      statusMessage = errorMessage
        ? `${t(locale, "cpFailed")} (${errorMessage})`
        : t(locale, "cpFailed");
      break;
    case "razorpay_unavailable":
      statusMessage = t(locale, "cpGatewayUnavailable");
      break;
    case "creating_intent":
    case "confirming":
    case "polling":
    case "creating_upi_intent":
      statusMessage = t(locale, "cpLoading");
      break;
    default:
      statusMessage = null;
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal
      aria-label={t(locale, "cpTitle")}
      data-testid="credit-purchase-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        style={{ maxWidth: 460, width: "min(460px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">{t(locale, "cpTitle")}</h2>
          <button
            type="button"
            className="modal__close"
            data-testid="cp-close-button"
            aria-label={t(locale, "cpClose")}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="modal__body" style={{ padding: "var(--space-5)" }}>
          {balance !== null ? (
            <div
              data-testid="cp-wallet-balance"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--surface-sunken)",
                borderRadius: "var(--radius-md)",
                padding: "var(--space-2) var(--space-3)",
                marginBottom: "var(--space-4)"
              }}
            >
              <span className="caption" style={{ fontWeight: 600 }}>
                {t(locale, "cpWalletBalance")}
              </span>
              <span className="caption" style={{ fontWeight: 700 }}>
                {balance}
              </span>
            </div>
          ) : null}

          {plansError ? (
            <p className="alert alert--error" data-testid="cp-plans-error">
              {plansError}
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label={t(locale, "cpTitle")}
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
            >
              {plans.map((plan) => {
                const selected = plan.plan_id === selectedPlanId;
                return (
                  <button
                    key={plan.plan_id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`cp-plan-${plan.plan_id}`}
                    onClick={() => setSelectedPlanId(plan.plan_id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "var(--space-3)",
                      padding: "var(--space-3) var(--space-4)",
                      borderRadius: "var(--radius-md)",
                      border: `2px solid ${selected ? "var(--brand)" : "var(--border)"}`,
                      background: selected ? "var(--brand-light)" : "var(--surface)",
                      textAlign: "left",
                      width: "100%",
                      cursor: "pointer"
                    }}
                  >
                    <div>
                      <p style={{ fontWeight: 600, margin: 0 }}>{plan.label}</p>
                      <p className="caption" style={{ color: "var(--text-tertiary)", margin: 0 }}>
                        {t(locale, "cpUnitPrice").replace(
                          "{price}",
                          formatRupees(plan.unit_price_paise)
                        )}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      {plan.recommended ? (
                        <span
                          data-testid={`cp-best-value-${plan.plan_id}`}
                          className="caption"
                          style={{
                            padding: "1px 8px",
                            borderRadius: "var(--radius-full)",
                            fontWeight: 700,
                            background: "var(--brand-light)",
                            color: "var(--brand-dark)"
                          }}
                        >
                          {t(locale, "cpBestValue")}
                        </span>
                      ) : null}
                      <span style={{ fontWeight: 700 }}>₹{formatRupees(plan.amount_paise)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              marginTop: "var(--space-4)"
            }}
          >
            <button
              type="button"
              className="btn btn--primary"
              data-testid="cp-pay-razorpay"
              disabled={busy || !selectedPlan || plansLoading}
              onClick={() => void handleRazorpayPay()}
              style={{ width: "100%" }}
            >
              {razorpayLabel}
            </button>

            {upiRevealed ? (
              <button
                type="button"
                className="btn btn--secondary"
                data-testid="cp-pay-upi"
                disabled={busy || !selectedPlan}
                onClick={() => void handleUpiPay()}
                style={{ width: "100%" }}
              >
                {status === "creating_upi_intent"
                  ? t(locale, "cpLoading")
                  : t(locale, "cpPayWithUpi")}
              </button>
            ) : null}

            {upiIntent && upiIntent.provider_payload.provider === "upi" ? (
              <a
                href={upiIntent.provider_payload.deep_link}
                target="_blank"
                rel="noreferrer"
                data-testid="cp-upi-deep-link"
                className="btn btn--secondary btn--sm"
                style={{ textAlign: "center", textDecoration: "none" }}
              >
                {t(locale, "cpPayWithUpi")}
              </a>
            ) : null}
          </div>

          {statusMessage ? (
            <p
              data-testid="cp-status"
              className="caption"
              style={{ marginTop: "var(--space-3)", color: "var(--text-secondary)" }}
            >
              {statusMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
