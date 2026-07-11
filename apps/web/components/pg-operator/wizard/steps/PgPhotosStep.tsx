"use client";
import { Dispatch } from "react";
import { Camera } from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import PgPhotoUploader from "../shared/PgPhotoUploader";
import SectionCard from "../shared/SectionCard";

interface Props {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
  accessToken: string | null;
}

export default function PgPhotosStep({ state, dispatch }: Props) {
  return (
    <SectionCard
      title="Photos"
      subtitle="Add at least 4 clear photos. Listings with photos get 3× more interest."
      icon={<Camera size={20} />}
    >
      <PgPhotoUploader state={state} dispatch={dispatch} />
    </SectionCard>
  );
}
