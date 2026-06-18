"use client";
import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { PG_STEP_ORDER, STEP_META, type PgStep } from "@/lib/pg-wizard-steps";
import styles from "./shared/pg-wizard.module.css";

// Screen-reader-only: convey wizard progress to AT without altering the visual
// step-pill design (the redesign dropped the old visible progressbar).
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0
};

export default function PgStepIndicator({
  current,
  onJump
}: {
  current: PgStep;
  onJump?: (step: PgStep) => void;
}) {
  const total = PG_STEP_ORDER.length;
  const progress = Math.round(((current - 1) / total) * 100);
  return (
    <nav className={styles.steps} aria-label="Wizard progress">
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`Step ${current} of ${total}`}
        style={SR_ONLY}
      />
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
