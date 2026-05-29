import { PropertyBasicsSchema } from "../schema/pg-extraction-schema";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types";

const FIELD_PREFIX = "property";
const CONFIDENCE_DEFAULT = 0.85;

const handler: ToolHandler = (input): ToolResult => {
  const r = PropertyBasicsSchema.safeParse(input);
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
  const extracted: ToolResult["extracted"] = [
    {
      field: `${FIELD_PREFIX}.display_name`,
      value: v.display_name,
      confidence: CONFIDENCE_DEFAULT
    }
  ];
  if (v.internal_code != null) {
    extracted.push({
      field: `${FIELD_PREFIX}.internal_code`,
      value: v.internal_code,
      confidence: CONFIDENCE_DEFAULT
    });
  }
  if (v.total_floors != null) {
    extracted.push({
      field: `${FIELD_PREFIX}.total_floors`,
      value: v.total_floors,
      confidence: CONFIDENCE_DEFAULT
    });
  }
  return { ok: true, extracted, errors: [] };
};

export const extractPropertyBasicsTool: ToolDefinition = {
  name: "extract_property_basics",
  description:
    "Extract PG property identity: display_name (required), internal_code, total_floors. Strict null on missing.",
  handler
};
