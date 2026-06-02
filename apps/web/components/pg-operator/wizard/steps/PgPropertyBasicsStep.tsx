"use client";
import { Dispatch, useState } from "react";
import { motion } from "framer-motion";
import { Building2, BedDouble, Users } from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import EnumChips from "../shared/EnumChips";

const SHARING = [
  { value: "single" as const, label: "Single" },
  { value: "double" as const, label: "Double" },
  { value: "triple" as const, label: "Triple" },
  { value: "quad" as const, label: "Quad" },
  { value: "dorm" as const, label: "Dorm" }
];

interface Props {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
  accessToken: string | null;
}

export default function PgPropertyBasicsStep({ state, dispatch }: Props) {
  const [error, setError] = useState<string | null>(null);
  const d = state.draft;
  const ui = state.ui;
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });
  const toggleSharing = (v: "single" | "double" | "triple" | "quad" | "dorm") => {
    const cur = new Set<string>(ui.sharing_options ?? []);
    cur.has(v) ? cur.delete(v) : cur.add(v);
    dispatch({ type: "SET_UI_FIELD", path: "sharing_options", value: Array.from(cur) });
  };

  const validate = (): string | null => {
    if (!d.property?.display_name || d.property.display_name.length < 2)
      return "Property name required (≥2 chars)";
    if (!d.pg_details?.total_beds || d.pg_details.total_beds < 1) return "Total beds required";
    if (!ui.sharing_options || ui.sharing_options.length < 1)
      return "Pick at least one sharing option";
    return null;
  };

  const onNext = () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    dispatch({ type: "GOTO_STEP", step: 2 });
  };

  return (
    <section className="pgo-stagger">
      {/* Property details */}
      <div className="pgo-form-section">
        <div className="pgo-section-header">
          <div className="pgo-section-header__icon">
            <Building2 size={20} />
          </div>
          <div className="pgo-section-header__text">
            <span className="pgo-overline">Property</span>
            <span className="pgo-heading pgo-heading--xs">Basic details</span>
          </div>
        </div>

        <div className="pgo-field">
          <input
            className="pgo-field__input"
            aria-label="property name"
            value={d.property?.display_name ?? ""}
            onChange={(e) => setF("property.display_name", e.target.value)}
            placeholder=" "
          />
          <label className="pgo-field__label">Property name</label>
          <span className="pgo-field__bar" />
        </div>

        <div className="pgo-form-row">
          <div className="pgo-field">
            <input
              className="pgo-field__input"
              type="number"
              aria-label="total floors"
              value={d.property?.total_floors ?? ""}
              onChange={(e) => setF("property.total_floors", parseInt(e.target.value, 10) || null)}
              placeholder=" "
            />
            <label className="pgo-field__label">Total floors</label>
            <span className="pgo-field__bar" />
          </div>
          <div className="pgo-field">
            <input
              className="pgo-field__input"
              aria-label="internal code"
              value={d.property?.internal_code ?? ""}
              onChange={(e) => setF("property.internal_code", e.target.value)}
              placeholder=" "
            />
            <label className="pgo-field__label">Internal code (optional)</label>
            <span className="pgo-field__bar" />
          </div>
        </div>
      </div>

      {/* PG Configuration */}
      <div className="pgo-form-section">
        <div className="pgo-section-header">
          <div className="pgo-section-header__icon">
            <BedDouble size={20} />
          </div>
          <div className="pgo-section-header__text">
            <span className="pgo-overline">Configuration</span>
            <span className="pgo-heading pgo-heading--xs">Capacity & type</span>
          </div>
        </div>

        <div className="pgo-field">
          <input
            className="pgo-field__input"
            type="number"
            aria-label="total beds"
            value={d.pg_details?.total_beds ?? ""}
            onChange={(e) => setF("pg_details.total_beds", parseInt(e.target.value, 10) || 0)}
            placeholder=" "
          />
          <label className="pgo-field__label">Total beds</label>
          <span className="pgo-field__bar" />
        </div>

        <EnumChips
          label="Gender policy"
          value={d.pg_details?.gender_policy as any}
          onChange={(v) => setF("pg_details.gender_policy", v)}
          options={[
            { value: "boys", label: "Boys" },
            { value: "girls", label: "Girls" },
            { value: "coed", label: "Co-ed" }
          ]}
        />

        <EnumChips
          label="Tenant type"
          value={d.pg_details?.tenant_type as any}
          onChange={(v) => setF("pg_details.tenant_type", v)}
          options={[
            { value: "students", label: "Students" },
            { value: "working", label: "Working Professionals" },
            { value: "any", label: "Anyone" }
          ]}
        />
      </div>

      {/* Sharing options */}
      <div>
        <div className="pgo-section-header">
          <div className="pgo-section-header__icon">
            <Users size={20} />
          </div>
          <div className="pgo-section-header__text">
            <span className="pgo-overline">Room Types</span>
            <span className="pgo-heading pgo-heading--xs">Sharing options offered</span>
          </div>
        </div>
        <div className="pgo-chips__grid">
          {SHARING.map((s) => {
            const active = (ui.sharing_options ?? []).includes(s.value);
            return (
              <motion.button
                key={s.value}
                type="button"
                className={`pgo-chip ${active ? "pgo-chip--selected" : ""}`}
                aria-pressed={active}
                onClick={() => toggleSharing(s.value)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                {s.label}
              </motion.button>
            );
          })}
        </div>
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pgo-error-msg"
          role="alert"
        >
          {error}
        </motion.p>
      )}

      <div className="pgo-step-nav">
        <div />
        <button className="pgo-btn pgo-btn--primary pgo-btn--lg" type="button" onClick={onNext}>
          Next
        </button>
      </div>
    </section>
  );
}
