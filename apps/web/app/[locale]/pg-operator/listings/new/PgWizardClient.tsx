"use client";
import { useReducer, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgStepIndicator from "@/components/pg-operator/wizard/PgStepIndicator";
import PgPropertyBasicsStep from "@/components/pg-operator/wizard/steps/PgPropertyBasicsStep";
import PgLocationStep from "@/components/pg-operator/wizard/steps/PgLocationStep";
import PgRoomsPricingStep from "@/components/pg-operator/wizard/steps/PgRoomsPricingStep";
import PgAmenitiesFoodStep from "@/components/pg-operator/wizard/steps/PgAmenitiesFoodStep";
import PgRulesAgreementStep from "@/components/pg-operator/wizard/steps/PgRulesAgreementStep";
import PgPhotosStep from "@/components/pg-operator/wizard/steps/PgPhotosStep";
import PgReviewStep from "@/components/pg-operator/wizard/steps/PgReviewStep";
import PgWizardShell from "@/components/pg-operator/wizard/PgWizardShell";
import PgCaptureEntry from "./PgCaptureEntry";
import { sanitizePartialDraft, draftToPayload } from "@/lib/pg-wizard-sanitizer";
import PgScoreMeter from "@/components/pg-operator/wizard/shared/PgScoreMeter";
import {
  STEP_META as PG_STEP_META,
  nextStep,
  prevStep,
  validatePgStep,
  type PgStep
} from "@/lib/pg-wizard-steps";
import wiz from "@/components/pg-operator/wizard/shared/pg-wizard.module.css";
import {
  putPgDraft,
  getPgDraft,
  getPgListingEditPayload,
  getPgListingDetail
} from "@/lib/pg-operator-api";
import { trackPgFunnel, setPgFunnelToken } from "@/lib/pg-funnel";
import { setPgVoiceToken } from "@/lib/pg-voice-socket";
import {
  PgFieldHighlightProvider,
  pgFieldToStep
} from "@/components/pg-operator/voice/PgFieldHighlightContext";
import { pgFieldLabel } from "@/components/pg-operator/voice/PgFieldConfirmCard";

const PgVoiceOrb = dynamic(() => import("@/components/pg-operator/voice/PgVoiceOrb"), {
  ssr: false
});

// Voice-first flow is browser-only (Socket.IO + mic) — load client-side.
const PgVoiceListingFlow = dynamic(() => import("./PgVoiceListingFlow"), { ssr: false });

const STORAGE_KEY = "pg-wizard-draft-v1";

// Required fields the operator still needs to fill — powers the admin
// missing-field heatmap (emitted as metadata.missing on step_completed).
function missingRequiredFields(draft: any): string[] {
  const p = draft?.property ?? {};
  const d = draft?.pg_details ?? {};
  const rooms = draft?.room_types ?? [];
  const m: string[] = [];
  if (!p.display_name || String(p.display_name).length < 2) m.push("display_name");
  if (!p.city_slug) m.push("city_slug");
  if (p.lat == null || p.lng == null) m.push("location_pin");
  if (!d.gender_policy) m.push("gender_policy");
  if (!d.tenant_type) m.push("tenant_type");
  if (!((d.security_deposit_paise ?? 0) > 0)) m.push("security_deposit");
  if (!Array.isArray(rooms) || rooms.length < 1) m.push("room_types");
  if (!d.house_rules || Object.keys(d.house_rules ?? {}).length === 0) m.push("house_rules");
  if (!d.amenities || Object.values(d.amenities ?? {}).filter(Boolean).length === 0)
    m.push("amenities");
  if (!d.meals) m.push("meals");
  return m;
}

interface Props {
  locale: string;
  draftId?: string;
  /** BUG-M1: when set, the wizard hydrates this committed listing and saves via PUT. */
  editListingId?: string;
  accessToken: string | null;
  operatorUserId: string | null;
  existingPgPropertyId?: string | null;
  existingPropertySeed?: { display_name?: string; city_slug?: string; locality_slug?: string };
}

export default function PgWizardClient({
  locale,
  draftId: draftIdProp,
  editListingId,
  accessToken,
  operatorUserId,
  existingPgPropertyId,
  existingPropertySeed
}: Props) {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  const [showWizard, setShowWizard] = useState<boolean>(
    !!(draftIdProp || existingPgPropertyId || editListingId)
  );
  const [voiceMode, setVoiceMode] = useState(false);
  // True while the edit-mode API calls are in flight — prevents blank-field flash.
  const [editHydrating, setEditHydrating] = useState<boolean>(!!editListingId);
  // In edit mode, the committed admin-verification + real geo state — so the score
  // meter matches the dashboard instead of fabricating "unverified" + no-geo.
  const [editMeta, setEditMeta] = useState<{
    verification_status: "unverified" | "pending" | "verified";
    has_exact_geo: boolean;
  } | null>(null);
  // Field the inline voice co-pilot just filled — surfaced as a transient
  // "jump to step" chip so the operator sees what changed.
  const [highlightedField, setHighlightedField] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightedField) return;
    const t = setTimeout(() => setHighlightedField(null), 6000);
    return () => clearTimeout(t);
  }, [highlightedField]);

  // Voice→manual handoff: a ?step=review deep-link (from PgVoiceListingFlow) jumps
  // straight to the final Review step so the operator confirms + submits.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const step = new URLSearchParams(window.location.search).get("step");
    if (step === "review") {
      setShowWizard(true);
      dispatch({ type: "GOTO_STEP", step: 7 });
    }
  }, []);

  // Hydrate sessionStorage + draft id + existing property
  useEffect(() => {
    // Edit mode hydrates from the committed listing (separate effect below); never
    // merge a leftover new-listing draft from sessionStorage into an edit.
    if (editListingId) return;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          draft: any;
          ui: any;
          savedAt?: number;
          draftId?: string;
        };
        if (parsed.draft) dispatch({ type: "MERGE_DRAFT", partial: parsed.draft });
        if (parsed.ui?.sharing_options)
          dispatch({
            type: "SET_UI_FIELD",
            path: "sharing_options",
            value: parsed.ui.sharing_options
          });
        // Restore the existing draft id so autosave UPDATES the same row instead
        // of INSERTing a new one on every reload/remount (duplicate-draft bug).
        if (!draftIdProp && parsed.draftId)
          dispatch({ type: "SET_DRAFT_ID", draftId: parsed.draftId });
      }
      if (draftIdProp) dispatch({ type: "SET_DRAFT_ID", draftId: draftIdProp });
      if (existingPgPropertyId) {
        dispatch({ type: "SET_PG_PROPERTY_ID", pgPropertyId: existingPgPropertyId });
        if (existingPropertySeed) {
          if (existingPropertySeed.display_name)
            dispatch({
              type: "SET_FIELD",
              path: "property.display_name",
              value: existingPropertySeed.display_name
            });
          if (existingPropertySeed.city_slug)
            dispatch({
              type: "SET_FIELD",
              path: "property.city_slug",
              value: existingPropertySeed.city_slug
            });
          if (existingPropertySeed.locality_slug)
            dispatch({
              type: "SET_FIELD",
              path: "property.locality_slug",
              value: existingPropertySeed.locality_slug
            });
        }
      }
    } catch {}
  }, [draftIdProp, existingPgPropertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // BUG-M1: edit mode — hydrate the committed listing (fields + existing photos)
  // and save via PUT. No pg_listing_drafts row is touched (autosave is guarded off
  // below). Photos mirror the owner edit flow: existing photos are seeded as
  // `complete` so they render, count toward the minimum, and are reordered (not
  // re-uploaded) on save.
  useEffect(() => {
    if (!editListingId || !accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const [payload, detail] = await Promise.all([
          getPgListingEditPayload(editListingId, accessToken),
          getPgListingDetail(editListingId, accessToken)
        ]);
        if (cancelled) return;
        dispatch({ type: "MERGE_DRAFT", partial: payload as any });
        if (!cancelled && detail) {
          // 'failed' verification must not score as verified → treat as unverified.
          const v =
            detail.verification_status === "verified"
              ? "verified"
              : detail.verification_status === "pending"
                ? "pending"
                : "unverified";
          setEditMeta({ verification_status: v, has_exact_geo: detail.has_exact_geo });
        }
        const items = detail?.photoItems ?? [];
        if (!cancelled && items.length > 0) {
          dispatch({
            type: "HYDRATE_PHOTOS",
            photos: items
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((it) => ({
                clientUploadId: `existing-${it.id}`,
                file: new File([], "existing-photo"),
                previewUrl: it.url,
                sizeBytes: 0,
                contentType: "image/jpeg",
                sortOrder: it.sort_order,
                isCover: it.is_cover,
                status: "complete" as const,
                photoId: it.id,
                blobPath: it.blob_path
              }))
          });
        }
      } catch {
        /* keep wizard usable even if the edit read fails */
      } finally {
        if (!cancelled) {
          setEditHydrating(false);
          setShowWizard(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editListingId, accessToken]);

  // Resume from server draft if draftId prop provided
  useEffect(() => {
    if (!draftIdProp || !accessToken) return;
    getPgDraft(accessToken, draftIdProp)
      .then((serverDraft) => {
        if (!serverDraft) return;
        // Compare server draft with session storage; prefer newer
        try {
          const saved = sessionStorage.getItem(STORAGE_KEY);
          const parsed = saved ? (JSON.parse(saved) as { savedAt?: number }) : null;
          const sessionNewer =
            parsed?.savedAt != null && new Date(serverDraft.updated_at).getTime() < parsed.savedAt;
          if (!sessionNewer) {
            dispatch({
              type: "HYDRATE_DRAFT",
              draftId: draftIdProp,
              payload: serverDraft.payload as any
            });
          }
        } catch {
          dispatch({
            type: "HYDRATE_DRAFT",
            draftId: draftIdProp,
            payload: serverDraft.payload as any
          });
        }
        setShowWizard(true);
      })
      .catch(() => {
        setShowWizard(true);
      });
  }, [draftIdProp, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // SessionStorage autosave
  useEffect(() => {
    if (editListingId) return; // editing a committed listing — don't persist a draft
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          draft: state.draft,
          ui: state.ui,
          draftId: state.draftId,
          savedAt: Date.now()
        })
      );
    } catch {}
  }, [state.draft, state.ui, state.draftId]);

  // Register the access token so funnel events (incl. deep step components and
  // unload-time abandon) authenticate against the Bearer-guarded ingest endpoint.
  useEffect(() => {
    setPgFunnelToken(accessToken);
    // Also authenticate the voice co-pilot socket handshake (SEC-C2).
    setPgVoiceToken(accessToken);
  }, [accessToken]);

  // Live mirror of draftId for callbacks that fire between renders (autosave
  // race, funnel events). Updated synchronously on first create so concurrent
  // saves reuse the id instead of spawning duplicate draft rows.
  const draftIdRef = useRef<string | undefined>(state.draftId);
  useEffect(() => {
    draftIdRef.current = state.draftId;
  }, [state.draftId]);

  // Server autosave (debounced 1500ms). Guards against concurrent creates: a
  // slow PUT must not let the next debounce tick spawn a second draft.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const savingRef = useRef(false);
  useEffect(() => {
    if (!accessToken) return;
    if (editListingId) return; // BUG-M1: edit mode never writes pg_listing_drafts
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      if (savingRef.current) return; // a save is already in flight
      const payload = sanitizePartialDraft(state.draft) as any;
      // Only persist a draft once the operator has named the listing. Gating on
      // the per-listing title (not the pre-seeded building name) stops a blank,
      // building-named draft from being created the moment the wizard opens.
      if (!payload.title) return;
      savingRef.current = true;
      try {
        const res = await putPgDraft(accessToken, {
          draft_id: draftIdRef.current,
          payload,
          source: "manual"
        });
        if (!draftIdRef.current) {
          draftIdRef.current = res.draft_id; // sync first so the next tick reuses it
          dispatch({ type: "SET_DRAFT_ID", draftId: res.draft_id });
        }
        void trackPgFunnel({ event_type: "draft_saved", source: "manual", draft_id: res.draft_id });
      } catch {
        /* offline / partial tolerated */
      } finally {
        savingRef.current = false;
      }
    }, 1500);
    return () => clearTimeout(autosaveTimer.current);
  }, [state.draft, accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // wizard_started — fire once when the wizard becomes visible, regardless of
  // entry path (entry chooser, existing property, or resumed draft). This is the
  // conversion denominator; the entry-chooser-only emission missed most sessions.
  const startedRef = useRef(false);
  useEffect(() => {
    if (showWizard && !startedRef.current && accessToken) {
      startedRef.current = true;
      void trackPgFunnel({
        event_type: "wizard_started",
        source: "manual",
        draft_id: draftIdRef.current
      });
    }
  }, [showWizard, accessToken]);

  // step_completed — on forward navigation, tagged with the still-missing fields
  // (powers the funnel step breakdown + the missing-field heatmap).
  const prevStepRef = useRef(state.currentStep);
  useEffect(() => {
    const prev = prevStepRef.current;
    if (state.currentStep > prev && accessToken) {
      void trackPgFunnel({
        event_type: "step_completed",
        source: "manual",
        step_no: prev,
        draft_id: draftIdRef.current,
        metadata: { missing: missingRequiredFields(state.draft) }
      });
    }
    prevStepRef.current = state.currentStep;
  }, [state.currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abandon event on unload. trackPgFunnel uses fetch keepalive (+ the registered
  // Bearer token) so the event flushes authenticated at unload — no orphan Next
  // route, no token-less sendBeacon.
  useEffect(() => {
    const handler = () => {
      if (state.submitting || !state.draft.property?.display_name) return;
      void trackPgFunnel({ event_type: "abandoned", source: "manual", draft_id: state.draftId });
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.submitting, state.draft.property?.display_name, state.draftId]);

  // Voice-first flow (entry chooser "Talk to list", gated by the env flag).
  if (voiceMode) {
    return (
      <PgVoiceListingFlow
        userId={operatorUserId ?? "anonymous"}
        accessToken={accessToken}
        locale={locale === "hi" ? "hi" : "en"}
      />
    );
  }

  // Loading skeleton while edit-mode API calls are in flight.
  if (editHydrating) {
    return (
      <div
        data-testid="edit-loading-skeleton"
        style={{ padding: "2rem", opacity: 0.5, textAlign: "center" }}
      >
        Loading listing…
      </div>
    );
  }

  // Show entry chooser first (for new listings without a draft)
  if (!showWizard) {
    return (
      <PgCaptureEntry
        onManual={() => {
          // wizard_started is emitted by the once-on-show effect (covers all
          // entry paths), so we just reveal the wizard here.
          setShowWizard(true);
        }}
        onVoice={() => setVoiceMode(true)}
      />
    );
  }

  const step = state.currentStep as PgStep;
  const meta = PG_STEP_META[step] ?? PG_STEP_META[1];
  const baseProps = { state, dispatch, locale };
  const check = validatePgStep(step, state.draft, state.pendingPhotos?.length ?? 0);

  return (
    <PgFieldHighlightProvider value={{ field: highlightedField, setField: setHighlightedField }}>
      <div className={wiz.wizardPage}>
        <PgWizardShell
          step={step}
          footerPrimary={step === 7 ? "none" : "next"}
          saving={!!state.submitting}
          nextDisabled={!check.ok}
          hint={check.hint}
          onNext={() => dispatch({ type: "GOTO_STEP", step: nextStep(step) })}
          onBack={() => dispatch({ type: "GOTO_STEP", step: prevStep(step) })}
          onSubmit={() => {}}
          indicator={
            <PgStepIndicator
              current={step}
              onJump={(s) => dispatch({ type: "GOTO_STEP", step: s })}
            />
          }
          rail={
            <>
              <div className={wiz.voiceCard}>
                <div className={wiz.voiceCardHead}>
                  <div>
                    <div className={wiz.voiceCardName}>Maya</div>
                    <div className={wiz.voiceCardRole}>your listing concierge</div>
                  </div>
                  <span className={wiz.voiceCardStatus}>ready</span>
                </div>
                <PgVoiceOrb
                  state={state}
                  dispatch={dispatch}
                  locale={locale}
                  userId={operatorUserId}
                />
              </div>
              <PgScoreMeter
                payload={draftToPayload(state.draft)}
                signals={{
                  // In edit mode, use the listing's committed verification + geo so the
                  // meter matches the dashboard (no false "verify"/"pin" prompts).
                  verification_status: editMeta?.verification_status ?? "unverified",
                  has_exact_geo: editMeta?.has_exact_geo || state.draft.property?.lat != null,
                  photo_count: state.pendingPhotos.length
                }}
                onGoToStep={(s) => dispatch({ type: "GOTO_STEP", step: s })}
              />
            </>
          }
        >
          <header className={wiz.hero}>
            <span className={wiz.heroEyebrow}>Cribliv · New listing</span>
            <h1 className={wiz.heroTitle}>Create your PG listing</h1>
            <p className={wiz.heroSub}>
              Fill the essentials below, or tap the orb to talk it through. Most operators finish in
              under 5 minutes.
            </p>
          </header>

          {highlightedField && (
            <button
              type="button"
              className={wiz.jumpChip}
              onClick={() => {
                dispatch({ type: "GOTO_STEP", step: pgFieldToStep(highlightedField) });
                setHighlightedField(null);
              }}
            >
              <span aria-hidden="true">✓</span>
              <span>
                Voice filled <strong>{pgFieldLabel(highlightedField)}</strong>, jump to step{" "}
                {pgFieldToStep(highlightedField)}
              </span>
            </button>
          )}

          <header className={wiz.stepHeader}>
            <h1 className={wiz.stepHeaderTitle}>{meta.title}</h1>
            <p className={wiz.stepHeaderDesc}>
              {meta.desc} <span className={wiz.stepHeaderMeta}>· ~{meta.minutes} min</span>
            </p>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            >
              {step === 1 && <PgPropertyBasicsStep {...baseProps} accessToken={accessToken} />}
              {step === 2 && <PgLocationStep {...baseProps} accessToken={accessToken} />}
              {step === 3 && <PgRoomsPricingStep {...baseProps} />}
              {step === 4 && <PgAmenitiesFoodStep {...baseProps} />}
              {step === 5 && <PgRulesAgreementStep {...baseProps} />}
              {step === 6 && <PgPhotosStep {...baseProps} accessToken={accessToken} />}
              {step === 7 && (
                <PgReviewStep
                  {...baseProps}
                  accessToken={accessToken}
                  editListingId={editListingId}
                  editMeta={editMeta}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </PgWizardShell>
      </div>
    </PgFieldHighlightProvider>
  );
}
