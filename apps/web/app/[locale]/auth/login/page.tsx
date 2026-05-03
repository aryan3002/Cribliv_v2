"use client";

import { signIn, getSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, Suspense } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Sparkles } from "lucide-react";
import type { UserRole } from "../../../../auth.config";
import { BrandLockup } from "../../../../components/brand/brand-lockup";

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
  const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    show: (i: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: { delay: 0.06 * i, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] as const }
    })
  };

  const subtitleCopy =
    tab === "signup" ? "Two minutes. No brokers. No passwords." : "Pick up where you left off.";

  return (
    <div className="auth-canvas">
      {/* atmospheric layers */}
      <div className="auth-canvas__aurora" aria-hidden="true" />
      <div className="auth-canvas__grain" aria-hidden="true" />
      <div className="auth-canvas__orb auth-canvas__orb--a" aria-hidden="true" />
      <div className="auth-canvas__orb auth-canvas__orb--b" aria-hidden="true" />

      {/* city skyline silhouette — gives the canvas an Indian-rentals sense of place */}
      <svg
        className="auth-canvas__skyline"
        viewBox="0 0 1440 220"
        preserveAspectRatio="xMidYMax slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="skylineFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(8, 18, 38, 0.85)" />
          </linearGradient>
          <pattern
            id="skylineWindows"
            x="0"
            y="0"
            width="6"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <rect x="2" y="2" width="2" height="2" fill="rgba(255,200,80,0.12)" />
            <rect x="2" y="6" width="2" height="2" fill="rgba(140,180,255,0.08)" />
          </pattern>
        </defs>
        <path
          d="M0,220 L0,150 L40,150 L40,120 L80,120 L80,140 L120,140 L120,90 L160,90 L160,110 L200,110 L200,80 L240,80 L240,130 L280,130 L280,100 L320,100 L320,140 L360,140 L360,70 L400,70 L400,110 L440,110 L440,150 L480,150 L480,90 L520,90 L520,120 L560,120 L560,60 L600,60 L600,100 L640,100 L640,140 L680,140 L680,80 L720,80 L720,120 L760,120 L760,150 L800,150 L800,100 L840,100 L840,70 L880,70 L880,130 L920,130 L920,90 L960,90 L960,140 L1000,140 L1000,110 L1040,110 L1040,80 L1080,80 L1080,120 L1120,120 L1120,150 L1160,150 L1160,100 L1200,100 L1200,140 L1240,140 L1240,90 L1280,90 L1280,120 L1320,120 L1320,80 L1360,80 L1360,130 L1400,130 L1400,150 L1440,150 L1440,220 Z"
          fill="rgba(8, 18, 38, 0.7)"
        />
        <path
          d="M0,220 L0,150 L40,150 L40,120 L80,120 L80,140 L120,140 L120,90 L160,90 L160,110 L200,110 L200,80 L240,80 L240,130 L280,130 L280,100 L320,100 L320,140 L360,140 L360,70 L400,70 L400,110 L440,110 L440,150 L480,150 L480,90 L520,90 L520,120 L560,120 L560,60 L600,60 L600,100 L640,100 L640,140 L680,140 L680,80 L720,80 L720,120 L760,120 L760,150 L800,150 L800,100 L840,100 L840,70 L880,70 L880,130 L920,130 L920,90 L960,90 L960,140 L1000,140 L1000,110 L1040,110 L1040,80 L1080,80 L1080,120 L1120,120 L1120,150 L1160,150 L1160,100 L1200,100 L1200,140 L1240,140 L1240,90 L1280,90 L1280,120 L1320,120 L1320,80 L1360,80 L1360,130 L1400,130 L1400,150 L1440,150 L1440,220 Z"
          fill="url(#skylineWindows)"
        />
        <rect x="0" y="0" width="1440" height="220" fill="url(#skylineFade)" />
      </svg>

      <div className="auth-canvas__inner">
        <motion.div
          className="auth-card auth-card--glass"
          initial="hidden"
          animate="show"
          transition={{ staggerChildren: 0.05 }}
        >
          <motion.div
            className="auth-card__brand"
            variants={fadeUp}
            custom={0}
            initial="hidden"
            animate="show"
          >
            <BrandLockup size="lg" glow priority />
          </motion.div>

          <motion.h1
            className="auth-card__title"
            variants={fadeUp}
            custom={1}
            initial="hidden"
            animate="show"
          >
            {tab === "signup" ? "Welcome home." : "Welcome back."}
          </motion.h1>

          <motion.p
            className="auth-card__subtitle"
            variants={fadeUp}
            custom={2}
            initial="hidden"
            animate="show"
          >
            {subtitleCopy}
          </motion.p>

          {/* Tab switcher */}
          <motion.div
            className="auth-tabs auth-tabs--pill"
            variants={fadeUp}
            custom={3}
            initial="hidden"
            animate="show"
            role="tablist"
          >
            {(["login", "signup"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
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
          </motion.div>

          {/* Step 1 — Phone */}
          {step === 1 && (
            <motion.div variants={fadeUp} custom={4} initial="hidden" animate="show">
              <label htmlFor="phone" className="form-label auth-form-label">
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
                  placeholder="98765 43210"
                  disabled={loading}
                  onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                  className="input auth-input"
                  autoFocus
                  autoComplete="tel"
                  aria-label="Mobile number"
                />
              </div>
              <button
                onClick={handleSendOtp}
                disabled={loading}
                className="btn btn--primary btn--full auth-cta"
              >
                {loading ? "Sending…" : "Continue with OTP"}
              </button>
            </motion.div>
          )}

          {/* Step 2 — OTP */}
          {step === 2 && (
            <motion.div variants={fadeUp} custom={4} initial="hidden" animate="show">
              {info && <p className="auth-info-line">{info}</p>}

              {/* Dev-only: show OTP hint when running on mock provider */}
              {devOtp && (
                <div className="auth-dev-chip" role="note">
                  <div className="auth-dev-chip__row">
                    <Sparkles size={13} aria-hidden="true" />
                    <span>Dev mode — mock OTP auto-filled</span>
                  </div>
                  <div className="auth-dev-chip__digits">{devOtp}</div>
                  <div className="auth-dev-chip__hint">No SMS sent. Just hit Verify.</div>
                </div>
              )}

              <label htmlFor="otp" className="form-label auth-form-label">
                6-digit code
              </label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="• • • • • •"
                disabled={loading}
                maxLength={6}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                className="input auth-input auth-input--otp"
                autoFocus
                autoComplete="one-time-code"
                aria-label="One-time password"
              />
              <button
                onClick={handleVerify}
                disabled={loading || otp.length < 6}
                className="btn btn--primary btn--full auth-cta"
              >
                {loading
                  ? "Verifying…"
                  : tab === "signup"
                    ? "Verify & Sign up"
                    : "Verify & Sign in"}
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
                className="auth-change-number"
                type="button"
              >
                ← Change number
              </button>
            </motion.div>
          )}

          {/* Error message */}
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <motion.div
            className="auth-trust-row"
            variants={fadeUp}
            custom={5}
            initial="hidden"
            animate="show"
          >
            <ShieldCheck size={13} aria-hidden="true" />
            <span>Trusted by verified owners across India</span>
          </motion.div>
        </motion.div>

        <motion.p
          className="auth-fine-print"
          variants={fadeUp}
          custom={6}
          initial="hidden"
          animate="show"
        >
          By continuing, you agree to Cribliv's <a href="/en/terms">Terms</a> and{" "}
          <a href="/en/privacy">Privacy Policy</a>.
        </motion.p>
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
