import { afterEach, describe, it, expect } from "vitest";
import { defaultFeatureFlags, readFeatureFlags } from "../feature-flags";

afterEach(() => {
  delete process.env.FF_PG_MAINTENANCE_OPS_V2;
});

describe("defaultFeatureFlags", () => {
  describe("PG Operator V1 flags", () => {
    it("ships ff_pg_operator_v1 OFF by default (prod-safe)", () => {
      expect(defaultFeatureFlags.ff_pg_operator_v1).toBe(false);
    });

    it("ships every PG capability flag OFF by default", () => {
      expect(defaultFeatureFlags.ff_pg_listing_wizard_enabled).toBe(false);
      expect(defaultFeatureFlags.ff_pg_voice_agent_enabled).toBe(false);
      expect(defaultFeatureFlags.ff_pg_voice_agent_realtime).toBe(false);
      expect(defaultFeatureFlags.ff_pg_dashboard_enabled).toBe(false);
      expect(defaultFeatureFlags.ff_pg_segmentation_v2).toBe(false);
      expect(defaultFeatureFlags.ff_pg_multi_property_enabled).toBe(false);
    });

    it("ships dashboard widget flags ON (gated by parent)", () => {
      expect(defaultFeatureFlags.ff_pg_dashboard_listing_health).toBe(true);
      expect(defaultFeatureFlags.ff_pg_dashboard_leads_inbox).toBe(true);
    });

    it("ships every cross-version (V2+) PG flag OFF", () => {
      expect(defaultFeatureFlags.ff_pg_bed_mgmt).toBe(false);
      expect(defaultFeatureFlags.ff_pg_maintenance_ops_v2).toBe(false);
      expect(defaultFeatureFlags.ff_pg_tenant_portal).toBe(false);
      expect(defaultFeatureFlags.ff_pg_rent_collection).toBe(false);
      expect(defaultFeatureFlags.ff_pg_food).toBe(false);
      expect(defaultFeatureFlags.ff_pg_ops_full).toBe(false);
      expect(defaultFeatureFlags.ff_pg_agreement).toBe(false);
      expect(defaultFeatureFlags.ff_pg_comms).toBe(false);
    });

    it("reads FF_PG_MAINTENANCE_OPS_V2 only when explicitly enabled", () => {
      expect(readFeatureFlags().ff_pg_maintenance_ops_v2).toBe(false);

      process.env.FF_PG_MAINTENANCE_OPS_V2 = "true";

      expect(readFeatureFlags().ff_pg_maintenance_ops_v2).toBe(true);
    });
  });
});

describe("ff_unavailable_listings", () => {
  afterEach(() => {
    delete process.env.FF_UNAVAILABLE_LISTINGS;
  });

  it("defaults to false", () => {
    expect(defaultFeatureFlags.ff_unavailable_listings).toBe(false);
    expect(readFeatureFlags().ff_unavailable_listings).toBe(false);
  });

  it("reads FF_UNAVAILABLE_LISTINGS=true", () => {
    process.env.FF_UNAVAILABLE_LISTINGS = "true";
    expect(readFeatureFlags().ff_unavailable_listings).toBe(true);
  });
});
