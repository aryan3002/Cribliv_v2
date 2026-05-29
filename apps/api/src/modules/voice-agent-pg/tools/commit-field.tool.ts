import { z } from "zod";
import type { ToolDefinition, ToolHandler } from "./types";

const Schema = z.object({ path: z.string().min(1), value: z.unknown() }).strict();

const handler: ToolHandler = (input) => {
  const r = Schema.safeParse(input);
  if (!r.success) {
    return {
      ok: false,
      extracted: [],
      errors: r.error.issues.map((i) => ({
        field: i.path.join("."),
        code: i.code,
        message: i.message
      }))
    };
  }
  return {
    ok: true,
    extracted: [{ field: r.data.path, value: r.data.value, confidence: 1.0 }],
    errors: []
  };
};

export const commitFieldTool: ToolDefinition = {
  name: "commit_field",
  description:
    "Overwrite a single field path with an explicit value (used on user correction). Confidence=1.0.",
  handler
};
