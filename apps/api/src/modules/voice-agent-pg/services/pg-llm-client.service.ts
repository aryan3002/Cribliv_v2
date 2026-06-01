import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PG_OPENAI_TOOLS } from "../tools/openai-function-schemas";

/**
 * Azure OpenAI Chat Completions client for the PG text-mode agent.
 *
 * Used when the operator picks "Type" instead of "Voice" in the assistant panel.
 * Same prompt, same tools, same phase machine as voice — just routed through
 * the chat-completions deployment (`cribliv-chat`) instead of the realtime one.
 *
 * Stateless across calls: caller passes in the full message history each turn
 * (the gateway maintains the in-memory transcript per session).
 *
 * Streaming: this client uses non-streaming for V1 simplicity. Each
 * `requestTurn()` call returns the assistant's final reply (after any tool-call
 * round-trips). The gateway emits the final text in one shot. Streaming SSE can
 * be wired in V1.1 by switching to `stream: true` + parsing SSE chunks.
 */

const API_VERSION = "2024-10-21";

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmMessage {
  role: LlmRole;
  content?: string | null;
  /** assistant turn that decided to call tools */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** when role==='tool', the id of the assistant tool_call this message answers */
  tool_call_id?: string;
  name?: string;
}

export interface LlmTurnResult {
  finalText: string;
  /** Tool calls the model issued THIS turn, in order. Caller has already
   *  executed them and appended `tool` messages before re-asking. */
  toolCalls: Array<{
    id: string;
    name: string;
    /** Parsed JSON arguments. `null` if the model emitted invalid JSON. */
    args: unknown;
    rawArgs: string;
  }>;
  /** True when the model finished without proposing further tool calls. */
  done: boolean;
}

interface AzureChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  error?: { message?: string; code?: string };
}

@Injectable()
export class PgLlmClient {
  private readonly log = new Logger(PgLlmClient.name);

  private readConfig() {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, "");
    const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim() ?? "";
    // CONVERSATION_DEPLOYMENT is the canonical name for the chat-style deployment;
    // fall back to CHAT_DEPLOYMENT (which the .env happens to set today).
    const deployment =
      process.env.AZURE_OPENAI_CONVERSATION_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_CHAT_DEPLOYMENT?.trim() ||
      "";
    const timeoutMs = Number(process.env.AZURE_AI_TIMEOUT_MS ?? 8000);
    return { endpoint, apiKey, deployment, timeoutMs };
  }

  /**
   * Run one assistant turn. The model may either emit final text (done=true)
   * or propose tool calls (done=false) — in which case the caller must execute
   * them, append `tool` messages with the results, and call again.
   */
  async requestTurn(args: { messages: LlmMessage[]; locale: "en" | "hi" }): Promise<LlmTurnResult> {
    const cfg = this.readConfig();
    if (!cfg.endpoint || !cfg.apiKey || !cfg.deployment) {
      throw new ServiceUnavailableException({
        code: "pg_llm_unavailable",
        message: "Azure OpenAI conversation deployment is not configured"
      });
    }

    const url = `${cfg.endpoint}/openai/deployments/${encodeURIComponent(
      cfg.deployment
    )}/chat/completions?api-version=${API_VERSION}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": cfg.apiKey
        },
        body: JSON.stringify({
          messages: args.messages,
          tools: PG_OPENAI_TOOLS,
          tool_choice: "auto",
          temperature: 0.2,
          // The PG assistant should be deterministic-ish; small top_p keeps it tight.
          top_p: 0.9,
          // We cap turn length aggressively — extraction tools carry most data.
          max_tokens: 400
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as AzureChatResponse;
        this.log.error(
          `Azure OpenAI returned ${response.status}: ${JSON.stringify(errorBody.error ?? {})}`
        );
        throw new ServiceUnavailableException({
          code: "pg_llm_failed",
          message: errorBody.error?.message ?? `LLM HTTP ${response.status}`
        });
      }

      const payload = (await response.json()) as AzureChatResponse;
      const choice = payload.choices?.[0];
      const message = choice?.message ?? {};
      const finalText = typeof message.content === "string" ? message.content : "";
      const rawCalls = message.tool_calls ?? [];

      const toolCalls = rawCalls.map((c) => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(c.function.arguments || "{}");
        } catch (e) {
          this.log.warn(`Tool ${c.function.name} returned non-JSON args: ${c.function.arguments}`);
        }
        return {
          id: c.id,
          name: c.function.name,
          args: parsed,
          rawArgs: c.function.arguments
        };
      });

      const done = toolCalls.length === 0 || choice?.finish_reason === "stop";

      return { finalText, toolCalls, done };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ServiceUnavailableException({
          code: "pg_llm_timeout",
          message: `LLM request exceeded ${cfg.timeoutMs}ms`
        });
      }
      this.log.error(`Unexpected LLM error: ${String(err)}`);
      throw new ServiceUnavailableException({
        code: "pg_llm_failed",
        message: "LLM request failed"
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
