import { RoomConfigSchema } from "../schema/pg-extraction-schema";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types";

const PREFIX = "pg_details";
const CONFIDENCE = 0.85;

const handler: ToolHandler = (input): ToolResult => {
  const r = RoomConfigSchema.safeParse(input);
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
    { field: `${PREFIX}.total_beds`, value: v.total_beds, confidence: CONFIDENCE },
    { field: `${PREFIX}.sharing_options`, value: v.sharing_options, confidence: CONFIDENCE }
  ];
  if (v.bathroom_kind != null)
    extracted.push({
      field: `${PREFIX}.bathroom_kind`,
      value: v.bathroom_kind,
      confidence: CONFIDENCE
    });
  if (v.furnishing != null)
    extracted.push({ field: `${PREFIX}.furnishing`, value: v.furnishing, confidence: CONFIDENCE });
  return { ok: true, extracted, errors: [] };
};

export const extractRoomConfigTool: ToolDefinition = {
  name: "extract_room_config",
  description:
    "Extract bed total, sharing kinds (single/double/triple/quad/dorm), bathroom default, furnishing default.",
  handler
};
