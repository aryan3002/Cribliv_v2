"use client";

import type { WizardForm, SharingType, StepError, PgPath } from "./types";
import { AMENITIES_FLAT, AMENITIES_PG, PREFERRED_TENANTS } from "./types";

interface Props {
  form: WizardForm;
  errors: StepError[];
  pgPath: PgPath;
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  toggleAmenity: (amenity: string) => void;
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
  function fillCls(field: string) {
    return aiFillingFields?.has(field) ? " cz-fill" : "";
  }
  function err(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  const isPg = form.listing_type === "pg";

  return (
    <div className="cz-card cz-fade cz-fade--2">
      <div className="cz-card__eyebrow">Step 3</div>
      <h2 className="cz-card__title">Property details</h2>
      <p className="cz-card__intent">
        {isPg
          ? "Share your PG's room configuration, sharing options, and included amenities."
          : "Add room configuration, area, and amenities to attract the right tenants."}
      </p>

      {isPg ? (
        <>
          <div className="cz-row">
            <div className="cz-field">
              <label className="cz-label" htmlFor="cz-beds">
                Total beds
              </label>
              <input
                id="cz-beds"
                type="number"
                className={`cz-input cz-input--numeric${fillCls("beds")}`}
                value={form.beds}
                onChange={(e) => updateField("beds", e.target.value)}
                placeholder="20"
                min="1"
              />
              {err("beds") ? <p className="cz-error">{err("beds")}</p> : null}
            </div>

            <div className="cz-field">
              <label className="cz-label" htmlFor="cz-sharing">
                Sharing
              </label>
              <select
                id="cz-sharing"
                className={`cz-select${fillCls("sharing_type")}`}
                value={form.sharing_type}
                onChange={(e) => updateField("sharing_type", e.target.value as SharingType)}
              >
                <option value="">Choose…</option>
                <option value="single">Single</option>
                <option value="double">Double</option>
                <option value="triple">Triple</option>
                <option value="quad">Quad</option>
              </select>
            </div>
          </div>

          <div className="cz-pill-row" style={{ marginTop: 22 }}>
            <button
              type="button"
              className="cz-toggle"
              onClick={() => updateField("meals_included", !form.meals_included)}
            >
              <input type="checkbox" checked={form.meals_included} readOnly aria-hidden />
              Meals included
            </button>
            <button
              type="button"
              className="cz-toggle"
              onClick={() => updateField("attached_bathroom", !form.attached_bathroom)}
            >
              <input type="checkbox" checked={form.attached_bathroom} readOnly aria-hidden />
              Attached bathroom
            </button>
          </div>

          {pgPath === "self_serve" ? (
            <div className="cz-banner cz-banner--gold" style={{ marginTop: 18 }}>
              With {form.beds} beds, you can manage this listing yourself — fully self-serve.
            </div>
          ) : null}
          {pgPath === "sales_assist" ? (
            <div className="cz-banner cz-banner--coral" style={{ marginTop: 18 }}>
              With {form.beds}+ beds, our team will reach out to help you onboard properly.
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="cz-row">
            <div className="cz-field">
              <label className="cz-label" htmlFor="cz-bedrooms">
                Bedrooms
              </label>
              <input
                id="cz-bedrooms"
                type="number"
                className={`cz-input cz-input--numeric${fillCls("bedrooms")}`}
                value={form.bedrooms}
                onChange={(e) => updateField("bedrooms", e.target.value)}
                placeholder="2"
                min="0"
              />
              {err("bedrooms") ? <p className="cz-error">{err("bedrooms")}</p> : null}
            </div>

            <div className="cz-field">
              <label className="cz-label" htmlFor="cz-bathrooms">
                Bathrooms
              </label>
              <input
                id="cz-bathrooms"
                type="number"
                className={`cz-input cz-input--numeric${fillCls("bathrooms")}`}
                value={form.bathrooms}
                onChange={(e) => updateField("bathrooms", e.target.value)}
                placeholder="2"
                min="0"
              />
            </div>
          </div>

          <div className="cz-field" style={{ marginTop: 22 }}>
            <label className="cz-label" htmlFor="cz-tenant">
              Preferred tenant
            </label>
            <select
              id="cz-tenant"
              className={`cz-select${fillCls("preferred_tenant")}`}
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

      <div className="cz-field cz-field--full" style={{ marginTop: 22 }}>
        <label className="cz-label" htmlFor="cz-area">
          Carpet area (sq ft)
        </label>
        <input
          id="cz-area"
          type="number"
          className={`cz-input cz-input--numeric${fillCls("area_sqft")}`}
          value={form.area_sqft}
          onChange={(e) => updateField("area_sqft", e.target.value)}
          placeholder="850"
          min="0"
        />
        {err("area_sqft") ? <p className="cz-error">{err("area_sqft")}</p> : null}
      </div>

      <div className="cz-field cz-field--full" style={{ marginTop: 26 }}>
        <label className="cz-label">Amenities</label>
        <div className="cz-pill-row">
          {(isPg ? AMENITIES_PG : AMENITIES_FLAT).map((amenity) => {
            const on = form.amenities.includes(amenity);
            return (
              <button
                key={amenity}
                type="button"
                className="cz-pill"
                aria-pressed={on}
                onClick={() => toggleAmenity(amenity)}
              >
                <span className="cz-pill__check" aria-hidden>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                {amenity}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
