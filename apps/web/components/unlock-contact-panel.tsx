"use client";

import { useEffect, useMemo, useState } from "react";
import {
  clearAuthSession,
  readAuthSession,
  readGuestShortlist,
  toggleGuestShortlist,
  writeAuthSession
} from "../lib/client-auth";
import { fetchApi } from "../lib/api";
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

export function UnlockContactPanel({ listingId }: UnlockContactPanelProps) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [phone, setPhone] = useState("+91");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [unlock, setUnlock] = useState<UnlockResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shortlisted, setShortlisted] = useState(false);
  const [authStep, setAuthStep] = useState<"none" | "otp_send" | "otp_verify">("none");
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`
  );

  useEffect(() => {
    const session = readAuthSession();
    setAccessToken(session?.access_token ?? null);
    if (!session) {
      setShortlisted(readGuestShortlist().includes(listingId));
    }
  }, [listingId]);

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
      trackEvent("contact_unlocked", {
        unlock_id: response.unlock_id,
        listing_id: listingId,
        response_deadline: response.response_deadline_at
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to unlock contact";
      setError(message);
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

      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
