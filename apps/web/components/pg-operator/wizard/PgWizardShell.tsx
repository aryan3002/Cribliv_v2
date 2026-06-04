"use client";
import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { PgStep } from "@/lib/pg-wizard-steps";
import styles from "./shared/pg-wizard.module.css";

export default function PgWizardShell({
  step,
  children,
  indicator,
  rail,
  onNext,
  onBack,
  onSubmit,
  saving,
  footerPrimary,
  nextDisabled = false,
  hint
}: {
  step: PgStep;
  children: ReactNode;
  indicator: ReactNode;
  rail: ReactNode;
  onNext: () => void;
  onBack: () => void;
  onSubmit: () => void;
  saving: boolean;
  /** Which primary action to show. Defaults to "submit" on step 7, "next" otherwise.
   *  Pass "none" when the step owns its own submit button (e.g. PgReviewStep). */
  footerPrimary?: "next" | "submit" | "none";
  /** When true, the Next action is blocked and the hint is revealed on attempt. */
  nextDisabled?: boolean;
  /** Friendly message describing what's still required this step. */
  hint?: string;
}) {
  const primary = footerPrimary ?? (step === 7 ? "submit" : "next");
  const [showHint, setShowHint] = useState(false);

  const handleNext = () => {
    if (nextDisabled) {
      setShowHint(true);
      return;
    }
    setShowHint(false);
    onNext();
  };

  return (
    <div className={styles.shell}>
      <div className={styles.formCol}>
        {indicator}
        {children}
        <div className={styles.footer}>
          {showHint && nextDisabled && hint && <p className={styles.footerHint}>{hint}</p>}
          <div className={styles.footerRow}>
            <button type="button" className={styles.navBtn} onClick={onBack} disabled={step === 1}>
              <ArrowLeft size={16} /> Back
            </button>
            {primary === "submit" && (
              <button
                type="button"
                className={`${styles.navBtn} ${styles.navBtnPrimary}`}
                onClick={onSubmit}
                disabled={saving}
              >
                {saving ? "Submitting…" : "Submit for review"}
              </button>
            )}
            {primary === "next" && (
              <button
                type="button"
                className={`${styles.navBtn} ${styles.navBtnPrimary}`}
                onClick={handleNext}
                disabled={saving}
                aria-disabled={nextDisabled}
              >
                {saving ? "Saving…" : "Next"} <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <aside className={styles.rail}>{rail}</aside>
    </div>
  );
}
