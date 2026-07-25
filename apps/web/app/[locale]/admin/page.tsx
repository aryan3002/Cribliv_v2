"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useSession, signOut } from "next-auth/react";
import { AdminShell } from "../../../components/admin/shell/AdminShell";
import { UNAUTHORIZED_EVENT } from "../../../lib/api";

/* ──────────────────────────────────────────────────────────────────────
 * Admin route — thin auth shim.
 *
 * Every meaningful piece of UI lives under components/admin/. This file
 * unwraps the session, hands the access token to AdminShell, and owns the
 * recovery path for when that token stops working.
 *
 * Why that recovery path exists: next-auth v5's React Server Component
 * `auth()` branch runs the jwt callback (which rotates the refresh token)
 * but drops the resulting Set-Cookie. The API had already revoked the old
 * session, so the browser was left holding a dead token while NextAuth
 * still reported "authenticated" — a fully rendered admin portal where
 * every panel 401'd, indefinitely, with no way out but a manual sign-out.
 *
 * Two signals, two responses:
 *   401 from any admin call → re-read the session. The API replays a
 *     rotated refresh token within its grace window, so this normally
 *     swaps in a working token without the user noticing.
 *   session.error → the refresh was definitively rejected. Sign out to
 *     the login page rather than render a dead surface.
 * ──────────────────────────────────────────────────────────────────── */

/** Don't stampede the session endpoint when many panels 401 at once. */
const HEAL_THROTTLE_MS = 5_000;

const centeredNotice: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  color: "#6B7280",
  fontSize: 13
};

export default function AdminDashboardPage() {
  const { data: session, status, update } = useSession();
  const accessToken = session?.accessToken ?? null;
  const refreshFailed = session?.error === "RefreshFailed";

  const lastHealAt = useRef(0);
  const healPending = useRef(false);
  const previousToken = useRef<string | null>(null);
  const [healNonce, setHealNonce] = useState(0);

  // No session cookie at all.
  useEffect(() => {
    if (status === "unauthenticated") {
      void signOut({ callbackUrl: "/auth/login" });
    }
  }, [status]);

  // Cookie is alive but the API rejected the refresh token — unrecoverable, so
  // end the session cleanly instead of stalling on a surface that only 401s.
  useEffect(() => {
    if (refreshFailed) {
      void signOut({ callbackUrl: "/auth/login?reason=session-expired" });
    }
  }, [refreshFailed]);

  // A 401 is usually a rotation whose cookie never reached us. Re-reading the
  // session runs the jwt callback, which retries the refresh and picks up the
  // replayed tokens.
  useEffect(() => {
    const onUnauthorized = () => {
      const now = Date.now();
      if (now - lastHealAt.current < HEAL_THROTTLE_MS) return;
      lastHealAt.current = now;
      healPending.current = true;
      void update();
    };

    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [update]);

  // Remount the shell when a heal actually produced a new token, so panels that
  // failed against the dead one refetch. Routine 30-minute rotations are left
  // alone — remounting those would discard in-tab filter state for no reason.
  useEffect(() => {
    if (
      accessToken &&
      previousToken.current &&
      accessToken !== previousToken.current &&
      healPending.current
    ) {
      healPending.current = false;
      setHealNonce((n) => n + 1);
    }
    previousToken.current = accessToken;
  }, [accessToken]);

  if (status === "loading") {
    return <div style={centeredNotice}>Loading admin…</div>;
  }

  if (refreshFailed) {
    return <div style={centeredNotice}>Session expired — taking you to sign in…</div>;
  }

  if (!accessToken) {
    return <div style={centeredNotice}>Sign in required.</div>;
  }

  return <AdminShell key={healNonce} accessToken={accessToken} />;
}
