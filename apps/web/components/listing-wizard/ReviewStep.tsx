"use client";

import type { WizardForm, UploadFile, PgPath } from "./types";
import type { Locale } from "../../lib/i18n";

interface Props {
  form: WizardForm;
  uploads: UploadFile[];
  pgPath: PgPath;
  locale: Locale;
}

export function ReviewStep({ form, uploads, pgPath }: Props) {
  const isPg = form.listing_type === "pg";
  const completed = uploads.filter((u) => u.status === "complete");
  const hero = completed[0]?.previewUrl;

  return (
    <div className="cz-card cz-fade cz-fade--2">
      <div className="cz-card__eyebrow">VI · One last look</div>
      <h2 className="cz-card__title">A printed property card.</h2>
      <p className="cz-card__intent">
        This is what tenants will see at a glance. If anything reads off, jump back and tweak.
      </p>

      <article className="cz-review">
        <div className="cz-review__hero">
          {hero ? (
            <img src={hero} alt="" />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--c-slate-soft)",
                fontStyle: "italic",
                fontFamily: "var(--c-display)"
              }}
            >
              No photos yet — your hero shot will land here.
            </div>
          )}
        </div>

        <div className="cz-review__body">
          <div className="cz-review__type">{isPg ? "PG / Hostel" : "Flat / House"}</div>
          <h3 className="cz-review__title">{form.title || "An untitled home"}</h3>
          <p className="cz-review__loc">
            {[form.locality, capitalize(form.city)].filter(Boolean).join(", ") ||
              "Location to be confirmed"}
            {form.landmark ? ` — near ${form.landmark}` : ""}
          </p>

          <div className="cz-review__rule" />

          {form.monthly_rent ? (
            <div className="cz-review__rent">
              ₹{Number(form.monthly_rent).toLocaleString("en-IN")}
              <small>/ month</small>
            </div>
          ) : null}

          <div className="cz-review__grid">
            {!isPg && form.bedrooms ? <Stat label="Bedrooms" value={form.bedrooms} /> : null}
            {!isPg && form.bathrooms ? <Stat label="Bathrooms" value={form.bathrooms} /> : null}
            {isPg && form.beds ? <Stat label="Beds" value={form.beds} /> : null}
            {isPg && form.sharing_type ? <Stat label="Sharing" value={form.sharing_type} /> : null}
            {form.area_sqft ? <Stat label="Sq ft" value={form.area_sqft} /> : null}
            {form.furnishing ? (
              <Stat label="Furnishing" value={form.furnishing.replace(/_/g, " ")} />
            ) : null}
            {form.deposit ? (
              <Stat label="Deposit" value={`₹${Number(form.deposit).toLocaleString("en-IN")}`} />
            ) : null}
          </div>

          {form.description ? <p className="cz-review__desc">{form.description}</p> : null}

          {form.amenities.length > 0 ? (
            <div className="cz-review__amenities">
              {form.amenities.map((a) => (
                <span key={a} className="cz-review__amenity">
                  {a}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </article>

      {pgPath === "sales_assist" ? (
        <div className="cz-banner cz-banner--gold" style={{ marginTop: 16 }}>
          As a large PG operator, our team will reach out after submission to assist with
          onboarding.
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="cz-review__stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
