"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import type { UserRole } from "../../auth.config";

function roleDashboard(role: UserRole | undefined): string {
  if (role === "owner" || role === "pg_operator") return "/en/owner/dashboard";
  if (role === "admin") return "/en/admin";
  return "/en/tenant/dashboard";
}

export default function ForbiddenPage() {
  const { data: session } = useSession();
  const role = session?.user?.role;

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: "var(--space-4)" }}>🚫</div>
        <h1 className="h2" style={{ marginBottom: "var(--space-3)" }}>
          Access Denied
        </h1>
        <p
          className="caption"
          style={{ color: "var(--text-tertiary)", marginBottom: "var(--space-6)", lineHeight: 1.6 }}
        >
          You don&apos;t have permission to view that page.
          {role && (
            <>
              {" "}
              You&apos;re logged in as <strong>{session?.user?.phone}</strong> ({role}).
            </>
          )}
        </p>
        <div
          style={{
            display: "flex",
            gap: "var(--space-3)",
            justifyContent: "center",
            flexWrap: "wrap"
          }}
        >
          {session ? (
            <Link href={roleDashboard(role) as `/${string}`} className="btn btn--primary">
              Go to my dashboard
            </Link>
          ) : (
            <Link href="/auth/login" className="btn btn--primary">
              Log in
            </Link>
          )}
          <Link href="/en" className="btn btn--secondary">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
