import { Logger } from "@nestjs/common";

const logger = new Logger("BlogLlm");

export interface BlogAiConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  timeoutMs: number;
}

export function readBlogAiConfig(): BlogAiConfig {
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment:
      process.env.AZURE_OPENAI_CHAT_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ||
      "",
    timeoutMs: Math.max(Number(process.env.SEO_BLOG_TIMEOUT_MS) || 20_000, 8_000)
  };
}

export async function callBlogJson<T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  fetchImpl?: typeof fetch;
}): Promise<T | null> {
  const config = readBlogAiConfig();
  if (!config.endpoint || !config.apiKey || !config.deployment) {
    logger.debug("Azure OpenAI not configured; skipping blog generation step");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const doFetch = opts.fetchImpl ?? fetch;

  try {
    const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(
      config.deployment
    )}/chat/completions?api-version=2024-10-21`;
    const response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": config.apiKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user }
        ],
        temperature: opts.temperature ?? 0.5,
        max_tokens: opts.maxTokens ?? 3000,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      logger.warn(`blog LLM call returned HTTP ${response.status}`);
      return null;
    }

    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content) as T;
  } catch (err) {
    logger.debug(`blog LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
