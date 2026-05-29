"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requestRoleUpgrade } from "@/lib/owner-api";

type Role = "tenant" | "owner" | "pg_operator" | "admin";
type Phase = "working" | "blocked" | "pending" | "error" | "done" | "needs_signin";

interface Props {
  locale: string;
  currentRole: Role;
  accessToken: string | null;
}

export default function PgBecomeClient({ locale, currentRole, accessToken }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() => {
    if (currentRole === "pg_operator") return "done";
    if (currentRole === "owner") return "blocked";
    if (!accessToken) return "needs_signin";
    return "working";
  });
  const [error, setError] = useState<string | null>(null);

  const doGrant = async () => {
    if (!accessToken) return;
    setPhase("working");
    setError(null);
    try {
      // Real signature: requestRoleUpgrade(accessToken, requestedRole)
      // Returns { status: "granted" | "pending" | "already_granted", role?, requested_role, request_id }
      const r = await requestRoleUpgrade(accessToken, "pg_operator");
      if (r.status === "granted" || r.status === "already_granted") {
        router.refresh(); // pick up new JWT role in next-auth session
        setPhase("done");
        router.push(`/${locale}/pg-operator/dashboard` as any);
      } else if (r.status === "pending") {
        setPhase("pending");
      } else {
        setError(`Unexpected status: ${(r as any).status}`);
        setPhase("error");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  useEffect(() => {
    if (currentRole === "tenant" && accessToken) void doGrant();
    if (currentRole === "pg_operator") router.push(`/${locale}/pg-operator/dashboard` as any);
  }, [currentRole, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === "needs_signin") {
    return (
      <main className="pg-become pg-become--needs-signin">
        <h1>Sign in to continue</h1>
        <p>You need to be signed in to become a PG operator.</p>
        <a href={`/${locale}/auth/login?from=/pg-operator/become`}>Sign in</a>
      </main>
    );
  }
  if (phase === "blocked") {
    return (
      <main className="pg-become pg-become--blocked">
        <h1>You already manage properties as an owner</h1>
        <p>
          Managing both an owner account and a PG operator account in one profile is on the V1.5
          roadmap. Reach out at support@cribliv.com if you need this sooner.
        </p>
        <a href={`/${locale}/owner/dashboard`}>Back to your owner dashboard</a>
      </main>
    );
  }
  if (phase === "pending") {
    return (
      <main className="pg-become pg-become--pending">
        <h1>Your PG operator request is being reviewed</h1>
        <p>
          We&apos;ll email you within 1 business day once your account is approved. You&apos;ll then
          be able to list your PG.
        </p>
      </main>
    );
  }
  if (phase === "error") {
    return (
      <main className="pg-become pg-become--error">
        <h1>Couldn&apos;t set you up just yet</h1>
        <p role="alert">{error ?? "Something went wrong."}</p>
        <button type="button" onClick={doGrant}>
          Retry
        </button>
      </main>
    );
  }
  return (
    <main className="pg-become pg-become--working">
      <h1>Setting up your PG operator account…</h1>
      <p>Welcome aboard. Taking you to your dashboard.</p>
    </main>
  );
}
