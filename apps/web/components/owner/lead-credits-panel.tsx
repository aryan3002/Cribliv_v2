"use client";

import { useState } from "react";
import { t, type Locale } from "../../lib/i18n";
import { CreditPurchaseDialog, type CreditPurchaseCapturedResult } from "../credit-purchase-dialog";

interface LeadCreditsPanelProps {
  accessToken: string;
  locale: Locale;
  onPurchased?: () => void;
}

/**
 * Compact owner-side launcher for the shared Razorpay/UPI credit purchase
 * dialog. Shown inline on a lead card when an unlock attempt comes back
 * `insufficient_credits`; `onPurchased` fires once the wallet is actually
 * credited so the caller (LeadCard) can retry the original unlock.
 */
export function LeadCreditsPanel({ accessToken, locale, onPurchased }: LeadCreditsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleCaptured(_result: CreditPurchaseCapturedResult) {
    setDialogOpen(false);
    onPurchased?.();
  }

  return (
    <div
      className="alert alert--warning"
      data-testid="lead-credits-panel"
      style={{ marginTop: "var(--space-3)" }}
    >
      <p style={{ fontWeight: 600 }}>{t(locale, "leadNoCredits")}</p>
      <p className="caption" style={{ color: "var(--text-secondary)" }}>
        {t(locale, "leadBuyPackSub")}
      </p>
      <button
        type="button"
        className="btn btn--primary btn--sm"
        data-testid="lead-credits-buy-button"
        style={{ marginTop: "var(--space-2)" }}
        onClick={() => setDialogOpen(true)}
      >
        {t(locale, "cpTitle")}
      </button>

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
