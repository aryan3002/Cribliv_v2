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

interface UnlockContactPanelProps {
  listingId: string;
}

interface UnlockResponse {
  unlock_id: string;
  owner_contact: {
    phone_e164: string;
    whatsapp_available: boolean;
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

interface PurchaseIntentResponse {
  order_id: string;
  amount_paise: number;
  credits_to_grant: number;
  provider_payload?: {
    provider?: string;
    deep_link?: string;
    key_id?: string;
  };
}

type PurchaseState =
  | "idle"
  | "creating_intent"
  | "pending_payment"
  | "checking_status"
  | "success"
  | "failed";

function createClientKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
}

export function UnlockContactPanel({ listingId }: UnlockContactPanelProps) {
  // NextAuth session — used as auth source when localStorage token is absent
  const { data: nextAuthSession, status: sessionStatus } = useSession();
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
  const [purchaseIdempotencyKey, setPurchaseIdempotencyKey] = useState(() => createClientKey());
  const [walletSnapshot, setWalletSnapshot] = useState<WalletSnapshot | null>(null);
  const [walletRefreshing, setWalletRefreshing] = useState(false);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>("idle");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseIntentResponse | null>(null);
  const [purchaseBaselineBalance, setPurchaseBaselineBalance] = useState<number>(0);
  const [purchaseStartedAt, setPurchaseStartedAt] = useState<number>(0);

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
        body: JSON.stringify({ listing_id: listingId })
      });
      setUnlock(response);
      await refreshWalletSnapshot(token);
      trackEvent("contact_unlocked", {
        unlock_id: response.unlock_id,
        listing_id: listingId,
        response_deadline: response.response_deadline_at
      });
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

  function hasNewPurchasePackTxns(snapshot: {
    balance_credits: number;
    transactions: WalletTransaction[];
  }) {
    return snapshot.transactions.some((txn) => {
      if (txn.txn_type !== "purchase_pack") {
        return false;
      }
      return new Date(txn.created_at).getTime() >= purchaseStartedAt - 1_000;
    });
  }

  async function startBuyCredits() {
    if (!accessToken) {
      setError("Please login first to purchase credits.");
      return;
    }

    setPurchaseState("creating_intent");
    setPurchaseError(null);
    setError(null);

    try {
      const baseline = walletSnapshot?.balance_credits ?? 0;
      setPurchaseBaselineBalance(baseline);
      const startedAt = Date.now();
      setPurchaseStartedAt(startedAt);

      const intent = await fetchApi<PurchaseIntentResponse>("/wallet/purchase-intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": purchaseIdempotencyKey
        },
        body: JSON.stringify({
          plan_id: "starter_10",
          provider: "upi"
        })
      });

      setPurchaseIntent(intent);
      setPurchaseState("pending_payment");
    } catch (err) {
      setPurchaseState("failed");
      setPurchaseError(err instanceof Error ? err.message : "Unable to start credit purchase");
    }
  }

  async function refreshPurchaseStatus() {
    if (!accessToken) {
      return;
    }
    setPurchaseState("checking_status");
    setPurchaseError(null);
    try {
      const latest = await refreshWalletSnapshot(accessToken);
      const gotCredits =
        latest.balance_credits > purchaseBaselineBalance || hasNewPurchasePackTxns(latest);

      if (gotCredits) {
        setPurchaseState("success");
        setUnlockErrorCode(null);
        setPurchaseIdempotencyKey(createClientKey());
      } else {
        setPurchaseState("pending_payment");
      }
    } catch (err) {
      setPurchaseState("failed");
      setPurchaseError(err instanceof Error ? err.message : "Unable to refresh wallet status");
    }
  }

  const canShowBuyCredits = Boolean(accessToken && unlockErrorCode === "insufficient_credits");
  const recentWalletTxns = walletSnapshot?.transactions.slice(0, 3) ?? [];
  const purchaseInProgress =
    purchaseState === "creating_intent" || purchaseState === "checking_status";

  return (
    <div>
      <p
        className="body-sm"
        style={{ color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}
      >
        Unlock contact for 1 credit. Auto-refund if no response in 12 hours.
      </p>

      {accessToken ? (
        <div
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
            Wallet balance
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
          {loading ? "Processing..." : sessionStatus === "loading" ? "Loading..." : "Unlock Number"}
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
          Guest browsing is open. OTP is required only for unlock.
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
            Verify & Unlock
          </button>
        </div>
      ) : null}

      {unlock ? (
        <div className="alert alert--success" style={{ marginTop: "var(--space-4)" }}>
          <p>
            Owner Contact: <strong>{unlock.owner_contact.phone_e164}</strong>
          </p>
          <p>Credits remaining: {unlock.credits_remaining}</p>
          <p>Refund auto-check at: {refundTimeLabel}</p>
        </div>
      ) : null}

      {canShowBuyCredits ? (
        <div
          className="alert alert--warning"
          data-testid="buy-credits-panel"
          style={{ marginTop: "var(--space-4)" }}
        >
          <p style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}>Not enough credits</p>
          <p className="caption" style={{ color: "var(--text-secondary)" }}>
            Buy credits to unlock this listing.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              marginTop: "var(--space-3)"
            }}
          >
            <button
              className="btn btn--primary"
              onClick={startBuyCredits}
              disabled={purchaseInProgress}
              style={{ width: "100%" }}
            >
              {purchaseState === "creating_intent" ? "Creating Purchase..." : "Buy Credits"}
            </button>
            <button
              className="btn btn--secondary"
              onClick={refreshPurchaseStatus}
              disabled={purchaseInProgress || purchaseState === "idle"}
              style={{ width: "100%" }}
            >
              {purchaseState === "checking_status" ? "Refreshing..." : "Refresh Balance"}
            </button>
          </div>
          {purchaseIntent ? (
            <div
              className="caption"
              style={{ marginTop: "var(--space-3)", color: "var(--text-tertiary)" }}
            >
              <p>
                Order: <strong>{purchaseIntent.order_id}</strong>
              </p>
              <p>
                Amount: <strong>₹{(purchaseIntent.amount_paise / 100).toFixed(2)}</strong> for{" "}
                <strong>{purchaseIntent.credits_to_grant}</strong> credits
              </p>
              {purchaseIntent.provider_payload?.deep_link ? (
                <a
                  href={purchaseIntent.provider_payload.deep_link}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn--secondary btn--sm"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    textDecoration: "none",
                    marginTop: "var(--space-2)"
                  }}
                >
                  Open UPI App
                </a>
              ) : null}
            </div>
          ) : null}
          {purchaseState === "pending_payment" ? (
            <p
              className="caption"
              style={{ color: "var(--text-tertiary)", marginTop: "var(--space-2)" }}
            >
              Waiting for payment confirmation. Tap Refresh Balance after paying.
            </p>
          ) : null}
          {purchaseState === "success" ? (
            <div className="alert alert--success" style={{ marginTop: "var(--space-3)" }}>
              <p>
                Credits updated. New balance:{" "}
                <strong>{walletSnapshot?.balance_credits ?? 0}</strong>
              </p>
              {recentWalletTxns.length > 0 ? (
                <div>
                  <p className="caption" style={{ color: "var(--text-tertiary)" }}>
                    Recent wallet activity:
                  </p>
                  <ul>
                    {recentWalletTxns.map((txn) => (
                      <li key={txn.id}>
                        {txn.txn_type}: {txn.credits_delta > 0 ? "+" : ""}
                        {txn.credits_delta}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {purchaseError ? (
            <p className="alert alert--error" style={{ marginTop: "var(--space-2)" }}>
              {purchaseError}
            </p>
          ) : null}
        </div>
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
