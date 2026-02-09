"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  clearAuthSession,
  readAuthSession,
  type StoredAuthSession
} from "../../../../../lib/client-auth";
import { trackEvent } from "../../../../../lib/analytics";
import { t, type Locale } from "../../../../../lib/i18n";
import {
  completeListingPhotos,
  createOwnerListing,
  listOwnerListings,
  makeIdempotencyKey,
  presignListingPhotos,
  segmentPgPath,
  submitOwnerListing,
  updateOwnerListing,
  type OwnerListingDraftInput
} from "../../../../../lib/owner-api";

type ListingType = "flat_house" | "pg";
type Furnishing = "" | "unfurnished" | "semi_furnished" | "fully_furnished";
type SharingType = "" | "single" | "double" | "triple" | "quad";
type PgPath = "self_serve" | "sales_assist" | null;

interface FormData {
  title: string;
  description: string;
  listing_type: ListingType;
  monthly_rent: string;
  deposit: string;
  furnishing: Furnishing;
  city: string;
  locality: string;
  address: string;
  bedrooms: string;
  bathrooms: string;
  area_sqft: string;
  amenities: string[];
  beds: string;
  sharing_type: SharingType;
  meals_included: boolean;
}

interface UploadFile {
  file: File;
  clientUploadId: string;
  status: "pending" | "uploading" | "complete" | "error";
  progress: number;
  previewUrl: string;
  errorMessage?: string;
}

const STEPS = ["Basics", "Location", "Details", "Photos", "Review"];
const STORAGE_KEY = "cribliv:wizard-draft";

const CITIES = [
  "Delhi",
  "Gurugram",
  "Noida",
  "Ghaziabad",
  "Faridabad",
  "Chandigarh",
  "Jaipur",
  "Lucknow"
];

const AMENITIES_FLAT = [
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

const AMENITIES_PG = [
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

const EMPTY_FORM: FormData = {
  title: "",
  description: "",
  listing_type: "flat_house",
  monthly_rent: "",
  deposit: "",
  furnishing: "",
  city: "",
  locality: "",
  address: "",
  bedrooms: "",
  bathrooms: "",
  area_sqft: "",
  amenities: [],
  beds: "",
  sharing_type: "",
  meals_included: false
};

function generateClientUploadId(file: File): string {
  return `${file.name}-${file.size}`;
}

function getSession() {
  return readAuthSession();
}

function getAccessToken() {
  return getSession()?.access_token ?? null;
}

function getRole(session: StoredAuthSession | null) {
  return session?.user?.role;
}

export default function OwnerListingWizardPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [listingId, setListingId] = useState<string | null>(editId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [pgPath, setPgPath] = useState<PgPath>(null);

  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved || editId) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as {
        form?: FormData;
        step?: number;
        listingId?: string;
      };
      if (parsed.form) {
        setForm(parsed.form);
      }
      if (typeof parsed.step === "number") {
        setStep(parsed.step);
      }
      if (parsed.listingId) {
        setListingId(parsed.listingId);
      }
    } catch {
      // Ignore invalid draft state.
    }
  }, [editId]);

  useEffect(() => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        form,
        step,
        listingId
      })
    );
  }, [form, step, listingId]);

  useEffect(() => {
    if (!editId) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      setAuthHint("Login required to edit and submit this listing.");
      return;
    }

    void (async () => {
      try {
        const response = await listOwnerListings(token);
        const found = response.items.find((item) => item.id === editId);
        if (!found) {
          return;
        }

        setForm((previous) => ({
          ...previous,
          title: found.title ?? "",
          listing_type: found.listingType,
          city: found.city ?? "",
          locality: found.locality ?? "",
          monthly_rent: typeof found.monthlyRent === "number" ? String(found.monthlyRent) : ""
        }));
        setListingId(editId);
      } catch {
        // Keep draft editable even if API call fails.
      }
    })();
  }, [editId]);

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function toggleAmenity(amenity: string) {
    setForm((previous) => ({
      ...previous,
      amenities: previous.amenities.includes(amenity)
        ? previous.amenities.filter((item) => item !== amenity)
        : [...previous.amenities, amenity]
    }));
  }

  function buildDraftInput(): OwnerListingDraftInput {
    const isPg = form.listing_type === "pg";

    return {
      title: form.title,
      description: form.description || undefined,
      listingType: form.listing_type,
      rent: form.monthly_rent ? Number(form.monthly_rent) : undefined,
      deposit: form.deposit ? Number(form.deposit) : undefined,
      location: {
        city: form.city,
        locality: form.locality || undefined,
        addressLine1: form.address || undefined,
        maskedAddress: form.locality || form.city || undefined
      },
      propertyFields: isPg
        ? undefined
        : {
            bhk: form.bedrooms ? Number(form.bedrooms) : undefined,
            bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
            areaSqft: form.area_sqft ? Number(form.area_sqft) : undefined,
            furnishing: form.furnishing || undefined
          },
      pgFields: isPg
        ? {
            totalBeds: form.beds ? Number(form.beds) : undefined,
            roomSharingOptions: form.sharing_type ? [form.sharing_type] : [],
            foodIncluded: form.meals_included,
            attachedBathroom: false
          }
        : undefined
    };
  }

  useEffect(() => {
    if (form.listing_type !== "pg" || !form.beds) {
      setPgPath(null);
      return;
    }

    const beds = Number(form.beds);
    if (!Number.isFinite(beds) || beds <= 0) {
      setPgPath(null);
      return;
    }

    const session = getSession();
    const token = session?.access_token;
    if (!token || getRole(session) !== "pg_operator") {
      setPgPath(beds <= 29 ? "self_serve" : "sales_assist");
      return;
    }

    void segmentPgPath(token, beds)
      .then((result) => {
        setPgPath(result.path);
        trackEvent("pg_segmentation_triggered", { beds, path: result.path });
      })
      .catch(() => {
        setPgPath(beds <= 29 ? "self_serve" : "sales_assist");
      });
  }, [form.beds, form.listing_type]);

  async function saveDraft(): Promise<string | null> {
    const token = getAccessToken();
    if (!token) {
      setAuthHint("Login required to save draft to server. You can continue filling the form.");
      return null;
    }

    setSaving(true);
    setError(null);

    try {
      const input = buildDraftInput();

      if (!listingId) {
        const created = await createOwnerListing(token, input);
        setListingId(created.listingId);
        trackEvent("owner_listing_draft_saved", { listing_id: created.listingId, is_new: true });
        return created.listingId;
      }

      await updateOwnerListing(token, listingId, input);
      trackEvent("owner_listing_draft_saved", { listing_id: listingId, is_new: false });
      return listingId;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save listing";
      if (message.toLowerCase().includes("unauthorized")) {
        clearAuthSession();
      }
      setError(message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitListing() {
    const token = getAccessToken();
    if (!token) {
      setError(t(locale, "loginRequired"));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let draftId = listingId;
      if (!draftId) {
        const created = await createOwnerListing(token, buildDraftInput());
        draftId = created.listingId;
        setListingId(draftId);
      } else {
        await updateOwnerListing(token, draftId, buildDraftInput());
      }

      await submitOwnerListing(token, draftId);
      trackEvent("owner_listing_submitted", { listing_id: draftId });
      sessionStorage.removeItem(STORAGE_KEY);
      router.push(`/${locale}/owner/dashboard`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit listing";
      if (message.toLowerCase().includes("unauthorized")) {
        clearAuthSession();
      }
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function goNext() {
    if (step >= 4) {
      return;
    }

    setAuthHint(null);

    const token = getAccessToken();
    if (token) {
      if (step === 1 && !listingId) {
        const savedId = await saveDraft();
        if (!savedId) {
          return;
        }
      } else if (step > 1 && listingId) {
        const savedId = await saveDraft();
        if (!savedId) {
          return;
        }
      }
    } else if (step === 0) {
      setAuthHint("You can keep filling the form. Login is needed to save and submit.");
    }

    setStep((current) => current + 1);
  }

  function goBack() {
    if (step > 0) {
      setStep((current) => current - 1);
    }
  }

  function onFilesSelected(files: FileList | null) {
    if (!files) {
      return;
    }

    setUploads((current) => {
      const existingIds = new Set(current.map((item) => item.clientUploadId));
      const nextUploads: UploadFile[] = Array.from(files).map((file) => {
        const clientUploadId = generateClientUploadId(file);
        const duplicate = existingIds.has(clientUploadId);
        return {
          file,
          clientUploadId,
          status: duplicate ? ("error" as const) : ("pending" as const),
          progress: 0,
          previewUrl: URL.createObjectURL(file),
          errorMessage: duplicate ? "This photo was already uploaded." : undefined
        };
      });
      return [...current, ...nextUploads];
    });
  }

  async function uploadFile(upload: UploadFile) {
    const token = getAccessToken();
    if (!token || !listingId) {
      setError("Login and save draft before uploading photos.");
      return;
    }

    setUploads((current) =>
      current.map((item) =>
        item.clientUploadId === upload.clientUploadId
          ? { ...item, status: "uploading", progress: 15 }
          : item
      )
    );

    try {
      const presignResult = await presignListingPhotos(
        token,
        listingId,
        [
          {
            clientUploadId: upload.clientUploadId,
            contentType: upload.file.type || "image/jpeg",
            sizeBytes: upload.file.size
          }
        ],
        makeIdempotencyKey("photo-presign")
      );

      const firstUpload = presignResult.uploads[0];
      if (!firstUpload) {
        throw new Error("Failed to get upload URL");
      }

      setUploads((current) =>
        current.map((item) =>
          item.clientUploadId === upload.clientUploadId ? { ...item, progress: 70 } : item
        )
      );

      await completeListingPhotos(
        token,
        listingId,
        [
          {
            clientUploadId: upload.clientUploadId,
            blobPath: firstUpload.blobPath,
            isCover: false,
            sortOrder: 0
          }
        ],
        makeIdempotencyKey("photo-complete")
      );

      setUploads((current) =>
        current.map((item) =>
          item.clientUploadId === upload.clientUploadId
            ? { ...item, status: "complete", progress: 100, errorMessage: undefined }
            : item
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      const duplicate =
        message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("already");

      setUploads((current) =>
        current.map((item) =>
          item.clientUploadId === upload.clientUploadId
            ? {
                ...item,
                status: "error",
                errorMessage: duplicate ? "This photo was already uploaded." : message
              }
            : item
        )
      );
    }
  }

  async function uploadAllPending() {
    for (const upload of uploads.filter((item) => item.status === "pending")) {
      await uploadFile(upload);
    }
  }

  function removeUpload(clientUploadId: string) {
    setUploads((current) => {
      const removed = current.find((item) => item.clientUploadId === clientUploadId);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((item) => item.clientUploadId !== clientUploadId);
    });
  }

  const canProceed = useMemo(() => {
    switch (step) {
      case 0:
        return form.title.trim().length > 0 && form.monthly_rent.trim().length > 0;
      case 1:
        return form.city.trim().length > 0;
      default:
        return true;
    }
  }, [form.city, form.monthly_rent, form.title, step]);

  function renderStepIndicator() {
    return (
      <nav className="wizard-steps" aria-label="Wizard progress">
        {STEPS.map((label, index) => (
          <div
            key={label}
            className={`wizard-step${
              index === step ? " wizard-step--active" : index < step ? " wizard-step--done" : ""
            }`}
            aria-current={index === step ? "step" : undefined}
          >
            {label}
          </div>
        ))}
      </nav>
    );
  }

  function renderBasics() {
    return (
      <>
        <div className="form-group">
          <label className="form-label" htmlFor="wiz-title">
            Listing title
          </label>
          <input
            id="wiz-title"
            className="form-input"
            value={form.title}
            onChange={(event) => updateField("title", event.target.value)}
            placeholder="e.g. Spacious 2BHK near Metro"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="wiz-desc">
            Description
          </label>
          <textarea
            id="wiz-desc"
            className="form-textarea"
            value={form.description}
            onChange={(event) => updateField("description", event.target.value)}
            placeholder="Describe your property — condition, nearby landmarks, best suited for..."
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="wiz-type">
              Property type
            </label>
            <select
              id="wiz-type"
              className="form-select"
              value={form.listing_type}
              onChange={(event) => updateField("listing_type", event.target.value as ListingType)}
            >
              <option value="flat_house">Flat / House</option>
              <option value="pg">PG / Hostel</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="wiz-furnishing">
              Furnishing
            </label>
            <select
              id="wiz-furnishing"
              className="form-select"
              value={form.furnishing}
              onChange={(event) => updateField("furnishing", event.target.value as Furnishing)}
            >
              <option value="">Select...</option>
              <option value="unfurnished">Unfurnished</option>
              <option value="semi_furnished">Semi-Furnished</option>
              <option value="fully_furnished">Fully Furnished</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label" htmlFor="wiz-rent">
              Monthly rent (₹)
            </label>
            <input
              id="wiz-rent"
              type="number"
              className="form-input"
              value={form.monthly_rent}
              onChange={(event) => updateField("monthly_rent", event.target.value)}
              placeholder="e.g. 15000"
              min="0"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="wiz-deposit">
              Security deposit (₹)
            </label>
            <input
              id="wiz-deposit"
              type="number"
              className="form-input"
              value={form.deposit}
              onChange={(event) => updateField("deposit", event.target.value)}
              placeholder="e.g. 30000"
              min="0"
            />
          </div>
        </div>
      </>
    );
  }

  function renderLocation() {
    return (
      <>
        <div className="form-group">
          <label className="form-label" htmlFor="wiz-city">
            City
          </label>
          <select
            id="wiz-city"
            className="form-select"
            value={form.city}
            onChange={(event) => updateField("city", event.target.value)}
          >
            <option value="">Select city...</option>
            {CITIES.map((city) => (
              <option key={city} value={city.toLowerCase()}>
                {city}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="wiz-locality">
            Locality / Area
          </label>
          <input
            id="wiz-locality"
            className="form-input"
            value={form.locality}
            onChange={(event) => updateField("locality", event.target.value)}
            placeholder="e.g. Sector 62, DLF Phase 3"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="wiz-address">
            Full address
          </label>
          <textarea
            id="wiz-address"
            className="form-textarea"
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            placeholder="Complete address (kept private, used for verification only)"
          />
          <p className="form-hint">
            Your full address is never shown to tenants. It is used only for owner verification.
          </p>
        </div>
      </>
    );
  }

  function renderDetails() {
    const isPg = form.listing_type === "pg";

    return (
      <>
        {isPg ? (
          <>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="wiz-beds">
                  Total beds
                </label>
                <input
                  id="wiz-beds"
                  type="number"
                  className="form-input"
                  value={form.beds}
                  onChange={(event) => updateField("beds", event.target.value)}
                  placeholder="e.g. 20"
                  min="1"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="wiz-sharing">
                  Sharing type
                </label>
                <select
                  id="wiz-sharing"
                  className="form-select"
                  value={form.sharing_type}
                  onChange={(event) =>
                    updateField("sharing_type", event.target.value as SharingType)
                  }
                >
                  <option value="">Select...</option>
                  <option value="single">Single</option>
                  <option value="double">Double</option>
                  <option value="triple">Triple</option>
                  <option value="quad">Quad</option>
                </select>
              </div>
            </div>

            <div className="checkbox-row">
              <input
                type="checkbox"
                id="wiz-meals"
                checked={form.meals_included}
                onChange={(event) => updateField("meals_included", event.target.checked)}
              />
              <label htmlFor="wiz-meals">Meals included</label>
            </div>

            {pgPath === "self_serve" ? (
              <div className="segment-banner segment-banner--self-serve">
                With {form.beds} beds, you can manage your listing yourself through our self-serve
                platform.
              </div>
            ) : null}
            {pgPath === "sales_assist" ? (
              <div className="segment-banner segment-banner--sales-assist">
                With {form.beds}+ beds, our team will help you with onboarding and dedicated
                support.
              </div>
            ) : null}
          </>
        ) : (
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="wiz-bedrooms">
                Bedrooms
              </label>
              <input
                id="wiz-bedrooms"
                type="number"
                className="form-input"
                value={form.bedrooms}
                onChange={(event) => updateField("bedrooms", event.target.value)}
                placeholder="e.g. 2"
                min="0"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="wiz-bathrooms">
                Bathrooms
              </label>
              <input
                id="wiz-bathrooms"
                type="number"
                className="form-input"
                value={form.bathrooms}
                onChange={(event) => updateField("bathrooms", event.target.value)}
                placeholder="e.g. 1"
                min="0"
              />
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="wiz-area">
            Area (sq ft)
          </label>
          <input
            id="wiz-area"
            type="number"
            className="form-input"
            value={form.area_sqft}
            onChange={(event) => updateField("area_sqft", event.target.value)}
            placeholder="e.g. 850"
            min="0"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Amenities</label>
          <div className="amenity-grid">
            {(isPg ? AMENITIES_PG : AMENITIES_FLAT).map((amenity) => (
              <div key={amenity} className="checkbox-row">
                <input
                  id={`amenity-${amenity}`}
                  type="checkbox"
                  checked={form.amenities.includes(amenity)}
                  onChange={() => toggleAmenity(amenity)}
                />
                <label htmlFor={`amenity-${amenity}`}>{amenity}</label>
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  function renderPhotos() {
    return (
      <>
        <p className="muted-text">
          Add photos of your property. Good photos help tenants decide faster.
        </p>

        <div
          className="upload-zone"
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onFilesSelected(event.dataTransfer.files);
          }}
        >
          <p>Click or drag photos here</p>
          <p className="form-hint">JPG, PNG up to 10 MB each</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => onFilesSelected(event.target.files)}
            aria-label="Select photos"
          />
        </div>

        {uploads.length > 0 ? (
          <>
            <div className="upload-list">
              {uploads.map((upload) => (
                <div key={upload.clientUploadId} className="upload-item">
                  <img
                    className="upload-item__preview"
                    src={upload.previewUrl}
                    alt={upload.file.name}
                  />
                  <div className="upload-item__info">
                    <div className="upload-item__name">{upload.file.name}</div>
                    <div
                      className={`upload-item__status${
                        upload.status === "complete"
                          ? " upload-item__status--success"
                          : upload.status === "error"
                            ? " upload-item__status--error"
                            : ""
                      }`}
                    >
                      {upload.status === "pending" ? "Ready to upload" : null}
                      {upload.status === "uploading" ? "Uploading..." : null}
                      {upload.status === "complete" ? "Uploaded" : null}
                      {upload.status === "error" ? upload.errorMessage || "Upload failed" : null}
                    </div>
                    {upload.status === "uploading" ? (
                      <div className="progress-bar">
                        <div
                          className="progress-bar__fill"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => removeUpload(upload.clientUploadId)}
                    aria-label={`Remove ${upload.file.name}`}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="primary"
                onClick={uploadAllPending}
                disabled={saving || uploads.every((upload) => upload.status !== "pending")}
              >
                Upload All
              </button>
            </div>
          </>
        ) : null}
      </>
    );
  }

  function renderReview() {
    const isPg = form.listing_type === "pg";
    const completedUploads = uploads.filter((upload) => upload.status === "complete");

    return (
      <>
        <div className="info-box">{t(locale, "reviewInfo")}</div>

        <div className="panel">
          <h3>{form.title || "Untitled"}</h3>
          <p className="muted-text">
            {isPg ? "PG / Hostel" : "Flat / House"} in {form.city || "—"}
            {form.locality ? `, ${form.locality}` : ""}
          </p>

          {form.monthly_rent ? (
            <p className="rent">₹{Number(form.monthly_rent).toLocaleString("en-IN")}/month</p>
          ) : null}
          {form.deposit ? <p>Deposit: ₹{Number(form.deposit).toLocaleString("en-IN")}</p> : null}
          {form.furnishing ? <p>Furnishing: {form.furnishing.replace(/_/g, " ")}</p> : null}
          {form.description ? <p>{form.description}</p> : null}
        </div>

        <div className="panel">
          <h4>Property details</h4>
          {!isPg && form.bedrooms ? <p>Bedrooms: {form.bedrooms}</p> : null}
          {!isPg && form.bathrooms ? <p>Bathrooms: {form.bathrooms}</p> : null}
          {isPg && form.beds ? <p>Beds: {form.beds}</p> : null}
          {isPg && form.sharing_type ? <p>Sharing: {form.sharing_type}</p> : null}
          {isPg ? <p>Meals: {form.meals_included ? "Included" : "Not included"}</p> : null}
          {form.area_sqft ? <p>Area: {form.area_sqft} sq ft</p> : null}

          {form.amenities.length > 0 ? (
            <div className="chip-row" style={{ marginTop: 8 }}>
              {form.amenities.map((amenity) => (
                <span key={amenity} className="badge">
                  {amenity}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {completedUploads.length > 0 ? (
          <div className="panel">
            <h4>Photos ({completedUploads.length})</h4>
            <div className="chip-row">
              {completedUploads.map((upload) => (
                <img
                  key={upload.clientUploadId}
                  src={upload.previewUrl}
                  alt=""
                  style={{ width: 80, height: 80, borderRadius: 6, objectFit: "cover" }}
                />
              ))}
            </div>
          </div>
        ) : null}

        {pgPath === "sales_assist" ? (
          <div className="segment-banner segment-banner--sales-assist">
            As a large PG operator, our team will be in touch after submission to assist with
            onboarding.
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section className="hero">
      <h1>{editId ? t(locale, "editListing") : t(locale, "createListing")}</h1>

      {renderStepIndicator()}

      {error ? (
        <div className="panel warning-box" role="alert">
          {error}
        </div>
      ) : null}

      {authHint ? (
        <div className="panel" role="status">
          <p className="muted-text" style={{ margin: 0 }}>
            {authHint}
          </p>
        </div>
      ) : null}

      <div className="panel">
        {step === 0 ? renderBasics() : null}
        {step === 1 ? renderLocation() : null}
        {step === 2 ? renderDetails() : null}
        {step === 3 ? renderPhotos() : null}
        {step === 4 ? renderReview() : null}
      </div>

      <div className="wizard-nav">
        <button type="button" className="secondary" onClick={goBack} disabled={step === 0}>
          {t(locale, "back")}
        </button>

        {step < 4 ? (
          <button
            type="button"
            className="primary"
            onClick={goNext}
            disabled={saving || !canProceed}
          >
            {saving ? "Saving..." : t(locale, "next")}
          </button>
        ) : (
          <button type="button" className="primary" onClick={submitListing} disabled={saving}>
            {saving ? "Submitting..." : t(locale, "submitForReview")}
          </button>
        )}
      </div>
    </section>
  );
}
