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
  const { data: nextAuthSession } = useSession();
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
    }
  }, [listingId, nextAuthSession]);

  useEffect(() => {
    if (!accessToken) {
      setWalletSnapshot(null);
      return;
    }
    void refreshWalletSnapshot(accessToken);
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
        clearAuthSession();
        setAccessToken(null);
        setAuthStep("otp_send");
      }
    } finally {
      setLoading(false);
    }
  }

  async function onUnlockClick() {
    if (!accessToken) {
      setAuthStep("otp_send");
      return;
    }
    await unlockContact(accessToken);
  }

  async function toggleShortlist() {
    setError(null);
    const session = readAuthSession();
    if (!session?.access_token) {
      const next = toggleGuestShortlist(listingId);
      setShortlisted(next.active);
      return;
    }

    try {
      if (shortlisted) {
        await fetchApi<{ success: true }>(`/shortlist/${listingId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        });
        setShortlisted(false);
        trackEvent("shortlist_removed", { listing_id: listingId, is_guest: false });
      } else {
        await fetchApi<{ shortlist_id: string }>("/shortlist", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`
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
    <div className="panel unlock-panel">
      <p>Unlock contact for 1 credit. Auto-refund if no response in 12 hours.</p>
      <div className="action-row">
        <button className="primary" onClick={onUnlockClick} disabled={loading}>
          {loading ? "Processing..." : "Unlock Number"}
        </button>
        <button className="secondary" onClick={toggleShortlist} disabled={loading}>
          {shortlisted ? "Remove from Shortlist" : "Save to Shortlist"}
        </button>
      </div>

      {!accessToken ? (
        <p className="muted-text">Guest browsing is open. OTP is required only for unlock.</p>
      ) : null}

      {authStep === "otp_send" ? (
        <div className="otp-box">
          <label htmlFor="unlock-phone">Phone number</label>
          <input id="unlock-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="primary" onClick={requestOtp} disabled={loading}>
            Send OTP
          </button>
        </div>
      ) : null}

      {authStep === "otp_verify" ? (
        <div className="otp-box">
          <label htmlFor="unlock-otp">Enter OTP</label>
          <input id="unlock-otp" value={otp} onChange={(e) => setOtp(e.target.value)} />
          <button className="primary" onClick={verifyOtpAndUnlock} disabled={loading}>
            Verify & Unlock
          </button>
        </div>
      ) : null}

      {unlock ? (
        <div className="success-box">
          <p>
            Owner Contact: <strong>{unlock.owner_contact.phone_e164}</strong>
          </p>
          <p>Credits remaining: {unlock.credits_remaining}</p>
          <p>Refund auto-check at: {refundTimeLabel}</p>
        </div>
      ) : null}

      {accessToken ? (
        <p className="muted-text">Wallet credits: {walletSnapshot?.balance_credits ?? "—"}</p>
      ) : null}

      {canShowBuyCredits ? (
        <div className="panel warning-box" data-testid="buy-credits-panel">
          <p>You don&apos;t have enough credits to unlock this listing. Buy credits to continue.</p>
          <div className="action-row">
            <button className="primary" onClick={startBuyCredits} disabled={purchaseInProgress}>
              {purchaseState === "creating_intent" ? "Creating Purchase..." : "Buy Credits"}
            </button>
            <button
              className="secondary"
              onClick={refreshPurchaseStatus}
              disabled={purchaseInProgress || purchaseState === "idle"}
            >
              {purchaseState === "checking_status"
                ? "Refreshing..."
                : "I completed payment - Refresh balance"}
            </button>
          </div>
          {purchaseIntent ? (
            <div className="muted-text">
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
                  className="secondary"
                  style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                >
                  Open UPI App
                </a>
              ) : null}
            </div>
          ) : null}
          {purchaseState === "pending_payment" ? (
            <p className="muted-text">
              Waiting for payment confirmation. Use refresh after completing payment.
            </p>
          ) : null}
          {purchaseState === "success" ? (
            <div className="success-box">
              <p>
                Credits updated. New balance:{" "}
                <strong>{walletSnapshot?.balance_credits ?? 0}</strong>
              </p>
              {recentWalletTxns.length > 0 ? (
                <div>
                  <p className="muted-text">Recent wallet activity:</p>
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
          {purchaseError ? <p className="error-text">{purchaseError}</p> : null}
        </div>
      ) : null}

      {accessToken && walletSnapshot ? (
        <p className="muted-text">
          Wallet transactions: {walletSnapshot.total_transactions}{" "}
          <button
            className="secondary"
            style={{ height: 32 }}
            onClick={() => refreshWalletSnapshot(accessToken)}
            disabled={walletRefreshing}
          >
            {walletRefreshing ? "Refreshing..." : "Refresh Wallet"}
          </button>
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
