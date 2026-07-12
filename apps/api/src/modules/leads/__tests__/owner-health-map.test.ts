import { describe, it, expect } from "vitest";
import { computeOwnerHealth } from "../../admin/owner-health.calculator";

/**
 * Characterizes the pure `computeOwnerHealth` mapping that
 * `AdminLeadOpsService.ownerHealthByIds` relies on to turn a per-owner CTE
 * row into a { score, grade } pair for the Lead Center board. The DB CTE
 * itself (grouping listings/contact_unlocks/leads per owner) is covered by
 * the analytics integration test in Task 3 — this file only pins down the
 * score/grade a given set of inputs produces, so a future change to the
 * weights or thresholds shows up as a diff here instead of silently
 * reshuffling the board's health column.
 */
describe("computeOwnerHealth (owner-health-map)", () => {
  it("scores a healthy owner (active listings, fast response, deals closing, recent login, no reports) high", () => {
    // listings: 5 active / 0 paused          -> 100        * 0.25 = 25
    // response: 10 min avg                    -> 100-5=95   * 0.30 = 28.5
    // deal:     6 deals / 8 unlocks            -> 75         * 0.25 = 18.75
    // freshness: seen 1 day ago                -> 100-2=98   * 0.10 = 9.8
    // trust:    0 reports                      -> 100        * 0.10 = 10
    // sum = 92.05 -> round = 92 -> grade A
    const result = computeOwnerHealth({
      listings_active: 5,
      listings_paused: 0,
      avg_response_minutes: 10,
      unlocks_60d: 8,
      deals_done_60d: 6,
      days_since_last_login: 1,
      report_count: 0
    });

    expect(result.score).toBe(92);
    expect(result.grade).toBe("A");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("scores a bad owner (paused listings, slow response, no deals, stale login, reports) low", () => {
    // listings: 0 active / 4 paused            -> 0          * 0.25 = 0
    // response: 600 min avg (10h)              -> clamp(0)   * 0.30 = 0
    // deal:     0 deals / 10 unlocks           -> 0          * 0.25 = 0
    // freshness: seen 90 days ago              -> clamp(0)   * 0.10 = 0
    // trust:    3 reports                      -> 100-60=40  * 0.10 = 4
    // sum = 4 -> round = 4 -> grade F
    const result = computeOwnerHealth({
      listings_active: 0,
      listings_paused: 4,
      avg_response_minutes: 600,
      unlocks_60d: 10,
      deals_done_60d: 0,
      days_since_last_login: 90,
      report_count: 3
    });

    expect(result.score).toBe(4);
    expect(result.grade).toBe("F");
    expect(result.score).toBeLessThan(60);
  });

  it("treats a brand-new owner's null avg_response_minutes/unlocks as neutral, but a null last-login as max-decay freshness", () => {
    // This is the shape ownerHealthByIds's CTE returns for an owner with no
    // listings, no unlocks yet, and no recorded last_login_at (nulls flow
    // through the r.field === null ? null : Number(r.field) mapping as-is).
    // listings: 0 active / 0 paused (no listings yet) -> neutral 50 * 0.25 = 12.5
    // response: null (no unlocks ever)                -> neutral 50 * 0.30 = 15
    // deal:     0 unlocks                              -> neutral 50 * 0.25 = 12.5
    // freshness: null last-login                       -> decay 0  * 0.10 = 0
    // trust:    0 reports                               -> 100      * 0.10 = 10
    // sum = 50 -> round = 50 -> grade F (freshness decay dominates, by design)
    const result = computeOwnerHealth({
      listings_active: 0,
      listings_paused: 0,
      avg_response_minutes: null,
      unlocks_60d: 0,
      deals_done_60d: 0,
      days_since_last_login: null,
      report_count: 0
    });

    expect(result.score).toBe(50);
    expect(result.grade).toBe("F");
  });
});
