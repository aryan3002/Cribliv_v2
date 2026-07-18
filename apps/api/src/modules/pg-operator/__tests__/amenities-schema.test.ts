import { describe, expect, it } from "vitest";
import { AmenitiesSchema } from "../../voice-agent-pg/schema/pg-extraction-schema";

describe("AmenitiesSchema", () => {
  it("accepts newly added tokens", () => {
    const result = AmenitiesSchema.safeParse({
      core: ["lift", "fire_safety"],
      extras: ["swimming_pool"]
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown tokens (strict enum)", () => {
    const result = AmenitiesSchema.safeParse({ core: ["teleporter"] });

    expect(result.success).toBe(false);
  });
});
