"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Error definitions
// ---------------------------------------------------------------------------
interface ErrorInfo {
  title: string;
  description: string;
  action: { label: string; href: string };
}

const ERROR_MAP: Record<string, ErrorInfo> = {
  // NextAuth built-in
  CredentialsSignin: {
    title: "Sign-in failed",
    description: "Incorrect OTP or the session has expired. Please try again.",
    action: { label: "Try again", href: "/auth/login" }
  },
  Configuration: {
    title: "Configuration error",
    description: "There is a problem with the server configuration. Please contact support.",
    action: { label: "Go home", href: "/en" }
  },
  // Custom / backend error codes surfaced via NextAuth
  otp_expired: {
    title: "OTP expired",
    description: "Your verification code has expired. Please request a new one.",
    action: { label: "Request new OTP", href: "/auth/login" }
  },
  otp_blocked: {
    title: "Too many attempts",
    description:
      "Your OTP has been blocked after too many incorrect attempts. Please try signing in again.",
    action: { label: "Sign in again", href: "/auth/login" }
  },
  otp_rate_limited: {
    title: "Too many requests",
    description: "You have requested too many OTPs. Please wait 10 minutes before trying again.",
    action: { label: "Go home", href: "/en" }
  },
  invalid_otp: {
    title: "Invalid code",
    description: "The OTP you entered is incorrect. Please try again.",
    action: { label: "Try again", href: "/auth/login" }
  },
  // Fallback
  default: {
    title: "Authentication error",
    description:
      "An unexpected error occurred. Please try again or contact support if the issue persists.",
    action: { label: "Try again", href: "/auth/login" }
  }
};

function getErrorInfo(code: string | null): ErrorInfo {
  if (!code) return ERROR_MAP.default;
  return ERROR_MAP[code] ?? ERROR_MAP.default;
}

// ---------------------------------------------------------------------------
// Inner component — uses useSearchParams, must be inside Suspense
// ---------------------------------------------------------------------------
function ErrorPageInner() {
  const params = useSearchParams();
  const errorCode = params.get("error");
  const { title, description, action } = getErrorInfo(errorCode);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-card__title">Cribliv</h1>

        <div className="alert alert--error" role="alert" aria-live="assertive">
          <p style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}>{title}</p>
          <p className="caption" style={{ margin: 0 }}>
            {description}
          </p>
        </div>

        <div style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-3)" }}>
          <Link href={action.href as `/${string}`} className="btn btn--primary">
            {action.label}
          </Link>
          {action.href !== "/en" && (
            <Link href="/en" className="btn btn--secondary">
              Go home
            </Link>
          )}
        </div>

        {errorCode && (
          <p
            className="caption"
            style={{ marginTop: "var(--space-5)", color: "var(--text-tertiary)" }}
          >
            Error code: {errorCode}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <ErrorPageInner />
    </Suspense>
  );
}
