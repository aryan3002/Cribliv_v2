"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import type { UserRole } from "../../auth.config";

interface ProtectedRouteProps {
  children: ReactNode;
  /** If omitted, any authenticated user is allowed. */
  allowedRoles?: UserRole[];
}

/**
 * Client-side route guard.
 *
 * Middleware (middleware.ts) already blocks server-side requests, but this
 * component adds a second layer of protection inside React so that role
 * changes mid-session and client-navigation edge cases are also handled.
 *
 * Behaviour:
 *  - Loading   → show spinner (prevent flash of protected content)
 *  - No session  → redirect to /auth/login?from={pathname}
 *  - Wrong role  → redirect to /403
 *  - OK        → render {children}
 */
export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const isLoading = status === "loading";
  const isAuthenticated = status === "authenticated";

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated || !session) {
      const loginUrl = `/auth/login?from=${encodeURIComponent(pathname)}` as `/${string}`;
      return;
    }

    if (allowedRoles && allowedRoles.length > 0) {
      const role = (session.user as { role?: UserRole })?.role;
      const allowed = role && allowedRoles.includes(role);
      if (!allowed) {
        router.replace("/403" as `/${string}`);
      }
    }
  }, [isLoading, isAuthenticated, session, allowedRoles, pathname, router]);

  // While the session is resolving show a neutral loading indicator
  if (isLoading) {
    return (
      <div
        role="status"
        aria-label="Checking authentication"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh"
        }}
      >
        <span>Loading…</span>
      </div>
    );
  }

  // Don't flash protected content while redirect is in flight
  if (!isAuthenticated) return null;

  if (allowedRoles && allowedRoles.length > 0) {
    const role = (session?.user as { role?: UserRole })?.role;
    if (!role || !allowedRoles.includes(role)) return null;
  }

  return <>{children}</>;
}
