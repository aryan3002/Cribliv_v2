"use client";
import { Dispatch, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { trackPgFunnel } from "@/lib/pg-funnel";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Rocket, Code } from "lucide-react";
import { PgWizardState, PgWizardAction, buildSubmitPayload } from "@/lib/pg-wizard-state";
import { createPgListing } from "@/lib/pg-operator-api";
import { presignListingPhotos, completeListingPhotos } from "@/lib/owner-api";
import PgPhotoUploader from "../shared/PgPhotoUploader";

function makeIdemKey(prefix: string): string {
  const r =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}-${r}`;
}

/** PUT a single Blob to an Azure SAS URL, with 3-attempt retry on retriable codes.
 *  Mirrors `apps/web/app/[locale]/owner/listings/new/page.tsx:608` so behaviour
 *  stays consistent across owner / pg_operator listing flows. */
async function putToAzure(uploadUrl: string, file: File): Promise<void> {
  const contentType = file.type || "image/jpeg";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType },
        body: file
      });
      if (res.ok) return;
      const retriable = [408, 429, 500, 502, 503, 504].includes(res.status);
      if (!retriable || attempt === 3) {
        throw new Error(`Photo upload failed (HTTP ${res.status})`);
      }
    } catch (e) {
      if (attempt === 3) throw e instanceof Error ? e : new Error("Photo upload failed");
    }
  }
}

interface Props {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
  accessToken: string | null;
}

const MIN_PHOTOS = 4;

export default function PgPhotosReviewStep({ state, dispatch, locale, accessToken }: Props) {
  const router = useRouter();
  const payload = useMemo(() => buildSubmitPayload(state), [state.draft, state.ui]);

  const totalPhotos = state.pendingPhotos?.length ?? 0;
  const photosOk = totalPhotos >= MIN_PHOTOS;
  const photosNeeded = Math.max(0, MIN_PHOTOS - totalPhotos);

  // photos_added — fire once the 4-photo minimum is reached, carrying the count
  // (the admin "avg photos" metric reads metadata.photo_count).
  const photosAddedRef = useRef(false);
  useEffect(() => {
    if (totalPhotos >= MIN_PHOTOS && !photosAddedRef.current) {
      photosAddedRef.current = true;
      void trackPgFunnel({
        event_type: "photos_added",
        source: "manual",
        step_no: 7,
        draft_id: state.draftId,
        metadata: { photo_count: totalPhotos }
      });
    }
  }, [totalPhotos, state.draftId]);

  const canSubmit =
    payload.property.display_name.length >= 2 &&
    payload.property.city_slug.length > 0 &&
    payload.pg_details?.total_beds != null &&
    (payload.room_types?.length ?? 0) >= 1 &&
    photosOk;

  const handlePublish = async () => {
    if (!accessToken) {
      dispatch({ type: "SUBMIT_FAIL", error: "Sign in required to publish." });
      return;
    }
    if (!canSubmit) {
      dispatch({
        type: "SUBMIT_FAIL",
        error: "Some required fields are missing or invalid. Go back and check earlier steps."
      });
      return;
    }
    dispatch({ type: "SUBMIT_BEGIN" });
    const key = state.idempotencyKey ?? crypto.randomUUID();
    try {
      const r = await createPgListing({
        idempotencyKey: key,
        payload,
        token: accessToken
      });

      // Phase 2: photos. The listing must exist (we need listing_id for SAS scope),
      // so this runs AFTER createPgListing. Photo upload failures are logged but
      // don't roll back the listing — the operator can re-upload from the dashboard.
      const pending = state.pendingPhotos ?? [];
      if (pending.length > 0) {
        try {
          const sorted = pending.slice().sort((a, b) => a.sortOrder - b.sortOrder);
          const presign = await presignListingPhotos(
            accessToken,
            r.listing_id,
            sorted.map((p) => ({
              clientUploadId: p.clientUploadId,
              contentType: p.contentType,
              sizeBytes: p.sizeBytes
            })),
            makeIdemKey("pg-photo-presign")
          );

          const byId = new Map(presign.uploads.map((u) => [u.clientUploadId, u]));
          await Promise.all(
            sorted.map(async (p) => {
              const u = byId.get(p.clientUploadId);
              if (!u) throw new Error(`No upload URL for ${p.clientUploadId}`);
              await putToAzure(u.uploadUrl, p.file);
            })
          );

          await completeListingPhotos(
            accessToken,
            r.listing_id,
            sorted.map((p) => {
              const u = byId.get(p.clientUploadId);
              return {
                clientUploadId: p.clientUploadId,
                blobPath: u?.blobPath ?? "",
                isCover: p.isCover,
                sortOrder: p.sortOrder
              };
            }),
            makeIdemKey("pg-photo-complete")
          );

          dispatch({ type: "CLEAR_PHOTOS" });
        } catch (photoErr) {
          // Listing already created — surface but don't fail the whole flow.
          console.error("[pg-wizard] photo upload failed post-create:", photoErr);
          dispatch({
            type: "SUBMIT_FAIL",
            error: "Listing was created but photo upload failed. Add photos from your dashboard."
          });
          router.push(
            `/${locale}/pg-operator/listings/${r.listing_id}?published=1&photoError=1` as any
          );
          return;
        }
      }

      dispatch({ type: "SUBMIT_OK" });
      sessionStorage.removeItem("pg-wizard-draft-v1");
      void trackPgFunnel({
        event_type: "submitted",
        source: "manual",
        listing_id: r.listing_id,
        draft_id: state.draftId,
        metadata: { photo_count: state.pendingPhotos?.length ?? 0 }
      });
      router.push(`/${locale}/pg-operator/listings/${r.listing_id}?published=1` as any);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "no_property") {
        dispatch({
          type: "SUBMIT_FAIL",
          error: "No property found on your account. Go back to Step 1 and create it."
        });
      } else {
        dispatch({ type: "SUBMIT_FAIL", error: err.message });
      }
    }
  };

  return (
    <section>
      <PgPhotoUploader state={state} dispatch={dispatch} />

      {/* Review summary */}
      <div className="pgo-review-grid">
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Property</div>
          <div className="pgo-review-item__value">{payload.property.display_name || "—"}</div>
        </div>
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">City</div>
          <div className="pgo-review-item__value">{payload.property.city_slug || "—"}</div>
        </div>
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Total Beds</div>
          <div className="pgo-review-item__value">{payload.pg_details?.total_beds ?? "—"}</div>
        </div>
        <div className="pgo-review-item">
          <div className="pgo-review-item__label">Room Types</div>
          <div className="pgo-review-item__value">{payload.room_types?.length ?? 0} configured</div>
        </div>
        {payload.pg_details?.gender_policy && (
          <div className="pgo-review-item">
            <div className="pgo-review-item__label">Gender</div>
            <div className="pgo-review-item__value" style={{ textTransform: "capitalize" }}>
              {payload.pg_details.gender_policy}
            </div>
          </div>
        )}
        {payload.pg_details?.meals?.provided && (
          <div className="pgo-review-item">
            <div className="pgo-review-item__label">Meals</div>
            <div className="pgo-review-item__value">Provided</div>
          </div>
        )}
      </div>

      {/* Debug payload */}
      <details className="pgo-collapsible" style={{ marginTop: 24 }}>
        <summary>
          <Code size={14} />
          Review payload (debug)
        </summary>
        <div className="pgo-collapsible__body">
          <pre className="pgo-collapsible__code">{JSON.stringify(payload, null, 2)}</pre>
        </div>
      </details>

      {state.submitError && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pgo-error-msg"
          role="alert"
        >
          {state.submitError}
        </motion.p>
      )}

      {!photosOk && (
        <p
          className="pgo-caption"
          style={{ color: "var(--pgo-warning, #f59e0b)", marginBottom: 8 }}
        >
          Add {photosNeeded} more photo{photosNeeded === 1 ? "" : "s"} — 4 required
        </p>
      )}

      <div className="pgo-step-nav">
        <button
          className="pgo-btn pgo-btn--secondary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 6 })}
        >
          Back
        </button>
        <button
          className="pgo-btn pgo-btn--primary pgo-btn--lg"
          type="button"
          onClick={handlePublish}
          disabled={state.submitting || !canSubmit}
        >
          {state.submitting ? (
            <>
              Publishing
              <span className="pgo-loading-dots">
                <span />
                <span />
                <span />
              </span>
            </>
          ) : (
            <>Publish Listing</>
          )}
        </button>
      </div>
    </section>
  );
}
