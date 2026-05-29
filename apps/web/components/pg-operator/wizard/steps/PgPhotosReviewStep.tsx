"use client";
import { Dispatch, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PgWizardState, PgWizardAction, buildSubmitPayload } from "@/lib/pg-wizard-state";
import { createPgListing } from "@/lib/pg-operator-api";
import PgPhotoUploader from "../shared/PgPhotoUploader";

interface Props {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
  accessToken: string | null;
}

export default function PgPhotosReviewStep({ state, dispatch, locale, accessToken }: Props) {
  const router = useRouter();
  const payload = useMemo(() => buildSubmitPayload(state), [state.draft, state.ui]);

  const canSubmit =
    payload.property.display_name.length >= 2 &&
    payload.property.city_slug.length > 0 &&
    payload.pg_details?.total_beds != null &&
    (payload.room_types?.length ?? 0) >= 1;

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
      dispatch({ type: "SUBMIT_OK" });
      sessionStorage.removeItem("pg-wizard-draft-v1");
      router.push(`/${locale}/pg-operator/dashboard?createdListingId=${r.listing_id}` as any);
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
    <section className="pg-step pg-step--photos-review">
      <h2>Photos &amp; Review</h2>
      <PgPhotoUploader />
      <details open>
        <summary>Review (this is what gets submitted)</summary>
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(payload, null, 2)}</pre>
      </details>
      {state.submitError && <p role="alert">{state.submitError}</p>}
      <button type="button" onClick={() => dispatch({ type: "GOTO_STEP", step: 5 })}>
        Back
      </button>
      <button type="button" onClick={handlePublish} disabled={state.submitting || !canSubmit}>
        {state.submitting ? "Publishing…" : "Publish"}
      </button>
    </section>
  );
}
