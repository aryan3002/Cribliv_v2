import { describe, it, expect } from "vitest";
import { TERMINATION_REASONS, terminationCopy, TerminationReason } from "../pg-termination-copy";

describe("pg-termination-copy", () => {
  it("covers all 9 reasons", () => {
    expect(TERMINATION_REASONS).toEqual([
      "duration_cap",
      "idle_timeout",
      "tool_call_cap",
      "concurrent_cap",
      "daily_cap",
      "audio_chunk_too_large",
      "rate_limited",
      "user_end",
      "disconnect"
    ]);
  });

  it.each<TerminationReason>([
    "duration_cap",
    "idle_timeout",
    "tool_call_cap",
    "concurrent_cap",
    "daily_cap",
    "audio_chunk_too_large",
    "rate_limited",
    "disconnect"
  ])("returns non-empty copy for %s", (reason) => {
    const c = terminationCopy(reason);
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.body.length).toBeGreaterThan(0);
    expect(["info", "warn", "error"]).toContain(c.tone);
  });

  it("user_end returns silent variant", () => {
    expect(terminationCopy("user_end").silent).toBe(true);
  });

  it("unknown reason falls back to disconnect", () => {
    expect(terminationCopy("anything_else").title).toBe(terminationCopy("disconnect").title);
  });

  // --- Strengthening tests ---

  it("every reason in TERMINATION_REASONS has a fully populated copy entry", () => {
    for (const reason of TERMINATION_REASONS) {
      const c = terminationCopy(reason);
      expect(c.title, `title missing for ${reason}`).toBeTruthy();
      expect(typeof c.title).toBe("string");
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.body, `body missing for ${reason}`).toBeTruthy();
      expect(typeof c.body).toBe("string");
      expect(c.body.length).toBeGreaterThan(0);
      expect(["info", "warn", "error"], `bad tone for ${reason}`).toContain(c.tone);
    }
  });

  it("silent is true only for user_end", () => {
    for (const reason of TERMINATION_REASONS) {
      const c = terminationCopy(reason);
      if (reason === "user_end") {
        expect(c.silent).toBe(true);
      } else {
        expect(c.silent === undefined || c.silent === false).toBe(true);
      }
    }
  });

  it("has at least one error-tone and at least one warn-tone reason", () => {
    const tones = TERMINATION_REASONS.map((r) => terminationCopy(r).tone);
    expect(tones).toContain("error");
    expect(tones).toContain("warn");
    expect(terminationCopy("disconnect").tone).toBe("error");
    expect(terminationCopy("duration_cap").tone).toBe("warn");
  });

  it("each reason has a unique body string", () => {
    const bodies = TERMINATION_REASONS.map((r) => terminationCopy(r).body);
    const unique = new Set(bodies);
    expect(unique.size).toBe(bodies.length);
  });
});
