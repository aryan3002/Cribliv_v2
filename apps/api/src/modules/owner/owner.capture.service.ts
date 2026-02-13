import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { AzureOpenAiExtractorClient } from "./azure-openai-extractor.client";
import { AzureSpeechClient } from "./azure-speech.client";
import {
  ConfidenceTier,
  ListingType,
  OwnerCaptureExtractResponse,
  OwnerDraftPayloadSnakeCase,
  SupportedCaptureLocale
} from "./owner.capture.types";
import {
  parseBooleanLike,
  parseIndianNumber,
  slugify,
  toConfidenceTier
} from "./owner.capture.utils";

const CITY_ALIASES: Record<string, string> = {
  delhi: "delhi",
  "new delhi": "delhi",
  दिल्ली: "delhi",
  gurugram: "gurugram",
  gurgaon: "gurugram",
  गुड़गांव: "gurugram",
  गुरुग्राम: "gurugram",
  noida: "noida",
  नोएडा: "noida",
  ghaziabad: "ghaziabad",
  गाज़ियाबाद: "ghaziabad",
  faridabad: "faridabad",
  फरीदाबाद: "faridabad",
  chandigarh: "chandigarh",
  चंडीगढ़: "chandigarh",
  jaipur: "jaipur",
  जयपुर: "jaipur",
  lucknow: "lucknow",
  लखनऊ: "lucknow"
};

const SUPPORTED_CITIES = new Set(Object.values(CITY_ALIASES));

const CRITICAL_CONFIRM_FIELDS = new Set([
  "listing_type",
  "rent",
  "deposit",
  "location.city",
  "location.locality"
]);

const REQUIRED_FIELDS = ["listing_type", "title", "rent", "location.city"];

const DEFAULT_CONFIDENCE_SCORE = 0.7;

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function normalizeListingType(raw: unknown): ListingType | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "flat_house" || normalized === "flat" || normalized === "house") {
    return "flat_house";
  }
  if (normalized === "pg" || normalized === "hostel") {
    return "pg";
  }
  return undefined;
}

function normalizeFurnishing(
  raw: unknown
): "unfurnished" | "semi_furnished" | "fully_furnished" | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "unfurnished") {
    return "unfurnished";
  }
  if (normalized === "semi_furnished" || normalized === "semifurnished") {
    return "semi_furnished";
  }
  if (normalized === "fully_furnished" || normalized === "furnished") {
    return "fully_furnished";
  }
  return undefined;
}

function normalizeRoomSharing(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const mapped = raw
      .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
      .map((item) =>
        item === "single" || item === "double" || item === "triple" || item === "quad" ? item : ""
      )
      .filter(Boolean);
    return mapped.length > 0 ? Array.from(new Set(mapped)) : undefined;
  }

  if (typeof raw === "string") {
    const mapped = raw
      .split(/[,\s]+/)
      .map((item) => item.trim().toLowerCase())
      .map((item) =>
        item === "single" || item === "double" || item === "triple" || item === "quad" ? item : ""
      )
      .filter(Boolean);
    return mapped.length > 0 ? Array.from(new Set(mapped)) : undefined;
  }

  return undefined;
}

function cleanText(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function hasValue(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function getPathValue(draft: Partial<OwnerDraftPayloadSnakeCase>, path: string): unknown {
  switch (path) {
    case "listing_type":
      return draft.listing_type;
    case "title":
      return draft.title;
    case "description":
      return draft.description;
    case "rent":
      return draft.rent;
    case "deposit":
      return draft.deposit;
    case "location.city":
      return draft.location?.city;
    case "location.locality":
      return draft.location?.locality;
    case "location.address_line1":
      return draft.location?.address_line1;
    case "location.masked_address":
      return draft.location?.masked_address;
    case "property_fields.bhk":
      return draft.property_fields?.bhk;
    case "property_fields.bathrooms":
      return draft.property_fields?.bathrooms;
    case "property_fields.area_sqft":
      return draft.property_fields?.area_sqft;
    case "property_fields.furnishing":
      return draft.property_fields?.furnishing;
    case "pg_fields.total_beds":
      return draft.pg_fields?.total_beds;
    case "pg_fields.room_sharing_options":
      return draft.pg_fields?.room_sharing_options;
    case "pg_fields.food_included":
      return draft.pg_fields?.food_included;
    case "pg_fields.attached_bathroom":
      return draft.pg_fields?.attached_bathroom;
    default:
      return undefined;
  }
}

function collectDraftPaths(draft: Partial<OwnerDraftPayloadSnakeCase>): string[] {
  const paths = [
    "listing_type",
    "title",
    "description",
    "rent",
    "deposit",
    "location.city",
    "location.locality",
    "location.address_line1",
    "location.masked_address",
    "property_fields.bhk",
    "property_fields.bathrooms",
    "property_fields.area_sqft",
    "property_fields.furnishing",
    "pg_fields.total_beds",
    "pg_fields.room_sharing_options",
    "pg_fields.food_included",
    "pg_fields.attached_bathroom"
  ];

  return paths.filter((path) => hasValue(getPathValue(draft, path)));
}

@Injectable()
export class OwnerCaptureService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AzureSpeechClient) private readonly speechClient: AzureSpeechClient,
    @Inject(AzureOpenAiExtractorClient)
    private readonly extractorClient: AzureOpenAiExtractorClient
  ) {}

  async extractFromAudio(input: {
    audioBuffer: Buffer;
    contentType: string;
    locale: SupportedCaptureLocale;
    listingTypeHint?: ListingType;
  }): Promise<OwnerCaptureExtractResponse> {
    const flags = readFeatureFlags();
    if (!flags.ff_owner_listing_assisted_capture) {
      throw new NotFoundException({
        code: "feature_disabled",
        message: "Assisted listing capture is disabled"
      });
    }

    if (!input.audioBuffer || input.audioBuffer.length === 0) {
      throw new BadRequestException({
        code: "invalid_audio",
        message: "Audio file is required"
      });
    }

    const transcript = await this.speechClient.transcribe({
      audioBuffer: input.audioBuffer,
      contentType: input.contentType,
      locale: input.locale
    });

    const extracted = await this.extractorClient.extractDraft({
      transcript,
      locale: input.locale,
      listingTypeHint: input.listingTypeHint
    });

    const warnings: string[] = [...(extracted.critical_warnings ?? [])];
    const draft = this.sanitizeDraft(extracted.draft_suggestion, input.listingTypeHint);
    await this.normalizeLocation(draft, warnings);

    const confidenceTiers = this.resolveConfidenceTiers(draft, extracted.field_confidence ?? {});
    const confirmFields = this.resolveConfirmFields(draft, confidenceTiers);
    const missingRequiredFields = REQUIRED_FIELDS.filter(
      (path) => !hasValue(getPathValue(draft, path))
    );

    return {
      transcript_echo: transcript,
      draft_suggestion: draft,
      field_confidence_tier: confidenceTiers,
      confirm_fields: confirmFields,
      missing_required_fields: missingRequiredFields,
      critical_warnings: Array.from(new Set(warnings))
    };
  }

  private sanitizeDraft(
    rawSuggestion: Partial<OwnerDraftPayloadSnakeCase> | undefined,
    listingTypeHint?: ListingType
  ): Partial<OwnerDraftPayloadSnakeCase> {
    const source = asObject(rawSuggestion);
    const location = asObject(source.location);
    const propertyFields = asObject(source.property_fields);
    const pgFields = asObject(source.pg_fields);

    const listingType = normalizeListingType(source.listing_type) ?? listingTypeHint;
    const draft: Partial<OwnerDraftPayloadSnakeCase> = {};
    if (listingType) {
      draft.listing_type = listingType;
    }

    const title = cleanText(source.title);
    if (title) {
      draft.title = title;
    }

    const description = cleanText(source.description);
    if (description) {
      draft.description = description;
    }

    const rent = parseIndianNumber(source.rent);
    if (rent != null) {
      draft.rent = rent;
    }

    const deposit = parseIndianNumber(source.deposit);
    if (deposit != null) {
      draft.deposit = deposit;
    }

    const city = cleanText(location.city);
    const locality = cleanText(location.locality);
    const addressLine = cleanText(location.address_line1);
    const maskedAddress = cleanText(location.masked_address);
    if (city || locality || addressLine || maskedAddress) {
      draft.location = {};
      if (city) {
        draft.location.city = city;
      }
      if (locality) {
        draft.location.locality = locality;
      }
      if (addressLine) {
        draft.location.address_line1 = addressLine;
      }
      if (maskedAddress) {
        draft.location.masked_address = maskedAddress;
      }
    }

    const bhk = parseIndianNumber(propertyFields.bhk);
    const bathrooms = parseIndianNumber(propertyFields.bathrooms);
    const areaSqft = parseIndianNumber(propertyFields.area_sqft);
    const furnishing = normalizeFurnishing(propertyFields.furnishing);
    if (bhk != null || bathrooms != null || areaSqft != null || furnishing) {
      draft.property_fields = {};
      if (bhk != null) {
        draft.property_fields.bhk = bhk;
      }
      if (bathrooms != null) {
        draft.property_fields.bathrooms = bathrooms;
      }
      if (areaSqft != null) {
        draft.property_fields.area_sqft = areaSqft;
      }
      if (furnishing) {
        draft.property_fields.furnishing = furnishing;
      }
    }

    const totalBeds = parseIndianNumber(pgFields.total_beds);
    const roomSharing = normalizeRoomSharing(pgFields.room_sharing_options);
    const foodIncluded = parseBooleanLike(pgFields.food_included);
    const attachedBathroom = parseBooleanLike(pgFields.attached_bathroom);
    if (totalBeds != null || roomSharing || foodIncluded != null || attachedBathroom != null) {
      draft.pg_fields = {};
      if (totalBeds != null) {
        draft.pg_fields.total_beds = totalBeds;
      }
      if (roomSharing) {
        draft.pg_fields.room_sharing_options = roomSharing;
      }
      if (foodIncluded != null) {
        draft.pg_fields.food_included = foodIncluded;
      }
      if (attachedBathroom != null) {
        draft.pg_fields.attached_bathroom = attachedBathroom;
      }
    }

    return draft;
  }

  private async normalizeLocation(draft: Partial<OwnerDraftPayloadSnakeCase>, warnings: string[]) {
    const location = draft.location;
    if (!location?.city) {
      return;
    }

    const normalizedCityInput = location.city.trim().toLowerCase();
    const aliasedCity = CITY_ALIASES[normalizedCityInput] ?? normalizedCityInput;
    if (!this.database.isEnabled()) {
      if (SUPPORTED_CITIES.has(aliasedCity)) {
        location.city = aliasedCity;
      } else {
        warnings.push("Unable to confidently map city. Please confirm city.");
        delete location.city;
      }
      if (location.locality) {
        location.locality = slugify(location.locality);
      }
      return;
    }

    const cities = await this.database.query<{
      id: number;
      slug: string;
      name_en: string;
      name_hi: string;
    }>(
      `
      SELECT id, slug, lower(name_en) AS name_en, lower(name_hi) AS name_hi
      FROM cities
      WHERE is_active = true
      `
    );

    const city = cities.rows.find((row) => {
      const candidates = new Set([row.slug, row.name_en, row.name_hi]);
      return candidates.has(aliasedCity);
    });

    if (!city) {
      warnings.push("Unable to map city to supported catalog. Please select city manually.");
      delete location.city;
      return;
    }

    location.city = city.slug;
    if (!location.locality) {
      return;
    }

    const localityInput = location.locality.trim().toLowerCase();
    const localitySlugInput = slugify(localityInput);
    const localities = await this.database.query<{
      slug: string;
      name_en: string;
      name_hi: string;
    }>(
      `
      SELECT slug, lower(name_en) AS name_en, lower(name_hi) AS name_hi
      FROM localities
      WHERE city_id = $1
      `,
      [city.id]
    );

    const locality = localities.rows.find((row) => {
      const candidates = new Set([row.slug, row.name_en, row.name_hi, slugify(row.name_en)]);
      return candidates.has(localityInput) || candidates.has(localitySlugInput);
    });

    if (!locality) {
      warnings.push("Locality could not be matched exactly. Please verify locality.");
      location.locality = localitySlugInput;
      return;
    }

    location.locality = locality.slug;
  }

  private resolveConfidenceTiers(
    draft: Partial<OwnerDraftPayloadSnakeCase>,
    rawScores: Record<string, number>
  ): Record<string, ConfidenceTier> {
    const normalized: Record<string, ConfidenceTier> = {};
    for (const path of collectDraftPaths(draft)) {
      const rawScore =
        rawScores[path] ?? rawScores[path.replace(/\./g, "_")] ?? DEFAULT_CONFIDENCE_SCORE;
      normalized[path] = toConfidenceTier(rawScore);
    }
    return normalized;
  }

  private resolveConfirmFields(
    draft: Partial<OwnerDraftPayloadSnakeCase>,
    confidenceTiers: Record<string, ConfidenceTier>
  ): string[] {
    const confirm = new Set<string>();
    for (const path of collectDraftPaths(draft)) {
      if (CRITICAL_CONFIRM_FIELDS.has(path)) {
        confirm.add(path);
        continue;
      }
      const tier = confidenceTiers[path] ?? "medium";
      if (tier !== "high") {
        confirm.add(path);
      }
    }
    return [...confirm];
  }
}
