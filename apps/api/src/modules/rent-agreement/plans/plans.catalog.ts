// Static plan catalog for Phase 11. Mirrors [[Overview]] §pricing.
// Phase 12 admin will allow stamp-duty rule edits but plan tiers are intentionally
// hard-coded (legal-team controlled, low change frequency).

export type PlanId = "basic" | "standard" | "premium";

export interface PlanRow {
  id: PlanId;
  display_name: string;
  amount_paise: number;
  features: readonly string[];
  active: boolean;
}

const PLANS: readonly PlanRow[] = [
  {
    id: "basic",
    display_name: "Basic",
    amount_paise: 9900,
    features: ["E-stamp paper (advisory)", "PDF download (5x)", "Standard clauses"],
    active: true
  },
  {
    id: "standard",
    display_name: "Standard",
    amount_paise: 19900,
    features: ["Everything in Basic", "Custom clauses", "Witness blocks"],
    active: true
  },
  {
    id: "premium",
    display_name: "Premium",
    amount_paise: 49900,
    features: [
      "Everything in Standard",
      "Canvas + upload signatures",
      "Watermark on draft, clean on paid"
    ],
    active: true
  }
];

export function listActivePlans(): readonly PlanRow[] {
  return PLANS.filter((p) => p.active);
}

export function getPlanAmountPaise(planId: string): { amount_paise: number } {
  const row = PLANS.find((p) => p.id === planId);
  if (!row) {
    const err = new Error(`Plan ${planId} is not valid`) as Error & { code: string };
    err.code = "RENT_AGREEMENT_INVALID_PLAN";
    throw err;
  }
  return { amount_paise: row.amount_paise };
}
