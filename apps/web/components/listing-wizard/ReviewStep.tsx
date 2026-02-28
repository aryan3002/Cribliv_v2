"use client";

import type { WizardForm, UploadFile, PgPath } from "./types";
import { t, type Locale } from "../../lib/i18n";

interface Props {
  form: WizardForm;
  uploads: UploadFile[];
  pgPath: PgPath;
  locale: Locale;
}

export function ReviewStep({ form, uploads, pgPath, locale }: Props) {
  const isPg = form.listing_type === "pg";
  const completedUploads = uploads.filter((u) => u.status === "complete");

  return (
    <>
      <div className="info-box">{t(locale, "reviewInfo")}</div>

      {/* Listing card preview */}
      <div className="review-card">
        {completedUploads.length > 0 ? (
          <div className="review-card__gallery">
            {completedUploads.slice(0, 4).map((u, i) => (
              <img
                key={u.clientUploadId}
                src={u.previewUrl}
                alt=""
                className={`review-card__photo${i === 0 ? " review-card__photo--main" : ""}`}
              />
            ))}
            {completedUploads.length > 4 ? (
              <div className="review-card__more">+{completedUploads.length - 4}</div>
            ) : null}
          </div>
        ) : (
          <div className="review-card__gallery review-card__gallery--empty">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p className="caption">No photos added</p>
          </div>
        )}

        <div className="review-card__body">
          <div className="review-card__row">
            <span className="review-card__type badge">{isPg ? "PG / Hostel" : "Flat / House"}</span>
            {form.furnishing ? (
              <span className="badge badge--outline">{form.furnishing.replace(/_/g, " ")}</span>
            ) : null}
          </div>

          <h3 className="review-card__title">{form.title || "Untitled Listing"}</h3>

          <p className="review-card__location">
            {[form.locality, form.city].filter(Boolean).join(", ") || "Location not set"}
            {form.landmark ? ` • near ${form.landmark}` : ""}
          </p>

          {form.monthly_rent ? (
            <p className="review-card__rent">
              ₹{Number(form.monthly_rent).toLocaleString("en-IN")}
              <span className="review-card__rent-period">/month</span>
            </p>
          ) : null}

          {form.deposit ? (
            <p className="review-card__detail">
              Deposit: ₹{Number(form.deposit).toLocaleString("en-IN")}
            </p>
          ) : null}

          {form.description ? <p className="review-card__desc">{form.description}</p> : null}
        </div>

        <div className="review-card__details">
          <h4>Property details</h4>
          <div className="review-card__grid">
            {!isPg && form.bedrooms ? (
              <div className="review-stat">
                <span className="review-stat__value">{form.bedrooms}</span>
                <span className="review-stat__label">Bedrooms</span>
              </div>
            ) : null}
            {!isPg && form.bathrooms ? (
              <div className="review-stat">
                <span className="review-stat__value">{form.bathrooms}</span>
                <span className="review-stat__label">Bathrooms</span>
              </div>
            ) : null}
            {isPg && form.beds ? (
              <div className="review-stat">
                <span className="review-stat__value">{form.beds}</span>
                <span className="review-stat__label">Beds</span>
              </div>
            ) : null}
            {isPg && form.sharing_type ? (
              <div className="review-stat">
                <span className="review-stat__value">{form.sharing_type}</span>
                <span className="review-stat__label">Sharing</span>
              </div>
            ) : null}
            {form.area_sqft ? (
              <div className="review-stat">
                <span className="review-stat__value">{form.area_sqft}</span>
                <span className="review-stat__label">Sq ft</span>
              </div>
            ) : null}
            {isPg ? (
              <>
                <div className="review-stat">
                  <span className="review-stat__value">{form.meals_included ? "Yes" : "No"}</span>
                  <span className="review-stat__label">Meals</span>
                </div>
                <div className="review-stat">
                  <span className="review-stat__value">
                    {form.attached_bathroom ? "Yes" : "No"}
                  </span>
                  <span className="review-stat__label">Attached bath</span>
                </div>
              </>
            ) : null}
            {!isPg && form.preferred_tenant && form.preferred_tenant !== "any" ? (
              <div className="review-stat">
                <span className="review-stat__value">{form.preferred_tenant}</span>
                <span className="review-stat__label">Preferred</span>
              </div>
            ) : null}
          </div>
        </div>

        {form.amenities.length > 0 ? (
          <div className="review-card__amenities">
            {form.amenities.map((a) => (
              <span key={a} className="badge">
                {a}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {pgPath === "sales_assist" ? (
        <div className="segment-banner segment-banner--sales-assist">
          As a large PG operator, our team will be in touch after submission to assist with
          onboarding.
        </div>
      ) : null}
    </>
  );
}
