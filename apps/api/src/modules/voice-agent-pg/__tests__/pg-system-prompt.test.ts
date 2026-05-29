import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT_VERSION, buildPgSystemPrompt } from "../prompts/pg-system-prompt";

describe("pg-system-prompt", () => {
  it("exports a stable version constant matching vN.N", () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^v\d+\.\d+$/);
  });

  it("includes strict-null and paise-conversion rules in en prompt", () => {
    const p = buildPgSystemPrompt({ locale: "en" });
    expect(p.toLowerCase()).toContain("null");
    expect(p.toLowerCase()).toContain("paise");
  });

  it("embeds version constant inside the rendered prompt", () => {
    const p = buildPgSystemPrompt({ locale: "en" });
    expect(p).toContain(SYSTEM_PROMPT_VERSION);
  });

  it("switches phrasing for hi locale", () => {
    const en = buildPgSystemPrompt({ locale: "en" });
    const hi = buildPgSystemPrompt({ locale: "hi" });
    expect(hi).not.toBe(en);
    expect(hi.length).toBeGreaterThan(50);
  });
});
