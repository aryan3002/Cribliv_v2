"use client";

/**
 * /en/become-owner
 *
 * Role upgrade request page.
 *
 * In-memory (dev) mode  → role is granted IMMEDIATELY, session is refreshed
 *                          and user is redirected to the owner dashboard.
 * DB (prod) mode         → pending request is created; admin must approve.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { requestRoleUpgrade } from "../../../lib/owner-api";

type RoleChoice = "owner" | "pg_operator";

const ROLE_INFO: Record<RoleChoice, { label: string; description: string; examples: string[] }> = {
  owner: {
    label: "Property Owner",
    description: "I own a flat, house, apartment or villa that I want to rent out.",
    examples: ["1 BHK / 2 BHK flat", "Independent house", "Builder floor", "Studio apartment"]
  },
  pg_operator: {
    label: "PG Operator",
    description:
      "I run a paying guest accommodation with shared / private rooms and common facilities.",
    examples: ["Boys / Girls PG", "Co-living space", "Hostel", "Serviced accommodation"]
  }
};

export default function BecomeOwnerPage({ params }: { params: { locale: string } }) {
  const { locale } = params;
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();
  const accessToken = (session as { accessToken?: string } | null)?.accessToken ?? null;
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  const [selected, setSelected] = useState<RoleChoice>("owner");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [grantedRole, setGrantedRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  //  Not logged in
  if (status === "loading") {
    return (
      <section className="hero">
        <div className="skeleton skeleton--card" style={{ height: 120 }} />
      </section>
    );
  }

  if (!session) {
    return (
      <section className="hero">
        <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
          <h2>Sign in first</h2>
          <p className="muted-text">You need to be logged in to request a role upgrade.</p>
          <Link
            href={`/auth/login?from=/${locale}/become-owner`}
            className="primary"
            style={{ marginTop: 16, display: "inline-block" }}
          >
            Login / Sign up
          </Link>
        </div>
      </section>
    );
  }

  //  Already an owner or pg_operator
  if (userRole === "owner" || userRole === "pg_operator") {
    return (
      <section className="hero">
        <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div
            style={{ background: "#e8fdf0", borderRadius: 10, padding: "24px", marginBottom: 24 }}
          >
            <h2 style={{ margin: "0 0 8px" }}>
              ✓ You&apos;re already a{""}
              {userRole === "pg_operator" ? "PG Operator" : "Property Owner"}
            </h2>
            <p className="muted-text" style={{ margin: 0 }}>
              Your role is active. Manage your listings from the dashboard.
            </p>
          </div>
          <Link href={`/${locale}/owner/dashboard`} className="primary">
            Go to Dashboard
          </Link>
        </div>
      </section>
    );
  }

  //  Role granted (immediate, dev mode)
  if (grantedRole) {
    const roleLabel = grantedRole === "pg_operator" ? "PG Operator" : "Property Owner";
    return (
      <section className="hero">
        <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
          <h2 style={{ margin: "0 0 8px" }}>✓ You are now a {roleLabel}!</h2>
          <p className="muted-text">Your account has been upgraded. Redirecting to dashboard</p>
        </div>
      </section>
    );
  }

  //  Pending admin approval (DB / prod mode)
  if (submitted) {
    return (
      <section className="hero">
        <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
          <h2 style={{ margin: "0 0 8px" }}>Request submitted! 🎉</h2>
          <p className="muted-text">
            Your request to become a{""}
            <strong>{ROLE_INFO[selected].label}</strong> is pending admin approval (usually within
            24 hours).
          </p>
          <Link
            href={`/${locale}`}
            style={{
              marginTop: 20,
              display: "inline-block",
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "8px 20px",
              textDecoration: "none",
              color: "#374151"
            }}
          >
            ← Back to home
          </Link>
        </div>
      </section>
    );
  }

  //  Request form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Guard: stale / missing token  send user to login
    if (!accessToken) {
      void signIn(undefined, { callbackUrl: `/${locale}/become-owner` });
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await requestRoleUpgrade(accessToken, selected);

      if (result.status === "granted") {
        // In-memory mode: role was granted immediately
        // 1. Force NextAuth to re-fetch /auth/me so session.user.role updates
        await updateSession();
        setGrantedRole(result.role ?? selected);
        // 2. Redirect to owner dashboard after a short tick so the banner updates
        setTimeout(() => {
          router.push(`/${locale}/owner/dashboard`);
        }, 1500);
      } else if (result.status === "already_granted") {
        // User already has this role (idempotent)
        await updateSession();
        router.push(`/${locale}/owner/dashboard`);
      } else {
        // DB mode: pending admin approval
        setSubmitted(true);
      }
    } catch (err) {
      const isApiError = err && typeof err === "object" && "status" in err;
      const status = isApiError ? (err as { status: number }).status : 0;

      if (status === 401) {
        // Session token expired (API restarted)  force re-login
        void signIn(undefined, { callbackUrl: `/${locale}/become-owner` });
        return;
      }

      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      if (msg.includes("already_pending")) {
        setError("You already have a pending request. An admin will review it shortly.");
      } else if (msg.includes("already_has_role")) {
        // Already upgraded  just go to dashboard
        await updateSession();
        router.push(`/${locale}/owner/dashboard`);
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="hero">
      <h1 style={{ marginBottom: 8 }}>List your property on CribLiv</h1>
      <p className="muted-text" style={{ marginBottom: 32 }}>
        Select your role below and get instant access.
      </p>

      <form onSubmit={handleSubmit}>
        {/* Role selector cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 24
          }}
        >
          {(["owner", "pg_operator"] as RoleChoice[]).map((role) => {
            const info = ROLE_INFO[role];
            const active = selected === role;
            return (
              <button
                key={role}
                type="button"
                onClick={() => setSelected(role)}
                style={{
                  textAlign: "left",
                  padding: 20,
                  borderRadius: 10,
                  border: active ? "2px solid #000" : "1px solid #e5e7eb",
                  background: active ? "#fafafa" : "#fff",
                  cursor: "pointer",
                  transition: "border 0.15s"
                }}
                aria-pressed={active}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 8
                  }}
                >
                  <strong style={{ fontSize: 16 }}>{info.label}</strong>
                  {active && (
                    <span
                      style={{
                        background: "#000",
                        color: "#fff",
                        borderRadius: "50%",
                        width: 20,
                        height: 20,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        flexShrink: 0
                      }}
                    >
                      ✓
                    </span>
                  )}
                </div>
                <p className="muted-text" style={{ margin: "0 0 12px", fontSize: 13 }}>
                  {info.description}
                </p>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 16,
                    fontSize: 12,
                    color: "#6b7280",
                    listStyle: "disc"
                  }}
                >
                  {info.examples.map((ex) => (
                    <li key={ex}>{ex}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="panel warning-box" role="alert" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          className="primary"
          disabled={submitting}
          style={{ width: "100%", padding: "12px 0", fontSize: 15 }}
        >
          {submitting ? "Activating…" : `Get ${ROLE_INFO[selected].label} access →`}
        </button>

        <p className="muted-text" style={{ marginTop: 12, fontSize: 12, textAlign: "center" }}>
          By submitting you agree to CribLiv&apos;s owner terms. We may contact you for
          verification.
        </p>
      </form>
    </section>
  );
}
