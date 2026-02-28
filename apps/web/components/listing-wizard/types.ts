import type {
  OwnerDraftPayloadSnakeCase,
  OwnerListingCaptureExtractResponse,
  ConfidenceTier
} from "../../lib/owner-api";

export type ListingType = "flat_house" | "pg";
export type Furnishing = "" | "unfurnished" | "semi_furnished" | "fully_furnished";
export type SharingType = "" | "single" | "double" | "triple" | "quad";
export type PgPath = "self_serve" | "sales_assist" | null;
export type CaptureMode =
  | "entry"
  | "voice_recording"
  | "assisted_confirmation"
  | "voice_agent"
  | "wizard";
export type RecorderState = "idle" | "recording" | "processing";

export interface WizardForm {
  title: string;
  description: string;
  listing_type: ListingType;
  monthly_rent: string;
  deposit: string;
  furnishing: Furnishing;
  city: string;
  locality: string;
  address: string;
  landmark: string;
  pincode: string;
  bedrooms: string;
  bathrooms: string;
  area_sqft: string;
  amenities: string[];
  preferred_tenant: string;
  beds: string;
  sharing_type: SharingType;
  meals_included: boolean;
  attached_bathroom: boolean;
}

export interface UploadFile {
  file: File;
  clientUploadId: string;
  status: "pending" | "uploading" | "complete" | "error";
  progress: number;
  previewUrl: string;
  errorMessage?: string;
}

export const STEPS = ["Basics", "Location", "Details", "Photos", "Review"] as const;
export const STORAGE_KEY = "cribliv:wizard-draft";

export const CITIES = [
  "Delhi",
  "Gurugram",
  "Noida",
  "Ghaziabad",
  "Faridabad",
  "Chandigarh",
  "Jaipur",
  "Lucknow"
];

export const AMENITIES_FLAT = [
  "WiFi",
  "AC",
  "Geyser",
  "Washing Machine",
  "Fridge",
  "TV",
  "Parking",
  "Power Backup",
  "Gas Pipeline",
  "Lift",
  "Security",
  "CCTV",
  "Gym",
  "Swimming Pool",
  "Balcony",
  "Kitchen",
  "Water Purifier"
];

export const AMENITIES_PG = [
  "WiFi",
  "AC",
  "Geyser",
  "Washing Machine",
  "Fridge",
  "TV",
  "Parking",
  "Power Backup",
  "Security",
  "CCTV",
  "Gym",
  "Meals",
  "Laundry",
  "Housekeeping"
];

export const PREFERRED_TENANTS = [
  { value: "", label: "No preference" },
  { value: "any", label: "Anyone" },
  { value: "family", label: "Family" },
  { value: "bachelor", label: "Bachelor" },
  { value: "female", label: "Female only" },
  { value: "male", label: "Male only" }
];

export const EMPTY_FORM: WizardForm = {
  title: "",
  description: "",
  listing_type: "flat_house",
  monthly_rent: "",
  deposit: "",
  furnishing: "",
  city: "",
  locality: "",
  address: "",
  landmark: "",
  pincode: "",
  bedrooms: "",
  bathrooms: "",
  area_sqft: "",
  amenities: [],
  preferred_tenant: "",
  beds: "",
  sharing_type: "",
  meals_included: false,
  attached_bathroom: false
};

// ─── Capture field definitions ───────────────────────────────────────────────

export interface CaptureFieldOption {
  value: string;
  label: string;
}

export interface CaptureFieldDefinition {
  path: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  options?: CaptureFieldOption[];
}

export const CAPTURE_FIELD_DEFINITIONS: CaptureFieldDefinition[] = [
  {
    path: "listing_type",
    label: "Property type",
    type: "select",
    options: [
      { value: "flat_house", label: "Flat / House" },
      { value: "pg", label: "PG / Hostel" }
    ]
  },
  { path: "title", label: "Listing title", type: "text" },
  { path: "description", label: "Description", type: "text" },
  { path: "rent", label: "Monthly rent", type: "number" },
  { path: "deposit", label: "Security deposit", type: "number" },
  { path: "location.city", label: "City", type: "text" },
  { path: "location.locality", label: "Locality", type: "text" },
  { path: "location.address_line1", label: "Full address", type: "text" },
  { path: "property_fields.bhk", label: "Bedrooms (BHK)", type: "number" },
  { path: "property_fields.bathrooms", label: "Bathrooms", type: "number" },
  { path: "property_fields.area_sqft", label: "Area (sq ft)", type: "number" },
  {
    path: "property_fields.furnishing",
    label: "Furnishing",
    type: "select",
    options: [
      { value: "unfurnished", label: "Unfurnished" },
      { value: "semi_furnished", label: "Semi-Furnished" },
      { value: "fully_furnished", label: "Fully Furnished" }
    ]
  },
  { path: "pg_fields.total_beds", label: "Total beds", type: "number" },
  {
    path: "pg_fields.room_sharing_options",
    label: "Sharing options",
    type: "select",
    options: [
      { value: "single", label: "Single" },
      { value: "double", label: "Double" },
      { value: "triple", label: "Triple" },
      { value: "quad", label: "Quad" }
    ]
  },
  { path: "pg_fields.food_included", label: "Meals included", type: "boolean" },
  { path: "pg_fields.attached_bathroom", label: "Attached bathroom", type: "boolean" }
];

// ─── Capture draft helpers ───────────────────────────────────────────────────

export function cloneCaptureDraft(
  draft: Partial<OwnerDraftPayloadSnakeCase> | undefined
): Partial<OwnerDraftPayloadSnakeCase> {
  return draft ? (JSON.parse(JSON.stringify(draft)) as Partial<OwnerDraftPayloadSnakeCase>) : {};
}

export function getCaptureFieldDefinition(path: string): CaptureFieldDefinition | undefined {
  return CAPTURE_FIELD_DEFINITIONS.find((d) => d.path === path);
}

export function getCaptureValue(
  draft: Partial<OwnerDraftPayloadSnakeCase> | null,
  path: string
): unknown {
  if (!draft) return undefined;
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
      return draft.pg_fields?.room_sharing_options?.[0];
    case "pg_fields.food_included":
      return draft.pg_fields?.food_included;
    case "pg_fields.attached_bathroom":
      return draft.pg_fields?.attached_bathroom;
    default:
      return undefined;
  }
}

export function hasCaptureValue(
  draft: Partial<OwnerDraftPayloadSnakeCase> | null,
  path: string
): boolean {
  const value = getCaptureValue(draft, path);
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function setCaptureValue(
  draft: Partial<OwnerDraftPayloadSnakeCase>,
  path: string,
  value: unknown
): Partial<OwnerDraftPayloadSnakeCase> {
  const next = cloneCaptureDraft(draft);
  switch (path) {
    case "listing_type":
      next.listing_type = value === "pg" ? "pg" : "flat_house";
      break;
    case "title":
      next.title = typeof value === "string" ? value : "";
      break;
    case "description":
      next.description = typeof value === "string" ? value : "";
      break;
    case "rent":
      next.rent = typeof value === "number" && Number.isFinite(value) ? value : undefined;
      break;
    case "deposit":
      next.deposit = typeof value === "number" && Number.isFinite(value) ? value : undefined;
      break;
    case "location.city":
      next.location = { ...(next.location ?? {}), city: typeof value === "string" ? value : "" };
      break;
    case "location.locality":
      next.location = {
        ...(next.location ?? {}),
        locality: typeof value === "string" ? value : ""
      };
      break;
    case "location.address_line1":
      next.location = {
        ...(next.location ?? {}),
        address_line1: typeof value === "string" ? value : ""
      };
      break;
    case "property_fields.bhk":
      next.property_fields = {
        ...(next.property_fields ?? {}),
        bhk: typeof value === "number" && Number.isFinite(value) ? value : undefined
      };
      break;
    case "property_fields.bathrooms":
      next.property_fields = {
        ...(next.property_fields ?? {}),
        bathrooms: typeof value === "number" && Number.isFinite(value) ? value : undefined
      };
      break;
    case "property_fields.area_sqft":
      next.property_fields = {
        ...(next.property_fields ?? {}),
        area_sqft: typeof value === "number" && Number.isFinite(value) ? value : undefined
      };
      break;
    case "property_fields.furnishing":
      next.property_fields = {
        ...(next.property_fields ?? {}),
        furnishing:
          value === "unfurnished" || value === "semi_furnished" || value === "fully_furnished"
            ? value
            : undefined
      };
      break;
    case "pg_fields.total_beds":
      next.pg_fields = {
        ...(next.pg_fields ?? {}),
        total_beds: typeof value === "number" && Number.isFinite(value) ? value : undefined
      };
      break;
    case "pg_fields.room_sharing_options":
      next.pg_fields = {
        ...(next.pg_fields ?? {}),
        room_sharing_options: typeof value === "string" && value ? [value] : undefined
      };
      break;
    case "pg_fields.food_included":
      next.pg_fields = {
        ...(next.pg_fields ?? {}),
        food_included: typeof value === "boolean" ? value : undefined
      };
      break;
    case "pg_fields.attached_bathroom":
      next.pg_fields = {
        ...(next.pg_fields ?? {}),
        attached_bathroom: typeof value === "boolean" ? value : undefined
      };
      break;
    default:
      break;
  }
  return next;
}

export function formatCaptureValue(path: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if ((path === "rent" || path === "deposit") && typeof value === "number")
    return `₹${value.toLocaleString("en-IN")}`;
  if (path === "listing_type" && typeof value === "string")
    return value === "pg" ? "PG / Hostel" : "Flat / House";
  if (path === "property_fields.furnishing" && typeof value === "string")
    return value.replace(/_/g, " ");
  if (
    (path === "pg_fields.food_included" || path === "pg_fields.attached_bathroom") &&
    typeof value === "boolean"
  )
    return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function resolveWizardStepForForm(form: WizardForm): number {
  if (!form.title.trim() || !form.monthly_rent.trim()) return 0;
  if (!form.city.trim()) return 1;
  return 2;
}

export function applyCaptureDraftToForm(
  prev: WizardForm,
  draft: Partial<OwnerDraftPayloadSnakeCase>
): WizardForm {
  const next = { ...prev };
  if (draft.title) next.title = draft.title;
  if (draft.description) next.description = draft.description;
  if (draft.listing_type) next.listing_type = draft.listing_type;
  if (typeof draft.rent === "number" && Number.isFinite(draft.rent))
    next.monthly_rent = String(draft.rent);
  if (typeof draft.deposit === "number" && Number.isFinite(draft.deposit))
    next.deposit = String(draft.deposit);
  if (draft.location?.city) next.city = draft.location.city;
  if (draft.location?.locality) next.locality = draft.location.locality;
  if (draft.location?.address_line1) next.address = draft.location.address_line1;
  if (typeof draft.property_fields?.bhk === "number")
    next.bedrooms = String(draft.property_fields.bhk);
  if (typeof draft.property_fields?.bathrooms === "number")
    next.bathrooms = String(draft.property_fields.bathrooms);
  if (typeof draft.property_fields?.area_sqft === "number")
    next.area_sqft = String(draft.property_fields.area_sqft);
  if (draft.property_fields?.furnishing) next.furnishing = draft.property_fields.furnishing;
  if (typeof draft.pg_fields?.total_beds === "number")
    next.beds = String(draft.pg_fields.total_beds);
  if (draft.pg_fields?.room_sharing_options?.[0])
    next.sharing_type = draft.pg_fields.room_sharing_options[0] as SharingType;
  if (typeof draft.pg_fields?.food_included === "boolean")
    next.meals_included = draft.pg_fields.food_included;
  if (typeof draft.pg_fields?.attached_bathroom === "boolean")
    next.attached_bathroom = draft.pg_fields.attached_bathroom;
  return next;
}

// ─── Step validation ─────────────────────────────────────────────────────────

export interface StepError {
  field: string;
  message: string;
}

export function validateStep(step: number, form: WizardForm): StepError[] {
  const errors: StepError[] = [];
  switch (step) {
    case 0: {
      if (!form.title.trim()) errors.push({ field: "title", message: "Title is required" });
      if (form.title.trim().length > 0 && form.title.trim().length < 5)
        errors.push({ field: "title", message: "Title must be at least 5 characters" });
      if (!form.monthly_rent.trim())
        errors.push({ field: "monthly_rent", message: "Rent is required" });
      const rent = Number(form.monthly_rent);
      if (form.monthly_rent && (!Number.isFinite(rent) || rent <= 0))
        errors.push({ field: "monthly_rent", message: "Rent must be a positive number" });
      if (form.monthly_rent && rent > 10000000)
        errors.push({ field: "monthly_rent", message: "Rent seems too high. Please check." });
      const dep = Number(form.deposit);
      if (form.deposit && (!Number.isFinite(dep) || dep < 0))
        errors.push({ field: "deposit", message: "Deposit must be a positive number" });
      break;
    }
    case 1: {
      if (!form.city.trim()) errors.push({ field: "city", message: "City is required" });
      break;
    }
    case 2: {
      const isPg = form.listing_type === "pg";
      if (!isPg && form.bedrooms) {
        const bhk = Number(form.bedrooms);
        if (!Number.isFinite(bhk) || bhk < 1 || bhk > 20)
          errors.push({ field: "bedrooms", message: "Bedrooms must be 1-20" });
      }
      if (isPg && form.beds) {
        const beds = Number(form.beds);
        if (!Number.isFinite(beds) || beds < 1)
          errors.push({ field: "beds", message: "Total beds must be at least 1" });
      }
      if (form.area_sqft) {
        const area = Number(form.area_sqft);
        if (!Number.isFinite(area) || area < 50 || area > 100000)
          errors.push({ field: "area_sqft", message: "Area must be 50-100,000 sq ft" });
      }
      break;
    }
    default:
      break;
  }
  return errors;
}

export function generateClientUploadId(file: File): string {
  return `${file.name}-${file.size}`;
}

export {
  type OwnerDraftPayloadSnakeCase,
  type OwnerListingCaptureExtractResponse,
  type ConfidenceTier
};
