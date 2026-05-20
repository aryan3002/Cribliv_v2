"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getApiBaseUrl } from "../../api";
import type { AuthPort } from "./auth-port";
import { DevAuthAdapter } from "./dev-auth-adapter";
import { NextAuthAdapter } from "./next-auth-adapter";

const AuthContext = createContext<AuthPort | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useMemo<AuthPort>(() => {
    const useDevAuth = process.env.NEXT_PUBLIC_RENT_AGREEMENT_DEV_AUTH === "true";
    return useDevAuth ? new DevAuthAdapter(getApiBaseUrl()) : new NextAuthAdapter();
  }, []);
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthPort {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth: missing <AuthProvider>");
  return v;
}
