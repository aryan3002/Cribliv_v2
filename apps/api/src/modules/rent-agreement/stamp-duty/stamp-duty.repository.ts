export type FormulaType =
  | "percentage_of_annual_rent"
  | "percentage_of_total_rent"
  | "percentage_of_rent_plus_deposit";

export interface StampDutyRule {
  state_code: string;
  state_name: string;
  formula_type: FormulaType;
  percentage: number;
  min_amount_paise: number;
  includes_deposit: boolean;
  effective_from?: string;
  effective_until?: string | null;
  notes?: string | null;
}

// Mirrors infra/migrations/0024_rent_agreement_v2.sql seed block. Single
// source of truth for the AppState fallback when the DB is disabled and for
// repository tests that don't talk to Postgres.
export const STAMP_DUTY_SEED: StampDutyRule[] = [
  {
    state_code: "MH",
    state_name: "Maharashtra",
    formula_type: "percentage_of_rent_plus_deposit",
    percentage: 0.0025,
    min_amount_paise: 10000,
    includes_deposit: true,
    notes: "Lease <= 5y: 0.25% of (total rent + deposit). Min Rs 100."
  },
  {
    state_code: "KA",
    state_name: "Karnataka",
    formula_type: "percentage_of_annual_rent",
    percentage: 0.01,
    min_amount_paise: 2000,
    includes_deposit: false,
    notes: "1% of avg annual rent. Min Rs 20."
  },
  {
    state_code: "DL",
    state_name: "Delhi",
    formula_type: "percentage_of_annual_rent",
    percentage: 0.02,
    min_amount_paise: 10000,
    includes_deposit: false,
    notes: "2% of avg annual rent for tenure < 5y."
  },
  {
    state_code: "UP",
    state_name: "Uttar Pradesh",
    formula_type: "percentage_of_annual_rent",
    percentage: 0.02,
    min_amount_paise: 1000,
    includes_deposit: false,
    notes: "2% of annual rent. Min Rs 10."
  },
  {
    state_code: "TN",
    state_name: "Tamil Nadu",
    formula_type: "percentage_of_annual_rent",
    percentage: 0.01,
    min_amount_paise: 2000,
    includes_deposit: false,
    notes: "1% of annual rent. Min Rs 20."
  },
  {
    state_code: "RJ",
    state_name: "Rajasthan",
    formula_type: "percentage_of_total_rent",
    percentage: 0.01,
    min_amount_paise: 2000,
    includes_deposit: false,
    notes: "1% of total rent. Min Rs 20."
  },
  {
    state_code: "GJ",
    state_name: "Gujarat",
    formula_type: "percentage_of_annual_rent",
    percentage: 0.01,
    min_amount_paise: 0,
    includes_deposit: false,
    notes: "1% of annual rent amount."
  },
  {
    state_code: "HR",
    state_name: "Haryana",
    formula_type: "percentage_of_annual_rent",
    percentage: 0.015,
    min_amount_paise: 0,
    includes_deposit: false,
    notes: "1.5% of annual rent."
  }
];

interface MinimalDb {
  isEnabled(): boolean;
  query(text: string, params: unknown[]): Promise<{ rows: StampDutyRule[] }>;
}

interface CacheEntry {
  rule: StampDutyRule | null;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

export class StampDutyRepository {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly db: MinimalDb,
    private readonly fallbackRows: StampDutyRule[] = STAMP_DUTY_SEED
  ) {}

  async findActiveRule(stateCode: string): Promise<StampDutyRule | null> {
    const code = stateCode.toUpperCase();
    const cached = this.cache.get(code);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rule;
    }
    const rule = await this.loadFromSource(code);
    this.cache.set(code, { rule, expiresAt: Date.now() + TTL_MS });
    return rule;
  }

  bustCache(stateCode?: string): void {
    if (stateCode === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(stateCode.toUpperCase());
  }

  private async loadFromSource(code: string): Promise<StampDutyRule | null> {
    if (this.db.isEnabled()) {
      const result = await this.db.query(
        `SELECT state_code, state_name, formula_type, percentage::float AS percentage,
                min_amount_paise, includes_deposit, effective_from, effective_until, notes
         FROM stamp_duty_rules
         WHERE state_code = $1 AND effective_until IS NULL
         LIMIT 1`,
        [code]
      );
      return result.rows[0] ?? null;
    }
    return this.fallbackRows.find((r) => r.state_code === code) ?? null;
  }
}
