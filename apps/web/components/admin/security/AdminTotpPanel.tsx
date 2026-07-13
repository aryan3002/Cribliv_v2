"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useFlag } from "../../../lib/feature-flags";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:4000/v1";

export function AdminTotpPanel({ accessToken }: { accessToken: string }) {
  const enabled = useFlag("ff_admin_totp");
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`
  };

  const loadStatus = useCallback(async () => {
    const res = await fetch(`${API_BASE}/auth/admin/totp/status`, { headers: authHeaders });
    if (res.ok) {
      const payload = (await res.json()) as { data: { enrolled: boolean } };
      setEnrolled(payload.data.enrolled);
    }
  }, [accessToken]);

  useEffect(() => {
    if (enabled) void loadStatus();
  }, [enabled, loadStatus]);

  const startEnroll = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/auth/admin/totp/enroll/start`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error();
      const payload = (await res.json()) as { data: { qr_data_url: string } };
      setQr(payload.data.qr_data_url);
    } catch {
      setError("Could not start enrollment.");
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  const confirmEnroll = useCallback(async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/auth/admin/totp/enroll/verify`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ totp_code: code.trim() })
      });
      if (!res.ok) throw new Error();
      setQr(null);
      setCode("");
      await loadStatus();
    } catch {
      setError("Incorrect code. Try again.");
    } finally {
      setBusy(false);
    }
  }, [code, accessToken, loadStatus]);

  const resetDevice = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`${API_BASE}/auth/admin/totp/reset`, { method: "POST", headers: authHeaders });
      setQr(null);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }, [accessToken, loadStatus]);

  if (!enabled) return null;

  return (
    <section style={{ maxWidth: 460, padding: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Authenticator (2-step login)</h2>
      <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>
        Log in without SMS OTP using an authenticator app (Google Authenticator, Authy, etc.).
      </p>

      {enrolled === true && !qr && (
        <div>
          <p style={{ color: "#059669", fontSize: 14, marginBottom: 12 }}>✓ Authenticator enrolled</p>
          <button onClick={resetDevice} disabled={busy} style={btnGhost}>
            Reset device (re-enroll)
          </button>
        </div>
      )}

      {enrolled === false && !qr && (
        <button onClick={startEnroll} disabled={busy} style={btnPrimary}>
          {busy ? "Preparing…" : "Set up authenticator"}
        </button>
      )}

      {qr && (
        <div>
          <p style={{ fontSize: 13, marginBottom: 8 }}>1. Scan this QR in your authenticator app:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Authenticator QR code" width={180} height={180} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 13, marginBottom: 8 }}>2. Enter the 6-digit code it shows:</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            placeholder="••••••"
            style={{ padding: 10, borderRadius: 8, border: "1px solid #D1D5DB", letterSpacing: 6, textAlign: "center", width: 160 }}
          />
          <div style={{ marginTop: 12 }}>
            <button onClick={confirmEnroll} disabled={busy || code.length < 6} style={btnPrimary}>
              {busy ? "Confirming…" : "Confirm"}
            </button>
          </div>
        </div>
      )}

      {error && <div role="alert" style={{ marginTop: 12, color: "#DC2626", fontSize: 13 }}>{error}</div>}
    </section>
  );
}

const btnPrimary: CSSProperties = {
  padding: "9px 16px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontWeight: 600, cursor: "pointer"
};
const btnGhost: CSSProperties = {
  padding: "9px 16px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#fff", color: "#374151", cursor: "pointer"
};
