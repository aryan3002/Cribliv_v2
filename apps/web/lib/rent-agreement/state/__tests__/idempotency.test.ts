import { describe, expect, it } from "vitest";
import { newIdempotencyKey } from "../idempotency";

describe("newIdempotencyKey", () => {
  it("returns seed:<uuid> shape", () => {
    const k = newIdempotencyKey("create-draft");
    expect(k.startsWith("create-draft:")).toBe(true);
    expect(k.length).toBeGreaterThan(20);
  });
  it("two calls produce distinct keys", () => {
    expect(newIdempotencyKey("x")).not.toBe(newIdempotencyKey("x"));
  });
});
