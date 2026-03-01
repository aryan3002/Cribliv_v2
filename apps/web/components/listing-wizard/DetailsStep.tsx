"use client";

import type { WizardForm, SharingType, StepError, PgPath } from "./types";
import { AMENITIES_FLAT, AMENITIES_PG, PREFERRED_TENANTS } from "./types";

interface Props {
  form: WizardForm;
  errors: StepError[];
  pgPath: PgPath;
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  toggleAmenity: (amenity: string) => void;
  /** Fields currently being filled by AI voice agent (glow effect) */
  aiFillingFields?: Set<string>;
}

export function DetailsStep({
  form,
  errors,
  pgPath,
  updateField,
  toggleAmenity,
  aiFillingFields
}: Props) {
  function aiClass(field: string) {
    return aiFillingFields?.has(field) ? " field--ai-filling" : "";
  }
  const isPg = form.listing_type === "pg";

  function fieldError(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  return (
    <>
      {isPg ? (
        <>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="wiz-beds">
                Total beds
              </label>
              <input
                id="wiz-beds"
                type="number"
                className={`input${fieldError("beds") ? " input--error" : ""}${aiClass("beds")}`}
                value={form.beds}
                onChange={(e) => updateField("beds", e.target.value)}
                placeholder="e.g. 20"
                min="1"
              />
              {fieldError("beds") ? <p className="form-error">{fieldError("beds")}</p> : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="wiz-sharing">
                Sharing type
              </label>
              <select
                id="wiz-sharing"
                className="input"
                value={form.sharing_type}
                onChange={(e) => updateField("sharing_type", e.target.value as SharingType)}
              >
                <option value="">Select...</option>
                <option value="single">Single</option>
                <option value="double">Double</option>
                <option value="triple">Triple</option>
                <option value="quad">Quad</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="wiz-meals"
                checked={form.meals_included}
                onChange={(e) => updateField("meals_included", e.target.checked)}
              />
              <label htmlFor="wiz-meals">Meals included</label>
            </div>

            <div className="checkbox-row">
              <input
                type="checkbox"
                id="wiz-attached-bath"
                checked={form.attached_bathroom}
                onChange={(e) => updateField("attached_bathroom", e.target.checked)}
              />
              <label htmlFor="wiz-attached-bath">Attached bathroom</label>
            </div>
          </div>

          {pgPath === "self_serve" ? (
            <div className="segment-banner segment-banner--self-serve">
              With {form.beds} beds, you can manage your listing yourself through our self-serve
              platform.
            </div>
          ) : null}
          {pgPath === "sales_assist" ? (
            <div className="segment-banner segment-banner--sales-assist">
              With {form.beds}+ beds, our team will help you with onboarding and dedicated support.
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="wiz-bedrooms">
                Bedrooms
              </label>
              <input
                id="wiz-bedrooms"
                type="number"
                className={`input${fieldError("bedrooms") ? " input--error" : ""}${aiClass("bedrooms")}`}
                value={form.bedrooms}
                onChange={(e) => updateField("bedrooms", e.target.value)}
                placeholder="e.g. 2"
                min="0"
              />
              {fieldError("bedrooms") ? (
                <p className="form-error">{fieldError("bedrooms")}</p>
              ) : null}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="wiz-bathrooms">
                Bathrooms
              </label>
              <input
                id="wiz-bathrooms"
                type="number"
                className="input"
                value={form.bathrooms}
                onChange={(e) => updateField("bathrooms", e.target.value)}
                placeholder="e.g. 1"
                min="0"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="wiz-preferred-tenant">
              Preferred tenant
            </label>
            <select
              id="wiz-preferred-tenant"
              className="input"
              value={form.preferred_tenant}
              onChange={(e) =>
                updateField("preferred_tenant", e.target.value as WizardForm["preferred_tenant"])
              }
            >
              {PREFERRED_TENANTS.map((pt) => (
                <option key={pt.value} value={pt.value}>
                  {pt.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-area">
          Area (sq ft)
        </label>
        <input
          id="wiz-area"
          type="number"
          className={`input${fieldError("area_sqft") ? " input--error" : ""}${aiClass("area_sqft")}`}
          value={form.area_sqft}
          onChange={(e) => updateField("area_sqft", e.target.value)}
          placeholder="e.g. 850"
          min="0"
        />
        {fieldError("area_sqft") ? <p className="form-error">{fieldError("area_sqft")}</p> : null}
      </div>

      <div className="form-group">
        <label className="form-label">Amenities</label>
        <div className="amenity-grid">
          {(isPg ? AMENITIES_PG : AMENITIES_FLAT).map((amenity) => (
            <div key={amenity} className="checkbox-row">
              <input
                id={`amenity-${amenity}`}
                type="checkbox"
                checked={form.amenities.includes(amenity)}
                onChange={() => toggleAmenity(amenity)}
              />
              <label htmlFor={`amenity-${amenity}`}>{amenity}</label>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
