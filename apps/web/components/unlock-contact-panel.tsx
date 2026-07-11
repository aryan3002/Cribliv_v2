"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  clearAuthSession,
  readAuthSession,
  readGuestShortlist,
  toggleGuestShortlist,
  writeAuthSession
} from "../lib/client-auth";
import { fetchApi } from "../lib/api";
import { ApiError } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { useFlag } from "../lib/feature-flags";
import { t, type Locale } from "../lib/i18n";
import { CreditPurchaseDialog, type CreditPurchaseCapturedResult } from "./credit-purchase-dialog";

interface UnlockContactPanelProps {
  listingId: string;
  locale: Locale;
  // Traffic-source tag (e.g. 'blog-2bhk-rent-in-noida') for content->revenue
  // attribution; recorded on the unlock when present.
  source?: string;
}

interface UnlockResponse {
  unlock_id: string;
  owner_contact?: {
    phone_e164: string;
    whatsapp_available: boolean;
  };
  callback?: {
    status: "awaiting_call";
    call_deadline_at: string;
  };
  credits_remaining: number;
  response_deadline_at: string;
}

interface WalletBalanceResponse {
  balance_credits: number;
  free_credits_granted: number;
}

interface WalletTransaction {
  id: string;
  txn_type: string;
  credits_delta: number;
  reference_id: string | null;
  created_at: string;
}

interface WalletTransactionsResponse {
  items: WalletTransaction[];
  total: number;
}

interface WalletSnapshot {
  balance_credits: number;
  free_credits_granted: number;
  transactions: WalletTransaction[];
  total_transactions: number;
}

function createClientKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
}

export function UnlockContactPanel({ listingId, locale, source }: UnlockContactPanelProps) {
  // NextAuth session — used as auth source when localStorage token is absent
  const { data: nextAuthSession, status: sessionStatus } = useSession();
  const callbackMode = useFlag("ff_callback_leads");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [phone, setPhone] = useState("+91");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [unlock, setUnlock] = useState<UnlockResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockErrorCode, setUnlockErrorCode] = useState<string | null>(null);
  const [shortlisted, setShortlisted] = useState(false);
  const [authStep, setAuthStep] = useState<"none" | "otp_send" | "otp_verify">("none");
  const [idempotencyKey] = useState(() => createClientKey());
  const [walletSnapshot, setWalletSnapshot] = useState<WalletSnapshot | null>(null);
  const [walletRefreshing, setWalletRefreshing] = useState(false);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);

  useEffect(() => {
    // Prefer localStorage (legacy in-panel OTP login), fall back to NextAuth session token
    const stored = readAuthSession();
    const nextAuthToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
    const token = stored?.access_token ?? nextAuthToken;
    setAccessToken(token);
    if (!token) {
      setShortlisted(readGuestShortlist().includes(listingId));
    } else {
      // Check shortlist status from the API for logged-in users
      void fetchApi<{ items: { id: string }[]; total: number }>("/shortlist", {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => {
          setShortlisted(res.items.some((item) => item.id === listingId));
        })
        .catch(() => {
          // Silently ignore — default to not shortlisted
        });
    }
  }, [listingId, nextAuthSession]);

  useEffect(() => {
    if (!accessToken) {
      setWalletSnapshot(null);
      return;
    }
    // .catch(() => {}) prevents this from surfacing as an unhandled rejection
    // in React dev mode when the wallet endpoint returns a non-ok response.
    void refreshWalletSnapshot(accessToken).catch(() => {});
  }, [accessToken]);

  const refundTimeLabel = useMemo(() => {
    if (!unlock?.response_deadline_at) {
      return "";
    }
    const d = new Date(unlock.response_deadline_at);
    return d.toLocaleString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short"
    });
  }, [unlock?.response_deadline_at]);

  async function requestOtp() {
    setLoading(true);
    setError(null);
    setUnlockErrorCode(null);
    try {
      const response = await fetchApi<{ challenge_id: string; dev_otp?: string }>(
        "/auth/otp/send",
        {
          method: "POST",
          body: JSON.stringify({
            phone_e164: phone,
            purpose: "contact_unlock"
          })
        }
      );
      setChallengeId(response.challenge_id);
      setAuthStep("otp_verify");
      trackEvent("otp_send_requested", {
        purpose: "contact_unlock",
        phone_hash: phone.slice(-4)
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtpAndUnlock() {
    if (!challengeId) {
      return;
    }
    setLoading(true);
    setError(null);
    setUnlockErrorCode(null);
    try {
      const verified = await fetchApi<{
        access_token: string;
        refresh_token: string;
        user: {
          id: string;
          role: string;
          phone_e164: string;
          preferred_language: "en" | "hi";
        };
      }>("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({
          challenge_id: challengeId,
          otp_code: otp,
          device_fingerprint: "web"
        })
      });
      writeAuthSession(verified);
      setAccessToken(verified.access_token);
      setAuthStep("none");
      trackEvent("otp_verified", { purpose: "contact_unlock", success: true });
      await unlockContact(verified.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OTP verification failed");
      trackEvent("otp_verified", { purpose: "contact_unlock", success: false });
    } finally {
      setLoading(false);
    }
  }

  async function unlockContact(token: string) {
    setLoading(true);
    setError(null);
    setUnlockErrorCode(null);
    trackEvent("contact_unlock_clicked", { listing_id: listingId, is_guest: false });
    try {
      const response = await fetchApi<UnlockResponse>("/tenant/contact-unlocks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(source ? { listing_id: listingId, source } : { listing_id: listingId })
      });
      setUnlock(response);
      await refreshWalletSnapshot(token);
      trackEvent("contact_unlocked", {
        unlock_id: response.unlock_id,
        listing_id: listingId,
        response_deadline: response.response_deadline_at
      });
      if (response.callback) {
        trackEvent("callback_requested", {
          unlock_id: response.unlock_id,
          listing_id: listingId,
          call_deadline: response.callback.call_deadline_at
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to unlock contact";
      setError(message);
      if (err instanceof ApiError) {
        setUnlockErrorCode(err.code ?? null);
      }
      if (message.toLowerCase().includes("unauthorized")) {
        // Clear any stale localStorage token — it's no longer valid.
        clearAuthSession();

        // Only fall back to the OTP form if there is genuinely no active session.
        // If NextAuth still has a valid session (user logged in via the navbar),
        // keep that token and just surface the error — the user can refresh the
        // page to get a fresh API JWT without re-entering their phone number.
        const freshNextAuthToken =
          (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;

        if (freshNextAuthToken) {
          // Session is still active — restore the NextAuth token and stay put.
          setAccessToken(freshNextAuthToken);
        } else {
          // Genuinely logged out — ask for OTP.
          setAccessToken(null);
          setAuthStep("otp_send");
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function onUnlockClick() {
    // If the NextAuth session is still initialising, wait — don't prematurely
    // show the OTP form just because the token hasn't arrived yet.
    if (sessionStatus === "loading") return;

    if (!accessToken) {
      setAuthStep("otp_send");
      return;
    }
    await unlockContact(accessToken);
  }

  async function toggleShortlist() {
    setError(null);
    // Check both localStorage and NextAuth session for the token
    const session = readAuthSession();
    const nextAuthToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
    const token = session?.access_token ?? nextAuthToken;

    if (!token) {
      const next = toggleGuestShortlist(listingId);
      setShortlisted(next.active);
      return;
    }

    try {
      if (shortlisted) {
        await fetchApi<{ success: true }>(`/shortlist/${listingId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        setShortlisted(false);
        trackEvent("shortlist_removed", { listing_id: listingId, is_guest: false });
      } else {
        await fetchApi<{ shortlist_id: string }>("/shortlist", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ listing_id: listingId })
        });
        setShortlisted(true);
        trackEvent("shortlist_added", { listing_id: listingId, is_guest: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update shortlist");
    }
  }

  async function refreshWalletSnapshot(token: string) {
    setWalletRefreshing(true);
    try {
      const [wallet, txns] = await Promise.all([
        fetchApi<WalletBalanceResponse>("/wallet", {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchApi<WalletTransactionsResponse>("/wallet/transactions", {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      setWalletSnapshot({
        balance_credits: wallet.balance_credits,
        free_credits_granted: wallet.free_credits_granted,
        transactions: txns.items,
        total_transactions: txns.total
      });
      return {
        balance_credits: wallet.balance_credits,
        transactions: txns.items
      };
    } finally {
      setWalletRefreshing(false);
    }
  }

  // Purchase mechanics (catalog, Razorpay/UPI, confirmation, polling) are
  // fully owned by CreditPurchaseDialog. Once it reports a real `captured`
  // order, retry the original contact-unlock exactly once, reusing the same
  // `idempotencyKey` from the attempt that failed with insufficient_credits
  // — the API heals/replays same-key same-listing requests, so this is a
  // safe, single retry rather than a fresh unlock attempt.
  function handleCreditsCaptured(result: CreditPurchaseCapturedResult) {
    setPurchaseDialogOpen(false);
    if (typeof result.balanceCredits === "number") {
      const nextBalance = result.balanceCredits;
      setWalletSnapshot((prev) => (prev ? { ...prev, balance_credits: nextBalance } : prev));
    }
    if (accessToken) {
      void unlockContact(accessToken);
    }
  }

  const canShowBuyCredits = Boolean(accessToken && unlockErrorCode === "insufficient_credits");

  return (
    <div>
      <p
        className="body-sm"
        style={{ color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}
      >
        {callbackMode
          ? t(locale, "cbGuaranteeIntro")
          : "Unlock contact for 1 credit. Auto-refund if no response in 12 hours."}
      </p>

      {accessToken ? (
        <div
          data-testid="tenant-wallet-balance"
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
          <span className="caption" style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
            {t(locale, "cpWalletBalance")}
          </span>
          <span className="caption" style={{ color: "var(--text-primary)", fontWeight: 700 }}>
            {walletSnapshot?.balance_credits ?? "—"} credit
            {walletSnapshot?.balance_credits !== 1 ? "s" : ""}
          </span>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <button
          className="btn btn--primary"
          onClick={onUnlockClick}
          disabled={loading || sessionStatus === "loading"}
          style={{ width: "100%" }}
        >
          {loading
            ? "Processing..."
            : sessionStatus === "loading"
              ? "Loading..."
              : callbackMode
                ? t(locale, "cbRequestButton")
                : "Unlock Number"}
        </button>
        <button
          className="btn btn--secondary"
          onClick={toggleShortlist}
          disabled={loading}
          style={{ width: "100%" }}
        >
          {shortlisted ? "♥ Saved" : "Save"}
        </button>
      </div>

      {!accessToken ? (
        <p
          className="caption"
          style={{ color: "var(--text-tertiary)", marginTop: "var(--space-3)" }}
        >
          {callbackMode
            ? t(locale, "cbGuestHint")
            : "Guest browsing is open. OTP is required only for unlock."}
        </p>
      ) : null}

      {authStep === "otp_send" ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <label className="form-label" htmlFor="unlock-phone">
            Phone number
          </label>
          <input
            id="unlock-phone"
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button
            className="btn btn--primary"
            onClick={requestOtp}
            disabled={loading}
            style={{ marginTop: "var(--space-2)", width: "100%" }}
          >
            Send OTP
          </button>
        </div>
      ) : null}

      {authStep === "otp_verify" ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <label className="form-label" htmlFor="unlock-otp">
            Enter OTP
          </label>
          <input
            id="unlock-otp"
            className="input"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
          <button
            className="btn btn--primary"
            onClick={verifyOtpAndUnlock}
            disabled={loading}
            style={{ marginTop: "var(--space-2)", width: "100%" }}
          >
            {callbackMode ? t(locale, "cbVerifyButton") : "Verify & Unlock"}
          </button>
        </div>
      ) : null}

      {unlock ? (
        callbackMode && unlock.callback ? (
          <div
            className="alert alert--success"
            data-testid="callback-requested"
            style={{ marginTop: "var(--space-4)" }}
          >
            <p style={{ fontWeight: 700 }}>{t(locale, "cbRequestedTitle")}</p>
            <ol style={{ margin: "var(--space-2) 0", paddingLeft: "var(--space-4)" }}>
              <li>{t(locale, "cbStepRequested")}</li>
              <li>{t(locale, "cbStepOwnerNotified")}</li>
              <li>{t(locale, "cbStepCallOnWay").replace("{time}", refundTimeLabel)}</li>
            </ol>
            <p className="caption" style={{ color: "var(--text-secondary)" }}>
              {t(locale, "cbRefundReassure").replace("{n}", String(unlock.credits_remaining))}
            </p>
          </div>
        ) : (
          <div className="alert alert--success" style={{ marginTop: "var(--space-4)" }}>
            <p>
              Owner Contact: <strong>{unlock.owner_contact?.phone_e164}</strong>
            </p>
            <p>Credits remaining: {unlock.credits_remaining}</p>
            <p>Refund auto-check at: {refundTimeLabel}</p>
          </div>
        )
      ) : null}

      {canShowBuyCredits ? (
        <div
          className="alert alert--warning"
          data-testid="buy-credits-panel"
          style={{ marginTop: "var(--space-4)" }}
        >
          <p style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}>
            {t(locale, "cbNoCredits")}
          </p>
          <p className="caption" style={{ color: "var(--text-secondary)" }}>
            {t(locale, "cbBuyCreditsSub")}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="tenant-buy-credits-button"
            style={{ marginTop: "var(--space-3)", width: "100%" }}
            onClick={() => setPurchaseDialogOpen(true)}
          >
            {t(locale, "cpTitle")}
          </button>
        </div>
      ) : null}

      {accessToken ? (
        <CreditPurchaseDialog
          open={purchaseDialogOpen}
          accessToken={accessToken}
          locale={locale}
          audience="tenant"
          onClose={() => setPurchaseDialogOpen(false)}
          onCaptured={handleCreditsCaptured}
        />
      ) : null}

      {accessToken && walletSnapshot ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "var(--space-4)"
          }}
        >
          <span className="caption" style={{ color: "var(--text-tertiary)" }}>
            {walletSnapshot.total_transactions} transaction
            {walletSnapshot.total_transactions !== 1 ? "s" : ""}
          </span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => refreshWalletSnapshot(accessToken)}
            disabled={walletRefreshing}
          >
            {walletRefreshing ? "Refreshing..." : "Refresh Wallet"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="alert alert--error" style={{ marginTop: "var(--space-3)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
