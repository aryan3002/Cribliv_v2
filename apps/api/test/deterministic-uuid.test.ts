import { describe, expect, it } from "vitest";
import { deterministicUuidV5 } from "../src/common/deterministic-uuid";

describe("deterministicUuidV5", () => {
  it("returns a valid RFC 4122 v5 UUID", () => {
    expect(deterministicUuidV5("lucknow")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("is stable for the same input", () => {
    expect(deterministicUuidV5("noida")).toBe(deterministicUuidV5("noida"));
  });

  it("differs across inputs", () => {
    expect(deterministicUuidV5("noida")).not.toBe(deterministicUuidV5("lucknow"));
  });

  it("matches the RFC 4122 DNS namespace vector", () => {
    expect(deterministicUuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "886313e1-3b8a-5372-9b90-0c9aee199e5d"
    );
  });
});
