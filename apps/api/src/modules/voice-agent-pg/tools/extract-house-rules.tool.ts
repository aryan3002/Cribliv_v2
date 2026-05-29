import { HouseRulesSchema } from "../schema/pg-extraction-schema";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types";

const CONFIDENCE = 0.82;

/**
 * gender_policy + tenant_type are filter-critical -> emitted as top-level
 * pg_details.* (matches DB column layout). Everything else under house_rules.
 */
const handler: ToolHandler = (input): ToolResult => {
  const r = HouseRulesSchema.safeParse(input);
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
  const { gender_policy, tenant_type, ...rules } = v;
  const extracted: ToolResult["extracted"] = [
    { field: "pg_details.house_rules", value: rules, confidence: CONFIDENCE }
  ];
  if (gender_policy != null)
    extracted.push({
      field: "pg_details.gender_policy",
      value: gender_policy,
      confidence: CONFIDENCE
    });
  if (tenant_type != null)
    extracted.push({ field: "pg_details.tenant_type", value: tenant_type, confidence: CONFIDENCE });
  return { ok: true, extracted, errors: [] };
};

export const extractHouseRulesTool: ToolDefinition = {
  name: "extract_house_rules",
  description:
    "Extract gender_policy (boys/girls/coed), tenant_type (students/working/any), curfew_time (HH:MM), guests_policy text, smoking/alcohol/non_veg/pets/cooking_in_room booleans, quiet_hours range.",
  handler
};
