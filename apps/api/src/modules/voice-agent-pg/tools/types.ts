import type { PgVoiceToolName, VoiceAgentPgPhase } from "@cribliv/shared-types";

export interface ToolResult {
  ok: boolean;
  extracted: Array<{
    field: string;
    value: unknown;
    confidence: number;
  }>;
  errors: Array<{
    field?: string;
    code: string;
    message: string;
  }>;
}

export interface ToolContext {
  sessionId: string;
  phase: VoiceAgentPgPhase;
  locale: "en" | "hi";
}

export type ToolHandler = (input: unknown, ctx: ToolContext) => ToolResult;

export interface ToolDefinition {
  name: PgVoiceToolName;
  description: string;
  handler: ToolHandler;
}
