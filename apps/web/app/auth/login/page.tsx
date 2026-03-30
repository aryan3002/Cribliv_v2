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

function normalizePhone(phone: string): string {
  const cleaned = phone.trim().replace(/\s+/g, "").replace(/^0+/, "");
  // If user already typed +91 prefix, keep it
  if (cleaned.startsWith("+91")) return cleaned;
  // If just digits, prepend +91
  return `+91${cleaned}`;
}

function validatePhone(phone: string): string | null {
  const normalized = normalizePhone(phone);
  if (!/^\+91\d{10}$/.test(normalized)) {
    return "Enter a valid 10-digit mobile number";
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

    const normalizedPhone = normalizePhone(phone);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: normalizedPhone, purpose: "login" })
      });

      const payload = (await res.json()) as {
        data?: { challenge_id: string; dev_otp?: string };
        error?: { code: string; message: string };
        // NestJS HttpException throws body directly (no wrapper)
        code?: string;
        message?: string;
      };

      if (!res.ok) {
        const errorCode = payload.error?.code ?? payload.code;
        setError(friendlyError(errorCode));
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

      setInfo(`OTP sent to ${normalizedPhone}`);
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
      const role = session?.user?.role;
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
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__logo">
          <span
            className="logo-dot"
            style={{ display: "inline-block", marginRight: 6, verticalAlign: "middle" }}
            aria-hidden="true"
          />
          Cribliv
        </div>
        <h1 className="auth-card__title">Welcome</h1>
        <p className="auth-card__subtitle">Sign in to save listings &amp; unlock owner contacts</p>

        {/* Tab switcher */}
        <div className="auth-tabs">
          {(["login", "signup"] as const).map((t) => (
            <button
              key={t}
              className={`auth-tab${tab === t ? " auth-tab--active" : ""}`}
              onClick={() => {
                setTab(t);
                setStep(1);
                setError(null);
                setInfo(null);
                setOtp("");
                setChallengeId("");
                setDevOtp(null);
              }}
            >
              {t === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        {/* Step 1 — Phone */}
        {step === 1 && (
          <div>
            <label htmlFor="phone" className="form-label">
              Mobile number
            </label>
            <div className="auth-phone-group">
              <span className="auth-phone-prefix">
                <span className="auth-phone-prefix__flag">🇮🇳</span>
                +91
              </span>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9999999901"
                disabled={loading}
                onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                className="input"
                autoFocus
                autoComplete="tel"
                aria-label="Mobile number"
              />
            </div>
            <button
              onClick={handleSendOtp}
              disabled={loading}
              className="btn btn--primary btn--full"
              style={{ marginTop: "var(--space-4)" }}
            >
              {loading ? "Sending…" : "Send OTP"}
            </button>
          </div>
        )}

        {/* Step 2 — OTP */}
        {step === 2 && (
          <div>
            {info && (
              <p className="body-sm text-secondary" style={{ marginBottom: "var(--space-3)" }}>
                {info}
              </p>
            )}

            {/* Dev-only: show OTP hint when running on mock provider */}
            {devOtp && (
              <div
                className="alert alert--warning"
                style={{ marginBottom: "var(--space-4)", textAlign: "center" }}
              >
                <div>
                  <div className="overline" style={{ marginBottom: "var(--space-1)" }}>
                    🔧 Dev Mode — Mock OTP (auto-filled)
                  </div>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: 32,
                      fontWeight: 700,
                      letterSpacing: 10,
                      color: "#78350f"
                    }}
                  >
                    {devOtp}
                  </div>
                  <div
                    className="caption"
                    style={{ marginTop: "var(--space-1)", color: "#92400e" }}
                  >
                    Just click Verify — no SMS sent
                  </div>
                </div>
              </div>
            )}

            <label htmlFor="otp" className="form-label">
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
              className="input"
              style={{ fontSize: 20, letterSpacing: 8, textAlign: "center" }}
              autoFocus
              autoComplete="one-time-code"
              aria-label="One-time password"
            />
            <button
              onClick={handleVerify}
              disabled={loading || otp.length < 6}
              className="btn btn--primary btn--full"
              style={{ marginTop: "var(--space-4)", marginBottom: "var(--space-3)" }}
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
              className="btn btn--ghost btn--sm"
              style={{ padding: 0 }}
            >
              ← Change number
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="alert alert--error" role="alert" style={{ marginTop: "var(--space-4)" }}>
            {error}
          </div>
        )}
      </div>
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
