import { Injectable, Logger } from "@nestjs/common";
import type { VoiceAgentPhase, VoiceAgentDraft, ConversationTurn } from "@cribliv/shared-types";

/* ──────────────────────────────────────────────────────────────────────
 * ConversationOrchestratorService
 *
 * The "brain" of the Hindi voice agent. Manages a phase-based
 * conversation state machine. At each user turn it:
 *
 * 1. Sends transcript + conversation context to Azure OpenAI
 * 2. Extracts structured listing fields from the LLM response
 * 3. Determines the next thing the agent should say (Hindi-Hinglish)
 * 4. Advances / stays in the current conversation phase
 *
 * The LLM system prompt enforces colloquial Hindi-Hinglish persona.
 * ──────────────────────────────────────────────────────────────────── */

/* ─── Phase graph ─────────────────────────────────────────────────── */

const PHASE_ORDER: VoiceAgentPhase[] = [
  "greeting",
  "property_type",
  "basics",
  "location",
  "details",
  "amenities",
  "confirmation",
  "complete"
];

/* ─── Config helpers ──────────────────────────────────────────────── */

interface OrchestratorConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  timeoutMs: number;
  maxTurns: number;
}

function readConfig(): OrchestratorConfig {
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment:
      process.env.AZURE_OPENAI_CONVERSATION_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ||
      "",
    timeoutMs: Math.max(Number(process.env.AZURE_AI_TIMEOUT_MS) || 12000, 5000),
    maxTurns: Math.max(Number(process.env.VOICE_AGENT_MAX_TURNS) || 50, 10)
  };
}

/* ─── Hard-coded fallback prompts per phase (no LLM needed) ───────── */

const FALLBACK_PROMPTS: Record<VoiceAgentPhase, string> = {
  greeting:
    "नमस्ते! मैं आपकी property list करने में help करूँगी। चलिए शुरू करते हैं — आपकी property flat है या PG?",
  property_type: "Aapki property flat hai ya PG/hostel?",
  basics:
    "Acha, ab basic details bataiye — monthly rent kitna soch rakha hai? Deposit kitna? Aur furnishing kaisi hai — furnished, semi-furnished ya unfurnished?",
  location:
    "Ab bataiye aapki property kahan located hai? City, area aur poora address bata dijiye — landmark aur pincode bhi agar pata ho.",
  details: "Kitne BHK hai ya kitne beds hain? Bathrooms? Area sq ft mein? Aur preferred tenant?",
  amenities: "Kya-kya facilities hain — WiFi, AC, parking, lift, washing machine?",
  confirmation:
    "Bahut badhiya! Main ek baar saari details repeat kar deti hoon, aap confirm kar dijiye.",
  complete:
    "Perfect! Aapki listing tayaar hai. Ab title aur description generate karte hain, photos add kar dijiye aur submit kar dijiye!"
};

/* ─── LLM System Prompt ──────────────────────────────────────────── */

const SYSTEM_PROMPT = `Tu ek friendly female property listing assistant hai — tera naam Cribliv Assistant hai.
Tu Hindi-Hinglish mein baat karti hai jaise normal Delhi/NCR mein log baat karte hain.
NEVER use formal/Sanskritized Hindi. Keep it natural and colloquial.

Real estate terms English mein use kar: BHK, rent, deposit, PG, flat, furnished, semi-furnished, unfurnished, parking, lift, AC, WiFi.
Numbers bhi English mein bol: "15 hazaar", "2 lakh", "850 sq ft".

CONVERSATION RULES:
1. Acknowledge what user said before asking next question.
2. If user gives multiple fields in one answer, extract ALL of them.
3. If something is ambiguous, ask a SPECIFIC clarifying question.
4. After collecting critical info (type, location, rent), confirm by repeating: "Toh 2BHK flat hai Noida Sector 62 mein, rent 15 hazaar — sahi hai?"
5. If user goes off-topic, gently bring back: "Haan haan, wo toh hai! Acha bataaiye..."
6. If user corrects something: "Okay, got it! Maine update kar diya."
7. Keep responses ULTRA SHORT — maximum 1 short sentence (15 words or less). NEVER repeat back all details unless in confirmation phase.
8. Always sound warm and encouraging.
9. When a field is optional and user doesn't know, move on: "Koi baat nahi, chhod dete hain."

PHASE-SPECIFIC RULES:
- In "basics" phase: You MUST ask for rent, deposit, AND furnishing (furnished/semi-furnished/unfurnished). Do NOT move to location phase until user has answered about furnishing. If they give rent but skip furnishing, ASK AGAIN: "Aur furnishing kaisi hai — furnished, semi-furnished ya unfurnished?"
- In "location" phase: Ask for city AND locality/area first. Then ALSO ask: "Poora address bhi bata dijiye — landmark, pincode, society name etc. Ye verification ke liye chahiye, tenants ko nahi dikhega." Extract into location.address_line1 field. Do NOT move to details until user has given at least city + some address info.
- Do NOT skip phases. Follow order: greeting → property_type → basics → location → details → amenities → confirmation → complete.

You MUST respond with a JSON object in this EXACT shape:
{
  "agent_response": "The Hindi-Hinglish text the agent should speak",
  "extracted_fields": {
    "listing_type": "flat_house",
    "rent": 15000,
    "deposit": 30000,
    "location": { "city": "noida", "locality": "sector-62", "address_line1": "B-42, Sector 62, near Metro" },
    "property_fields": { "furnishing": "semi_furnished", "bhk": 2, "bathrooms": 2, "area_sqft": 850 },
    "pg_fields": { "total_beds": 10, "room_sharing_options": ["double"], "food_included": true, "attached_bathroom": false },
    "amenities": ["WiFi", "AC", "Parking"],
    "preferred_tenant": "family"
  },
  "fields_to_confirm": ["rent", "location.city"],
  "next_phase": "basics",
  "phase_complete": true,
  "is_correction": false
}

IMPORTANT: furnishing MUST go inside "property_fields" object, NOT at the top level.
deposit goes at the top level (NOT inside property_fields).
Only include fields that were mentioned in THIS turn.

FIELD RULES:
- listing_type: "flat_house" or "pg" only
- rent/deposit: numeric rupee values (18k → 18000, 2 lakh → 200000, 18 हजार → 18000)
- Convert Devanagari digits (१२३) to Arabic (123)
- city: map Hindi names (दिल्ली→delhi, गुरुग्राम/गुड़गाँव→gurugram, नोएडा→noida, जयपुर→jaipur, लखनऊ→lucknow)
- furnishing: "unfurnished", "semi_furnished", "fully_furnished" only
- bhk: integer 1-10
- preferred_tenant: "any", "family", "bachelor", "female", "male"
- amenities: array from [WiFi, AC, Geyser, Washing Machine, Fridge, TV, Parking, Power Backup, Gas Pipeline, Lift, Security, CCTV, Gym, Swimming Pool, Balcony, Kitchen, Water Purifier]

Only extract fields the user EXPLICITLY mentioned. Never guess.
extracted_fields should only contain NEW or CORRECTED fields from this turn.
Set is_correction=true if the user is correcting a previously given value.`;

/* ─── Response type from LLM ─────────────────────────────────────── */

export interface LlmConversationResponse {
  agent_response: string;
  extracted_fields: Partial<VoiceAgentDraft>;
  fields_to_confirm: string[];
  next_phase: VoiceAgentPhase;
  phase_complete: boolean;
  is_correction: boolean;
}

export interface OrchestratorResult {
  agentText: string;
  updatedDraft: VoiceAgentDraft;
  fieldsCollected: string[];
  fieldsRemaining: string[];
  nextPhase: VoiceAgentPhase;
  isComplete: boolean;
}

@Injectable()
export class ConversationOrchestratorService {
  private readonly logger = new Logger(ConversationOrchestratorService.name);

  /* ────── Get greeting text ──────────────────────────────────────── */
  getGreeting(listingTypeHint?: "flat_house" | "pg"): string {
    if (listingTypeHint === "pg") {
      return "नमस्ते! मैं आपकी PG listing बनाने में help करूँगी। चलिए शुरू करते हैं — monthly rent kitna hai? Deposit? Aur furnishing kaisi hai?";
    }
    if (listingTypeHint === "flat_house") {
      return "नमस्ते! मैं आपकी flat listing बनाने में help करूँगी। चलिए शुरू करते हैं — monthly rent kitna hai? Deposit? Aur furnishing kaisi hai?";
    }
    return FALLBACK_PROMPTS.greeting;
  }

  /* ────── Process a user turn ────────────────────────────────────── */
  async processTurn(input: {
    userText: string;
    currentPhase: VoiceAgentPhase;
    currentDraft: VoiceAgentDraft;
    conversationHistory: ConversationTurn[];
    fieldsCollected: string[];
  }): Promise<OrchestratorResult> {
    const config = readConfig();

    // Try LLM path
    if (config.endpoint && config.apiKey && config.deployment) {
      try {
        return await this.processWithLlm(input, config);
      } catch (err) {
        this.logger.error(`LLM processing failed, using fallback: ${err}`);
      }
    }

    // Fallback — rule-based response
    return this.processWithFallback(input);
  }

  /* ────── LLM-powered turn processing ────────────────────────────── */
  private async processWithLlm(
    input: {
      userText: string;
      currentPhase: VoiceAgentPhase;
      currentDraft: VoiceAgentDraft;
      conversationHistory: ConversationTurn[];
      fieldsCollected: string[];
    },
    config: OrchestratorConfig
  ): Promise<OrchestratorResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    // Build message history for context (last 20 turns)
    const recentHistory = input.conversationHistory.slice(-20);
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: `CURRENT STATE:
phase=${input.currentPhase}
fields_collected=[${input.fieldsCollected.join(",")}]
current_draft=${JSON.stringify(input.currentDraft)}`
      }
    ];

    for (const turn of recentHistory) {
      messages.push({
        role: turn.role === "agent" ? "assistant" : "user",
        content: turn.text
      });
    }
    messages.push({ role: "user", content: input.userText });

    const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey
        },
        body: JSON.stringify({
          messages,
          temperature: 0.7,
          max_tokens: 300,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      if (!response.ok || !payload.choices?.[0]?.message?.content) {
        throw new Error("Empty LLM response");
      }

      const llmResponse = JSON.parse(payload.choices[0].message.content) as LlmConversationResponse;
      this.logger.debug(`LLM raw response: ${JSON.stringify(llmResponse.extracted_fields)}`);
      this.logger.debug(
        `LLM next_phase: ${llmResponse.next_phase}, current: ${input.currentPhase}`
      );

      // Merge extracted fields into draft
      const updatedDraft = this.mergeDraft(input.currentDraft, llmResponse.extracted_fields);
      const fieldsCollected = this.computeCollectedFields(updatedDraft);
      const fieldsRemaining = this.computeRemainingFields(fieldsCollected);

      // IMPORTANT: Don't trust the LLM's next_phase blindly — constrain it
      // using our own field-based logic so phases can't be skipped.
      const llmPhase = llmResponse.next_phase || input.currentPhase;
      const rulePhase = this.advancePhaseByFields(input.currentPhase, fieldsCollected);
      // Use the more conservative of (LLM suggestion, rule-based), but never go backwards
      const currentIdx = PHASE_ORDER.indexOf(input.currentPhase);
      const llmIdx = PHASE_ORDER.indexOf(llmPhase);
      const ruleIdx = PHASE_ORDER.indexOf(rulePhase);
      // Allow advancing at most to whichever is lower (more conservative), but at least current
      const nextIdx = Math.max(currentIdx, Math.min(llmIdx, ruleIdx));
      const nextPhase = PHASE_ORDER[nextIdx] ?? input.currentPhase;
      this.logger.debug(
        `Phase decision: llm=${llmPhase}(${llmIdx}), rule=${rulePhase}(${ruleIdx}), final=${nextPhase}(${nextIdx}), fields=[${fieldsCollected.join(",")}]`
      );
      const isComplete = nextPhase === "complete" || fieldsRemaining.length === 0;

      return {
        agentText: llmResponse.agent_response || FALLBACK_PROMPTS[nextPhase],
        updatedDraft,
        fieldsCollected,
        fieldsRemaining,
        nextPhase: isComplete ? "complete" : nextPhase,
        isComplete
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /* ────── Rule-based fallback (when LLM unavailable) ─────────────── */
  private processWithFallback(input: {
    userText: string;
    currentPhase: VoiceAgentPhase;
    currentDraft: VoiceAgentDraft;
    fieldsCollected: string[];
  }): OrchestratorResult {
    // Simple rule-based extraction for common patterns
    const draft = { ...input.currentDraft };
    const text = input.userText.toLowerCase();

    // Try to extract listing type
    if (text.includes("pg") || text.includes("hostel") || text.includes("पीजी")) {
      draft.listing_type = "pg";
    } else if (
      text.includes("flat") ||
      text.includes("house") ||
      text.includes("apartment") ||
      text.includes("फ्लैट") ||
      text.includes("मकान")
    ) {
      draft.listing_type = "flat_house";
    }

    // Try to extract city
    const cityMap: Record<string, string> = {
      delhi: "Delhi",
      दिल्ली: "Delhi",
      noida: "Noida",
      नोएडा: "Noida",
      gurugram: "Gurugram",
      gurgaon: "Gurugram",
      गुरुग्राम: "Gurugram",
      गुड़गाँव: "Gurugram",
      ghaziabad: "Ghaziabad",
      गाजियाबाद: "Ghaziabad",
      faridabad: "Faridabad",
      फरीदाबाद: "Faridabad",
      chandigarh: "Chandigarh",
      चंडीगढ़: "Chandigarh",
      jaipur: "Jaipur",
      जयपुर: "Jaipur",
      lucknow: "Lucknow",
      लखनऊ: "Lucknow"
    };
    for (const [key, val] of Object.entries(cityMap)) {
      if (text.includes(key)) {
        draft.location = { ...draft.location, city: val };
        break;
      }
    }

    // Try to extract rent (look for number followed by hazaar/thousand/lakh)
    const rentMatch = text.match(/(\d+)\s*(hazaar|हजार|thousand|k\b)/i);
    if (rentMatch) {
      draft.rent = parseInt(rentMatch[1], 10) * 1000;
    }
    const lakhMatch = text.match(/(\d+)\s*(lakh|लाख)/i);
    if (lakhMatch) {
      draft.rent = parseInt(lakhMatch[1], 10) * 100000;
    }

    // BHK
    const bhkMatch = text.match(/(\d+)\s*bhk/i);
    if (bhkMatch) {
      draft.property_fields = {
        ...draft.property_fields,
        bhk: parseInt(bhkMatch[1], 10)
      };
    }

    // Furnishing
    if (text.includes("unfurnished") || text.includes("अनफर्निश")) {
      draft.property_fields = { ...draft.property_fields, furnishing: "unfurnished" };
    } else if (
      text.includes("semi furnished") ||
      text.includes("semi-furnished") ||
      text.includes("semi furnish") ||
      text.includes("सेमी फर्निश")
    ) {
      draft.property_fields = { ...draft.property_fields, furnishing: "semi_furnished" };
    } else if (
      text.includes("fully furnished") ||
      text.includes("full furnished") ||
      text.includes("furnished") ||
      text.includes("फर्निश")
    ) {
      draft.property_fields = { ...draft.property_fields, furnishing: "fully_furnished" };
    }

    // Deposit
    const depositMatch = text.match(/deposit\s+(\d+)\s*(hazaar|हजार|thousand|k\b|lakh|लाख)?/i);
    if (depositMatch) {
      const val = parseInt(depositMatch[1], 10);
      const unit = (depositMatch[2] || "").toLowerCase();
      if (unit.includes("lakh") || unit.includes("लाख")) {
        draft.deposit = val * 100000;
      } else if (
        unit.includes("hazaar") ||
        unit.includes("हजार") ||
        unit.includes("thousand") ||
        unit === "k"
      ) {
        draft.deposit = val * 1000;
      } else {
        draft.deposit = val;
      }
    }

    const fieldsCollected = this.computeCollectedFields(draft);
    const fieldsRemaining = this.computeRemainingFields(fieldsCollected);

    // Move to next phase
    const nextPhase = this.advancePhaseByFields(input.currentPhase, fieldsCollected);

    return {
      agentText: FALLBACK_PROMPTS[nextPhase],
      updatedDraft: draft,
      fieldsCollected,
      fieldsRemaining,
      nextPhase,
      isComplete: nextPhase === "complete"
    };
  }

  /* ────── Merge extracted fields into draft ──────────────────────── */
  private mergeDraft(
    existing: VoiceAgentDraft,
    extracted: Partial<VoiceAgentDraft> | undefined
  ): VoiceAgentDraft {
    if (!extracted) return { ...existing };

    const draft: VoiceAgentDraft = { ...existing };

    // Handle top-level fields that LLM might misplace
    const ext = extracted as Record<string, unknown>;

    if (extracted.listing_type) draft.listing_type = extracted.listing_type;
    if (extracted.title) draft.title = extracted.title;
    if (extracted.description) draft.description = extracted.description;
    if (typeof extracted.rent === "number") draft.rent = extracted.rent;
    if (typeof extracted.deposit === "number") draft.deposit = extracted.deposit;
    if (extracted.preferred_tenant) draft.preferred_tenant = extracted.preferred_tenant;
    if (extracted.amenities?.length) {
      draft.amenities = [...new Set([...(draft.amenities ?? []), ...extracted.amenities])];
    }

    // LLM sometimes puts furnishing at top level instead of property_fields
    const topFurnishing = ext.furnishing as string | undefined;
    if (
      topFurnishing &&
      ["unfurnished", "semi_furnished", "fully_furnished"].includes(topFurnishing)
    ) {
      draft.property_fields = {
        ...draft.property_fields,
        furnishing: topFurnishing as "unfurnished" | "semi_furnished" | "fully_furnished"
      };
    }

    if (extracted.location) {
      draft.location = { ...draft.location };
      if (extracted.location.city) draft.location.city = extracted.location.city;
      if (extracted.location.locality) draft.location.locality = extracted.location.locality;
      if (extracted.location.address_line1)
        draft.location.address_line1 = extracted.location.address_line1;
    }

    if (extracted.property_fields) {
      draft.property_fields = { ...draft.property_fields };
      if (typeof extracted.property_fields.bhk === "number")
        draft.property_fields.bhk = extracted.property_fields.bhk;
      if (typeof extracted.property_fields.bathrooms === "number")
        draft.property_fields.bathrooms = extracted.property_fields.bathrooms;
      if (typeof extracted.property_fields.area_sqft === "number")
        draft.property_fields.area_sqft = extracted.property_fields.area_sqft;
      if (extracted.property_fields.furnishing)
        draft.property_fields.furnishing = extracted.property_fields.furnishing;
    }

    if (extracted.pg_fields) {
      draft.pg_fields = { ...draft.pg_fields };
      if (typeof extracted.pg_fields.total_beds === "number")
        draft.pg_fields.total_beds = extracted.pg_fields.total_beds;
      if (extracted.pg_fields.room_sharing_options)
        draft.pg_fields.room_sharing_options = extracted.pg_fields.room_sharing_options;
      if (typeof extracted.pg_fields.food_included === "boolean")
        draft.pg_fields.food_included = extracted.pg_fields.food_included;
      if (typeof extracted.pg_fields.attached_bathroom === "boolean")
        draft.pg_fields.attached_bathroom = extracted.pg_fields.attached_bathroom;
    }

    return draft;
  }

  /* ────── Compute which fields are filled in the draft ───────────── */
  private computeCollectedFields(draft: VoiceAgentDraft): string[] {
    const fields: string[] = [];

    if (draft.listing_type) fields.push("listing_type");
    if (draft.title?.trim()) fields.push("title");
    if (draft.description?.trim()) fields.push("description");
    if (typeof draft.rent === "number" && draft.rent > 0) fields.push("rent");
    if (typeof draft.deposit === "number" && draft.deposit > 0) fields.push("deposit");
    if (draft.preferred_tenant) fields.push("preferred_tenant");
    if (draft.amenities?.length) fields.push("amenities");
    if (draft.location?.city) fields.push("location.city");
    if (draft.location?.locality) fields.push("location.locality");
    if (draft.location?.address_line1) fields.push("location.address_line1");
    if (typeof draft.property_fields?.bhk === "number") fields.push("property_fields.bhk");
    if (typeof draft.property_fields?.bathrooms === "number")
      fields.push("property_fields.bathrooms");
    if (typeof draft.property_fields?.area_sqft === "number")
      fields.push("property_fields.area_sqft");
    if (draft.property_fields?.furnishing) fields.push("property_fields.furnishing");
    if (typeof draft.pg_fields?.total_beds === "number") fields.push("pg_fields.total_beds");
    if (draft.pg_fields?.room_sharing_options?.length)
      fields.push("pg_fields.room_sharing_options");
    if (typeof draft.pg_fields?.food_included === "boolean") fields.push("pg_fields.food_included");
    if (typeof draft.pg_fields?.attached_bathroom === "boolean")
      fields.push("pg_fields.attached_bathroom");

    return fields;
  }

  private computeRemainingFields(collected: string[]): string[] {
    const required = ["listing_type", "rent", "location.city"];
    return required.filter((f) => !collected.includes(f));
  }

  /* ────── Determine next phase based on collected fields ─────────── */
  private advancePhaseByFields(current: VoiceAgentPhase, collected: string[]): VoiceAgentPhase {
    const idx = PHASE_ORDER.indexOf(current);

    // Phase completion checks
    const hasType = collected.includes("listing_type");
    const hasLocation = collected.includes("location.city");
    const hasAddress = collected.includes("location.address_line1");
    const hasRent = collected.includes("rent");
    const hasBasics =
      hasRent &&
      (collected.includes("deposit") || collected.includes("property_fields.furnishing"));
    const hasDetails =
      collected.includes("property_fields.bhk") ||
      collected.includes("pg_fields.total_beds") ||
      collected.includes("property_fields.bathrooms") ||
      collected.includes("property_fields.area_sqft");
    const hasAmenities = collected.includes("amenities");
    const allRequired = ["listing_type", "rent", "location.city"].every((f) =>
      collected.includes(f)
    );

    if (allRequired && hasDetails && hasAmenities) return "confirmation";
    if (allRequired && hasDetails) return "amenities";
    if (hasBasics && hasLocation && hasType) return "details";
    if (hasBasics && hasType) return "location";
    if (hasRent && hasType) {
      // If user gave rent but not deposit/furnishing, stay on basics
      return "basics";
    }
    if (hasType) return "basics";
    if (current === "greeting") return "property_type";

    // Don't go backwards
    return PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)];
  }
}
