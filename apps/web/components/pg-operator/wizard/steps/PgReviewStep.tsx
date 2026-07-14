"use client";
import { Dispatch, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Building2,
  MapPin,
  BedDouble,
  UtensilsCrossed,
  ScrollText,
  Camera,
  Pencil,
  CheckCircle2
} from "lucide-react";
import { trackPgFunnel } from "@/lib/pg-funnel";
import { PgWizardState, PgWizardAction, buildSubmitPayload } from "@/lib/pg-wizard-state";
import { createPgListing, updatePgListing, submitPgListing } from "@/lib/pg-operator-api";
import { presignListingPhotos, completeListingPhotos, reorderListingPhotos } from "@/lib/owner-api";
import PgScoreMeter from "../shared/PgScoreMeter";
import SectionCard from "../shared/SectionCard";
import { draftToPayload } from "@/lib/pg-wizard-sanitizer";
import styles from "../shared/pg-wizard.module.css";

function makeIdemKey(prefix: string): string {
  const r =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}-${r}`;
}

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
      if (!retriable || attempt === 3) throw new Error(`Photo upload failed (HTTP ${res.status})`);
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
  /** BUG-M1: when set, submit edits this committed listing (PUT) instead of creating. */
  editListingId?: string;
  /** Edit mode: committed verification + geo so the score meter matches the dashboard. */
  editMeta?: {
    verification_status: "unverified" | "pending" | "verified";
    has_exact_geo: boolean;
  } | null;
}

const MIN_PHOTOS = 4;
const GENDER: Record<string, string> = { boys: "Boys", girls: "Girls", coed: "Co-ed" };
const TENANT: Record<string, string> = { students: "Students", working: "Working", any: "Any" };
const ELEC: Record<string, string> = {
  flat: "Flat",
  submetered: "Sub-metered",
  split_equally: "Split equally"
};

function titleCase(s?: string | null) {
  if (!s) return "-";
  return s
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function rupees(paise?: number | null) {
  return paise && paise > 0 ? `₹${Math.round(paise / 100).toLocaleString("en-IN")}` : "-";
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.reviewRow}>
      <span className={styles.reviewLabel}>{label}</span>
      <span className={styles.reviewVal}>{children}</span>
    </div>
  );
}

export default function PgReviewStep({
  state,
  dispatch,
  locale,
  accessToken,
  editListingId,
  editMeta
}: Props) {
  const router = useRouter();
  const payload = useMemo(() => buildSubmitPayload(state), [state.draft, state.ui]);
  const d = (state.draft.pg_details ?? {}) as any;
  const p = (state.draft.property ?? {}) as any;
  const rooms = state.draft.room_types ?? [];
  const r = (d.house_rules ?? {}) as Record<string, unknown>;
  const photos = state.pendingPhotos ?? [];
  const totalPhotos = photos.length;
  const photosOk = totalPhotos >= MIN_PHOTOS;
  const photosNeeded = Math.max(0, MIN_PHOTOS - totalPhotos);
  const goto = (s: 1 | 2 | 3 | 4 | 5 | 6 | 7) => dispatch({ type: "GOTO_STEP", step: s });
  const Edit = ({ step }: { step: 1 | 2 | 3 | 4 | 5 | 6 | 7 }) => (
    <button type="button" className={styles.editBtn} onClick={() => goto(step)}>
      <Pencil size={12} /> Edit
    </button>
  );

  const allowed = ["smoking", "alcohol", "non_veg", "pets", "cooking_in_room"]
    .filter((k) => r[k] === true)
    .map((k) => titleCase(k));
  const amenityCount = Object.values(d.amenities ?? {}).reduce(
    (n: number, a: any) => n + (Array.isArray(a) ? a.length : 0),
    0
  );

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
    (payload.title?.trim().length ?? 0) >= 2 &&
    payload.property.display_name.length >= 2 &&
    payload.property.city_slug.length > 0 &&
    payload.pg_details?.total_beds != null &&
    (payload.room_types?.length ?? 0) >= 1 &&
    photosOk;

  const handleSubmit = async () => {
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

    // BUG-M1 edit branch: save back to the SAME listing (PUT). Mirrors the owner
    // photo flow — upload ONLY new photos, then reorder the full set to honor the
    // grid order + cover; existing photos are reused, never re-uploaded.
    if (editListingId) {
      try {
        await updatePgListing({
          id: editListingId,
          idempotencyKey: key,
          payload,
          token: accessToken
        });
        const ordered = (state.pendingPhotos ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const fresh = ordered.filter((p) => !p.photoId);
        const photoIdByClient = new Map<string, string>();
        ordered.forEach((p) => {
          if (p.photoId) photoIdByClient.set(p.clientUploadId, p.photoId);
        });
        if (fresh.length > 0) {
          const presign = await presignListingPhotos(
            accessToken,
            editListingId,
            fresh.map((p) => ({
              clientUploadId: p.clientUploadId,
              contentType: p.contentType,
              sizeBytes: p.sizeBytes
            })),
            makeIdemKey("pg-photo-presign")
          );
          const byId = new Map(presign.uploads.map((u) => [u.clientUploadId, u]));
          await Promise.all(
            fresh.map(async (p) => {
              const u = byId.get(p.clientUploadId);
              if (!u) throw new Error(`No upload URL for ${p.clientUploadId}`);
              await putToAzure(u.uploadUrl, p.file);
            })
          );
          const completion = await completeListingPhotos(
            accessToken,
            editListingId,
            fresh.map((p) => ({
              clientUploadId: p.clientUploadId,
              blobPath: byId.get(p.clientUploadId)?.blobPath ?? "",
              isCover: p.isCover,
              sortOrder: ordered.indexOf(p)
            })),
            makeIdemKey("pg-photo-complete")
          );
          fresh.forEach((p, i) => {
            const id = completion.photoIds[i];
            if (id) photoIdByClient.set(p.clientUploadId, id);
          });
        }
        const persisted = ordered
          .map((p) => photoIdByClient.get(p.clientUploadId))
          .filter((id): id is string => !!id);
        if (persisted.length >= 2) {
          await reorderListingPhotos(
            accessToken,
            editListingId,
            persisted.map((photoId, idx) => ({ photoId, sortOrder: idx, isCover: idx === 0 })),
            makeIdemKey("pg-photo-reorder")
          );
        }
        dispatch({ type: "SUBMIT_OK" });
        void trackPgFunnel({
          event_type: "submitted",
          source: "manual",
          listing_id: editListingId,
          draft_id: state.draftId,
          metadata: { photo_count: ordered.length }
        });
        router.push(`/${locale}/pg-operator/listings/${editListingId}?updated=1` as any);
      } catch (e) {
        const err = e as Error & { code?: string };
        dispatch({ type: "SUBMIT_FAIL", error: err.message });
      }
      return;
    }

    try {
      const res = await createPgListing({ idempotencyKey: key, payload, token: accessToken });
      const pending = state.pendingPhotos ?? [];
      if (pending.length > 0) {
        try {
          const sorted = pending.slice().sort((a, b) => a.sortOrder - b.sortOrder);
          const presign = await presignListingPhotos(
            accessToken,
            res.listing_id,
            sorted.map((pp) => ({
              clientUploadId: pp.clientUploadId,
              contentType: pp.contentType,
              sizeBytes: pp.sizeBytes
            })),
            makeIdemKey("pg-photo-presign")
          );
          const byId = new Map(presign.uploads.map((u) => [u.clientUploadId, u]));
          await Promise.all(
            sorted.map(async (pp) => {
              const u = byId.get(pp.clientUploadId);
              if (!u) throw new Error(`No upload URL for ${pp.clientUploadId}`);
              await putToAzure(u.uploadUrl, pp.file);
            })
          );
          await completeListingPhotos(
            accessToken,
            res.listing_id,
            sorted.map((pp) => {
              const u = byId.get(pp.clientUploadId);
              return {
                clientUploadId: pp.clientUploadId,
                blobPath: u?.blobPath ?? "",
                isCover: pp.isCover,
                sortOrder: pp.sortOrder
              };
            }),
            makeIdemKey("pg-photo-complete")
          );
          dispatch({ type: "CLEAR_PHOTOS" });
        } catch (photoErr) {
          console.error("[pg-wizard] photo upload failed post-create:", photoErr);
          dispatch({
            type: "SUBMIT_FAIL",
            error:
              "Saved as a draft, but the photos didn't upload. Open the listing to add photos and submit for review."
          });
          // The listing was created as a DRAFT (NOT submitted for review), so it is
          // not stranded in the admin queue. Clear the autosaved draft so the next
          // "new listing" starts blank (else it restores this data: BUG-3).
          sessionStorage.removeItem("pg-wizard-draft-v1");
          router.push(
            `/${locale}/pg-operator/listings/${res.listing_id}?draft=1&photoError=1` as any
          );
          return;
        }
      }
      // Photos are attached — NOW transition the draft to pending_review. Doing
      // this AFTER the upload guarantees a listing never enters the admin review
      // queue without its photos (the root cause of the strand-in-review bug).
      try {
        await submitPgListing(res.listing_id, accessToken ?? undefined);
      } catch (submitErr) {
        console.error("[pg-wizard] submit-for-review failed:", submitErr);
        dispatch({
          type: "SUBMIT_FAIL",
          error:
            "Your listing and photos were saved as a draft, but submitting for review failed. Open the listing and submit again."
        });
        sessionStorage.removeItem("pg-wizard-draft-v1");
        router.push(`/${locale}/pg-operator/listings/${res.listing_id}?draft=1` as any);
        return;
      }
      dispatch({ type: "SUBMIT_OK" });
      sessionStorage.removeItem("pg-wizard-draft-v1");
      void trackPgFunnel({
        event_type: "submitted",
        source: "manual",
        listing_id: res.listing_id,
        draft_id: state.draftId,
        metadata: { photo_count: totalPhotos }
      });
      router.push(`/${locale}/pg-operator/listings/${res.listing_id}?published=1` as any);
    } catch (e) {
      const err = e as Error & { code?: string };
      dispatch({
        type: "SUBMIT_FAIL",
        error:
          err.code === "no_property"
            ? "No property found on your account. Go back to Step 1 and create it."
            : err.message
      });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionCard title="Basics" icon={<Building2 size={20} />} action={<Edit step={1} />}>
        <div className={styles.reviewRows}>
          <Row label="Listing title">{payload.title || "-"}</Row>
          <Row label="Property name">{p.display_name || "-"}</Row>
          <Row label="For">{GENDER[d.gender_policy] ?? "-"}</Row>
          <Row label="Tenant type">{TENANT[d.tenant_type] ?? "-"}</Row>
          <Row label="Total beds">{d.total_beds ?? "-"}</Row>
        </div>
      </SectionCard>

      <SectionCard title="Location" icon={<MapPin size={20} />} action={<Edit step={2} />}>
        <div className={styles.reviewRows}>
          <Row label="City">{titleCase(p.city_slug)}</Row>
          <Row label="Locality">{titleCase(p.locality_slug)}</Row>
          {p.formatted_address && <Row label="Address">{p.formatted_address}</Row>}
        </div>
      </SectionCard>

      <SectionCard
        title="Rooms & pricing"
        icon={<BedDouble size={20} />}
        action={<Edit step={3} />}
      >
        <div className={styles.reviewRows}>
          {rooms.length === 0 && <Row label="Rooms">None added</Row>}
          {rooms.map((rt: any, i: number) => (
            <Row key={i} label={`${titleCase(rt.sharing)} ${rt.ac ? "· AC" : "· Non-AC"}`}>
              {rupees(rt.monthly_rent_paise)}/mo · {rt.vacancy_count ?? 0} vac
            </Row>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Food & amenities"
        icon={<UtensilsCrossed size={20} />}
        action={<Edit step={4} />}
      >
        <div className={styles.reviewRows}>
          <Row label="Food">
            {d.meals?.provided ? (d.meals?.veg_only ? "Veg only" : "Provided") : "Not provided"}
          </Row>
          <Row label="Amenities">{amenityCount > 0 ? `${amenityCount} selected` : "-"}</Row>
        </div>
      </SectionCard>

      <SectionCard
        title="Rules & agreement"
        icon={<ScrollText size={20} />}
        action={<Edit step={5} />}
      >
        <div className={styles.reviewRows}>
          <Row label="Allowed">
            {allowed.length ? (
              <span className={styles.reviewChips}>
                {allowed.map((a) => (
                  <span key={a} className={styles.previewBadge}>
                    {a}
                  </span>
                ))}
              </span>
            ) : (
              "Strict"
            )}
          </Row>
          <Row label="Security deposit">{rupees(d.security_deposit_paise)}</Row>
          <Row label="Notice period">
            {d.notice_period_days != null ? `${d.notice_period_days} days` : "-"}
          </Row>
          <Row label="Electricity">{ELEC[d.electricity_mode] ?? "-"}</Row>
        </div>
      </SectionCard>

      <SectionCard title="Photos" icon={<Camera size={20} />} action={<Edit step={6} />}>
        {totalPhotos > 0 ? (
          <div className={styles.reviewThumbs}>
            {photos.slice(0, 8).map((ph) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={ph.clientUploadId}
                src={ph.previewUrl}
                alt=""
                className={styles.reviewThumb}
              />
            ))}
          </div>
        ) : (
          <div className={styles.reviewRows}>
            <Row label="Photos">None added</Row>
          </div>
        )}
      </SectionCard>

      <PgScoreMeter
        payload={draftToPayload(state.draft)}
        signals={{
          // Edit mode: use the listing's committed verification + geo so the meter
          // matches the dashboard score (no false "verify"/"pin" prompts).
          verification_status: editMeta?.verification_status ?? "unverified",
          has_exact_geo: editMeta?.has_exact_geo || state.draft.property?.lat != null,
          photo_count: totalPhotos
        }}
        onGoToStep={(s) => goto(s)}
      />

      <div className={styles.submitBar}>
        {state.submitError && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={styles.submitError}
            role="alert"
          >
            {state.submitError}
          </motion.p>
        )}
        {!photosOk && (
          <p className={styles.submitWarn}>
            Add {photosNeeded} more photo{photosNeeded === 1 ? "" : "s"} to publish (4 required).
          </p>
        )}
        <button
          type="button"
          className={styles.submitBtn}
          onClick={handleSubmit}
          disabled={state.submitting || !canSubmit}
        >
          <CheckCircle2 size={18} />
          {state.submitting ? "Submitting…" : "Submit for review"}
        </button>
        <p className={styles.submitNote}>
          By submitting, you agree to Cribliv&apos;s PG operator terms.
        </p>
      </div>
    </div>
  );
}
