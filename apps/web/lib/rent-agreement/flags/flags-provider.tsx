"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { FlagsPort, FrontendFlags } from "./flags";
import { EnvFlagsAdapter } from "./env-flags-adapter";

const FlagsContext = createContext<FlagsPort | null>(null);

export function FlagsProvider({ children }: { children: ReactNode }) {
  const flags = useMemo<FlagsPort>(() => new EnvFlagsAdapter(), []);
  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>;
}

export function useFlag<K extends keyof FrontendFlags>(key: K): FrontendFlags[K] {
  const v = useContext(FlagsContext);
  if (!v) throw new Error("useFlag: missing <FlagsProvider>");
  return v.get(key);
}
