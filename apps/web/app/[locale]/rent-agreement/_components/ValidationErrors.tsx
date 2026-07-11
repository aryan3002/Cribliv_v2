"use client";
import type { RaError } from "@/lib/rent-agreement/errors/ra-error";

export function ValidationErrors({ error }: { error: unknown }) {
  const e = error as RaError | null;
  if (!e) return null;
  if (e.code === "RENT_AGREEMENT_STEP_VALIDATION_FAILED" && e.fieldErrors?.length) {
    return (
      <div className="ra-error-box" role="alert">
        <b>Some fields need attention.</b>
        <ul>
          {e.fieldErrors.map((f, i) => (
            <li key={i}>
              <b>{f.field}</b>: {f.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p className="ra-error-box" role="alert">
      {e.code} · {e.message}
    </p>
  );
}
