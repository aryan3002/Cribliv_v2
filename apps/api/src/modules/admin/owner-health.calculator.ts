/* ──────────────────────────────────────────────────────────────────────
 * Owner Health Score
 *
 * 0–100 composite score for an owner. Designed so a healthy, responsive
 * owner with active listings naturally scores 80+, an inactive or
 * frequently-reported owner falls below 60.
 *
 * Components and weights (must sum to 1):
 *   listings_health    0.25   active / (active + paused)
 *   response_health    0.30   100 - avg_response_minutes / 2  (clamped)
 *   deal_health        0.25   deals_done_60d / unlocks_60d
 *   freshness_health   0.10   100 - days_since_last_login * 2 (clamped)
 *   trust_health       0.10   100 - report_count * 20         (clamped)
 *
 * Letter grades: 90+ A, 80+ B, 70+ C, 60+ D, else F.
 *
 * The calculator is a pure function — fed raw numbers from a single
 * Postgres query in admin-owner-health.service.ts.
 * ──────────────────────────────────────────────────────────────────── */

export interface OwnerHealthInputs {
  listings_active: number;
  listings_paused: number;
  avg_response_minutes: number | null;
  unlocks_60d: number;
  deals_done_60d: number;
  days_since_last_login: number | null;
  report_count: number;
}

export interface OwnerHealthResult {
  score: number; // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  components: {
    listings: { value: number; weight: number };
    response: { value: number; weight: number };
    deal: { value: number; weight: number };
    freshness: { value: number; weight: number };
    trust: { value: number; weight: number };
  };
}

const WEIGHTS = {
  listings: 0.25,
  response: 0.3,
  deal: 0.25,
  freshness: 0.1,
  trust: 0.1
} as const;

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

export function computeOwnerHealth(inp: OwnerHealthInputs): OwnerHealthResult {
  const totalListings = inp.listings_active + inp.listings_paused;
  const listings =
    totalListings === 0
      ? 50 // brand-new owner — neutral, not punished
      : clamp((inp.listings_active / totalListings) * 100);

  const response =
    inp.avg_response_minutes == null
      ? 50 // never had an unlock — neutral
      : clamp(100 - inp.avg_response_minutes / 2);

  const deal =
    inp.unlocks_60d === 0
      ? 50 // no traffic to judge yet — neutral
      : clamp((inp.deals_done_60d / inp.unlocks_60d) * 100);

  const freshness =
    inp.days_since_last_login == null
      ? 0 // never seen recently → max-decay; pushes inactive owners down
      : clamp(100 - inp.days_since_last_login * 2);

  const trust = clamp(100 - inp.report_count * 20);

  const score = Math.round(
    listings * WEIGHTS.listings +
      response * WEIGHTS.response +
      deal * WEIGHTS.deal +
      freshness * WEIGHTS.freshness +
      trust * WEIGHTS.trust
  );

  const grade: OwnerHealthResult["grade"] =
    score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  return {
    score,
    grade,
    components: {
      listings: { value: Math.round(listings), weight: WEIGHTS.listings },
      response: { value: Math.round(response), weight: WEIGHTS.response },
      deal: { value: Math.round(deal), weight: WEIGHTS.deal },
      freshness: { value: Math.round(freshness), weight: WEIGHTS.freshness },
      trust: { value: Math.round(trust), weight: WEIGHTS.trust }
    }
  };
}
