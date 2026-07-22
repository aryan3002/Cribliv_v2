import { describe, it, expectTypeOf } from "vitest";
import type { AvailabilityAlertResult, WaitlistLead, AvailabilityAlertStatus } from "../types";

describe("availability types", () => {
  it("exposes alert result + lead shapes", () => {
    expectTypeOf<AvailabilityAlertResult["already_on_list"]>().toEqualTypeOf<boolean>();
    expectTypeOf<WaitlistLead["phone"]>().toEqualTypeOf<string>();
    expectTypeOf<AvailabilityAlertStatus>().toMatchTypeOf<
      "waiting" | "ready" | "notified" | "cancelled"
    >();
  });
});
