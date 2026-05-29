import type { PgVoiceToolName } from "@cribliv/shared-types";
import type { ToolDefinition } from "./types";
import { extractPropertyBasicsTool } from "./extract-property-basics.tool";
import { extractRoomConfigTool } from "./extract-room-config.tool";
import { extractPricingMatrixTool } from "./extract-pricing-matrix.tool";
import { extractPaymentTermsTool } from "./extract-payment-terms.tool";
import { extractAmenitiesTool } from "./extract-amenities.tool";
import { extractFoodTool } from "./extract-food.tool";
import { extractHouseRulesTool } from "./extract-house-rules.tool";
import { commitFieldTool } from "./commit-field.tool";
import { summarizeForConfirmTool } from "./summarize-for-confirm.tool";
import { requestPhotoUploadTool } from "./request-photo-upload.tool";

export const PG_TOOLS: readonly ToolDefinition[] = [
  extractPropertyBasicsTool,
  extractRoomConfigTool,
  extractPricingMatrixTool,
  extractPaymentTermsTool,
  extractAmenitiesTool,
  extractFoodTool,
  extractHouseRulesTool,
  commitFieldTool,
  summarizeForConfirmTool,
  requestPhotoUploadTool
] as const;

const byName = new Map<PgVoiceToolName, ToolDefinition>(PG_TOOLS.map((t) => [t.name, t]));

export function getToolByName(name: PgVoiceToolName): ToolDefinition | undefined {
  return byName.get(name);
}

export function toolNames(): PgVoiceToolName[] {
  return PG_TOOLS.map((t) => t.name);
}
