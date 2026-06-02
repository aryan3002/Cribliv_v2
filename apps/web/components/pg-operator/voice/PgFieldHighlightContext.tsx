"use client";

import { createContext, useContext } from "react";

/**
 * Shared channel between the inline voice co-pilot (PgVoicePanel) and the manual
 * wizard (PgWizardClient): the co-pilot publishes the field it just filled so the
 * wizard can highlight it / offer a jump to its step. Default is a safe no-op so
 * the panel works even when rendered outside a provider (e.g. the orb in tests).
 */
export interface PgFieldHighlight {
  field: string | null;
  setField: (field: string | null) => void;
}

const PgFieldHighlightCtx = createContext<PgFieldHighlight>({ field: null, setField: () => {} });

export const PgFieldHighlightProvider = PgFieldHighlightCtx.Provider;
export const usePgFieldHighlight = (): PgFieldHighlight => useContext(PgFieldHighlightCtx);

/** Canonical 7-step ownership for a dotted field path (Doc 1 step order). */
export function pgFieldToStep(field: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  if (field.startsWith("room_types") || field.includes("monthly_rent")) return 3;
  if (
    field.includes("lat") ||
    field.includes("lng") ||
    field.includes("locality") ||
    field.includes("city") ||
    field.includes("formatted_address")
  )
    return 2;
  if (
    field.includes("security_deposit") ||
    field.includes("notice_period") ||
    field.includes("payment")
  )
    return 4;
  if (field.includes("house_rules") || field.includes("rule")) return 5;
  if (field.includes("amenit") || field.includes("meal") || field.includes("food")) return 6;
  if (field.includes("photo")) return 7;
  return 1; // display_name / gender / tenant_type / capacity → Basics
}
