import { AmenitiesSchema } from "../schema/pg-extraction-schema";
import type { ToolDefinition, ToolHandler, ToolResult } from "./types";

const PREFIX = "pg_details.amenities";
const CONFIDENCE = 0.83;

const handler: ToolHandler = (input): ToolResult => {
  const r = AmenitiesSchema.safeParse(input);
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
  const extracted: ToolResult["extracted"] = [];
  for (const key of ["core", "room", "services", "extras"] as const) {
    const arr = v[key];
    if (arr && arr.length)
      extracted.push({ field: `${PREFIX}.${key}`, value: arr, confidence: CONFIDENCE });
  }
  return { ok: true, extracted, errors: [] };
};

export const extractAmenitiesTool: ToolDefinition = {
  name: "extract_amenities",
  description:
    "Extract amenities toggles. Buckets: core (wifi/hot_water/power_backup/cctv/security_guard), room (ac/tv/study_table/wardrobe/safety_locker/mattress), services (housekeeping/laundry/biometric_access), extras (parking_2w/parking_4w/fridge/microwave/gym/indoor_games). Allowlist enforced.",
  handler
};
