// Canonical step sequence per plan. Server-enforced via drafts.service.advance/back.
// basic + standard skip the signature step (6); premium runs through all 7.

export type PlanId = "basic" | "standard" | "premium";

export const STEP_SEQUENCES: Record<PlanId, readonly number[]> = {
  basic: [1, 2, 3, 4, 5, 7],
  standard: [1, 2, 3, 4, 5, 7],
  premium: [1, 2, 3, 4, 5, 6, 7]
};

export function getStepSequence(plan: PlanId): number[] {
  return [...STEP_SEQUENCES[plan]];
}

export function isValidStep(plan: PlanId, step: number): boolean {
  return STEP_SEQUENCES[plan].includes(step);
}

export function nextStep(plan: PlanId, current: number): number | null {
  const seq = STEP_SEQUENCES[plan];
  const idx = seq.indexOf(current);
  if (idx === -1 || idx === seq.length - 1) return null;
  return seq[idx + 1];
}

export function previousStep(plan: PlanId, current: number): number | null {
  const seq = STEP_SEQUENCES[plan];
  const idx = seq.indexOf(current);
  if (idx <= 0) return null;
  return seq[idx - 1];
}

export function requiresSignatureStep(plan: PlanId): boolean {
  return STEP_SEQUENCES[plan].includes(6);
}
