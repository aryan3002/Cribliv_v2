"use client";

import type { WizardForm, ListingType, Furnishing, StepError } from "./types";

interface Props {
  form: WizardForm;
  errors: StepError[];
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
}

export function BasicsStep({ form, errors, updateField }: Props) {
  function fieldError(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  return (
    <>
      <div className="form-group">
        <label className="form-label" htmlFor="wiz-title">
          Listing title
        </label>
        <input
          id="wiz-title"
          className={`input${fieldError("title") ? " input--error" : ""}`}
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="e.g. Spacious 2BHK near Metro"
        />
        {fieldError("title") ? <p className="form-error">{fieldError("title")}</p> : null}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-desc">
          Description
        </label>
        <textarea
          id="wiz-desc"
          className="textarea"
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="Describe your property — condition, nearby landmarks, best suited for..."
          rows={3}
        />
      </div>

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
            className="input"
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
            className={`input${fieldError("monthly_rent") ? " input--error" : ""}`}
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
            className={`input${fieldError("deposit") ? " input--error" : ""}`}
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
