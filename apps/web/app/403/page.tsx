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
  const role = (session?.user as { role?: UserRole } | undefined)?.role;

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "120px auto",
        padding: "0 24px",
        textAlign: "center",
        fontFamily: "sans-serif"
      }}
    >
      <div style={{ fontSize: 64, marginBottom: 16 }}>🚫</div>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>Access Denied</h1>
      <p style={{ color: "#555", marginBottom: 32, lineHeight: 1.5 }}>
        You don&apos;t have permission to view that page.
        {role && (
          <>
            {" "}
            You&apos;re logged in as{" "}
            <strong>{(session?.user as { phone?: string } | undefined)?.phone}</strong> ({role}).
          </>
        )}
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        {session ? (
          <Link
            href={roleDashboard(role) as `/${string}`}
            style={{
              background: "#000",
              color: "#fff",
              borderRadius: 6,
              padding: "10px 20px",
              textDecoration: "none",
              fontSize: 15
            }}
          >
            Go to my dashboard
          </Link>
        ) : (
          <Link
            href="/auth/login"
            style={{
              background: "#000",
              color: "#fff",
              borderRadius: 6,
              padding: "10px 20px",
              textDecoration: "none",
              fontSize: 15
            }}
          >
            Log in
          </Link>
        )}
        <Link
          href="/en"
          style={{
            border: "1px solid #ccc",
            borderRadius: 6,
            padding: "10px 20px",
            textDecoration: "none",
            fontSize: 15,
            color: "#333"
          }}
        >
          Home
        </Link>
      </div>
    </div>
  );
}
