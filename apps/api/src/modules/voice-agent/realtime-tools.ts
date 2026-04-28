/* ──────────────────────────────────────────────────────────────────────
 * realtime-tools.ts
 *
 * Function/tool definitions for the Azure OpenAI Realtime listing
 * concierge ("Maya"). These are registered on the Realtime session
 * via the `tools` array. The agent CALLS these tools instead of
 * returning structured JSON in text — that lets her speak naturally
 * while writing fields into the form in front of the owner.
 *
 * Schema reference:
 *   https://platform.openai.com/docs/guides/realtime#function-calling
 *
 * Keep parameter shapes flat & permissive. The realtime model is more
 * reliable when the JSON schema is small; we validate / normalise on
 * the client before mutating form state.
 * ──────────────────────────────────────────────────────────────────── */

export type RealtimeToolName =
  | "update_listing_fields"
  | "navigate_to_step"
  | "generate_title_and_description"
  | "request_review"
  | "summarize_progress";

export interface RealtimeToolDefinition {
  type: "function";
  name: RealtimeToolName;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * The single richest tool — Maya calls this every time she hears any
 * field, in any order. ALL fields are optional; she only passes what
 * she actually heard / inferred.
 */
const updateListingFields: RealtimeToolDefinition = {
  type: "function",
  name: "update_listing_fields",
  description:
    "Update one or more listing fields. Call this WHENEVER the owner provides any property detail — even out of order, even if it belongs to a 'later' step. Always pass only the fields you actually heard. The form updates live in front of the owner as you call this.",
  parameters: {
    type: "object",
    properties: {
      listing_type: {
        type: "string",
        enum: ["flat_house", "pg"],
        description: "Whole property (flat/house) vs PG / hostel."
      },
      monthly_rent: {
        type: "number",
        description: "Monthly rent in INR. Convert words like 'pachees hazaar' → 25000."
      },
      deposit: {
        type: "number",
        description: "Security deposit in INR."
      },
      furnishing: {
        type: "string",
        enum: ["unfurnished", "semi_furnished", "fully_furnished"]
      },
      city: {
        type: "string",
        description:
          "Lowercased city slug from the official list: delhi, gurugram, noida, ghaziabad, faridabad, chandigarh, jaipur, lucknow, bangalore, mumbai, pune, hyderabad, chennai, kolkata. Pick the closest match if the owner says a city not in the list."
      },
      locality: { type: "string", description: "Neighborhood / sector / area." },
      address: { type: "string", description: "Full street address (kept private)." },
      landmark: { type: "string" },
      pincode: { type: "string", description: "6-digit Indian pincode." },
      bedrooms: {
        type: "integer",
        description: "Bedrooms / BHK count for flat or house. 0 for studio."
      },
      bathrooms: { type: "integer" },
      area_sqft: { type: "integer" },
      preferred_tenant: {
        type: "string",
        enum: ["any", "family", "bachelor", "female", "male"]
      },
      beds: { type: "integer", description: "PG only — total beds in the PG." },
      sharing_type: {
        type: "string",
        enum: ["single", "double", "triple", "quad"],
        description: "PG only."
      },
      meals_included: { type: "boolean", description: "PG only." },
      attached_bathroom: { type: "boolean", description: "PG only." },
      amenities: {
        type: "array",
        items: { type: "string" },
        description:
          "Capitalised exact strings from: WiFi, AC, Geyser, Washing Machine, Fridge, TV, Parking, Power Backup, Gas Pipeline, Lift, Security, CCTV, Gym, Swimming Pool, Balcony, Kitchen, Water Purifier, Meals, Laundry, Housekeeping. Send the FULL desired list each call — the form replaces, not appends."
      },
      title: { type: "string", description: "Listing headline (5–80 chars)." },
      description: { type: "string", description: "Description paragraph." }
    },
    additionalProperties: false
  }
};

const navigateToStep: RealtimeToolDefinition = {
  type: "function",
  name: "navigate_to_step",
  description:
    "Move the owner to a specific wizard step. Use this when (a) you've finished collecting fields for a section and want to glide them forward, (b) the owner says 'skip' / 'I'll do photos later', or (c) they ask to go back to fix something. Steps: 0=Basics, 1=Location, 2=Details, 3=Title & Description, 4=Photos, 5=Review.",
  parameters: {
    type: "object",
    properties: {
      step: { type: "integer", minimum: 0, maximum: 5 },
      reason: {
        type: "string",
        description:
          "One short sentence shown as a toast, e.g. 'Saving the address — let's pick photos.'"
      }
    },
    required: ["step"],
    additionalProperties: false
  }
};

const generateTitleAndDescription: RealtimeToolDefinition = {
  type: "function",
  name: "generate_title_and_description",
  description:
    "Ask the system to draft a polished listing title + description from currently-collected fields. Call this ONLY after the basics + location + key details are captured. The result is filled into the form with a typewriter animation.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  }
};

const requestReview: RealtimeToolDefinition = {
  type: "function",
  name: "request_review",
  description:
    "When the listing feels complete, take the owner to the Review step (5) so they can submit. Call this AFTER you've confirmed the key fields verbally.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  }
};

const summarizeProgress: RealtimeToolDefinition = {
  type: "function",
  name: "summarize_progress",
  description:
    "Optional: surface a short summary card in the side panel of what's captured so far. Call when the owner asks 'kya kya likha hai?' / 'show me everything'.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  }
};

export const LISTING_TOOLS: RealtimeToolDefinition[] = [
  updateListingFields,
  navigateToStep,
  generateTitleAndDescription,
  requestReview,
  summarizeProgress
];

/* ─── System prompt builder ────────────────────────────────────────── */

const STEP_LABELS = [
  "Basics (property type, rent, deposit, furnishing)",
  "Location (city, locality, address, landmark, pincode)",
  "Details (bedrooms, bathrooms, area, amenities, preferred tenant — or PG beds/sharing)",
  "Title & Description",
  "Photos",
  "Review & submit"
];

export interface BuildInstructionsInput {
  currentStep: number;
  filledFields: Record<string, unknown>;
  missingFields: string[];
  locale: "en" | "hi";
  ownerFirstName?: string;
}

/**
 * Build the dynamic Realtime `instructions` string. This is the single
 * most important piece of behaviour — it tells Maya:
 *   • Where the owner is now.
 *   • What's already filled (so she doesn't re-ask).
 *   • That she may NEVER force a sequence.
 */
export function buildInstructions(input: BuildInstructionsInput): string {
  const { currentStep, filledFields, missingFields, ownerFirstName } = input;
  const stepLabel = STEP_LABELS[currentStep] ?? STEP_LABELS[0];
  const filledSummary = JSON.stringify(filledFields, null, 0);
  const missingSummary = missingFields.length
    ? missingFields.join(", ")
    : "(everything looks captured)";
  const greetingHint = ownerFirstName ? ` The owner's first name is ${ownerFirstName}.` : "";

  const langInstruction =
    "Speak in natural, warm Hinglish — the way a trusted senior property consultant in Delhi or Mumbai would talk. Mix Hindi and English fluidly in EVERY sentence (e.g. 'Aapka rent 25,000 hai, that's noted.' / 'Bilkul, city bata dijiye — kaun si city hai?'). Never speak in pure formal Hindi and never speak in pure English — always blend both naturally. Short sentences only.";

  return `You are Maya, the warm, unhurried property concierge for CribLiv. You behave like a private property agent sitting next to the owner with a clipboard, taking notes as they describe their property.${greetingHint}

LANGUAGE
${langInstruction}

VOICE STYLE
- Keep turns SHORT — one or two sentences max. Never lecture.
- Sound human: acknowledgements like "Perfect, noted!", "Achha, bilkul!", "Got it, aage chalte hain.", "Samajh gayi."
- Light, conversational pace. No lists, no numbered points.
- If the owner goes off-topic, respond briefly and gently steer back.

CURRENT CONTEXT (the owner is mid-flow — do NOT restart from scratch)
- Currently viewing wizard step: ${currentStep} — ${stepLabel}
- Already filled: ${filledSummary}
- Still missing (priority order, but flexible): ${missingSummary}

PRIME DIRECTIVES
1. CAPTURE EVERYTHING IMMEDIATELY. The MOMENT you hear any field value (rent, city, BHK, amenity, anything), call update_listing_fields with it — even if it belongs to a "later" step.
2. NEVER re-ask for fields already in "Already filled". Acknowledge briefly and move to the next missing field.
3. ONE question at a time — the most useful missing field for the current context.
4. If the owner says "skip" / "next step" / "let's move on" — call navigate_to_step to advance them.
5. If they say "go back" / "fix the rent" — call navigate_to_step to the relevant step.
6. If they ask "what did you write?" / "show me everything" — call summarize_progress and read it back.
7. Once rent + city + at least 2 more details are captured, OFFER to write the title: "Want me to write a title and description for you?" — if yes, call generate_title_and_description.
8. Call request_review ONLY when ALL of these are filled: listing_type, monthly_rent, city, and title. Never call it on an incomplete form.
9. NEVER read out raw field names or JSON. Confirm values in plain language: "25,000 rupees monthly rent — noted."
10. If the owner is silent for ~6 seconds, prompt gently with ONE nudge. Never repeat the same question twice in a row.

DATA NORMALISATION
- Numbers: convert words to integers (twenty-five thousand → 25000, ek lakh → 100000).
- City: lowercase slug from: delhi, gurugram, noida, ghaziabad, faridabad, chandigarh, jaipur, lucknow, bangalore, mumbai, pune, hyderabad, chennai, kolkata.
- Furnishing: "fully furnished" → fully_furnished, "empty/bare" → unfurnished, "some furniture" → semi_furnished.
- Amenities: send the FULL desired list on every call — the form replaces, not appends.

OPENING
Greet warmly in ONE short Hinglish sentence and immediately ask the single most useful question based on what is missing. Example tone: "Namaste! Main Maya hun, aapki property list karwane mein help karungi — pehle rent batayein?" or if data is already filled: "Achha, rent aur city already hai — ab details batayein, jaise kitne bedrooms hain?" Do NOT say "let's start from the beginning" or give a long intro.`;
}
