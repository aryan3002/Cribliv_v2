import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callBlogJson, readBlogAiConfig } from "../src/modules/blog/blog-llm";

const ENV = {
  AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
  AZURE_OPENAI_API_KEY: "k",
  AZURE_OPENAI_CHAT_DEPLOYMENT: "gpt-4o"
};

describe("blog-llm", () => {
  const OLD: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [key, value] of Object.entries(ENV)) {
      OLD[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(ENV)) {
      if (OLD[key] === undefined) delete process.env[key];
      else process.env[key] = OLD[key];
    }
  });

  it("readBlogAiConfig reads Azure env", () => {
    const cfg = readBlogAiConfig();
    expect(cfg.endpoint).toBe("https://example.openai.azure.com");
    expect(cfg.deployment).toBe("gpt-4o");
    expect(cfg.timeoutMs).toBeGreaterThanOrEqual(8000);
  });

  it("returns null when Azure is not configured", async () => {
    delete process.env.AZURE_OPENAI_API_KEY;
    const out = await callBlogJson({ system: "s", user: "u", fetchImpl: vi.fn() });
    expect(out).toBeNull();
  });

  it("parses the JSON content from a chat completion", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ outline: ["A", "B"] }) } }]
      })
    })) as unknown as typeof fetch;
    const out = await callBlogJson<{ outline: string[] }>({
      system: "s",
      user: "u",
      fetchImpl
    });
    expect(out).toEqual({ outline: ["A", "B"] });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/openai/deployments/gpt-4o/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ "api-key": "k" });
    expect(String((init as RequestInit).body)).toContain("json_object");
  });

  it("returns null on non-OK HTTP", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    })) as unknown as typeof fetch;
    const out = await callBlogJson({ system: "s", user: "u", fetchImpl });
    expect(out).toBeNull();
  });

  it("returns null on invalid JSON content", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] })
    })) as unknown as typeof fetch;
    const out = await callBlogJson({ system: "s", user: "u", fetchImpl });
    expect(out).toBeNull();
  });
});
