"use client";

import { useState } from "react";
import type { StepFormProps } from "./types";
import { step7Schema } from "@/lib/rent-agreement/schemas/step-7.zod";

export function Step7Form(props: StepFormProps) {
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = { agree_to_terms: agreeToTerms };
    const r = step7Schema.safeParse(payload);

    if (!r.success) {
      setError("You must agree to the terms to continue.");
      return;
    }

    setError(null);
    await props.onSubmit(r.data);
  }

  return (
    <form onSubmit={handleSubmit} className="ra-form">
      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Final confirmation</h2>
        <p className="ra-muted">
          Review your agreement details on the previous steps. By continuing you confirm everything
          is correct and agree to CribLiv&apos;s rent-agreement terms of service.
        </p>

        <div className="ra-checkbox-row">
          <input
            id="agree-to-terms"
            type="checkbox"
            checked={agreeToTerms}
            onChange={(e) => setAgreeToTerms(e.target.checked)}
          />
          <label htmlFor="agree-to-terms" className="ra-label">
            I agree to the terms
          </label>
        </div>
      </section>

      {error && (
        <p className="ra-error-box" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={props.busy} className="ra-button">
        {props.busy ? "Submitting…" : "Continue to checkout"}
        <span className="sr-only">Advance</span>
      </button>
    </form>
  );
}
