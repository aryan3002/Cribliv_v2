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
    <form onSubmit={handleSubmit}>
      <p>
        This is the final step. Review your agreement details on the previous steps. By continuing
        you confirm everything is correct and agree to CribLiv&apos;s rent-agreement terms of
        service.
      </p>

      <div>
        <input
          id="agree-to-terms"
          type="checkbox"
          checked={agreeToTerms}
          onChange={(e) => setAgreeToTerms(e.target.checked)}
        />
        <label htmlFor="agree-to-terms">I agree to the terms</label>
      </div>

      {error && <p>{error}</p>}

      <button
        type="submit"
        disabled={props.busy}
        className="px-3 py-1 border rounded bg-blue-600 text-white disabled:opacity-50"
      >
        {props.busy ? "Submitting…" : "Advance"}
      </button>
    </form>
  );
}
