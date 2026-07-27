"use client";

import { useCallback, useId, useState } from "react";
import type { FullNameErrorCode } from "@cribliv/shared-types";
import { t, type Locale } from "../../lib/i18n";
import { saveFullName, validateFullName } from "../../lib/name-capture";

export interface NameCaptureFormProps {
  locale: Locale;
  /** Drives which body copy renders. */
  variant: "tenant" | "owner" | "contact";
  token: string;
  /** Omitted for the unskippable variants. When absent, no skip control renders. */
  onSkip?: () => void;
  onSaved: (name: string) => void;
  /** Label override; defaults to nameCaptureSave. */
  submitLabelKey?: string;
  autoFocus?: boolean;
}

const BODY_KEY: Record<NameCaptureFormProps["variant"], string> = {
  tenant: "nameCaptureBodyTenant",
  owner: "nameCaptureBodyOwner",
  contact: "nameCaptureBodyContact"
};

// Exhaustive over FullNameErrorCode (not a ternary) so a fifth error code
// added later fails the compiler here instead of silently falling into a
// catch-all with no prompt to pick real copy for it.
const ERROR_COPY_KEY: Record<FullNameErrorCode, string> = {
  too_short: "nameCaptureTooShort",
  too_long: "nameCaptureInvalid",
  no_letter: "nameCaptureInvalid",
  invalid_chars: "nameCaptureInvalid"
};

export function NameCaptureForm({
  locale,
  variant,
  token,
  onSkip,
  onSaved,
  submitLabelKey = "nameCaptureSave",
  autoFocus = true
}: NameCaptureFormProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (saving) return;

      // Validated with the same module the API uses, so a name that passes here
      // cannot 400 on the server for a rule reason.
      const parsed = validateFullName(value);
      if (!parsed.ok) {
        // parsed.message is zod's English default (for logs/non-UI callers);
        // the code is what drives localised copy so hi users don't see it.
        setError(t(locale, ERROR_COPY_KEY[parsed.code]));
        return;
      }
      if (parsed.value === null) {
        // Blank means "clear my name" elsewhere; in a capture prompt it is just
        // an empty submit, so re-use the too-short message rather than saving.
        setError(t(locale, "nameCaptureTooShort"));
        return;
      }

      setSaving(true);
      setError(null);
      try {
        await saveFullName(token, parsed.value);
        onSaved(parsed.value);
      } catch {
        setError(t(locale, "nameCaptureError"));
      } finally {
        setSaving(false);
      }
    },
    [locale, onSaved, saving, token, value]
  );

  return (
    <form className="name-capture-form" onSubmit={onSubmit} noValidate>
      <p className="name-capture-form__body">{t(locale, BODY_KEY[variant])}</p>

      <label className="name-capture-form__label" htmlFor={inputId}>
        {t(locale, "nameCaptureLabel")}
      </label>
      <input
        id={inputId}
        className="input"
        type="text"
        value={value}
        autoFocus={autoFocus}
        autoComplete="name"
        maxLength={80}
        placeholder={t(locale, "nameCapturePlaceholder")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        data-testid="name-capture-input"
        onChange={(event) => {
          setValue(event.target.value);
          // Clear on edit: leaving a stale error under a now-valid field reads
          // as the form being broken.
          if (error) setError(null);
        }}
      />

      {error ? (
        <p className="name-capture-form__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}

      <div className="name-capture-form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={saving}
          data-testid="name-capture-submit"
        >
          {saving ? t(locale, "nameCaptureSaving") : t(locale, submitLabelKey)}
        </button>
        {onSkip ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onSkip}
            disabled={saving}
            data-testid="name-capture-skip"
          >
            {t(locale, "nameCaptureSkip")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
