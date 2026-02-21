"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

/**
 * Thin "use client" wrapper around NextAuth's SessionProvider.
 * Must live here because root layout.tsx is a Server Component and
 * SessionProvider requires a client context.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    // refetchOnWindowFocus: re-runs the session callback (which calls /auth/me)
    // whenever the browser tab regains focus → wallet balance stays fresh.
    // refetchInterval: also poll every 30 s for background updates.
    <NextAuthSessionProvider refetchOnWindowFocus={true} refetchInterval={30}>
      {children}
    </NextAuthSessionProvider>
  );
}
