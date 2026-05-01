"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { trackEvent } from "../../../../../lib/analytics";
import { t, type Locale } from "../../../../../lib/i18n";
import {
  completeListingPhotos,
  createSalesLead,
  createOwnerListing,
  generateListingContent,
  listOwnerListings,
  makeIdempotencyKey,
  presignListingPhotos,
  segmentPgPath,
  submitOwnerListing,
  updateOwnerListing
} from "../../../../../lib/owner-api";
import { ApiError } from "../../../../../lib/api";
import type { OwnerListingDraftInput } from "../../../../../lib/owner-api";

import {
  type WizardForm,
  type PgPath,
  type UploadFile,
  type StepError,
  STEPS,
  EMPTY_FORM,
  generateClientUploadId,
  validateStep,
  WizardStepIndicator,
  BasicsStep,
  LocationStep,
  DetailsStep,
  TitleDescriptionStep,
  PhotosStep,
  ReviewStep,
  VoiceCoPilot
} from "../../../../../components/listing-wizard";

const STORAGE_KEY = "cribliv:wizard-draft";
const MAX_PARALLEL_UPLOADS = 4;
const REALTIME_FLAG_ENV =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_FF_VOICE_REALTIME ??
      process.env.NEXT_PUBLIC_FF_VOICE_AGENT_ENABLED ??
      "true")
    : "true";
const REALTIME_FLAG_ENABLED =
  REALTIME_FLAG_ENV === "1" ||
  REALTIME_FLAG_ENV === "true" ||
  REALTIME_FLAG_ENV === "yes" ||
  REALTIME_FLAG_ENV === "on";

function friendlyApiMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 400:
        return "Couldn't save your draft right now — your progress is still here. Try submitting again at the end.";
      case 401:
        return "Your session has expired. Please log in again.";
      case 409:
        return "This listing already exists. Check your dashboard.";
      case 422:
        return "Some details look off. Please review your entries and try again.";
      default:
        return "Something went wrong saving your draft. Your progress is preserved — please try again.";
    }
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

export default function OwnerListingWizardPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const { data: nextAuthSession } = useSession();
  const accessToken = nextAuthSession?.accessToken ?? null;
  const userId = nextAuthSession?.user?.id ?? null;
  const userRole = nextAuthSession?.user?.role ?? null;
  const ownerFirstName = nextAuthSession?.user?.name?.split(/\s+/)[0];
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  /* ── Wizard state ──────────────────────────────────────────────── */
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(EMPTY_FORM);
  const [listingId, setListingId] = useState<string | null>(editId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<StepError[]>([]);
  const [pgPath, setPgPath] = useState<PgPath>(null);
  const [salesAssistNotice, setSalesAssistNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /* ── Voice + animation state ───────────────────────────────────── */
  const [voiceActive, setVoiceActive] = useState(false);
  const [aiFillingFields, setAiFillingFields] = useState<Set<string>>(new Set());
  const fillTimers = useRef(new Map<string, number>());
  const seenSteps = useRef<Set<number>>(new Set());

  /* ── Photo uploads ─────────────────────────────────────────────── */
  const [uploads, setUploads] = useState<UploadFile[]>([]);

  /* ─────────────────────────────────────────────────────────────────
     Session-storage draft persistence
     ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (editId) return;
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { form?: WizardForm; step?: number };
      if (parsed.form) setForm(parsed.form);
      if (typeof parsed.step === "number") setStep(parsed.step);
    } catch {
      /* ignore */
    }
  }, [editId]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ form, step, listingId }));
  }, [form, step, listingId]);

  /* ─────────────────────────────────────────────────────────────────
     Edit-mode hydration
     ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!editId) return;
    if (!accessToken) {
      setAuthHint("Login required to edit and submit this listing.");
      return;
    }
    void (async () => {
      try {
        const response = await listOwnerListings(accessToken);
        const found = response.items.find((item) => item.id === editId);
        if (!found) return;
        setForm((prev) => ({
          ...prev,
          title: found.title ?? "",
          listing_type: found.listingType,
          city: found.city ?? "",
          locality: found.locality ?? "",
          monthly_rent: typeof found.monthlyRent === "number" ? String(found.monthlyRent) : ""
        }));
        setListingId(editId);
      } catch {
        /* keep draft editable */
      }
    })();
  }, [editId, accessToken]);

  /* ─────────────────────────────────────────────────────────────────
     PG segmentation
     ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (form.listing_type !== "pg" || !form.beds) {
      setPgPath(null);
      setSalesAssistNotice(null);
      return;
    }
    const beds = Number(form.beds);
    if (!Number.isFinite(beds) || beds <= 0) {
      setPgPath(null);
      return;
    }
    if (!accessToken || userRole !== "pg_operator") {
      setPgPath(beds <= 29 ? "self_serve" : "sales_assist");
      return;
    }
    void segmentPgPath(accessToken, beds)
      .then((result) => {
        setPgPath(result.path);
        trackEvent("pg_segmentation_triggered", { beds, path: result.path });
      })
      .catch(() => setPgPath(beds <= 29 ? "self_serve" : "sales_assist"));
  }, [form.beds, form.listing_type, accessToken, userRole]);

  /* ─────────────────────────────────────────────────────────────────
     Field-fill animation hook
     ───────────────────────────────────────────────────────────────── */
  const flagFieldsAsFilling = useCallback((fields: (keyof WizardForm)[]) => {
    if (fields.length === 0) return;
    setAiFillingFields((prev) => {
      const next = new Set(prev);
      for (const f of fields) next.add(String(f));
      return next;
    });
    for (const f of fields) {
      const key = String(f);
      const existing = fillTimers.current.get(key);
      if (existing) window.clearTimeout(existing);
      const handle = window.setTimeout(() => {
        setAiFillingFields((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        fillTimers.current.delete(key);
      }, 1500);
      fillTimers.current.set(key, handle);
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const handle of fillTimers.current.values()) window.clearTimeout(handle);
      fillTimers.current.clear();
    };
  }, []);

  /* ─────────────────────────────────────────────────────────────────
     Form helpers
     ───────────────────────────────────────────────────────────────── */
  function updateField<K extends keyof WizardForm>(key: K, value: WizardForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStepErrors([]);
  }

  function toggleAmenity(amenity: string) {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter((a) => a !== amenity)
        : [...prev.amenities, amenity]
    }));
    flagFieldsAsFilling(["amenities"]);
  }

  /* ─────────────────────────────────────────────────────────────────
     Voice → form integration
     ───────────────────────────────────────────────────────────────── */
  const handleVoiceFormApply = useCallback(
    (nextForm: WizardForm, animatedFields: (keyof WizardForm)[], _nextStep?: number) => {
      setForm(nextForm);
      flagFieldsAsFilling(animatedFields);
      setStepErrors([]);
    },
    [flagFieldsAsFilling]
  );

  const handleVoiceNavigate = useCallback((nextStep: number, reason?: string) => {
    setStep(nextStep);
    setStepErrors([]);
    if (reason) {
      setToast(reason);
      window.setTimeout(() => setToast(null), 2400);
    }
  }, []);

  const handleVoiceUiAction = useCallback(
    (action: "generate_title" | "request_review" | "summarize") => {
      if (action === "generate_title") {
        if (!accessToken) return;
        void generateListingContent(accessToken, formToGeneratePayload(form))
          .then((result) => {
            typewriterFill("title", result.title);
            setTimeout(() => typewriterFill("description", result.description), 360);
            setStep((s) => Math.max(s, 3));
          })
          .catch(() => {
            /* user can still type */
          });
      } else if (action === "request_review") {
        setStep(5);
      } else if (action === "summarize") {
        setToast("Captured details refreshed in the panel →");
        window.setTimeout(() => setToast(null), 2400);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, form]
  );

  /** Typewriter fill with animation flag — used by AI generate_title. */
  function typewriterFill(field: "title" | "description", value: string) {
    flagFieldsAsFilling([field]);
    let i = 0;
    const tick = () => {
      if (i <= value.length) {
        setForm((prev) => ({ ...prev, [field]: value.slice(0, i) }));
        i++;
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }

  /* ─────────────────────────────────────────────────────────────────
     Draft + submit
     ───────────────────────────────────────────────────────────────── */
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
        landmark: form.landmark || undefined,
        pincode: form.pincode || undefined,
        maskedAddress: form.locality || form.city || undefined
      },
      propertyFields: isPg
        ? undefined
        : {
            bhk: form.bedrooms ? Number(form.bedrooms) : undefined,
            bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
            areaSqft: form.area_sqft ? Number(form.area_sqft) : undefined,
            furnishing: form.furnishing || undefined,
            preferredTenant: (form.preferred_tenant || undefined) as
              | "any"
              | "family"
              | "bachelor"
              | "female"
              | "male"
              | undefined
          },
      pgFields: isPg
        ? {
            totalBeds: form.beds ? Number(form.beds) : undefined,
            roomSharingOptions: form.sharing_type ? [form.sharing_type] : [],
            foodIncluded: form.meals_included,
            attachedBathroom: form.attached_bathroom
          }
        : undefined
    };
  }

  async function saveDraft(): Promise<string | null> {
    if (!accessToken) {
      setAuthHint("Login required to save the draft. You can keep filling the form first.");
      return null;
    }
    setSaving(true);
    setError(null);
    try {
      const input = buildDraftInput();
      if (!listingId) {
        const created = await createOwnerListing(accessToken, input);
        setListingId(created.listingId);
        trackEvent("owner_listing_draft_saved", { listing_id: created.listingId, is_new: true });
        return created.listingId;
      }
      await updateOwnerListing(accessToken, listingId, input);
      trackEvent("owner_listing_draft_saved", { listing_id: listingId, is_new: false });
      return listingId;
    } catch (err) {
      setError(friendlyApiMessage(err));
      if (err instanceof ApiError && err.status === 401) void signOut({ redirect: false });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitListing() {
    if (!accessToken) {
      setError(t(locale, "loginRequired"));
      return;
    }
    // Final validation across all gating fields.
    const allErrors = [
      ...validateStep(0, form),
      ...validateStep(1, form),
      ...validateStep(2, form),
      ...validateStep(3, form)
    ];
    if (allErrors.length > 0) {
      setStepErrors(allErrors);
      const firstField = allErrors[0]?.field;
      const firstStep =
        firstField === "monthly_rent" || firstField === "deposit"
          ? 0
          : firstField === "city"
            ? 1
            : firstField === "title"
              ? 3
              : 2;
      setStep(firstStep);
      setError("Some fields need attention before we can submit.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let draftId = listingId;
      if (!draftId) {
        const created = await createOwnerListing(accessToken, buildDraftInput());
        draftId = created.listingId;
        setListingId(draftId);
      } else {
        await updateOwnerListing(accessToken, draftId, buildDraftInput());
      }
      await submitOwnerListing(accessToken, draftId);
      if (pgPath === "sales_assist") {
        try {
          await createSalesLead(accessToken, {
            source: "pg_sales_assist",
            listingId: draftId,
            notes: "PG onboarding assist requested from listing wizard",
            metadata: {
              total_beds: form.beds ? Number(form.beds) : null,
              listing_type: form.listing_type
            },
            idempotencyKey: `pg-sales-assist:${draftId}`
          });
          setSalesAssistNotice("Sales assist request created. Our team will reach out shortly.");
        } catch {
          setSalesAssistNotice(
            "Listing submitted. Sales assist request couldn't be created automatically."
          );
        }
      }
      trackEvent("owner_listing_submitted", { listing_id: draftId });
      sessionStorage.removeItem(STORAGE_KEY);
      router.push(`/${locale}/owner/dashboard`);
    } catch (err) {
      setError(friendlyApiMessage(err));
      if (err instanceof ApiError && err.status === 401) void signOut({ redirect: false });
    } finally {
      setSaving(false);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     Stepper navigation — clickable + Back / Next buttons
     Validation now fires only on Next (and final submit).
     ───────────────────────────────────────────────────────────────── */
  async function goNext() {
    if (step >= 5) return;
    setAuthHint(null);
    const errs = validateStep(step, form);
    if (errs.length > 0) {
      setStepErrors(errs);
      return;
    }
    setStepErrors([]);

    if (accessToken) {
      const shouldSave = listingId ? step >= 1 : step >= 3;
      if (shouldSave) {
        // Fire the draft save but don't block navigation on failure —
        // the form data is preserved in session storage and the user
        // can still submit at the end. A soft error banner is shown.
        void saveDraft().then((id) => {
          if (id) setListingId(id);
        });
      }
    } else if (step === 0) {
      setAuthHint("You can keep filling the form. Login is needed to save and submit.");
    }
    setStep((s) => s + 1);
    setError(null); // clear any stale banner from previous steps
  }

  function goBack() {
    if (step > 0) {
      setStepErrors([]);
      setStep((s) => s - 1);
    }
  }

  function jumpStep(target: number) {
    if (target === step) return;
    setStepErrors([]);
    setStep(Math.max(0, Math.min(5, target)));
  }

  // Track which steps the owner has visited (drives the "done" dot).
  useEffect(() => {
    seenSteps.current.add(step);
  }, [step]);

  /* ─────────────────────────────────────────────────────────────────
     Photo upload logic (preserved from previous wizard)
     ───────────────────────────────────────────────────────────────── */
  function onFilesSelected(files: FileList | null) {
    if (!files) return;
    setUploads((current) => {
      const existingIds = new Set(current.map((i) => i.clientUploadId));
      const next: UploadFile[] = Array.from(files).map((file) => {
        const id = generateClientUploadId(file);
        const dup = existingIds.has(id);
        return {
          file,
          clientUploadId: id,
          status: dup ? ("error" as const) : ("pending" as const),
          progress: 0,
          previewUrl: URL.createObjectURL(file),
          errorMessage: dup ? "This photo was already uploaded." : undefined
        };
      });
      return [...current, ...next];
    });
  }

  async function uploadFile(
    upload: UploadFile,
    listingIdOverride?: string,
    sortOrder = 0,
    isCover = false
  ) {
    const activeListingId = listingIdOverride ?? listingId;
    if (!accessToken || !activeListingId) {
      setError("Login and save the draft before uploading photos.");
      return;
    }
    setUploads((c) =>
      c.map((i) =>
        i.clientUploadId === upload.clientUploadId
          ? { ...i, status: "uploading" as const, progress: 15 }
          : i
      )
    );
    try {
      const presignResult = await presignListingPhotos(
        accessToken,
        activeListingId,
        [
          {
            clientUploadId: upload.clientUploadId,
            contentType: upload.file.type || "image/jpeg",
            sizeBytes: upload.file.size
          }
        ],
        makeIdempotencyKey("photo-presign")
      );
      const first = presignResult.uploads[0];
      if (!first) throw new Error("Failed to get upload URL");
      setUploads((c) =>
        c.map((i) => (i.clientUploadId === upload.clientUploadId ? { ...i, progress: 45 } : i))
      );

      let uploaded = false;
      const contentType = upload.file.type || "image/jpeg";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const putResponse = await fetch(first.uploadUrl, {
            method: "PUT",
            headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType },
            body: upload.file
          });
          if (putResponse.ok) {
            uploaded = true;
            break;
          }
          const retriable = [408, 429, 500, 502, 503, 504].includes(putResponse.status);
          if (!retriable || attempt === 3) {
            throw new Error(`Photo upload failed (HTTP ${putResponse.status})`);
          }
        } catch (e) {
          if (attempt === 3) {
            if (e instanceof Error) throw e;
            throw new Error("Photo upload failed due to a network error");
          }
        }
      }
      if (!uploaded) throw new Error("Photo upload failed");

      setUploads((c) =>
        c.map((i) => (i.clientUploadId === upload.clientUploadId ? { ...i, progress: 80 } : i))
      );
      await completeListingPhotos(
        accessToken,
        activeListingId,
        [{ clientUploadId: upload.clientUploadId, blobPath: first.blobPath, isCover, sortOrder }],
        makeIdempotencyKey("photo-complete")
      );
      setUploads((c) =>
        c.map((i) =>
          i.clientUploadId === upload.clientUploadId
            ? { ...i, status: "complete" as const, progress: 100, errorMessage: undefined }
            : i
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      const duplicate =
        message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("already");
      setUploads((c) =>
        c.map((i) =>
          i.clientUploadId === upload.clientUploadId
            ? {
                ...i,
                status: "error" as const,
                errorMessage: duplicate ? "This photo was already uploaded." : message
              }
            : i
        )
      );
    }
  }

  async function uploadAllPending() {
    let activeListingId = listingId;
    if (!listingId && accessToken) {
      const id = await saveDraft();
      if (!id) return;
      activeListingId = id;
    }
    const pending = uploads.filter((i) => i.status === "pending");
    const workerCount = Math.min(MAX_PARALLEL_UPLOADS, pending.length);
    if (workerCount === 0) return;

    let cursor = 0;
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < pending.length) {
        const idx = cursor;
        cursor += 1;
        const cur = pending[idx];
        if (!cur) continue;
        await uploadFile(cur, activeListingId ?? undefined, idx, idx === 0);
      }
    });
    await Promise.all(workers);
  }

  function removeUpload(id: string) {
    setUploads((c) => {
      const removed = c.find((i) => i.clientUploadId === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return c.filter((i) => i.clientUploadId !== id);
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     Derived
     ───────────────────────────────────────────────────────────────── */
  const completedSteps = useMemo(() => {
    const set = new Set<number>();
    if (form.monthly_rent.trim()) set.add(0);
    if (form.city.trim()) set.add(1);
    if (form.bedrooms || form.beds || form.area_sqft || form.amenities.length) set.add(2);
    if (form.title.trim().length >= 5) set.add(3);
    if (uploads.some((u) => u.status === "complete")) set.add(4);
    return set;
  }, [form, uploads]);

  const headline = editId ? t(locale, "editListing") : t(locale, "createListing");

  return (
    <section className="wizard-concierge" data-voice-active={voiceActive ? "true" : "false"}>
      <div className="cz-shell">
        <header className="cz-topbar cz-fade cz-fade--1">
          <div>
            <div className="cz-eyebrow">CribLiv · New listing</div>
            <h1 className="cz-title">{editId ? "Refining your listing" : "Create your listing"}</h1>
            <p className="cz-subtitle">
              {voiceActive
                ? "Maya is listening — describe your property and she'll fill in the details."
                : "Fill in the details below, or tap Maya to use voice input."}
            </p>
            <p style={{ marginTop: 4, fontSize: 13, color: "var(--c-text-tertiary)" }}>
              {headline}
            </p>
          </div>
          {REALTIME_FLAG_ENABLED && userId ? (
            <button
              type="button"
              className="cz-voice-toggle"
              data-active={voiceActive ? "true" : "false"}
              onClick={() => {
                setVoiceActive((v) => !v);
                trackEvent(voiceActive ? "voice_realtime_stopped" : "voice_realtime_started");
              }}
            >
              <span className="cz-voice-toggle__dot" />
              {voiceActive ? "End voice" : "Talk to Maya"}
            </button>
          ) : null}
        </header>

        {error ? (
          <div
            role="alert"
            className="cz-banner cz-banner--coral"
            style={{ gridColumn: "1 / -1", justifyContent: "space-between", alignItems: "center" }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                fontSize: 18,
                lineHeight: 1,
                padding: "0 0 0 12px",
                opacity: 0.7
              }}
            >
              ×
            </button>
          </div>
        ) : null}
        {authHint ? (
          <div role="status" className="cz-banner" style={{ gridColumn: "1 / -1" }}>
            {authHint}
          </div>
        ) : null}
        {salesAssistNotice ? (
          <div role="status" className="cz-banner cz-banner--gold" style={{ gridColumn: "1 / -1" }}>
            {salesAssistNotice}
          </div>
        ) : null}
        {toast ? (
          <div role="status" className="cz-banner" style={{ gridColumn: "1 / -1" }}>
            {toast}
          </div>
        ) : null}

        <div className="cz-formcol">
          <WizardStepIndicator
            currentStep={step}
            onStepClick={jumpStep}
            completedSteps={completedSteps}
          />

          {step === 0 ? (
            <BasicsStep
              form={form}
              errors={stepErrors}
              updateField={updateField}
              aiFillingFields={aiFillingFields}
            />
          ) : null}
          {step === 1 ? (
            <LocationStep
              form={form}
              errors={stepErrors}
              updateField={updateField}
              aiFillingFields={aiFillingFields}
            />
          ) : null}
          {step === 2 ? (
            <DetailsStep
              form={form}
              errors={stepErrors}
              pgPath={pgPath}
              updateField={updateField}
              toggleAmenity={toggleAmenity}
              aiFillingFields={aiFillingFields}
            />
          ) : null}
          {step === 3 ? (
            <TitleDescriptionStep
              form={form}
              errors={stepErrors}
              accessToken={accessToken}
              updateField={updateField}
              aiFillingFields={aiFillingFields}
            />
          ) : null}
          {step === 4 ? (
            <PhotosStep
              uploads={uploads}
              saving={saving}
              onFilesSelected={onFilesSelected}
              onUploadAll={uploadAllPending}
              onRemove={removeUpload}
            />
          ) : null}
          {step === 5 ? (
            <ReviewStep form={form} uploads={uploads} pgPath={pgPath} locale={locale} />
          ) : null}

          <div className="cz-nav cz-fade cz-fade--3">
            <button
              type="button"
              className="cz-btn cz-btn--ghost"
              onClick={goBack}
              disabled={step === 0}
            >
              {t(locale, "back")}
            </button>
            {step < 5 ? (
              <button
                type="button"
                className="cz-btn cz-btn--primary"
                onClick={goNext}
                disabled={saving}
              >
                {saving ? "Saving…" : t(locale, "next")}
              </button>
            ) : (
              <button
                type="button"
                className="cz-btn cz-btn--primary"
                onClick={handleSubmitListing}
                disabled={saving}
              >
                {saving ? "Submitting…" : t(locale, "submitForReview")}
              </button>
            )}
          </div>
        </div>

        {REALTIME_FLAG_ENABLED ? (
          <VoiceCoPilot
            form={form}
            step={step}
            accessToken={accessToken}
            locale={locale}
            ownerFirstName={ownerFirstName}
            voiceActive={voiceActive}
            onToggleVoice={(next) => setVoiceActive(next)}
            onFormApply={handleVoiceFormApply}
            onNavigate={handleVoiceNavigate}
            onUiAction={handleVoiceUiAction}
            onChipJump={jumpStep}
          />
        ) : null}
      </div>
    </section>
  );
}

function formToGeneratePayload(form: WizardForm) {
  return {
    listing_type: form.listing_type,
    monthly_rent: form.monthly_rent ? Number(form.monthly_rent) : undefined,
    deposit: form.deposit ? Number(form.deposit) : undefined,
    furnishing: form.furnishing || undefined,
    city: form.city || undefined,
    locality: form.locality || undefined,
    bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
    bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
    area_sqft: form.area_sqft ? Number(form.area_sqft) : undefined,
    amenities: form.amenities.length > 0 ? form.amenities : undefined,
    preferred_tenant: form.preferred_tenant || undefined,
    beds: form.beds ? Number(form.beds) : undefined,
    sharing_type: form.sharing_type || undefined,
    meals_included: form.meals_included || undefined,
    attached_bathroom: form.attached_bathroom || undefined
  };
}
