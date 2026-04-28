"use client";

import { Fragment } from "react";
import { STEPS } from "./types";

interface Props {
  currentStep: number;
  onStepClick?: (step: number) => void;
  /** Optional set of step indices that already have content (drives the "done" dot styling). */
  completedSteps?: Set<number>;
}

/**
 * Concierge stepper — six gold-leaf dots connected by hairline rules.
 * Each dot is a real button: validation now lives on submit, not on
 * navigation, so the owner (or Maya via `navigate_to_step`) can hop to
 * any stage at any time.
 */
export function WizardStepIndicator({ currentStep, onStepClick, completedSteps }: Props) {
  return (
    <nav className="cz-stepper" aria-label="Listing progress">
      {STEPS.map((label, index) => {
        const isActive = index === currentStep;
        const isDone = completedSteps?.has(index) ?? index < currentStep;
        const cls = `cz-step${isActive ? " cz-step--active" : ""}${
          isDone && !isActive ? " cz-step--done" : ""
        }`;
        return (
          <Fragment key={label}>
            <button
              type="button"
              className={cls}
              onClick={() => onStepClick?.(index)}
              aria-current={isActive ? "step" : undefined}
              aria-label={`Step ${index + 1}: ${label}`}
            >
              <span className="cz-step__num">{toRoman(index + 1)}</span>
              <span className="cz-step__dot" aria-hidden />
              <span className="cz-step__label">{label}</span>
            </button>
            {index < STEPS.length - 1 ? <span className="cz-step__rule" aria-hidden /> : null}
          </Fragment>
        );
      })}
    </nav>
  );
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"]
  ];
  let out = "";
  let val = n;
  for (const [v, s] of map) {
    while (val >= v) {
      out += s;
      val -= v;
    }
  }
  return out;
}
