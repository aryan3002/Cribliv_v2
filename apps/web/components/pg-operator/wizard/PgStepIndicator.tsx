"use client";
import { CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

const STEPS = [
  { num: 1, label: "Property & Identity" },
  { num: 2, label: "Rooms & Pricing" },
  { num: 3, label: "Payment" },
  { num: 4, label: "Rules" },
  { num: 5, label: "Amenities & Food" },
  { num: 6, label: "Photos & Review" }
] as const;

export default function PgStepIndicator({ current }: { current: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const fillPct = Math.round(((current - 1) / STEPS.length) * 100);

  return (
    <nav className="pgo-stepper" aria-label="Wizard progress">
      {/* Track */}
      <div className="pgo-stepper__track">
        <motion.div
          className="pgo-stepper__fill"
          initial={{ width: 0 }}
          animate={{ width: `${fillPct}%` }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          role="progressbar"
          aria-valuenow={fillPct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      {/* Steps */}
      <ol className="pgo-stepper__list">
        {STEPS.map(({ num, label }) => {
          const isActive = current === num;
          const isDone = current > num;

          return (
            <li
              key={num}
              className={`pgo-stepper__step ${isDone ? "pgo-stepper__step--done" : isActive ? "pgo-stepper__step--active" : ""}`}
              aria-current={isActive ? "step" : undefined}
            >
              <motion.div
                className={`pgo-stepper__dot ${
                  isDone
                    ? "pgo-stepper__dot--done"
                    : isActive
                      ? "pgo-stepper__dot--active"
                      : "pgo-stepper__dot--pending"
                }`}
                data-step={num}
                initial={false}
                animate={{
                  scale: isActive ? 1.1 : 1
                }}
                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                aria-hidden="true"
              >
                {isDone && <CheckCircle2 size={16} />}
              </motion.div>
              <span className="pgo-stepper__label">{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
