"use client";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/rent-agreement/auth/auth-provider";
import { FlagsProvider } from "@/lib/rent-agreement/flags/flags-provider";
import { RaErrorBoundary } from "@/lib/rent-agreement/errors/error-boundary";
import { ProviderModeBadge } from "./_components/ProviderModeBadge";

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
            <main className="max-w-3xl mx-auto p-4">{children}</main>
          </RaErrorBoundary>
        </AuthProvider>
      </FlagsProvider>
    </QueryClientProvider>
  );
}
