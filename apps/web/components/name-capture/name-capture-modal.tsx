"use client";

import { useCallback, useEffect, useRef } from "react";
import { t, type Locale } from "../../lib/i18n";
import { NameCaptureForm } from "./name-capture-form";

export interface NameCaptureModalProps {
  locale: Locale;
  variant: "tenant" | "owner" | "contact";
  token: string;
  required: boolean;
  onSaved: (name: string) => void;
  onDismiss: () => void;
}

export function NameCaptureModal({
  locale,
  variant,
  token,
  required,
  onSaved,
  onDismiss
}: NameCaptureModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(() => {
    // The required variant has no exit that isn't saving.
    if (required) return;
    onDismiss();
  }, [onDismiss, required]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (required) {
        // Swallow it: without this the browser may still blur/close things and
        // the user perceives a dismissable dialog that isn't.
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onDismiss();
    };

    // Keep focus inside the dialog. Simpler than welcome-credits' explicit
    // first/last refs because this dialog's controls are not fixed in number.
    const onFocusIn = (event: FocusEvent) => {
      const node = event.target;
      if (node instanceof Node && !dialogRef.current?.contains(node)) {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        (focusables?.[0] ?? headingRef.current)?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [onDismiss, required]);

  const titleKey = required ? "nameCaptureTitleRequired" : "nameCaptureTitle";

  return (
    <div
      className="modal-overlay name-capture-overlay"
      role="dialog"
      aria-modal
      aria-label={t(locale, titleKey)}
      data-testid="name-capture-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className="modal name-capture-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title" ref={headingRef} tabIndex={-1}>
            {t(locale, titleKey)}
          </h2>
          {required ? null : (
            <button
              type="button"
              className="modal__close"
              aria-label={t(locale, "nameCaptureClose")}
              onClick={onDismiss}
              data-testid="name-capture-close"
            >
              ✕
            </button>
          )}
        </div>
        <div className="modal__body">
          <NameCaptureForm
            locale={locale}
            variant={variant}
            token={token}
            onSaved={onSaved}
            onSkip={required ? undefined : onDismiss}
            submitLabelKey={required ? "nameCaptureSaveAndContinue" : "nameCaptureSave"}
          />
        </div>
      </div>
    </div>
  );
}
