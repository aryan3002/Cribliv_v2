import { describe, it, expect } from "vitest";
import { defaultFeatureFlags } from "../feature-flags";

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
      expect(defaultFeatureFlags.ff_pg_tenant_portal).toBe(false);
      expect(defaultFeatureFlags.ff_pg_rent_collection).toBe(false);
      expect(defaultFeatureFlags.ff_pg_food).toBe(false);
      expect(defaultFeatureFlags.ff_pg_ops_full).toBe(false);
      expect(defaultFeatureFlags.ff_pg_agreement).toBe(false);
      expect(defaultFeatureFlags.ff_pg_comms).toBe(false);
    });
  });
});
