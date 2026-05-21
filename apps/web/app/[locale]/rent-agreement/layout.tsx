"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/rent-agreement/auth/auth-provider";
import { FlagsProvider } from "@/lib/rent-agreement/flags/flags-provider";
import { RaErrorBoundary } from "@/lib/rent-agreement/errors/error-boundary";
import { ProviderModeBadge } from "./_components/ProviderModeBadge";

/**
 * Requires a signed-in session for the rent-agreement module. The plan picker
 * (/new) stays public so a visitor can choose a plan before signing in;
 * every other page redirects to /auth/login with a return path.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const isPublic = pathname.endsWith("/rent-agreement/new");

  useEffect(() => {
    if (!isPublic && status === "unauthenticated") {
      router.replace(`/auth/login?from=${encodeURIComponent(pathname)}`);
    }
  }, [isPublic, status, pathname, router]);

  if (isPublic) return <>{children}</>;
  if (status !== "authenticated") {
    return <p className="ra-loading">Checking sign-in…</p>;
  }
  return <>{children}</>;
}

export default function Layout({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false }
        }
      })
  );
  return (
    <QueryClientProvider client={qc}>
      <FlagsProvider>
        <AuthProvider>
          <RaErrorBoundary>
            <ProviderModeBadge />
            <div className="ra-layout">
              <div className="ra-shell">
                <AuthGate>{children}</AuthGate>
              </div>
            </div>
          </RaErrorBoundary>
        </AuthProvider>
      </FlagsProvider>
    </QueryClientProvider>
  );
}
