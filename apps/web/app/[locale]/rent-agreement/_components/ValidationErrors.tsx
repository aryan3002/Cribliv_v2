"use client";
import type { RaError } from "@/lib/rent-agreement/errors/ra-error";

export function ValidationErrors({ error }: { error: unknown }) {
  const e = error as RaError | null;
  if (!e) return null;
  if (e.code === "RENT_AGREEMENT_STEP_VALIDATION_FAILED" && e.fieldErrors?.length) {
    return (
      <ul className="text-red-700 text-sm list-disc pl-5">
        {e.fieldErrors.map((f, i) => (
          <li key={i}>
            <b>{f.field}</b>: {f.message}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="text-red-700 text-sm">
      {e.code} — {e.message}
    </p>
  );
}
