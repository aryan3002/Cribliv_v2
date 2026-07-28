"use client";

import { signIn, getSession, useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Sparkles } from "lucide-react";
import { BrandLockup } from "../../../../components/brand/brand-lockup";
import { NameCaptureForm } from "../../../../components/name-capture/name-capture-form";
import { t } from "../../../../lib/i18n";
import { resolveAuthedDestination } from "../../../../lib/login-redirect";
import { hasName, markNamePromptDismissed } from "../../../../lib/name-capture";
import { signInWithCsrfRetry } from "../../../../lib/sign-in-retry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:4000/v1";

/**
 * Prefix `from=` with the active locale if the link target shipped without one.
 * Without this, `from=/pg-operator/become` would navigate to a locale-less URL
 * that the App-Router doesn't serve — yielding a 404 even though auth succeeded.
 * Defensive: callers SHOULD pass locale-aware `from`, but historically didn't.
 */
function normalizeFromPath(path: string | null | undefined, locale: string): string | null {
  if (!path) return null;
  if (path === "/" || /^\/(en|hi)(\/|$)/.test(path)) return path; // already locale-aware
  if (!path.startsWith("/")) return null; // refuse arbitrary off-site redirects
  return `/${locale}${path}`;
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
  MissingCSRF: "Your secure sign-in session expired. Please try again.",
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
  const params = useSearchParams();
  const locale = "en"; // single supported locale today; hi when middleware ramps it
  const fromPath = normalizeFromPath(params.get("from"), locale);
  const { data: session, status } = useSession();

  // UI state
  const initialTab = params.get("tab") === "signup" ? "signup" : "login";
  const [tab, setTab] = useState<"login" | "signup">(initialTab);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form state
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null); // Only in mock mode

  // Where to go once the name step is done (saved or skipped).
  const [pendingDest, setPendingDest] = useState<string | null>(null);
  const [nameToken, setNameToken] = useState<string | null>(null);
  const [nameUserId, setNameUserId] = useState<string | null>(null);
  const [nameRole, setNameRole] = useState<string | null>(null);

  // Async state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // True from the moment handleVerify begins OTP verification until it either
  // diverts to the name step or navigates away. A ref, not state: it must be
  // observable on the very render where useSession()'s status flips, and a
  // ref updates synchronously without waiting for a render. This matters
  // because signIn() flips status to "authenticated" as part of its own
  // completion — before handleVerify's subsequent getSession() call resolves
  // and setStep(3) runs. On that render, `step` is still 1, so a guard that
  // only checks `step === 3` is always one render too late; it must also
  // consult this ref.
  const verifyingRef = useRef(false);

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
    // Set BEFORE signIn() is ever called (and before the OTP-format check, so
    // no path that skips signIn() can leave a stale `true` behind — every
    // early return below explicitly clears it again). See the ref's own
    // declaration comment for why this has to be a ref and not state.
    verifyingRef.current = true;
    setError(null);
    const otpErr = validateOtp(otp);
    if (otpErr) {
      setError(otpErr);
      verifyingRef.current = false;
      return;
    }

    setLoading(true);
    try {
      const result = await signInWithCsrfRetry(signIn, {
        challengeId,
        otpCode: otp.trim(),
        phone: phone.trim()
      });
      if (result?.error) {
        setError(friendlyError(result.error));
        verifyingRef.current = false;
        return;
      }

      // Resolve the session — getSession() can race with the cookie write on
      // the first call after signIn (well-known NextAuth v5 timing window).
      // Retry once after a short tick if role is missing.
      let session = await getSession();
      if (!session?.user?.role) {
        console.warn("[auth] session role missing after signIn — retrying");
        await new Promise((r) => setTimeout(r, 200));
        session = await getSession();
      }
      const role = session?.user?.role;

      // Pick destination. If we still don't have a role (cookie still racing
      // or /auth/me sync slow), trust the cookie and navigate to fromPath;
      // middleware will enforce role-based access. Avoid the silent "fall
      // back to homepage" path that made owners think login had failed.
      const safeDest = resolveAuthedDestination(role, fromPath, locale);

      // Divert to the name step when the account has no name. Covers brand-new
      // signups (always nameless) and existing users who never set one.
      // session.user.name is populated by the /auth/me sync in the session
      // callback, so it is authoritative by this point.
      if (!hasName(session?.user?.name) && role !== "admin") {
        const token = (session as { accessToken?: string } | null)?.accessToken ?? null;
        if (token) {
          setNameToken(token);
          setNameUserId(session?.user?.id ?? null);
          setNameRole(role ?? null);
          setPendingDest(safeDest);
          setStep(3);
          // verifyingRef is intentionally left `true` here: step 3 renders
          // right away with the same commit, so both guards already stand
          // down on `step === 3` alone from this point on. Nothing further
          // needs the ref.
          return;
        }
      }

      // Force a full page navigation instead of router.push. router.push uses
      // the App Router's client-side cache; if middleware can't yet see the
      // freshly-set session cookie, it silently bounces back to login and the
      // URL doesn't change. window.location.href guarantees a fresh request
      // that includes the new cookie, sidestepping the race entirely.
      // (verifyingRef is left `true`; the navigation unloads the page, so
      // there is no further render for a stale ref to affect.)
      window.location.href = safeDest;
    } catch {
      setError("Sign-in failed. Please try again.");
      verifyingRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [challengeId, otp, phone, fromPath]);

  // ------------------------------------------------------------------
  // Guard — already authenticated
  // ------------------------------------------------------------------
  // If a session is already present (e.g. the middleware cookie race bounced a
  // just-logged-in user back here, or they reached /auth/login via back button
  // or a stale link), don't show the login form — send them onward. Fires only
  // once the client session is hydrated, so the cookie is committed and the
  // destination won't bounce back to login. window.location.replace: a full
  // navigation (guarantees the cookie) that leaves no login entry in history.
  useEffect(() => {
    // step 3 is the post-verify name capture: the session IS authenticated
    // there by design, so this guard must stand down or it redirects the user
    // away mid-typing. That alone is too late, though: signIn() flips
    // useSession()'s status to "authenticated" as part of its own completion,
    // before handleVerify's getSession() resolves and setStep(3) runs — so on
    // the render where status first flips, `step` is still 1. verifyingRef
    // (set synchronously at the very start of handleVerify, before signIn())
    // is what actually stands this guard down on that earlier render; `step
    // === 3` only takes over from the render after that.
    if (step === 3 || verifyingRef.current) return;
    if (status === "authenticated") {
      window.location.replace(resolveAuthedDestination(session?.user?.role, fromPath, locale));
    }
  }, [status, session, fromPath, locale, step]);

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

  // Already authenticated → we're redirecting (effect above). Render nothing
  // instead of a flash of the login form. EXCEPT step 3: that step is reached
  // precisely because the session just became authenticated, and it renders
  // its own card below — this early return must not blank that out from
  // under it (the effect's guard alone isn't enough; this render gate short-
  // circuits before that card's JSX is ever reached).
  //
  // `step !== 3` alone is too late for the same reason the effect above needs
  // verifyingRef: status can flip to "authenticated" on a render that still
  // has `step === 1` (signIn() completes before handleVerify reaches
  // setStep(3)). Without also consulting the ref here, this gate would blank
  // the page on exactly that render — a real DOM node the E2E suite observed
  // (see login-guard.test.tsx's earlier-flip regression test).
  if (status === "authenticated" && step !== 3 && !verifyingRef.current) {
    return <div className="auth-canvas" aria-hidden="true" />;
  }

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

          {/* Tab switcher — hidden on step 3 (post-verify name capture). The
              user is already authenticated by that point, so a login/signup
              choice is no longer meaningful; more importantly, its onClick
              calls setStep(1) but has no way to also clear verifyingRef
              (deliberately left `true` when step 3 is reached — see that
              ref's declaration comment above). Without this guard, clicking a
              tab here would flip `step` back to 1 while the ref stayed `true`,
              which stands down BOTH the redirect effect and the render-time
              "already authenticated" gate — stranding an authenticated user on
              the phone form with no way to reach their destination. */}
          {step !== 3 && (
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
          )}

          {/* Signup benefits strip */}
          {tab === "signup" ? (
            <div
              className="auth-benefits"
              data-testid="signup-benefits"
              style={{
                margin: "var(--space-3) 0",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-1)"
              }}
            >
              {(["loginBenefit1", "loginBenefit2", "loginBenefit3"] as const).map((key) => (
                <p
                  key={key}
                  className="caption"
                  style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}
                >
                  <span aria-hidden="true">✦</span> {t(locale, key)}
                </p>
              ))}
            </div>
          ) : null}

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
                    <span>Dev mode, mock OTP auto-filled</span>
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

          {/* Step 3 — Name capture (nameless account, post-verify) */}
          {step === 3 && nameToken && (
            <motion.div variants={fadeUp} custom={4} initial="hidden" animate="show">
              <h1 className="auth-card__title">{t(locale, "nameCaptureTitle")}</h1>
              <NameCaptureForm
                locale={locale}
                variant={nameRole === "owner" || nameRole === "pg_operator" ? "owner" : "tenant"}
                token={nameToken}
                submitLabelKey="nameCaptureSaveAndContinue"
                onSaved={() => {
                  if (pendingDest) window.location.href = pendingDest;
                }}
                onSkip={() => {
                  // Suppress the ambient modal on landing — being asked twice in a
                  // row reads as a broken form. It returns on the next login.
                  if (nameUserId && typeof window !== "undefined") {
                    markNamePromptDismissed(nameUserId, window.sessionStorage);
                  }
                  if (pendingDest) window.location.href = pendingDest;
                }}
              />
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
          By continuing, you agree to Cribliv&apos;s <a href="/en/terms">Terms</a> and{" "}
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
