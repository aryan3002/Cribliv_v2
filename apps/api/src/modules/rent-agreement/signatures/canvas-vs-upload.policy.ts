// Plan-tier gate for signature persistence. Only premium plans may save signatures
// (Architecture §A1; API-Contract §B2 step graph table). Pure function; no IO.

import type { PlanId } from "../drafts/step-registry";

export function canSaveSignature(plan: PlanId | string): boolean {
  return plan === "premium";
}
