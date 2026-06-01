/**
 * OpenAI Chat Completions function-tool definitions for the PG listing agent.
 *
 * These are *parallel* to the runtime ToolDefinitions in pg-realtime-tools.ts:
 *  - Names match exactly (PgVoiceToolName).
 *  - Parameter shapes mirror the Zod schemas in schema/pg-extraction-schema.ts.
 *  - The orchestrator validates with the existing Zod schema after the LLM
 *    proposes a call; this file's JSON Schema is only a *hint* to the LLM.
 *
 * Why hand-written (instead of zod-to-json-schema): the V1 set is 10 tools.
 * Avoid pulling in zod-to-json-schema for a one-off conversion. Stays in sync
 * because the runtime is the source of truth — LLM bad calls still get
 * rejected at the orchestrator boundary.
 */

import type { PgVoiceToolName } from "@cribliv/shared-types";

interface JsonSchemaProperty {
  type: string | string[];
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
}

interface OpenAiFunctionDefinition {
  type: "function";
  function: {
    name: PgVoiceToolName;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, JsonSchemaProperty>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

const SHARING_KINDS = ["single", "double", "triple", "quad", "dorm"] as const;
const BATHROOM_KINDS = [
  "attached_western",
  "attached_indian",
  "shared_western",
  "shared_indian"
] as const;
const FURNISHING = ["unfurnished", "semi_furnished", "fully_furnished"] as const;
const GENDER = ["boys", "girls", "coed"] as const;
const TENANT = ["students", "working", "any"] as const;
const ELECTRICITY = ["flat", "submetered", "split_equally"] as const;
const PAYMENT_MODES = ["upi", "bank_transfer", "cash"] as const;

export const PG_OPENAI_TOOLS: OpenAiFunctionDefinition[] = [
  {
    type: "function",
    function: {
      name: "extract_property_basics",
      description:
        "Extract PG property identity: display_name (required), internal_code, total_floors. Only call when user has said these explicitly.",
      parameters: {
        type: "object",
        properties: {
          display_name: { type: "string", description: "Marketing name of the PG" },
          internal_code: { type: ["string", "null"] },
          total_floors: { type: ["integer", "null"], minimum: 1, maximum: 50 }
        },
        required: ["display_name"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract_room_config",
      description:
        "Extract total bed count and the sharing kinds offered (drives the pricing matrix UI).",
      parameters: {
        type: "object",
        properties: {
          total_beds: { type: "integer", minimum: 1, maximum: 500 },
          sharing_options: {
            type: "array",
            items: { type: "string", enum: SHARING_KINDS }
          },
          bathroom_kind: { type: ["string", "null"], enum: BATHROOM_KINDS },
          furnishing: { type: ["string", "null"], enum: FURNISHING }
        },
        required: ["total_beds", "sharing_options"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract_pricing_matrix",
      description:
        "Extract pricing for ONE room-type row (sharing+AC combo). Call once per row. Rent is in paise (1 rupee = 100 paise). Rent must be 200000–5000000 paise (₹2,000–₹50,000).",
      parameters: {
        type: "object",
        properties: {
          sharing: { type: "string", enum: SHARING_KINDS },
          ac: { type: "boolean" },
          bathroom_kind: { type: "string", enum: BATHROOM_KINDS },
          furnishing: { type: "string", enum: FURNISHING },
          monthly_rent_paise: { type: "integer", minimum: 200000, maximum: 5000000 },
          vacancy_count: { type: "integer", minimum: 0, maximum: 500 },
          security_deposit_paise: { type: ["integer", "null"] },
          deposit_refundable_pct: { type: ["integer", "null"], minimum: 0, maximum: 100 },
          available_from: { type: ["string", "null"], description: "YYYY-MM-DD" }
        },
        required: ["sharing", "ac", "monthly_rent_paise", "vacancy_count"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract_payment_terms",
      description: "Extract payment-related rules: notice, lock-in, deposit, electricity etc.",
      parameters: {
        type: "object",
        properties: {
          notice_period_days: { type: ["integer", "null"], minimum: 0, maximum: 180 },
          lock_in_months: { type: ["integer", "null"], minimum: 0, maximum: 24 },
          electricity_mode: { type: ["string", "null"], enum: ELECTRICITY },
          maintenance_paise: { type: ["integer", "null"] },
          rent_due_day: { type: ["integer", "null"], minimum: 1, maximum: 28 },
          payment_modes: {
            type: "array",
            items: { type: "string", enum: PAYMENT_MODES }
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract_amenities",
      description: "Extract amenities organised by category.",
      parameters: {
        type: "object",
        properties: {
          core: { type: "array", items: { type: "string" } },
          room: { type: "array", items: { type: "string" } },
          services: { type: "array", items: { type: "string" } },
          extras: { type: "array", items: { type: "string" } }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract_food",
      description: "Extract food/meal info.",
      parameters: {
        type: "object",
        properties: {
          provided: { type: "boolean" },
          breakfast: { type: "boolean" },
          lunch: { type: "boolean" },
          snack: { type: "boolean" },
          dinner: { type: "boolean" },
          veg_only: { type: "boolean" },
          meal_charges_paise: { type: ["integer", "null"] }
        },
        required: ["provided"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract_house_rules",
      description: "Extract house rules + gender / tenant policy.",
      parameters: {
        type: "object",
        properties: {
          gender_policy: { type: ["string", "null"], enum: GENDER },
          tenant_type: { type: ["string", "null"], enum: TENANT },
          curfew_time: { type: ["string", "null"], description: "HH:MM 24h" },
          guests_policy: { type: ["string", "null"] },
          smoking: { type: "boolean" },
          alcohol: { type: "boolean" },
          non_veg: { type: "boolean" },
          pets: { type: "boolean" },
          cooking_in_room: { type: "boolean" }
        },
        required: ["smoking", "alcohol", "non_veg", "pets", "cooking_in_room"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "commit_field",
      description: "Commit a single named field. Use for one-off corrections, NOT bulk extraction.",
      parameters: {
        type: "object",
        properties: {
          field: { type: "string", description: "Dotted path e.g. 'property.display_name'" },
          value: { type: ["string", "number", "boolean", "object", "array", "null"] }
        },
        required: ["field", "value"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "summarize_for_confirm",
      description:
        "Signal-only. Call once the current phase's required fields are fully captured so the orchestrator can advance.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  },
  {
    type: "function",
    function: {
      name: "request_photo_upload",
      description:
        "Signal-only. Call when the conversation reaches the media phase to prompt the operator to upload photos in the UI.",
      parameters: { type: "object", properties: {}, additionalProperties: false }
    }
  }
];
