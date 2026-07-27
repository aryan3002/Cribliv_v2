"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Required has no exit that isn't saving — UNLESS a save attempt has
  // actually failed (PATCH /users/me: network drop, 500). requireName one
  // layer up (lib/name-capture.ts) already fails OPEN when the name *lookup*
  // fails; a required modal that fails CLOSED with zero escape when the save
  // itself fails is the same class of bug from the other side — the user is
  // stuck behind a dead endpoint with only a page reload to get out. Once
  // NameCaptureForm reports a save error via onSaveError below, this flips
  // true and every trap below (Escape, overlay click, close button) stands
  // down, same as the non-required path.
  const [saveFailed, setSaveFailed] = useState(false);
  // Mirrors saveFailed for the mount-only effect's onKeyDown closure below,
  // which cannot see later renders' state directly (the effect's own deps
  // deliberately exclude saveFailed — see that effect's comment). Assigned
  // during render, not inside the effect, so it is always current by the
  // time any keydown fires without needing the effect to re-run.
  const saveFailedRef = useRef(false);
  saveFailedRef.current = saveFailed;

  const dismiss = useCallback(() => {
    if (required && !saveFailed) return;
    onDismiss();
  }, [onDismiss, required, saveFailed]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Reads the ref, not `saveFailed` directly: this effect runs once (on
      // mount — its deps below deliberately exclude saveFailed so a save
      // failure doesn't tear down and re-run the focus/scroll-lock setup
      // above), so a closure over the state variable itself would freeze at
      // its mount-time value (always `false`) and never see a later failure.
      if (required && !saveFailedRef.current) {
        // Swallow it completely: without this the browser may still blur/close
        // things and the user perceives a dismissable dialog that isn't. The
        // stated guarantee for required mode (while no save has failed yet)
        // is that NOTHING else in the tree reacts to this Escape press, so
        // stop it from propagating any further too — e.g. header-menu.tsx's
        // nav-dropdown closer also listens for Escape on `document` and must
        // not fire. Because this listener is itself attached to `document`,
        // plain stopPropagation() cannot stop sibling document-level
        // listeners; stopImmediatePropagation() is what actually prevents
        // other document listeners registered (before or after this one)
        // from running for this event.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      onDismiss();
    };

    // Keep focus inside the dialog. Simpler than welcome-credits' explicit
    // first/last refs because this dialog's controls are not fixed in number.
    const onFocusIn = (event: FocusEvent) => {
      const node = event.target;
      if (!(node instanceof Node) || dialogRef.current?.contains(node)) return;

      // Do NOT pull focus back if it landed inside a DIFFERENT dialog.
      // WelcomeCreditsModal can be mounted at the same time as this one and
      // sits visually above it (z-index 120 vs. this modal's 110), running
      // its own independent Tab-cycling focus trap. Without this guard, this
      // handler would keep yanking focus back to itself from behind, making
      // the visually-topmost WelcomeCreditsModal's controls effectively
      // unfocusable even though the z-index ordering looks correct — the
      // trap would win at the interaction level while losing visually. Guard
      // for non-Element nodes since a focusin target can be any Node. Do not
      // simplify this away.
      const otherDialog = node instanceof Element ? node.closest('[role="dialog"]') : null;
      if (otherDialog && otherDialog !== overlayRef.current) return;

      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      (focusables?.[0] ?? headingRef.current)?.focus({ preventScroll: true });
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
    };
    // saveFailed is deliberately NOT a dep: this effect's cleanup restores
    // focus/scroll to their pre-open state, which must only happen on actual
    // unmount, not merely because a save attempt failed while still open.
    // onKeyDown reads saveFailedRef (kept fresh every render, above) instead.
  }, [onDismiss, required]);

  const titleKey = required ? "nameCaptureTitleRequired" : "nameCaptureTitle";

  return (
    <div
      ref={overlayRef}
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
          {required && !saveFailed ? null : (
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
            onSaveError={() => setSaveFailed(true)}
            submitLabelKey={required ? "nameCaptureSaveAndContinue" : "nameCaptureSave"}
            // NameCaptureForm defaults autoFocus to true, but React focuses
            // autoFocus elements during commit — synchronously, and before
            // ANY effect (including this modal's own useEffect above) runs.
            // Left at the default, the input grabs focus first, so by the
            // time this modal's effect reads document.activeElement to
            // remember what to restore focus to on close, it captures the
            // form's own input instead of whatever was focused on the page
            // before this modal opened — and restoring focus to that input
            // on unmount then silently no-ops, since it is being removed in
            // the same unmount. The heading still ends up focused either way
            // (see the explicit headingRef.current.focus() call below), so
            // disabling this changes no visible behaviour, only which
            // element previousFocusRef captures.
            autoFocus={false}
          />
        </div>
      </div>
    </div>
  );
}
