import { describe, expect, it } from "vitest";

import { canSaveSignature } from "../../signatures/canvas-vs-upload.policy";

describe("canSaveSignature", () => {
  it("returns true for plan 'premium'", () => {
    expect(canSaveSignature("premium")).toBe(true);
  });

  it("returns false for plan 'basic'", () => {
    expect(canSaveSignature("basic")).toBe(false);
  });

  it("returns false for plan 'standard'", () => {
    expect(canSaveSignature("standard")).toBe(false);
  });

  it("returns false for unknown plan strings", () => {
    expect(canSaveSignature("enterprise")).toBe(false);
    expect(canSaveSignature("")).toBe(false);
    expect(canSaveSignature("PREMIUM")).toBe(false);
  });

  it("returns false for non-string inputs without throwing", () => {
    expect(canSaveSignature(undefined as unknown as string)).toBe(false);
    expect(canSaveSignature(null as unknown as string)).toBe(false);
    expect(canSaveSignature(42 as unknown as string)).toBe(false);
  });
});
