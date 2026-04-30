"use client";

import { useEffect, type ReactNode } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useSession } from "next-auth/react";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com";

let initialized = false;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  if (!POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false,
    capture_pageleave: true,
    persistence: "localStorage+cookie",
    autocapture: false,
    disable_session_recording: false,
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.debug(false);
    }
  });
  initialized = true;
}

function IdentifyBridge() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (!POSTHOG_KEY || typeof window === "undefined") return;
    if (status !== "authenticated") {
      if (status === "unauthenticated") posthog.reset();
      return;
    }
    const user = session?.user;
    if (!user?.id) return;
    posthog.identify(user.id, {
      role: user.role,
      preferred_language: user.preferredLanguage
    });
  }, [session, status]);

  return null;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  ensureInit();
  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }
  return (
    <PHProvider client={posthog}>
      <IdentifyBridge />
      {children}
    </PHProvider>
  );
}
