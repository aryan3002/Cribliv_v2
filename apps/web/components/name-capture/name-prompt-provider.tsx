"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import type { Locale } from "../../lib/i18n";
import {
  fetchFullName,
  hasName,
  markNamePromptDismissed,
  shouldShowNamePrompt,
  type PromptableRole
} from "../../lib/name-capture";
import { shouldShowWelcome } from "../../lib/welcome-credits";
import { NameCaptureModal } from "./name-capture-modal";

export type RequireName = (opts: { token: string }) => Promise<boolean>;

interface NamePromptContextValue {
  requireName: RequireName;
}

/**
 * Default resolves true. A component rendered outside the provider — in an
 * existing test, or on a route that doesn't mount it — must not have its
 * contact action silently blocked by missing context.
 */
const NamePromptContext = createContext<NamePromptContextValue>({
  requireName: async () => {
    return true;
  }
});

export function useNamePrompt(): NamePromptContextValue {
  return useContext(NamePromptContext);
}

type Pending = {
  token: string;
  resolve: (granted: boolean) => void;
};

export function NamePromptProvider({
  locale,
  children
}: {
  locale: Locale;
  children?: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const inFlightRef = useRef(false);

  const userId = session?.user?.id;
  const role = session?.user?.role as PromptableRole | undefined;
  const token = (session as { accessToken?: string } | null)?.accessToken;
  const storage = typeof window === "undefined" ? undefined : window.sessionStorage;

  /**
   * Both this and WelcomeCreditsModal lock body scroll and trap focus, so they
   * must never be on screen together. The credits celebration wins — it is the
   * reward moment; the name prompt returns on the next navigation.
   */
  const welcomePending =
    storage !== undefined &&
    shouldShowWelcome({
      isNewUser: session?.isNewUser,
      userId,
      creditsGranted: session?.signupReward?.creditsGranted,
      storage: window.localStorage
    });

  const ambientOpen =
    !dismissed &&
    !pending &&
    shouldShowNamePrompt({
      status,
      role,
      name: session?.user?.name,
      userId,
      pathname,
      storage,
      welcomePending
    });

  const requireName = useCallback<RequireName>(async ({ token: callerToken }) => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    try {
      // Server-authoritative: the unlock panel's users may have no NextAuth
      // session at all, so session.user.name cannot answer this.
      const current = await fetchFullName(callerToken);
      if (hasName(current)) return true;
      return await new Promise<boolean>((resolve) => {
        setPending({ token: callerToken, resolve });
      });
    } catch {
      // Fail open. A dead /auth/me must not make contacting an owner
      // impossible — the worst case is one lead with no name attached.
      return true;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const value = useMemo(() => {
    return { requireName };
  }, [requireName]);

  const variant: "tenant" | "owner" | "contact" = pending
    ? "contact"
    : role === "owner" || role === "pg_operator"
      ? "owner"
      : "tenant";

  const activeToken = pending?.token ?? token;

  return (
    <NamePromptContext.Provider value={value}>
      {children}
      {activeToken && (ambientOpen || pending) ? (
        <NameCaptureModal
          locale={locale}
          variant={variant}
          token={activeToken}
          required={Boolean(pending)}
          onSaved={() => {
            if (pending) {
              pending.resolve(true);
              setPending(null);
              return;
            }
            // The SessionProvider's 30s refetch will pick the name up; hide now
            // so the user isn't looking at a dialog they already completed.
            setDismissed(true);
          }}
          onDismiss={() => {
            if (pending) {
              // Unreachable in required mode, but keep the promise from leaking.
              pending.resolve(false);
              setPending(null);
              return;
            }
            setDismissed(true);
            if (userId && storage) markNamePromptDismissed(userId, storage);
          }}
        />
      ) : null}
    </NamePromptContext.Provider>
  );
}
