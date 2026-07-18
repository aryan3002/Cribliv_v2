import { describe, expect, it } from "vitest";
import { DemandSignalsService } from "../src/modules/demand-signals/demand-signals.service";

describe("DemandSignalsService.create", () => {
  it("persists via DB when enabled and returns an id", async () => {
    const database = {
      isEnabled: () => true,
      query: async () => ({
        rows: [{ id: "sig_1", created_at: "2026-01-01T00:00:00Z" }]
      })
    };
    const appState = { demandSignals: [] as Array<Record<string, unknown>> };

    const service = new DemandSignalsService(database as never, appState as never);
    const res = await service.create({
      city: "lucknow",
      locality: "Gomti Nagar",
      filters: { bhk: 2 },
      unmet: "parking"
    });

    expect(res.id).toBeTruthy();
    expect(res.id).toBe("sig_1");
    expect(res.created_at).toBe("2026-01-01T00:00:00Z");
  });

  it("falls back to in-memory when DB disabled", async () => {
    const database = { isEnabled: () => false };
    const appState = { demandSignals: [] as Array<Record<string, unknown>> };

    const service = new DemandSignalsService(database as never, appState as never);
    const res = await service.create({ filters: {} });

    expect(res.id).toBeTruthy();
    expect(appState.demandSignals).toHaveLength(1);
    expect(appState.demandSignals[0]).toMatchObject({ id: res.id, filters: {} });
  });
});
