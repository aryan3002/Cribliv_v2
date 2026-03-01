"use client";

import type { WizardForm, ListingType, Furnishing, StepError } from "./types";

interface Props {
  form: WizardForm;
  errors: StepError[];
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  /** Fields currently being filled by AI voice agent (glow effect) */
  aiFillingFields?: Set<string>;
}

export function BasicsStep({ form, errors, updateField, aiFillingFields }: Props) {
  function aiClass(field: string) {
    return aiFillingFields?.has(field) ? " field--ai-filling" : "";
  }
  function fieldError(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  return (
    <>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="wiz-type">
            Property type
          </label>
          <select
            id="wiz-type"
            className="input"
            value={form.listing_type}
            onChange={(e) => updateField("listing_type", e.target.value as ListingType)}
          >
            <option value="flat_house">Flat / House</option>
            <option value="pg">PG / Hostel</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="wiz-furnishing">
            Furnishing
          </label>
          <select
            id="wiz-furnishing"
            className={`input${aiClass("furnishing")}`}
            value={form.furnishing}
            onChange={(e) => updateField("furnishing", e.target.value as Furnishing)}
          >
            <option value="">Select...</option>
            <option value="unfurnished">Unfurnished</option>
            <option value="semi_furnished">Semi-Furnished</option>
            <option value="fully_furnished">Fully Furnished</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="wiz-rent">
            Monthly rent (₹)
          </label>
          <input
            id="wiz-rent"
            type="number"
            className={`input${fieldError("monthly_rent") ? " input--error" : ""}${aiClass("monthly_rent")}`}
            value={form.monthly_rent}
            onChange={(e) => updateField("monthly_rent", e.target.value)}
            placeholder="e.g. 15000"
            min="0"
          />
          {fieldError("monthly_rent") ? (
            <p className="form-error">{fieldError("monthly_rent")}</p>
          ) : null}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="wiz-deposit">
            Security deposit (₹)
          </label>
          <input
            id="wiz-deposit"
            type="number"
            className={`input${fieldError("deposit") ? " input--error" : ""}${aiClass("deposit")}`}
            value={form.deposit}
            onChange={(e) => updateField("deposit", e.target.value)}
            placeholder="e.g. 30000"
            min="0"
          />
          {fieldError("deposit") ? <p className="form-error">{fieldError("deposit")}</p> : null}
        </div>
      </div>
    </>
  );
}
