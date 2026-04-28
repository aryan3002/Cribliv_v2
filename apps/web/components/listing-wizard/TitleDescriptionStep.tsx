"use client";

import { useState } from "react";
import type { WizardForm, StepError } from "./types";
import { generateListingContent } from "../../lib/owner-api";

interface Props {
  form: WizardForm;
  errors: StepError[];
  accessToken: string | null;
  updateField: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
  aiFillingFields?: Set<string>;
  /** When set, the parent already has a typewriter routine — skip ours. */
  externalGenerate?: () => Promise<void>;
}

export function TitleDescriptionStep({
  form,
  errors,
  accessToken,
  updateField,
  aiFillingFields,
  externalGenerate
}: Props) {
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  function fillCls(field: string) {
    return aiFillingFields?.has(field) ? " cz-fill" : "";
  }
  function err(field: string) {
    return errors.find((e) => e.field === field)?.message;
  }

  async function handleGenerate() {
    if (externalGenerate) {
      setGenerating(true);
      setGenError(null);
      try {
        await externalGenerate();
      } catch (e) {
        setGenError(e instanceof Error ? e.message : "Failed to draft.");
      } finally {
        setGenerating(false);
      }
      return;
    }
    if (!accessToken) {
      setGenError("Login required to draft.");
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
      typewriterSet("title", result.title);
      setTimeout(() => typewriterSet("description", result.description), 400);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Failed to generate content");
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
    <div className="cz-card cz-fade cz-fade--2">
      <div className="cz-card__eyebrow">IV · How you&apos;d describe it</div>
      <h2 className="cz-card__title">A title that fits like a poem.</h2>
      <p className="cz-card__intent">
        Use what we&apos;ve gathered to draft something honest and inviting — then make it yours.
      </p>

      <div style={{ marginBottom: 22 }}>
        <button
          type="button"
          className="cz-btn cz-btn--gold"
          onClick={handleGenerate}
          disabled={generating || !hasEnoughInfo}
        >
          {generating ? (
            <>
              <Spinner /> Drafting…
            </>
          ) : (
            <>Draft for me</>
          )}
        </button>
        {!hasEnoughInfo ? (
          <p className="cz-help" style={{ marginTop: 8 }}>
            Add rent and city first to draft a title.
          </p>
        ) : null}
        {genError ? (
          <p className="cz-error" style={{ marginTop: 8 }}>
            {genError}
          </p>
        ) : null}
      </div>

      <div className="cz-field cz-field--full">
        <label className="cz-label" htmlFor="cz-title">
          Title
        </label>
        <input
          id="cz-title"
          className={`cz-input${fillCls("title")}`}
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="Sunlit 2BHK on a quiet lane near Indiranagar Metro"
        />
        {err("title") ? <p className="cz-error">{err("title")}</p> : null}
      </div>

      <div className="cz-field cz-field--full" style={{ marginTop: 22 }}>
        <label className="cz-label" htmlFor="cz-desc">
          Description
        </label>
        <textarea
          id="cz-desc"
          className={`cz-textarea${fillCls("description")}`}
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="Two paragraphs about the layout, the view, the people who fit best, the corners that make it feel like home…"
          rows={6}
        />
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        display: "inline-block",
        animation: "spin 0.6s linear infinite"
      }}
    />
  );
}
