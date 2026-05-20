"use client";
import { Step1Form } from "./steps/Step1Form";
import { Step2Form } from "./steps/Step2Form";
import { Step3Form } from "./steps/Step3Form";
import { Step4Form } from "./steps/Step4Form";
import { Step5Form } from "./steps/Step5Form";
import { Step6Form } from "./steps/Step6Form";
import { Step7Form } from "./steps/Step7Form";

export interface StepFormProps {
  step: number;
  agreementId: string;
  onSubmit: (payload: unknown) => Promise<void>;
  busy?: boolean;
}

/**
 * Renders the real form for a given wizard step. Each Step{N}Form owns its
 * own fields + Zod validation; this dispatcher just picks the right one.
 */
export function StepForm({ step, agreementId, onSubmit, busy }: StepFormProps) {
  const props = { agreementId, onSubmit, busy };
  switch (step) {
    case 1:
      return <Step1Form {...props} />;
    case 2:
      return <Step2Form {...props} />;
    case 3:
      return <Step3Form {...props} />;
    case 4:
      return <Step4Form {...props} />;
    case 5:
      return <Step5Form {...props} />;
    case 6:
      return <Step6Form {...props} />;
    case 7:
      return <Step7Form {...props} />;
    default:
      return <p className="text-red-700">Unknown step: {step}</p>;
  }
}
