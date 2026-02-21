"use client";

import { signIn, getSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, Suspense } from "react";
import type { UserRole } from "../../../auth.config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:4000/v1";

function rolePath(role: UserRole | undefined, locale = "en"): string {
  // Tenants land on the homepage — their "dashboard" is the search experience
  if (!role || role === "tenant") return `/${locale}`;
  if (role === "owner" || role === "pg_operator") return `/${locale}/owner/dashboard`;
  if (role === "admin") return `/${locale}/admin`;
  return `/${locale}`;
}

/**
 * Returns true if the given role is allowed to access the destination path.
 * Prevents a tenant from being redirected to /admin (→ 403) after login.
 */
function canAccessPath(role: UserRole | undefined, path: string): boolean {
  if (path.startsWith("/en/admin") || path.startsWith("/hi/admin")) {
    return role === "admin";
  }
  if (path.startsWith("/en/owner") || path.startsWith("/hi/owner")) {
    return role === "owner" || role === "pg_operator";
  }
  if (path.startsWith("/en/tenant") || path.startsWith("/hi/tenant")) {
    return role === "tenant";
  }
  return true; // public path
}

function validatePhone(phone: string): string | null {
  if (!/^\+91\d{10}$/.test(phone.trim())) {
    return "Enter a valid Indian mobile number (e.g. +919999999901)";
  }
  return null;
}

function validateOtp(otp: string): string | null {
  if (!/^\d{6}$/.test(otp.trim())) {
    return "OTP must be exactly 6 digits";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Error-code → user-friendly message map
// ---------------------------------------------------------------------------
const OTP_ERRORS: Record<string, string> = {
  invalid_otp: "Incorrect OTP. Please try again.",
  otp_expired: "OTP has expired. Please request a new one.",
  otp_blocked: "Too many incorrect attempts. Please request a new OTP.",
  otp_rate_limited: "Too many requests. Please wait a few minutes before trying again.",
  invalid_phone: "Invalid phone number format.",
  CredentialsSignin: "Incorrect OTP or session expired."
};

function friendlyError(code: string | null | undefined): string {
  if (!code) return "Something went wrong. Please try again.";
  return OTP_ERRORS[code] ?? "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Inner page component (uses useSearchParams — must be inside Suspense)
// ---------------------------------------------------------------------------
function LoginPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const fromPath = params.get("from");

  // UI state
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [step, setStep] = useState<1 | 2>(1);

  // Form state
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null); // Only in mock mode

  // Async state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Step 1 — Request OTP
  // ------------------------------------------------------------------
  const handleSendOtp = useCallback(async () => {
    setError(null);
    setInfo(null);

    const phoneErr = validatePhone(phone);
    if (phoneErr) {
      setError(phoneErr);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: phone.trim(), purpose: "login" })
      });

      const payload = (await res.json()) as {
        data?: { challenge_id: string; dev_otp?: string };
        error?: { code: string; message: string };
      };

      if (!res.ok) {
        setError(friendlyError(payload.error?.code));
        return;
      }

      if (!payload.data?.challenge_id) {
        setError("Unexpected response from server. Please try again.");
        return;
      }

      setChallengeId(payload.data.challenge_id);

      // dev_otp is only returned when OTP_PROVIDER=mock
      if (payload.data.dev_otp) {
        setDevOtp(payload.data.dev_otp);
        setOtp(payload.data.dev_otp); // auto-fill so user can just click Verify
      }

      setInfo(`OTP sent to ${phone.trim()}`);
      setStep(2);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [phone]);

  // ------------------------------------------------------------------
  // Step 2 — Verify OTP + Sign In
  // ------------------------------------------------------------------
  const handleVerify = useCallback(async () => {
    setError(null);
    const otpErr = validateOtp(otp);
    if (otpErr) {
      setError(otpErr);
      return;
    }

    setLoading(true);
    try {
      const result = await signIn("credentials", {
        redirect: false,
        challengeId,
        otpCode: otp.trim(),
        phone: phone.trim()
      });
      if (result?.error) {
        setError(friendlyError(result.error));
        return;
      }

      // Fetch session to get role for redirect
      const session = await getSession();
      const role = (session?.user as { role?: UserRole } | undefined)?.role;
      const locale = "en";
      // Only use fromPath if the logged-in role is actually allowed there
      const safeDest =
        fromPath && canAccessPath(role, fromPath) ? fromPath : rolePath(role, locale);
      router.push(safeDest as `/${string}`);
    } catch {
      setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [challengeId, otp, phone, fromPath, router]);

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  return (
    <div
      style={{
        maxWidth: 360,
        margin: "80px auto",
        padding: "0 16px",
        fontFamily: "sans-serif"
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Cribliv</h1>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        {(["login", "signup"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setStep(1);
              setError(null);
              setInfo(null);
              setOtp("");
              setChallengeId("");
              setDevOtp(null);
            }}
            style={{
              background: "none",
              border: "none",
              borderBottom: tab === t ? "2px solid #000" : "2px solid transparent",
              paddingBottom: 4,
              cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
              fontSize: 15,
              textTransform: "capitalize"
            }}
          >
            {t === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>

      {/* Step 1 — Phone */}
      {step === 1 && (
        <div>
          <label htmlFor="phone" style={{ display: "block", marginBottom: 6, fontSize: 14 }}>
            Mobile number
          </label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919999999901"
            disabled={loading}
            onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 15,
              border: "1px solid #ccc",
              borderRadius: 6,
              boxSizing: "border-box",
              marginBottom: 12
            }}
            autoFocus
            autoComplete="tel"
            aria-label="Mobile number"
          />
          <button
            onClick={handleSendOtp}
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px 0",
              backgroundColor: loading ? "#999" : "#000",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? "Sending…" : "Send OTP"}
          </button>
        </div>
      )}

      {/* Step 2 — OTP */}
      {step === 2 && (
        <div>
          {info && <p style={{ fontSize: 13, color: "#555", marginBottom: 12 }}>{info}</p>}

          {/* Dev-only: show OTP hint when running on mock provider */}
          {devOtp && (
            <div
              style={{
                background: "#fef9c3",
                border: "2px solid #facc15",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 16,
                textAlign: "center"
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#92400e",
                  fontWeight: 600,
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: 1
                }}
              >
                🔧 Dev Mode — Mock OTP (input auto-filled)
              </div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: 10,
                  color: "#78350f",
                  fontFamily: "monospace"
                }}
              >
                {devOtp}
              </div>
              <div style={{ fontSize: 11, color: "#92400e", marginTop: 4 }}>
                Just click Verify — no SMS sent
              </div>
            </div>
          )}

          <label htmlFor="otp" style={{ display: "block", marginBottom: 6, fontSize: 14 }}>
            6-digit OTP
          </label>
          <input
            id="otp"
            type="text"
            inputMode="numeric"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            disabled={loading}
            maxLength={6}
            onKeyDown={(e) => e.key === "Enter" && handleVerify()}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 20,
              letterSpacing: 8,
              border: "1px solid #ccc",
              borderRadius: 6,
              boxSizing: "border-box",
              marginBottom: 12
            }}
            autoFocus
            autoComplete="one-time-code"
            aria-label="One-time password"
          />
          <button
            onClick={handleVerify}
            disabled={loading || otp.length < 6}
            style={{
              width: "100%",
              padding: "10px 0",
              backgroundColor: loading || otp.length < 6 ? "#999" : "#000",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 15,
              cursor: loading || otp.length < 6 ? "not-allowed" : "pointer",
              marginBottom: 12
            }}
          >
            {loading ? "Verifying…" : tab === "signup" ? "Verify & Sign up" : "Verify & Sign in"}
          </button>
          <button
            onClick={() => {
              setStep(1);
              setOtp("");
              setChallengeId("");
              setDevOtp(null);
              setError(null);
              setInfo(null);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#555",
              fontSize: 13,
              cursor: "pointer",
              padding: 0
            }}
          >
            ← Change number
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p
          role="alert"
          style={{
            marginTop: 16,
            color: "#c00",
            fontSize: 13,
            padding: "8px 12px",
            border: "1px solid #f9c",
            borderRadius: 4,
            backgroundColor: "#fff5f5"
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export — wrap in Suspense so useSearchParams() works during SSR
// ---------------------------------------------------------------------------
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
