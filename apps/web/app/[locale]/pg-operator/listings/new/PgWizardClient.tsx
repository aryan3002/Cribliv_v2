"use client";
import { useReducer, useEffect } from "react";
import dynamic from "next/dynamic";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgStepIndicator from "@/components/pg-operator/wizard/PgStepIndicator";
import PgPropertyBasicsStep from "@/components/pg-operator/wizard/steps/PgPropertyBasicsStep";
import PgRoomsPricingStep from "@/components/pg-operator/wizard/steps/PgRoomsPricingStep";
import PgPaymentStep from "@/components/pg-operator/wizard/steps/PgPaymentStep";
import PgRulesStep from "@/components/pg-operator/wizard/steps/PgRulesStep";
import PgAmenitiesFoodStep from "@/components/pg-operator/wizard/steps/PgAmenitiesFoodStep";
import PgPhotosReviewStep from "@/components/pg-operator/wizard/steps/PgPhotosReviewStep";

const PgVoiceOrb = dynamic(() => import("@/components/pg-operator/voice/PgVoiceOrb"), {
  ssr: false
});

const STORAGE_KEY = "pg-wizard-draft-v1";

interface Props {
  locale: string;
  draftId?: string;
  accessToken: string | null;
  /** From server-side getMe(): set when operator already has a property. */
  existingPgPropertyId?: string | null;
  /** From server-side getMe(): pre-populate property block. */
  existingPropertySeed?: { display_name?: string; city_slug?: string; locality_slug?: string };
}

export default function PgWizardClient({
  locale,
  draftId,
  accessToken,
  existingPgPropertyId,
  existingPropertySeed
}: Props) {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());

  // Hydrate sessionStorage + draft id + existing property
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.draft) dispatch({ type: "MERGE_DRAFT", partial: parsed.draft });
        if (parsed.ui?.sharing_options)
          dispatch({
            type: "SET_UI_FIELD",
            path: "sharing_options",
            value: parsed.ui.sharing_options
          });
      }
      if (draftId) dispatch({ type: "SET_DRAFT_ID", draftId });
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
  }, [draftId, existingPgPropertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ draft: state.draft, ui: state.ui }));
    } catch {}
  }, [state.draft, state.ui]);

  const baseProps = { state, dispatch, locale };
  return (
    <main className="pg-wizard">
      <PgStepIndicator current={state.currentStep} />
      {state.currentStep === 1 && <PgPropertyBasicsStep {...baseProps} accessToken={accessToken} />}
      {state.currentStep === 2 && <PgRoomsPricingStep {...baseProps} />}
      {state.currentStep === 3 && <PgPaymentStep {...baseProps} />}
      {state.currentStep === 4 && <PgRulesStep {...baseProps} />}
      {state.currentStep === 5 && <PgAmenitiesFoodStep {...baseProps} />}
      {state.currentStep === 6 && <PgPhotosReviewStep {...baseProps} accessToken={accessToken} />}
      <PgVoiceOrb state={state} dispatch={dispatch} locale={locale} />
    </main>
  );
}
