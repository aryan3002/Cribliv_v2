"use client";

import { Fragment } from "react";
import { STEPS } from "./types";

interface Props {
  currentStep: number;
  onStepClick?: (step: number) => void;
  completedSteps?: Set<number>;
}

export function WizardStepIndicator({ currentStep, onStepClick, completedSteps }: Props) {
  const progress = Math.round((currentStep / (STEPS.length - 1)) * 100);
  return (
    <nav className="cz-stepper" aria-label="Listing progress">
      <div className="cz-progress-track">
        <div className="cz-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="cz-step-labels">
        {STEPS.map((label, index) => {
          const isActive = index === currentStep;
          const isDone = completedSteps?.has(index) ?? index < currentStep;
          const cls = `cz-step${isActive ? " cz-step--active" : ""}${
            isDone && !isActive ? " cz-step--done" : ""
          }`;
          return (
            <button
              key={label}
              type="button"
              className={cls}
              onClick={() => onStepClick?.(index)}
              aria-current={isActive ? "step" : undefined}
              aria-label={`Step ${index + 1}: ${label}`}
            >
              <span className="cz-step__num">{index + 1}</span>
              <span className="cz-step__label">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
