import { STEPS } from "./types";

interface Props {
  currentStep: number;
}

export function WizardStepIndicator({ currentStep }: Props) {
  return (
    <nav className="wizard-steps" aria-label="Wizard progress">
      {STEPS.map((label, index) => (
        <div
          key={label}
          className={`wizard-step${
            index === currentStep
              ? " wizard-step--active"
              : index < currentStep
                ? " wizard-step--done"
                : ""
          }`}
          aria-current={index === currentStep ? "step" : undefined}
        >
          {label}
        </div>
      ))}
    </nav>
  );
}
