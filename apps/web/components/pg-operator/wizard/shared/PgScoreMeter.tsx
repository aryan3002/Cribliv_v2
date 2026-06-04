"use client";
import { ArrowRight, Sparkles } from "lucide-react";
import { computePgListingScore } from "@cribliv/shared-types";
import type { PgListingPayload, PgScoreSignals } from "@cribliv/shared-types";
import styles from "./pg-wizard.module.css";

interface Props {
  payload: PgListingPayload;
  signals: PgScoreSignals;
  onGoToStep: (step: 1 | 2 | 3 | 4 | 5 | 6 | 7) => void;
}

export default function PgScoreMeter({ payload, signals, onGoToStep }: Props) {
  const { composite, recommendations } = computePgListingScore(payload, signals);
  const tier = composite >= 70 ? "Excellent" : composite >= 40 ? "Good" : "Basic";
  const color = composite >= 70 ? "#10b981" : composite >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div className={styles.scoreCard} role="complementary" aria-label="Listing quality score">
      <div className={styles.scoreTop}>
        <span className={styles.scoreTitle}>Listing quality</span>
        <span className={styles.scoreNum} style={{ color }}>
          {composite}
          <span style={{ fontSize: 12, color: "var(--pw-text-soft)", fontWeight: 600 }}>/100</span>
        </span>
      </div>

      <div className={styles.scoreBarTrack}>
        <div
          className={styles.scoreBarFill}
          style={{ width: `${composite}%`, background: color }}
        />
      </div>
      <div className={styles.scoreTiers}>
        <span style={tier === "Basic" ? { color } : undefined}>Basic</span>
        <span style={tier === "Good" ? { color } : undefined}>Good</span>
        <span style={tier === "Excellent" ? { color } : undefined}>Excellent</span>
      </div>

      {recommendations.length > 0 && (
        <div className={styles.scoreRecs}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "var(--pw-text-strong)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <Sparkles size={13} /> Boost your score
          </span>
          {recommendations.map((rec) => (
            <button
              key={rec.id}
              type="button"
              className={styles.scoreRec}
              onClick={() => onGoToStep(rec.step)}
            >
              <span className={styles.scoreRecLabel}>{rec.label}</span>
              <span className={styles.scoreRecPts}>+{rec.points}</span>
              <ArrowRight size={13} style={{ color: "var(--pw-text-soft)" }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
