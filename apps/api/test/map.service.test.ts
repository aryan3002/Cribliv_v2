import { describe, expect, it, vi } from "vitest";
import { MapService } from "../src/modules/map/map.service";

describe("MapService.getAreaStats", () => {
  it("applies visible map filters to stats queries", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (/GROUP BY l\.bhk/.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [{ recent_avg: null, older_avg: null }], rowCount: 1 };
      })
    };
    const service = new MapService(database as never, {} as never);

    await service.getAreaStats(76.84, 28.4, 77.35, 28.88, {
      bhk: 2,
      max_rent: 25000,
      listing_type: "flat_house",
      verified_only: true,
      near_metro: true
    });

    expect(calls[0].sql).toMatch(/\(\$5::smallint IS NULL OR l\.bhk = \$5\)/);
    expect(calls[0].sql).toMatch(/\(\$6::int IS NULL OR l\.monthly_rent <= \$6\)/);
    expect(calls[0].sql).toMatch(/EXISTS \(\s*SELECT 1 FROM metro_stations ms/);
    expect(calls[0].params).toEqual([
      28.4,
      28.88,
      76.84,
      77.35,
      2,
      25000,
      "flat_house",
      true
    ]);
  });
});

describe("MapService.getSeekerPins", () => {
  it("falls back to legacy seeker columns when radius or tags migrations are missing", async () => {
    const calls: string[] = [];
    const database = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (calls.length === 1) {
          const err = new Error("column does not exist") as Error & { code?: string };
          err.code = "42703";
          throw err;
        }
        return {
          rows: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              lat: 26.85,
              lng: 80.94,
              budget_min: 5000,
              budget_max: 12000,
              bhk_preference: [1],
              move_in: "flexible",
              listing_type: "pg",
              note: null,
              radius_m: 1000,
              tags: [],
              created_at: "2026-07-03T00:00:00.000Z",
              source: "seeker"
            }
          ],
          rowCount: 1
        };
      })
    };
    const service = new MapService(database as never, {} as never);

    const pins = await service.getSeekerPins(26.7, 80.8, 26.95, 81.1);

    expect(calls).toHaveLength(2);
    expect(pins[0]).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      radius_m: 1000,
      tags: [],
      source: "seeker"
    });
  });

  it("returns estimated demand pins from active listings when no real seekers exist", async () => {
    const calls: string[] = [];
    const database = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (/FROM seeker_pins/.test(sql)) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: "estimated_22222222-2222-2222-2222-222222222222",
              lat: 26.8467,
              lng: 80.9462,
              budget_min: 9000,
              budget_max: 13200,
              bhk_preference: [],
              move_in: "flexible",
              listing_type: "pg",
              note: null,
              radius_m: 900,
              tags: [],
              created_at: "2026-07-03T00:00:00.000Z",
              source: "estimated"
            }
          ],
          rowCount: 1
        };
      })
    };
    const service = new MapService(database as never, {} as never);

    const pins = await service.getSeekerPins(26.7, 80.8, 26.95, 81.1);

    expect(calls[1]).toMatch(/FROM listings l/);
    expect(pins[0]).toMatchObject({
      id: "estimated_22222222-2222-2222-2222-222222222222",
      source: "estimated",
      radius_m: 900
    });
  });
});
