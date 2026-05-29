import type { ToolDefinition, ToolHandler } from "./types";

/** Signal-only tool. Orchestrator catches the call, produces NL readback to user. */
const handler: ToolHandler = () => ({ ok: true, extracted: [], errors: [] });

export const summarizeForConfirmTool: ToolDefinition = {
  name: "summarize_for_confirm",
  description:
    "Signal the orchestrator to produce a natural-language summary of the current draft for user confirmation. No args.",
  handler
};
