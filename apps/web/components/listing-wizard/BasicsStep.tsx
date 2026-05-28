"use client";

import type { WizardForm, ListingType, Furnishing, StepError } from "./types";

interface Props {
  form: WizardForm;
  errors: StepError[];
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  /** Fields currently being filled by AI voice agent (gold glow). */
  aiFillingFields?: Set<string>;
}

export function BasicsStep({ form, errors, updateField, aiFillingFields }: Props) {
  function fillCls(field: string) {
    return aiFillingFields?.has(field) ? " cz-fill" : "";
  }
  function err(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  return (
    <div className="cz-card cz-fade cz-fade--2">
      <div className="cz-card__eyebrow">Step 1</div>
      <h2 className="cz-card__title">Property basics</h2>
      <p className="cz-card__intent">What type of property is this and how much does it cost?</p>

      <div className="cz-row">
        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-type">
            Property
          </label>
          <select
            id="cz-type"
            className={`cz-select${fillCls("listing_type")}`}
            value={form.listing_type}
            onChange={(e) => updateField("listing_type", e.target.value as ListingType)}
          >
            <option value="flat_house">Flat / House</option>
            <option value="pg">PG / Hostel</option>
          </select>
        </div>

        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-furnishing">
            Furnishing
          </label>
          <select
            id="cz-furnishing"
            className={`cz-select${fillCls("furnishing")}`}
            value={form.furnishing}
            onChange={(e) => updateField("furnishing", e.target.value as Furnishing)}
          >
            <option value="">Tell me how it&apos;s set up…</option>
            <option value="unfurnished">Unfurnished</option>
            <option value="semi_furnished">Semi-furnished</option>
            <option value="fully_furnished">Fully furnished</option>
          </select>
        </div>
      </div>

      <div className="cz-row" style={{ marginTop: 24 }}>
        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-rent">
            Monthly rent
          </label>
          <div className="cz-prefix">
            <span className="cz-prefix__symbol">₹</span>
            <input
              id="cz-rent"
              type="number"
              inputMode="numeric"
              className={`cz-input cz-input--numeric${fillCls("monthly_rent")}`}
              value={form.monthly_rent}
              onChange={(e) => updateField("monthly_rent", e.target.value)}
              placeholder="25,000"
              min="0"
            />
          </div>
          {err("monthly_rent") ? <p className="cz-error">{err("monthly_rent")}</p> : null}
        </div>

        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-deposit">
            Security deposit
          </label>
          <div className="cz-prefix">
            <span className="cz-prefix__symbol">₹</span>
            <input
              id="cz-deposit"
              type="number"
              inputMode="numeric"
              className={`cz-input cz-input--numeric${fillCls("deposit")}`}
              value={form.deposit}
              onChange={(e) => updateField("deposit", e.target.value)}
              placeholder="50,000"
              min="0"
            />
          </div>
          {err("deposit") ? <p className="cz-error">{err("deposit")}</p> : null}
        </div>
      </div>
    </div>
  );
}
