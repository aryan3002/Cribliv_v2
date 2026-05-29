import { PricingMatrixSchema } from "../schema/pg-extraction-schema";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types";

const CONFIDENCE = 0.88;

/**
 * Emits a SINGLE composite extraction under field path "room_types.cell".
 * The extraction service detects this special path and appends to
 * draft.payload.room_types[] (cells accumulate matrix-style).
 */
const handler: ToolHandler = (input): ToolResult => {
  const r = PricingMatrixSchema.safeParse(input);
  if (!r.success) {
    return {
      ok: false,
      extracted: [],
      errors: r.error.issues.map((iss) => ({
        field: iss.path.join("."),
        code: iss.code,
        message: iss.message
      }))
    };
  }
  return {
    ok: true,
    extracted: [{ field: "room_types.cell", value: r.data, confidence: CONFIDENCE }],
    errors: []
  };
};

export const extractPricingMatrixTool: ToolDefinition = {
  name: "extract_pricing_matrix",
  description:
    "Extract one pricing-matrix cell: sharing x ac with monthly_rent_paise (₹2k-₹50k), vacancy, deposit. Money in paise (1 rupee = 100 paise).",
  handler
};
