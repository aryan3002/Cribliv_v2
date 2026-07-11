"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "../../lib/api";
import { t, type Locale } from "../../lib/i18n";
import { fetchCreditPlans, type CreditPlanDto } from "../../lib/credit-purchase";
import { CreditPurchaseDialog, type CreditPurchaseCapturedResult } from "../credit-purchase-dialog";

interface LeadCreditBalanceBarProps {
  accessToken: string;
  locale: Locale;
  lockedLeadCount: number;
  onCreditsChanged: () => void;
}

function formatRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/**
 * Persistent owner-dashboard upsell mounted above the leads toolbar: always
 * shows the current lead-credit balance, how many locked leads are waiting,
 * and both pack prices, with a one-click launcher into the shared
 * Razorpay/UPI purchase dialog.
 */
export function LeadCreditBalanceBar({
  accessToken,
  locale,
  lockedLeadCount,
  onCreditsChanged
}: LeadCreditBalanceBarProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [plans, setPlans] = useState<CreditPlanDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wallet, items] = await Promise.all([
        fetchApi<{ balance_credits: number }>("/wallet", {
          headers: { Authorization: `Bearer ${accessToken}` }
        }),
        fetchCreditPlans(accessToken)
      ]);
      setBalance(wallet.balance_credits);
      setPlans(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load wallet");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function handleCaptured(result: CreditPurchaseCapturedResult) {
    setDialogOpen(false);
    if (typeof result.balanceCredits === "number") setBalance(result.balanceCredits);
    void refresh();
    onCreditsChanged();
  }

  return (
    <div
      className="lead-credit-bar"
      data-testid="lead-credit-balance-bar"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-4)",
        background: "var(--surface-sunken)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3) var(--space-4)",
        marginBottom: "var(--space-4)"
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
        <span className="caption" style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
          {t(locale, "leadBalanceLabel")}
        </span>
        <strong data-testid="lead-credit-balance-value" style={{ fontSize: "1.1em" }}>
          {loading && balance === null ? "…" : (balance ?? 0)}
        </strong>
      </div>

      {lockedLeadCount > 0 ? (
        <span
          data-testid="lead-credit-locked"
          className="caption"
          style={{ color: "var(--text-tertiary)" }}
        >
          {t(locale, "leadLockedWaiting").replace("{n}", String(lockedLeadCount))}
        </span>
      ) : null}

      {plans.length > 0 ? (
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {plans.map((plan) => (
            <div
              key={plan.plan_id}
              data-testid={`lead-credit-pack-${plan.plan_id}`}
              className="caption"
              style={{ color: "var(--text-secondary)" }}
            >
              <strong>{plan.label}</strong>{" "}
              {t(locale, "cpUnitPrice").replace("{price}", formatRupees(plan.unit_price_paise))}
              {plan.recommended ? ` · ${t(locale, "cpBestValue")}` : ""}
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn--primary btn--sm"
        data-testid="lead-credit-buy-button"
        style={{ marginLeft: "auto" }}
        onClick={() => setDialogOpen(true)}
      >
        {t(locale, "cpTitle")}
      </button>

      {error ? (
        <p className="alert alert--error" style={{ width: "100%", margin: 0 }}>
          {error}
        </p>
      ) : null}

      <CreditPurchaseDialog
        open={dialogOpen}
        accessToken={accessToken}
        locale={locale}
        audience="owner"
        onClose={() => setDialogOpen(false)}
        onCaptured={handleCaptured}
      />
    </div>
  );
}
