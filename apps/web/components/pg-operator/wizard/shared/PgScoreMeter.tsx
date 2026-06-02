"use client";
import { motion } from "framer-motion";
import { computePgListingScore } from "@cribliv/shared-types";
import type { PgListingPayload, PgScoreSignals } from "@cribliv/shared-types";

const R = 44;
const CIRC = 2 * Math.PI * R;

interface Props {
  payload: PgListingPayload;
  signals: PgScoreSignals;
  onGoToStep: (step: 1 | 2 | 3 | 4 | 5 | 6 | 7) => void;
}

export default function PgScoreMeter({ payload, signals, onGoToStep }: Props) {
  const { composite, recommendations } = computePgListingScore(payload, signals);
  const offset = CIRC * (1 - composite / 100);
  const color =
    composite >= 70
      ? "var(--pgo-success, #22c55e)"
      : composite >= 40
        ? "var(--pgo-warning, #f59e0b)"
        : "var(--pgo-danger, #ef4444)";

  return (
    <div
      className="pgo-glass pgo-score-meter"
      role="complementary"
      aria-label="Listing quality score"
    >
      <div className="pgo-score-meter__ring-wrap">
        <svg
          width={108}
          height={108}
          viewBox="0 0 108 108"
          role="img"
          aria-label={`Score: ${composite} out of 100`}
        >
          <circle
            cx={54}
            cy={54}
            r={R}
            fill="none"
            stroke="var(--pgo-border, rgba(255,255,255,0.12))"
            strokeWidth={9}
          />
          <motion.circle
            cx={54}
            cy={54}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            initial={{ strokeDashoffset: CIRC }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            style={{ transform: "rotate(-90deg)", transformOrigin: "54px 54px" }}
          />
        </svg>
        <div className="pgo-score-meter__num" aria-hidden="true">
          <motion.span
            key={composite}
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            style={{ color, fontWeight: 700, fontSize: 28, lineHeight: 1 }}
          >
            {composite}
          </motion.span>
          <span style={{ fontSize: 11, opacity: 0.6, display: "block" }}>/100</span>
        </div>
      </div>

      {recommendations.length > 0 && (
        <div className="pgo-score-meter__recs">
          <p className="pgo-caption" style={{ fontWeight: 600, marginBottom: 8 }}>
            Boost your score
          </p>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6
            }}
          >
            {recommendations.map((rec) => (
              <li key={rec.id}>
                <button
                  type="button"
                  className="pgo-score-meter__rec"
                  onClick={() => onGoToStep(rec.step)}
                >
                  <span style={{ flex: 1, textAlign: "left", fontSize: 13 }}>{rec.label}</span>
                  <span className="pgo-score-meter__rec-pts">+{rec.points}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
