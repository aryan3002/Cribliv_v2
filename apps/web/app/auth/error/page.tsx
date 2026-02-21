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
    <div
      style={{
        maxWidth: 380,
        margin: "80px auto",
        padding: "0 16px",
        fontFamily: "sans-serif"
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Cribliv</h1>

      <div
        role="alert"
        aria-live="assertive"
        style={{
          marginTop: 24,
          padding: "16px",
          border: "1px solid #f9c",
          borderRadius: 6,
          backgroundColor: "#fff5f5"
        }}
      >
        <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: "#900" }}>{title}</p>
        <p style={{ fontSize: 14, color: "#555", margin: 0 }}>{description}</p>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
        <Link
          href={action.href as `/${string}`}
          style={{
            display: "inline-block",
            padding: "10px 20px",
            backgroundColor: "#000",
            color: "#fff",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: 14
          }}
        >
          {action.label}
        </Link>
        {action.href !== "/en" && (
          <Link
            href="/en"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              border: "1px solid #ccc",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 14,
              color: "#333"
            }}
          >
            Go home
          </Link>
        )}
      </div>

      {/* Show error code in small text for debugging without leaking details */}
      {errorCode && (
        <p style={{ marginTop: 24, fontSize: 11, color: "#aaa" }}>Error code: {errorCode}</p>
      )}
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
