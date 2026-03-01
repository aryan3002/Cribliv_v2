"use client";

import { useState } from "react";
import type { WizardForm, StepError } from "./types";
import { generateListingContent } from "../../lib/owner-api";

interface Props {
  form: WizardForm;
  errors: StepError[];
  accessToken: string | null;
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  /** Fields currently being filled by AI (glow effect) */
  aiFillingFields?: Set<string>;
}

export function TitleDescriptionStep({
  form,
  errors,
  accessToken,
  updateField,
  aiFillingFields
}: Props) {
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  function aiClass(field: string) {
    return aiFillingFields?.has(field) ? " field--ai-filling" : "";
  }
  function fieldError(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  async function handleGenerate() {
    if (!accessToken) {
      setGenError("Login required to generate content.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generateListingContent(accessToken, {
        listing_type: form.listing_type,
        monthly_rent: form.monthly_rent ? Number(form.monthly_rent) : undefined,
        deposit: form.deposit ? Number(form.deposit) : undefined,
        furnishing: form.furnishing || undefined,
        city: form.city || undefined,
        locality: form.locality || undefined,
        bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
        bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
        area_sqft: form.area_sqft ? Number(form.area_sqft) : undefined,
        amenities: form.amenities.length > 0 ? form.amenities : undefined,
        preferred_tenant: form.preferred_tenant || undefined,
        beds: form.beds ? Number(form.beds) : undefined,
        sharing_type: form.sharing_type || undefined,
        meals_included: form.meals_included || undefined,
        attached_bathroom: form.attached_bathroom || undefined
      });
      // Typewriter-style fill for title
      typewriterSet("title", result.title);
      // Slight delay then fill description
      setTimeout(() => typewriterSet("description", result.description), 400);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to generate content");
    } finally {
      setGenerating(false);
    }
  }

  function typewriterSet(field: "title" | "description", value: string) {
    let i = 0;
    const step = () => {
      if (i <= value.length) {
        updateField(field, value.slice(0, i));
        i++;
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  const hasEnoughInfo = form.monthly_rent.trim().length > 0 && form.city.trim().length > 0;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 12px" }}>
          We&apos;ll generate a title and description based on the details you&apos;ve provided. You
          can edit them anytime.
        </p>
        <button
          type="button"
          className="btn btn--primary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
            padding: "8px 20px"
          }}
          onClick={handleGenerate}
          disabled={generating || !hasEnoughInfo}
        >
          {generating ? (
            <>
              <span
                className="spinner"
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  border: "2px solid #fff",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "spin 0.6s linear infinite",
                  display: "inline-block"
                }}
              />
              Generating…
            </>
          ) : (
            <>✨ Generate Title &amp; Description</>
          )}
        </button>
        {!hasEnoughInfo && (
          <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
            Fill in rent and city first to enable generation.
          </p>
        )}
        {genError && (
          <p className="form-error" style={{ marginTop: 6 }}>
            {genError}
          </p>
        )}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-title">
          Listing title
        </label>
        <input
          id="wiz-title"
          className={`input${fieldError("title") ? " input--error" : ""}${aiClass("title")}`}
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="e.g. Spacious 2BHK near Metro"
        />
        {fieldError("title") && <p className="form-error">{fieldError("title")}</p>}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="wiz-desc">
          Description
        </label>
        <textarea
          id="wiz-desc"
          className={`textarea${aiClass("description")}`}
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="Describe your property — condition, nearby landmarks, best suited for..."
          rows={4}
        />
      </div>
    </>
  );
}
