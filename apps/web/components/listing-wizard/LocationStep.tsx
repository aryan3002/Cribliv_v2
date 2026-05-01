"use client";

import type { WizardForm, StepError } from "./types";
import { CITIES } from "./types";

interface Props {
  form: WizardForm;
  errors: StepError[];
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  aiFillingFields?: Set<string>;
}

export function LocationStep({ form, errors, updateField, aiFillingFields }: Props) {
  function fillCls(field: string) {
    return aiFillingFields?.has(field) ? " cz-fill" : "";
  }
  function err(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  return (
    <div className="cz-card cz-fade cz-fade--2">
      <div className="cz-card__eyebrow">Step 2</div>
      <h2 className="cz-card__title">Property location</h2>
      <p className="cz-card__intent">Where is the property located? Help tenants find it easily.</p>

      <div className="cz-row">
        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-city">
            City
          </label>
          <select
            id="cz-city"
            className={`cz-select${fillCls("city")}`}
            value={form.city}
            onChange={(e) => updateField("city", e.target.value)}
          >
            <option value="">Pick a city…</option>
            {CITIES.map((city) => (
              <option key={city} value={city.toLowerCase()}>
                {city}
              </option>
            ))}
          </select>
          {err("city") ? <p className="cz-error">{err("city")}</p> : null}
        </div>

        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-locality">
            Locality
          </label>
          <input
            id="cz-locality"
            className={`cz-input${fillCls("locality")}`}
            value={form.locality}
            onChange={(e) => updateField("locality", e.target.value)}
            placeholder="Indiranagar, DLF Phase 3, …"
          />
        </div>
      </div>

      <div className="cz-row" style={{ marginTop: 24 }}>
        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-landmark">
            Nearest landmark
          </label>
          <input
            id="cz-landmark"
            className={`cz-input${fillCls("landmark")}`}
            value={form.landmark}
            onChange={(e) => updateField("landmark", e.target.value)}
            placeholder="Near Huda City Centre Metro"
          />
        </div>

        <div className="cz-field">
          <label className="cz-label" htmlFor="cz-pincode">
            Pincode
          </label>
          <input
            id="cz-pincode"
            className={`cz-input cz-input--numeric${fillCls("pincode")}`}
            value={form.pincode}
            onChange={(e) => updateField("pincode", e.target.value)}
            placeholder="122002"
            maxLength={6}
            inputMode="numeric"
            pattern="[0-9]*"
          />
        </div>
      </div>

      <div className="cz-field cz-field--full" style={{ marginTop: 24 }}>
        <label className="cz-label" htmlFor="cz-address">
          Full address
        </label>
        <textarea
          id="cz-address"
          className={`cz-textarea${fillCls("address")}`}
          value={form.address}
          onChange={(e) => updateField("address", e.target.value)}
          placeholder="House number, street, sector — anything that helps a verifier reach the door."
          rows={2}
        />
        <p className="cz-help">Kept private. Tenants only see locality + landmark.</p>
      </div>
    </div>
  );
}
