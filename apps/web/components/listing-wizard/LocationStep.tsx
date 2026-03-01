"use client";

import type { WizardForm, StepError } from "./types";
import { CITIES } from "./types";

interface Props {
  form: WizardForm;
  errors: StepError[];
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  /** Fields currently being filled by AI voice agent (glow effect) */
  aiFillingFields?: Set<string>;
}

export function LocationStep({ form, errors, updateField, aiFillingFields }: Props) {
  function aiClass(field: string) {
    return aiFillingFields?.has(field) ? " field--ai-filling" : "";
  }
  function fieldError(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  return (
    <>
      <div className="form-group">
        <label className="form-label" htmlFor="wiz-city">
          City
        </label>
        <select
          id="wiz-city"
          className={`input${fieldError("city") ? " input--error" : ""}${aiClass("city")}`}
          value={form.city}
          onChange={(e) => updateField("city", e.target.value)}
        >
          <option value="">Select city...</option>
          {CITIES.map((city) => (
            <option key={city} value={city.toLowerCase()}>
              {city}
            </option>
          ))}
        </select>
        {fieldError("city") ? <p className="form-error">{fieldError("city")}</p> : null}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-locality">
          Locality / Area
        </label>
        <input
          id="wiz-locality"
          className="input"
          value={form.locality}
          onChange={(e) => updateField("locality", e.target.value)}
          placeholder="e.g. Sector 62, DLF Phase 3"
        />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="wiz-landmark">
            Nearest landmark
          </label>
          <input
            id="wiz-landmark"
            className="input"
            value={form.landmark}
            onChange={(e) => updateField("landmark", e.target.value)}
            placeholder="e.g. Near Huda City Centre Metro"
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="wiz-pincode">
            Pincode
          </label>
          <input
            id="wiz-pincode"
            className="input"
            value={form.pincode}
            onChange={(e) => updateField("pincode", e.target.value)}
            placeholder="e.g. 122002"
            maxLength={6}
            inputMode="numeric"
            pattern="[0-9]*"
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-address">
          Full address
        </label>
        <textarea
          id="wiz-address"
          className="textarea"
          value={form.address}
          onChange={(e) => updateField("address", e.target.value)}
          placeholder="Complete address (kept private, used for verification only)"
          rows={2}
        />
        <p
          className="caption"
          style={{ color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}
        >
          Your full address is never shown to tenants. It is used only for owner verification.
        </p>
      </div>
    </>
  );
}
