import { FoodSchema } from "../schema/pg-extraction-schema";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types";

const CONFIDENCE = 0.85;

const handler: ToolHandler = (input): ToolResult => {
  const r = FoodSchema.safeParse(input);
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
  const v = r.data;
  const { meal_charges_paise: charges, ...meals } = v;
  const extracted: ToolResult["extracted"] = [
    { field: "pg_details.meals", value: meals, confidence: CONFIDENCE }
  ];
  if (charges != null)
    extracted.push({
      field: "pg_details.meal_charges_paise",
      value: charges,
      confidence: CONFIDENCE
    });
  return { ok: true, extracted, errors: [] };
};

export const extractFoodTool: ToolDefinition = {
  name: "extract_food",
  description:
    "Extract meal provision flags (provided + per-meal toggles + veg_only) and meal_charges_paise. Money in paise.",
  handler
};
