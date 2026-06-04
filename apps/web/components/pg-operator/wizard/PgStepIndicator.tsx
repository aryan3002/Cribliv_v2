"use client";
import { Check } from "lucide-react";
import { PG_STEP_ORDER, STEP_META, type PgStep } from "@/lib/pg-wizard-steps";
import styles from "./shared/pg-wizard.module.css";

export default function PgStepIndicator({
  current,
  onJump
}: {
  current: PgStep;
  onJump?: (step: PgStep) => void;
}) {
  return (
    <nav className={styles.steps} aria-label="Wizard progress">
      {PG_STEP_ORDER.map((num) => {
        const isActive = current === num;
        const isDone = current > num;
        const cls = `${styles.stepPill} ${
          isActive ? styles.stepPillActive : isDone ? styles.stepPillDone : ""
        }`;
        return (
          <button
            key={num}
            type="button"
            className={cls}
            aria-current={isActive ? "step" : undefined}
            disabled={!isDone && !isActive}
            onClick={() => onJump?.(num)}
          >
            <span className={styles.stepDot}>
              {isDone ? <Check size={12} strokeWidth={3} /> : num}
            </span>
            {STEP_META[num].label}
          </button>
        );
      })}
    </nav>
  );
}
