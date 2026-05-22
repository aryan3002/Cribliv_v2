import { describe, expect, it } from "vitest";

import { nullAnalytics } from "../../plans/null-analytics";

describe("nullAnalytics", () => {
  it("emit() resolves without throwing", async () => {
    await expect(
      nullAnalytics.emit("ra.session_started", { user_id: "u1" })
    ).resolves.toBeUndefined();
  });

  it("emitStepAudit() resolves without throwing", async () => {
    await expect(
      nullAnalytics.emitStepAudit({
        agreementId: "agr-1",
        step: 1,
        outcome: "advanced",
        actorUserId: "u1"
      })
    ).resolves.toBeUndefined();
  });
});
