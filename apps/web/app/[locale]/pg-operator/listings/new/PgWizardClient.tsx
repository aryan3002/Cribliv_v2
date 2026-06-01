"use client";
import { useReducer, useEffect } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
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

const STEP_META: Record<number, { title: string; desc: string }> = {
  1: {
    title: "Property & Identity",
    desc: "Tell us about your PG — name, location, and basic setup."
  },
  2: { title: "Rooms & Pricing", desc: "Configure room types, monthly rent, and availability." },
  3: { title: "Payment Terms", desc: "Set deposit, notice period, and accepted payment methods." },
  4: { title: "House Rules", desc: "Define the rules tenants need to follow." },
  5: { title: "Amenities & Food", desc: "Select facilities and meal options you offer." },
  6: { title: "Photos & Review", desc: "Add photos and review everything before publishing." }
};

interface Props {
  locale: string;
  draftId?: string;
  accessToken: string | null;
  /** Real UUID of the logged-in operator. Threaded down to PgVoiceOrb → socket
   *  handshake so the gateway can FK into users(id) when persisting sessions. */
  operatorUserId: string | null;
  /** From server-side getMe(): set when operator already has a property. */
  existingPgPropertyId?: string | null;
  /** From server-side getMe(): pre-populate property block. */
  existingPropertySeed?: { display_name?: string; city_slug?: string; locality_slug?: string };
}

export default function PgWizardClient({
  locale,
  draftId,
  accessToken,
  operatorUserId,
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

  const meta = STEP_META[state.currentStep];
  const baseProps = { state, dispatch, locale };

  return (
    <main className="pgo-page">
      <div className="pgo-glass pgo-glass--lg" style={{ position: "relative" }}>
        <PgStepIndicator current={state.currentStep} />

        {/* Step header */}
        <motion.div
          key={`header-${state.currentStep}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ marginBottom: 32 }}
        >
          <h1 className="pgo-heading pgo-heading--lg">{meta.title}</h1>
          <p className="pgo-desc" style={{ marginTop: 4 }}>
            {meta.desc}
          </p>
        </motion.div>

        {/* Steps with cross-fade */}
        <AnimatePresence mode="wait">
          <motion.div
            key={state.currentStep}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          >
            {state.currentStep === 1 && (
              <PgPropertyBasicsStep {...baseProps} accessToken={accessToken} />
            )}
            {state.currentStep === 2 && <PgRoomsPricingStep {...baseProps} />}
            {state.currentStep === 3 && <PgPaymentStep {...baseProps} />}
            {state.currentStep === 4 && <PgRulesStep {...baseProps} />}
            {state.currentStep === 5 && <PgAmenitiesFoodStep {...baseProps} />}
            {state.currentStep === 6 && (
              <PgPhotosReviewStep {...baseProps} accessToken={accessToken} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <PgVoiceOrb state={state} dispatch={dispatch} locale={locale} userId={operatorUserId} />
    </main>
  );
}
