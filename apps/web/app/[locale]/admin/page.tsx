"use client";

import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { AdminShell } from "../../../components/admin/shell/AdminShell";

/* ──────────────────────────────────────────────────────────────────────
 * Admin route — thin auth shim.
 *
 * Every meaningful piece of UI lives under components/admin/. This file
 * just unwraps the session, hands the access token to AdminShell, and
 * forces a sign-out if the API ever returns 401 (handled inside the shell
 * via the toast pipeline; we listen here for an explicit signal too).
 * ──────────────────────────────────────────────────────────────────── */

export default function AdminDashboardPage() {
  const { data: nextAuthSession, status } = useSession();
  const accessToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;

  useEffect(() => {
    if (status === "unauthenticated") {
      void signOut({ callbackUrl: "/auth/login" });
    }
  }, [status]);

  if (status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "#6B7280",
          fontSize: 13
        }}
      >
        Loading admin…
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "#6B7280",
          fontSize: 13
        }}
      >
        Sign in required.
      </div>
    );
  }

  return <AdminShell accessToken={accessToken} />;
}
