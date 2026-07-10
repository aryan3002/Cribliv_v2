"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { t, type Locale } from "../lib/i18n";
import { shouldShowWelcome, markWelcomeShown } from "../lib/welcome-credits";
import { trackEvent } from "../lib/analytics";

const CONFETTI_PIECES = 24;

/**
 * One-time celebration on a new user's first landing after signup.
 * Fires only when session.isNewUser is set (first-ever OTP verify) and the
 * per-user localStorage marker is absent; marks immediately on open so a
 * mid-animation reload can't re-trigger it.
 */
export function WelcomeCreditsModal({ locale }: { locale: Locale }) {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  const role = session?.user?.role;
  const isOwnerSide = role === "owner" || role === "pg_operator";

  useEffect(() => {
    if (status !== "authenticated") return;
    if (typeof window === "undefined") return;
    const userId = session?.user?.id;
    if (
      shouldShowWelcome({
        isNewUser: session?.isNewUser,
        userId,
        storage: window.localStorage
      })
    ) {
      markWelcomeShown(userId!, window.localStorage);
      setOpen(true);
      trackEvent("welcome_credits_shown", { role: role ?? "tenant" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session, role]);

  useEffect(() => {
    if (!open) return;
    const timers = [setTimeout(() => setCount(1), 600), setTimeout(() => setCount(2), 1100)];
    return () => timers.forEach(clearTimeout);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal
      aria-label={t(locale, "welcomeTitle")}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <motion.div
        className="modal"
        style={{
          maxWidth: 420,
          width: "min(420px, 94vw)",
          textAlign: "center",
          overflow: "hidden",
          position: "relative"
        }}
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {Array.from({ length: CONFETTI_PIECES }, (_, i) => (
            <motion.span
              key={i}
              initial={{ y: -20, x: `${(i * 41) % 100}%`, opacity: 1, rotate: 0 }}
              animate={{ y: 480, rotate: 360 * ((i % 3) + 1), opacity: 0 }}
              transition={{ duration: 2.2 + (i % 5) * 0.3, delay: (i % 7) * 0.12, ease: "easeIn" }}
              style={{
                position: "absolute",
                width: 8,
                height: 12,
                borderRadius: 2,
                background: ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899"][i % 4]
              }}
            />
          ))}
        </div>
        <div className="modal__body" style={{ padding: "var(--space-6) var(--space-5)" }}>
          <h2 className="modal__title" style={{ marginBottom: "var(--space-3)" }}>
            {t(locale, "welcomeTitle")}
          </h2>
          <motion.div
            data-testid="welcome-credit-count"
            initial={{ scale: 0.6 }}
            animate={{ scale: count === 2 ? [1.2, 1] : 1 }}
            style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}
          >
            ✦ {count}
          </motion.div>
          <p
            className="body-sm"
            style={{ color: "var(--text-secondary)", margin: "var(--space-3) 0 var(--space-5)" }}
          >
            {t(locale, isOwnerSide ? "welcomeOwnerBody" : "welcomeTenantBody")}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            style={{ width: "100%" }}
            onClick={() => setOpen(false)}
          >
            {t(locale, "welcomeCta")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
