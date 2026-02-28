"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { trackEvent } from "../../../../../lib/analytics";
import { t, type Locale } from "../../../../../lib/i18n";
import {
  completeListingPhotos,
  createSalesLead,
  createOwnerListing,
  extractOwnerListingFromAudio,
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
  type CaptureMode,
  type RecorderState,
  type PgPath,
  type UploadFile,
  type StepError,
  type OwnerDraftPayloadSnakeCase,
  type OwnerListingCaptureExtractResponse,
  STEPS,
  EMPTY_FORM,
  cloneCaptureDraft,
  applyCaptureDraftToForm,
  resolveWizardStepForForm,
  generateClientUploadId,
  validateStep
} from "../../../../../components/listing-wizard";

import { CaptureEntry } from "../../../../../components/listing-wizard/CaptureEntry";
import { VoiceRecordingPanel } from "../../../../../components/listing-wizard/VoiceRecordingPanel";
import { CaptureConfirmation } from "../../../../../components/listing-wizard/CaptureConfirmation";
import { WizardStepIndicator } from "../../../../../components/listing-wizard/WizardStepIndicator";
import { BasicsStep } from "../../../../../components/listing-wizard/BasicsStep";
import { LocationStep } from "../../../../../components/listing-wizard/LocationStep";
import { DetailsStep } from "../../../../../components/listing-wizard/DetailsStep";
import { PhotosStep } from "../../../../../components/listing-wizard/PhotosStep";
import { ReviewStep } from "../../../../../components/listing-wizard/ReviewStep";

const STORAGE_KEY = "cribliv:wizard-draft";

export default function OwnerListingWizardPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const { data: nextAuthSession } = useSession();
  const accessToken = nextAuthSession?.accessToken ?? null;
  const userRole = nextAuthSession?.user?.role ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  /* ——— Core wizard state ——— */
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(EMPTY_FORM);
  const [listingId, setListingId] = useState<string | null>(editId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [pgPath, setPgPath] = useState<PgPath>(null);
  const [salesAssistNotice, setSalesAssistNotice] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<StepError[]>([]);

  /* ——— Photo upload state ——— */
  const [uploads, setUploads] = useState<UploadFile[]>([]);

  /* ——— Capture / voice state ——— */
  const [captureMode, setCaptureMode] = useState<CaptureMode>(editId ? "wizard" : "entry");
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [captureSeconds, setCaptureSeconds] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureResult, setCaptureResult] = useState<OwnerListingCaptureExtractResponse | null>(
    null
  );
  const [captureDraft, setCaptureDraft] = useState<Partial<OwnerDraftPayloadSnakeCase> | null>(
    null
  );

  /* ——— Refs ——— */
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ================================================================
     Session-storage draft persistence
     ================================================================ */
  useEffect(() => {
    // Only restore draft when editing an existing listing.
    // For new listings we always start fresh to avoid stale listingIds
    // from a previous session causing "Listing not found" on save.
    if (editId) return;
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { form?: WizardForm; step?: number; listingId?: string };
      // Only restore if we have a matching listingId (same session draft continuity).
      // Discard listingId if it looks stale (no editId in URL = fresh listing).
      if (parsed.form) setForm(parsed.form);
      if (typeof parsed.step === "number") setStep(parsed.step);
      // Do NOT restore listingId for new listings — avoids "Listing not found"
      // when a previous draft's ID no longer exists.
    } catch {
      /* ignore */
    }
  }, [editId]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ form, step, listingId }));
  }, [form, step, listingId]);

  /* ================================================================
     Load existing listing for edit
     ================================================================ */
  useEffect(() => {
    if (!editId) return;
    const token = accessToken;
    if (!token) {
      setAuthHint("Login required to edit and submit this listing.");
      return;
    }
    void (async () => {
      try {
        const response = await listOwnerListings(token);
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
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ================================================================
     Cleanup recorder on unmount
     ================================================================ */
  useEffect(() => {
    return () => {
      if (recorderTimerRef.current) clearInterval(recorderTimerRef.current);
      recorderRef.current?.stop();
      recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /* ================================================================
     PG segmentation
     ================================================================ */
  useEffect(() => {
    if (form.listing_type !== "pg" || !form.beds) {
      setPgPath(null);
      setSalesAssistNotice(null);
      return;
    }
    const beds = Number(form.beds);
    if (!Number.isFinite(beds) || beds <= 0) {
      setPgPath(null);
      setSalesAssistNotice(null);
      return;
    }
    const token = accessToken;
    if (!token || userRole !== "pg_operator") {
      setPgPath(beds <= 29 ? "self_serve" : "sales_assist");
      return;
    }
    void segmentPgPath(token, beds)
      .then((result) => {
        setPgPath(result.path);
        trackEvent("pg_segmentation_triggered", { beds, path: result.path });
      })
      .catch(() => setPgPath(beds <= 29 ? "self_serve" : "sales_assist"));
  }, [form.beds, form.listing_type]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ================================================================
     Recorder helpers
     ================================================================ */
  function clearRecorderTimer() {
    if (recorderTimerRef.current) {
      clearInterval(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
  }

  function stopRecorderStream() {
    recorderStreamRef.current?.getTracks().forEach((t) => t.stop());
    recorderStreamRef.current = null;
  }

  function enterManualWizard(reason?: string) {
    if (reason) trackEvent("owner_listing_manual_fallback", { reason });
    setCaptureMode("wizard");
    setRecorderState("idle");
    setCaptureError(null);
  }

  async function processCapturedAudio(audioBlob: Blob) {
    const token = accessToken;
    if (!token) {
      setCaptureError("Login required to use assisted capture. Continue with manual form.");
      trackEvent("owner_listing_capture_abandoned", { stage: "extraction", fields_filled: 0 });
      return;
    }
    setRecorderState("processing");
    setCaptureError(null);
    try {
      const result = await extractOwnerListingFromAudio(token, {
        audio: audioBlob,
        locale: locale === "hi" ? "hi-IN" : "en-IN",
        listingTypeHint: form.listing_type
      });
      setCaptureResult(result);
      setCaptureDraft(cloneCaptureDraft(result.draft_suggestion));
      setCaptureMode("assisted_confirmation");
      setRecorderState("idle");
      trackEvent("owner_listing_extraction_completed", {
        field_count: Object.keys(result.field_confidence_tier ?? {}).length,
        confirm_count: result.confirm_fields.length,
        missing_required: result.missing_required_fields.length
      });
    } catch (err) {
      const isSttError =
        err instanceof ApiError && (err.code === "stt_failed" || err.code === "stt_unavailable");

      if (isSttError) {
        // Azure Speech couldn't transcribe — auto-switch to manual wizard.
        setRecorderState("idle");
        setCaptureError("Voice capture unavailable — switching to manual form.");
        trackEvent("owner_listing_capture_abandoned", {
          stage: "stt_fallback",
          code: (err as ApiError).code
        });
        // Brief delay so user sees the message, then switch to manual form
        setTimeout(() => {
          enterManualWizard("stt_failed");
        }, 1200);
      } else {
        const message = err instanceof Error ? err.message : "Failed to process voice capture";
        setCaptureError(message);
        setRecorderState("idle");
        trackEvent("owner_listing_capture_abandoned", { stage: "extraction", fields_filled: 0 });
      }
    }
  }

  async function startVoiceCapture() {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setCaptureError("Voice capture is not supported in this browser.");
      enterManualWizard("browser_unsupported");
      return;
    }
    setCaptureError(null);
    setCaptureSeconds(0);
    setRecorderState("recording");
    setCaptureMode("voice_recording");
    trackEvent("owner_listing_capture_started", { method: "voice" });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderStreamRef.current = stream;
      recorderChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : undefined;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        clearRecorderTimer();
        const audioBlob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });
        stopRecorderStream();
        recorderRef.current = null;
        void processCapturedAudio(audioBlob);
      };
      recorder.start(250);
      recorderTimerRef.current = setInterval(() => {
        setCaptureSeconds((prev) => {
          const next = prev + 1;
          if (next >= 60) recorderRef.current?.stop();
          return Math.min(next, 60);
        });
      }, 1000);
    } catch (err) {
      clearRecorderTimer();
      stopRecorderStream();
      recorderRef.current = null;
      setRecorderState("idle");
      setCaptureMode("entry");
      setCaptureError(
        err instanceof Error ? err.message : "Microphone permission denied. Continue manually."
      );
      trackEvent("owner_listing_manual_fallback", { reason: "permission_denied" });
    }
  }

  function stopVoiceCapture() {
    if (recorderState !== "recording") return;
    clearRecorderTimer();
    recorderRef.current?.stop();
    trackEvent("owner_listing_recording_completed", { duration_sec: captureSeconds });
  }

  function continueFromCapture() {
    if (!captureDraft || !captureResult) return;
    const updatedForm = applyCaptureDraftToForm(form, captureDraft);
    setForm(updatedForm);
    setStep(resolveWizardStepForForm(updatedForm));
    setCaptureMode("wizard");
    trackEvent("owner_listing_capture_completed", {
      total_time_sec: captureSeconds,
      field_fill_rate: Object.keys(captureResult.field_confidence_tier ?? {}).length
    });
  }

  /* ================================================================
     Form helpers
     ================================================================ */
  function updateField<K extends keyof WizardForm>(key: K, value: WizardForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStepErrors([]); // clear step errors on edit
  }

  function toggleAmenity(amenity: string) {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter((a) => a !== amenity)
        : [...prev.amenities, amenity]
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

  /* ================================================================
     Draft save / submit
     ================================================================ */
  async function saveDraft(): Promise<string | null> {
    const token = accessToken;
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
      if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setError(message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitListing() {
    const token = accessToken;
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
      if (pgPath === "sales_assist") {
        try {
          await createSalesLead(token, {
            source: "pg_sales_assist",
            listingId: draftId,
            notes: "PG onboarding assist requested from listing wizard",
            metadata: {
              total_beds: form.beds ? Number(form.beds) : null,
              listing_type: form.listing_type
            },
            idempotencyKey: `pg-sales-assist:${draftId}`
          });
          setSalesAssistNotice("Sales assist request created. Our team will contact you shortly.");
          trackEvent("pg_sales_assist_requested", {
            listing_id: draftId,
            total_beds: form.beds ? Number(form.beds) : null
          });
        } catch (leadError) {
          console.error("Failed to create PG sales assist lead", leadError);
          setSalesAssistNotice(
            "Listing submitted. Sales assist request could not be created automatically."
          );
        }
      }
      trackEvent("owner_listing_submitted", { listing_id: draftId });
      sessionStorage.removeItem(STORAGE_KEY);
      router.push(`/${locale}/owner/dashboard`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit listing";
      if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  /* ================================================================
     Navigation
     ================================================================ */
  async function goNext() {
    if (step >= 4) return;
    setAuthHint(null);

    // Per-step validation
    const errors = validateStep(step, form);
    if (errors.length > 0) {
      setStepErrors(errors);
      return;
    }
    setStepErrors([]);

    const token = accessToken;
    if (token) {
      // Always save when moving forward from step 1+.
      // This handles the capture flow where the wizard can jump
      // directly to step 2 before a listing has ever been created
      // (listingId === null), so we can't gate on listingId.
      if (step >= 1) {
        const savedId = await saveDraft();
        if (!savedId) return;
      }
    } else if (step === 0) {
      setAuthHint("You can keep filling the form. Login is needed to save and submit.");
    }

    setStep((c) => c + 1);
  }

  function goBack() {
    if (step > 0) {
      setStepErrors([]);
      setStep((c) => c - 1);
    }
  }

  /* ================================================================
     Photo upload logic
     ================================================================ */
  function onFilesSelected(files: FileList | null) {
    if (!files) return;
    setUploads((current) => {
      const existingIds = new Set(current.map((i) => i.clientUploadId));
      const nextUploads: UploadFile[] = Array.from(files).map((file) => {
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
      return [...current, ...nextUploads];
    });
  }

  async function uploadFile(upload: UploadFile) {
    const token = accessToken;
    if (!token || !listingId) {
      setError("Login and save draft before uploading photos.");
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
      const first = presignResult.uploads[0];
      if (!first) throw new Error("Failed to get upload URL");
      setUploads((c) =>
        c.map((i) => (i.clientUploadId === upload.clientUploadId ? { ...i, progress: 70 } : i))
      );
      await completeListingPhotos(
        token,
        listingId,
        [
          {
            clientUploadId: upload.clientUploadId,
            blobPath: first.blobPath,
            isCover: false,
            sortOrder: 0
          }
        ],
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
    // Auto-save draft first if no listing yet (creates listing ID for photo association)
    if (!listingId && accessToken) {
      const savedId = await saveDraft();
      if (!savedId) return;
    }
    for (const upload of uploads.filter((i) => i.status === "pending")) {
      await uploadFile(upload);
    }
  }

  function removeUpload(clientUploadId: string) {
    setUploads((c) => {
      const removed = c.find((i) => i.clientUploadId === clientUploadId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return c.filter((i) => i.clientUploadId !== clientUploadId);
    });
  }

  /* ================================================================
     Derived state
     ================================================================ */
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

  /* ================================================================
     Render
     ================================================================ */
  return (
    <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
      <h1>{editId ? t(locale, "editListing") : t(locale, "createListing")}</h1>

      {error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : null}
      {authHint ? (
        <div className="card" role="status">
          <p className="caption" style={{ margin: 0 }}>
            {authHint}
          </p>
        </div>
      ) : null}
      {salesAssistNotice ? (
        <div className="card" role="status">
          <p className="caption" style={{ margin: 0 }}>
            {salesAssistNotice}
          </p>
        </div>
      ) : null}

      {/* ——— Capture screens ——— */}
      {captureMode === "entry" ? (
        <CaptureEntry
          onDescribe={startVoiceCapture}
          onManual={() => enterManualWizard("user_preference")}
          error={captureError}
        />
      ) : null}

      {captureMode === "voice_recording" ? (
        <VoiceRecordingPanel
          seconds={captureSeconds}
          isProcessing={recorderState === "processing"}
          onStop={stopVoiceCapture}
          onManual={() => enterManualWizard("user_cancelled")}
          error={captureError}
        />
      ) : null}

      {captureMode === "assisted_confirmation" && captureResult && captureDraft ? (
        <CaptureConfirmation
          captureResult={captureResult}
          draft={captureDraft}
          onDraftChange={(d) => setCaptureDraft(d)}
          onContinue={continueFromCapture}
          onReRecord={() => setCaptureMode("entry")}
        />
      ) : null}

      {/* ——— Wizard form ——— */}
      {captureMode === "wizard" ? (
        <>
          <WizardStepIndicator currentStep={step} />

          <div className="card">
            {step === 0 ? (
              <BasicsStep form={form} errors={stepErrors} updateField={updateField} />
            ) : null}
            {step === 1 ? (
              <LocationStep form={form} errors={stepErrors} updateField={updateField} />
            ) : null}
            {step === 2 ? (
              <DetailsStep
                form={form}
                errors={stepErrors}
                pgPath={pgPath}
                updateField={updateField}
                toggleAmenity={toggleAmenity}
              />
            ) : null}
            {step === 3 ? (
              <PhotosStep
                uploads={uploads}
                saving={saving}
                onFilesSelected={onFilesSelected}
                onUploadAll={uploadAllPending}
                onRemove={removeUpload}
              />
            ) : null}
            {step === 4 ? (
              <ReviewStep form={form} uploads={uploads} pgPath={pgPath} locale={locale} />
            ) : null}
          </div>

          <div className="wizard-nav">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={goBack}
              disabled={step === 0}
            >
              {t(locale, "back")}
            </button>

            {step < 4 ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={goNext}
                disabled={saving || !canProceed}
              >
                {saving ? "Saving..." : t(locale, "next")}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSubmitListing}
                disabled={saving}
              >
                {saving ? "Submitting..." : t(locale, "submitForReview")}
              </button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
