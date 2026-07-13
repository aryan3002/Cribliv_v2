"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Clock, Sparkles, X } from "lucide-react";
import { t, type Locale } from "../lib/i18n";
import {
  formatSignupRewardExpiry,
  markWelcomeShown,
  shouldShowWelcome
} from "../lib/welcome-credits";
import { trackEvent } from "../lib/analytics";

const REWARD_DAYS_VALID = 90;
const EXPERIENCE_VERSION = "reward_reveal_v2";
const PARTICLE_EDGES = [
  "top-left",
  "top-right",
  "left-upper",
  "right-upper",
  "left-lower",
  "right-lower",
  "bottom-left",
  "bottom-right"
] as const;

// The login page (/auth/login) redirects with a hard `window.location.href`
// navigation after signIn() succeeds, but NextAuth's client session can flip
// to "authenticated" a tick *before* that redirect fires — while the user is
// still looking at the login form. Since this modal is mounted globally in
// the locale layout, without this guard it would open (and mark itself
// "shown" in localStorage) on the login page itself, then get torn down by
// the redirect before the user ever sees it — burning the one-time flag for
// nothing. Suppress the effect while on /auth/* so it only ever fires once
// the user actually lands on their destination page.
const SUPPRESSED_PATHS = [/\/auth(\/|$)/];

interface SignupReward {
  creditsGranted: number;
  expiresAt: string | null;
}

type DismissReason = "escape" | "overlay" | "close";

function fillPlaceholders(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function readLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * One-time celebration on a new user's first landing after signup.
 * Fires only when session.isNewUser is set (first-ever OTP verify) and the
 * canonical reward is positive. The marker is written only after the dialog
 * mounts, so auth redirects cannot consume the one-time experience.
 */
export function WelcomeCreditsModal({ locale }: { locale: Locale }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const reduceMotion = Boolean(useReducedMotion());
  const [reward, setReward] = useState<SignupReward | null>(null);
  const [count, setCount] = useState(0);
  const firedRef = useRef(false);
  const shownRef = useRef(false);
  const storageRef = useRef<Storage | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);

  const suppressed = pathname ? SUPPRESSED_PATHS.some((re) => re.test(pathname)) : false;
  const userId = session?.user?.id;
  const creditsGranted = session?.signupReward?.creditsGranted;
  const expiresAt = session?.signupReward?.expiresAt;
  const eligibleForReward =
    !suppressed &&
    status === "authenticated" &&
    session?.isNewUser === true &&
    Boolean(userId) &&
    typeof creditsGranted === "number" &&
    creditsGranted > 0;

  const closeReward = useCallback((reason?: DismissReason) => {
    if (reason) {
      trackEvent("welcome_credits_dismissed", { reason });
    }
    setReward(null);
  }, []);

  useEffect(() => {
    if (firedRef.current) return;
    if (!eligibleForReward) return;
    if (typeof window === "undefined") return;
    if (!userId || !creditsGranted) return;

    const storage = readLocalStorage();
    storageRef.current = storage;
    if (
      storage &&
      !shouldShowWelcome({
        isNewUser: session.isNewUser,
        userId,
        creditsGranted,
        storage
      })
    ) {
      return;
    }

    firedRef.current = true;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReward({
      creditsGranted,
      expiresAt: expiresAt ?? null
    });
  }, [creditsGranted, eligibleForReward, expiresAt, session?.isNewUser, userId]);

  useEffect(() => {
    if (!reward || eligibleForReward) return;
    setReward(null);
  }, [eligibleForReward, reward]);

  useEffect(() => {
    if (!reward || !userId) return;

    if (!shownRef.current) {
      shownRef.current = true;
      if (storageRef.current) {
        markWelcomeShown(userId, storageRef.current);
      }
      trackEvent("welcome_credits_shown", {
        credits_granted: reward.creditsGranted,
        days_valid: REWARD_DAYS_VALID,
        experience_version: EXPERIENCE_VERSION
      });
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeReward("escape");
        return;
      }
      if (event.key !== "Tab") return;

      const firstControl = closeRef.current;
      const lastControl = ctaRef.current;
      if (!firstControl || !lastControl) return;

      const activeElement = document.activeElement;
      const focusIsOutside =
        activeElement instanceof Node && !dialogRef.current?.contains(activeElement);

      if (event.shiftKey) {
        if (
          activeElement === firstControl ||
          activeElement === headingRef.current ||
          focusIsOutside
        ) {
          event.preventDefault();
          lastControl.focus();
        }
        return;
      }

      if (activeElement === lastControl || activeElement === headingRef.current || focusIsOutside) {
        event.preventDefault();
        firstControl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [closeReward, reward, userId]);

  useEffect(() => {
    if (!reward) {
      setCount(0);
      return;
    }
    if (reduceMotion) {
      setCount(reward.creditsGranted);
      return;
    }

    setCount(0);
    let animationFrame = 0;
    let startedAt: number | null = null;
    const durationMs = 900;

    const updateCount = (timestamp: number) => {
      startedAt ??= timestamp;
      const progress = Math.min((timestamp - startedAt) / durationMs, 1);
      setCount(Math.round(reward.creditsGranted * progress));
      if (progress < 1) {
        animationFrame = requestAnimationFrame(updateCount);
      }
    };

    animationFrame = requestAnimationFrame(updateCount);
    return () => cancelAnimationFrame(animationFrame);
  }, [reduceMotion, reward]);

  if (!reward) return null;

  const expiryDate = reward.expiresAt ? formatSignupRewardExpiry(reward.expiresAt, locale) : "";
  const creditsFact = fillPlaceholders(t(locale, "welcomeRewardCreditsFact"), {
    credits: reward.creditsGranted
  });
  const expiryFact = expiryDate
    ? fillPlaceholders(t(locale, "welcomeRewardExpiryFact"), { date: expiryDate })
    : null;
  const liveMessage = expiryDate
    ? fillPlaceholders(t(locale, "welcomeRewardLive"), {
        credits: reward.creditsGranted,
        date: expiryDate
      })
    : creditsFact;

  const handleCta = () => {
    trackEvent("welcome_credits_cta_clicked", {
      credits_granted: reward.creditsGranted,
      experience_version: EXPERIENCE_VERSION
    });
    setReward(null);
  };

  return (
    <div
      className="welcome-reward-overlay"
      data-testid="welcome-reward-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          closeReward("overlay");
        }
      }}
    >
      <motion.div
        ref={dialogRef}
        className="welcome-reward"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-reward-heading"
        aria-describedby="welcome-reward-supporting welcome-reward-footnote"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 18 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={
          reduceMotion
            ? { duration: 0.12 }
            : { type: "spring", stiffness: 280, damping: 24, mass: 0.8 }
        }
      >
        <div
          className="welcome-reward__grid"
          data-testid="welcome-reward-grid"
          aria-hidden="true"
        />
        <div
          className={`welcome-reward__particles${
            reduceMotion ? " welcome-reward__particles--reduced" : ""
          }`}
          data-testid="welcome-reward-particles"
          aria-hidden="true"
        >
          {PARTICLE_EDGES.map((edge) => (
            <span
              key={edge}
              className={`welcome-reward__particle welcome-reward__particle--edge-${edge}`}
              data-testid="welcome-reward-particle"
            />
          ))}
        </div>

        <button
          ref={closeRef}
          type="button"
          className="welcome-reward__close"
          aria-label={t(locale, "welcomeRewardClose")}
          onClick={() => closeReward("close")}
        >
          <X size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="welcome-reward__content">
          <div className="welcome-reward__badge">
            <CheckCircle2 size={17} strokeWidth={2.2} aria-hidden="true" />
            <span>{t(locale, "welcomeRewardBadge")}</span>
          </div>

          <h2
            ref={headingRef}
            id="welcome-reward-heading"
            className="welcome-reward__heading"
            tabIndex={-1}
          >
            {t(locale, "welcomeRewardHeading")}
          </h2>
          <p id="welcome-reward-supporting" className="welcome-reward__supporting">
            {t(locale, "welcomeRewardSupporting")}
          </p>

          <div className="welcome-reward__token-stage">
            <div className="welcome-reward__rings" aria-hidden="true">
              <span />
              <span />
            </div>
            <motion.div
              className="welcome-reward__token"
              aria-hidden="true"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.72 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={reduceMotion ? { duration: 0 } : { delay: 0.18, duration: 0.44 }}
            >
              <span data-testid="welcome-credit-count">{count}</span>
            </motion.div>
          </div>

          <p className="welcome-reward__label">{t(locale, "welcomeRewardLabel")}</p>

          <div className="welcome-reward__facts">
            <div className="welcome-reward__fact">
              <Sparkles size={18} aria-hidden="true" />
              <span>{creditsFact}</span>
            </div>
            {expiryFact ? (
              <div className="welcome-reward__fact">
                <Clock size={18} aria-hidden="true" />
                <span>{expiryFact}</span>
              </div>
            ) : null}
          </div>

          <button ref={ctaRef} type="button" className="welcome-reward__cta" onClick={handleCta}>
            {t(locale, "welcomeRewardCta")}
          </button>

          <p id="welcome-reward-footnote" className="welcome-reward__footnote">
            {t(locale, "welcomeRewardFootnote")}
          </p>

          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {liveMessage}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
