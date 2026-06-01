"use client";
import { Dispatch } from "react";
import { Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";

const RULES = [
  { key: "smoking", label: "Smoking", emoji: "🚬" },
  { key: "alcohol", label: "Alcohol", emoji: "🍺" },
  { key: "non_veg", label: "Non Veg", emoji: "🍗" },
  { key: "pets", label: "Pets", emoji: "🐾" },
  { key: "cooking_in_room", label: "Cooking in Room", emoji: "🍳" }
] as const;

export default function PgRulesStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
}) {
  const r = state.draft.pg_details?.house_rules ?? ({} as any);
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });
  const toggleRule = (k: string) => setF(`pg_details.house_rules.${k}`, !r[k]);

  return (
    <section className="pgo-stagger">
      <div className="pgo-form-section">
        <div className="pgo-section-header">
          <div className="pgo-section-header__icon">
            <Shield size={20} />
          </div>
          <div className="pgo-section-header__text">
            <span className="pgo-overline">Schedule</span>
            <span className="pgo-heading pgo-heading--xs">Timing & guests</span>
          </div>
        </div>

        <div className="pgo-form-row">
          <div className="pgo-field">
            <input
              className="pgo-field__input"
              type="time"
              aria-label="curfew time"
              value={r.curfew_time ?? ""}
              onChange={(e) => setF("pg_details.house_rules.curfew_time", e.target.value)}
              placeholder=" "
            />
            <label className="pgo-field__label">Curfew time</label>
            <span className="pgo-field__bar" />
          </div>
        </div>

        <div className="pgo-field">
          <textarea
            className="pgo-field__input pgo-field__input--textarea"
            aria-label="guests policy"
            maxLength={400}
            value={r.guests_policy ?? ""}
            onChange={(e) => setF("pg_details.house_rules.guests_policy", e.target.value)}
            placeholder=" "
            rows={3}
          />
          <label className="pgo-field__label">Guests policy</label>
          <span className="pgo-field__bar" />
          {r.guests_policy && (
            <span className="pgo-caption" style={{ position: "absolute", right: 12, bottom: 8 }}>
              {(r.guests_policy as string).length}/400
            </span>
          )}
        </div>
      </div>

      <div className="pgo-form-section">
        <span className="pgo-chips__label">General Rules</span>
        <p className="pgo-caption" style={{ marginBottom: 12 }}>
          Toggle on the items that are allowed
        </p>
        <div
          className="pgo-grid pgo-grid--auto"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}
        >
          {RULES.map(({ key: k, label, emoji }) => (
            <label key={k} className={`pgo-switch ${r[k] ? "pgo-switch--on" : ""}`}>
              <input
                type="checkbox"
                id={`rule-${k}`}
                aria-label={label}
                checked={!!r[k]}
                onChange={() => toggleRule(k)}
              />
              <div className="pgo-switch__track">
                <div className="pgo-switch__thumb" />
              </div>
              <span className="pgo-switch__label">{label}</span>
              <span className="pgo-switch__emoji">{r[k] ? "✅" : emoji}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <span className="pgo-chips__label">Quiet Hours (optional)</span>
        <div className="pgo-form-row" style={{ marginTop: 10 }}>
          <div className="pgo-field">
            <input
              className="pgo-field__input"
              type="time"
              aria-label="quiet from"
              value={r.quiet_hours?.from ?? ""}
              onChange={(e) => setF("pg_details.house_rules.quiet_hours.from", e.target.value)}
              placeholder=" "
            />
            <label className="pgo-field__label">From</label>
            <span className="pgo-field__bar" />
          </div>
          <div className="pgo-field">
            <input
              className="pgo-field__input"
              type="time"
              aria-label="quiet to"
              value={r.quiet_hours?.to ?? ""}
              onChange={(e) => setF("pg_details.house_rules.quiet_hours.to", e.target.value)}
              placeholder=" "
            />
            <label className="pgo-field__label">To</label>
            <span className="pgo-field__bar" />
          </div>
        </div>
      </div>

      <div className="pgo-step-nav">
        <button
          className="pgo-btn pgo-btn--secondary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 3 })}
        >
          Back
        </button>
        <button
          className="pgo-btn pgo-btn--primary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 5 })}
        >
          Next
        </button>
      </div>
    </section>
  );
}
