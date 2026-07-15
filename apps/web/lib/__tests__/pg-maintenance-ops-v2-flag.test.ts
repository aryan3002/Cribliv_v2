import { afterEach, describe, expect, it } from "vitest";

import { isPgMaintenanceOpsV2Enabled } from "../pg-maintenance-ops-v2-flag";

describe("isPgMaintenanceOpsV2Enabled", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2;
  });

  it("defaults to off", () => {
    expect(isPgMaintenanceOpsV2Enabled()).toBe(false);
  });

  it("is enabled by true or 1", () => {
    process.env.NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2 = "true";
    expect(isPgMaintenanceOpsV2Enabled()).toBe(true);

    process.env.NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2 = "1";
    expect(isPgMaintenanceOpsV2Enabled()).toBe(true);
  });
});
