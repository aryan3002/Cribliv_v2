import type { PlanId } from "../api/types";

const SEQUENCES: Record<PlanId, number[]> = {
  basic: [1, 2, 3, 4, 5, 7],
  standard: [1, 2, 3, 4, 5, 7],
  premium: [1, 2, 3, 4, 5, 6, 7]
};

export function isValidStep(plan: PlanId, step: number): boolean {
  return SEQUENCES[plan].includes(step);
}

export function nextStep(plan: PlanId, step: number): number | null {
  const seq = SEQUENCES[plan];
  const i = seq.indexOf(step);
  if (i === -1 || i === seq.length - 1) return null;
  return seq[i + 1];
}

export function totalSteps(plan: PlanId): number {
  return SEQUENCES[plan].length;
}

export function sequenceFor(plan: PlanId): readonly number[] {
  return SEQUENCES[plan];
}
