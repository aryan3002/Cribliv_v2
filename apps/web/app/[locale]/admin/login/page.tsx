"use client";

import { signIn } from "next-auth/react";
import { useCallback, useState } from "react";
import { useFlag } from "../../../../lib/feature-flags";

function normalizePhone(phone: string): string {
  const cleaned = phone.trim().replace(/\s+/g, "").replace(/^0+/, "");
  return cleaned.startsWith("+91") ? cleaned : `+91${cleaned}`;
}

export default function AdminLoginPage() {
  const enabled = useFlag("ff_admin_totp");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const phoneE164 = normalizePhone(phone);
    if (!/^\+91\d{10}$/.test(phoneE164)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setLoading(true);
    try {
      const result = await signIn("admin-totp", {
        redirect: false,
        phone: phoneE164,
        totpCode: code.trim()
      });
      if (result?.error) {
        setError("Invalid phone or authenticator code.");
        return;
      }
      window.location.href = "/en/admin";
    } catch {
      setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [phone, code]);

  if (!enabled) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 380, textAlign: "center", color: "#374151" }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Admin sign-in</h1>
          <p style={{ fontSize: 14, color: "#6B7280" }}>
            Authenticator sign-in isn&apos;t enabled yet. Use the{" "}
            <a href="/auth/login" style={{ color: "#2563EB" }}>
              standard OTP login
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Admin sign-in</h1>
        <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 20 }}>
          Enter your phone and the 6-digit code from your authenticator app.
        </p>

        <label style={{ fontSize: 12, color: "#374151" }} htmlFor="admin-phone">
          Mobile number
        </label>
        <input
          id="admin-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="98765 43210"
          disabled={loading}
          style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 8, border: "1px solid #D1D5DB" }}
        />

        <label style={{ fontSize: 12, color: "#374151" }} htmlFor="admin-code">
          6-digit code
        </label>
        <input
          id="admin-code"
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="••••••"
          disabled={loading}
          maxLength={6}
          style={{ width: "100%", padding: 10, margin: "6px 0 14px", borderRadius: 8, border: "1px solid #D1D5DB", letterSpacing: 6, textAlign: "center" }}
        />

        <button
          onClick={handleSubmit}
          disabled={loading || code.length < 6}
          style={{ width: "100%", padding: 11, borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontWeight: 600, cursor: "pointer" }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {error && (
          <div role="alert" style={{ marginTop: 12, color: "#DC2626", fontSize: 13 }}>
            {error}
          </div>
        )}

        <p style={{ marginTop: 18, fontSize: 12, color: "#9CA3AF", textAlign: "center" }}>
          Lost your device?{" "}
          <a href="/auth/login" style={{ color: "#6B7280" }}>
            Sign in with OTP
          </a>{" "}
          and re-enroll from Security.
        </p>
      </div>
    </div>
  );
}
