"use client";
/**
 * TrustMotion — verification motion kit. Calm, one pulse, never loops (except the tiny live dot).
 *
 * Usage (3 lines):
 *   import { VerifiedStamp, LiveCounter, RentReveal, SafetyRow } from "@/components/motion/TrustMotion";
 *   <VerifiedStamp date="12 Jul 2026" />  <LiveCounter from={0} to={1240} suffix=" homes" />
 *   <RentReveal rent={18000} />  <SafetyRow />
 */
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

const GREEN = "#0d9f4f",
  AMBER = "#f59e0b",
  INK = "#1a1a2e",
  SEC = "#64748b";
const POP = { type: "spring", stiffness: 420, damping: 24, mass: 0.7 } as const;
const EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/* Shield/check taps in with a spring pop + one-shot ring pulse; date fades after. */
export function VerifiedStamp({
  date,
  size = 28,
  delay = 0
}: {
  date?: string;
  size?: number;
  delay?: number;
}) {
  const reduced = !!useReducedMotion();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ position: "relative", width: size, height: size, display: "inline-block" }}>
        {!reduced && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0.5, scale: 1 }}
            animate={{ opacity: 0, scale: 1.9 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: delay + 0.18 }}
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 9999,
              border: `2px solid ${GREEN}`
            }}
          />
        )}
        <motion.span
          initial={reduced ? false : { scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...POP, delay }}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9999,
            background: GREEN
          }}
        >
          <svg
            width={size * 0.55}
            height={size * 0.55}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        </motion.span>
      </span>
      {date && (
        <motion.span
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: delay + 0.35 }}
          style={{ fontSize: 12.5, fontWeight: 700, color: GREEN }}
        >
          Verified {date}
        </motion.span>
      )}
    </span>
  );
}

/* Number rolls up (ease-out, tabular), soft amber glow on settle; tiny live dot. */
export function LiveCounter({
  from = 0,
  to,
  suffix = "",
  duration = 0.9,
  locale = "en-IN",
  style
}: {
  from?: number;
  to: number;
  suffix?: string;
  duration?: number;
  locale?: string;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const [settled, setSettled] = React.useState(reduced);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      el.textContent = to.toLocaleString(locale);
      setSettled(true);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / (duration * 1000)),
        e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString(locale);
      if (k < 1) raf = requestAnimationFrame(step);
      else setSettled(true);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [from, to, duration, locale, reduced]);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, ...style }}>
      <motion.span
        aria-hidden
        animate={reduced ? { opacity: 1 } : { opacity: [1, 0.35, 1] }}
        transition={{ duration: 1.4, repeat: reduced ? 0 : Infinity, ease: "easeInOut" }}
        style={{
          width: 7,
          height: 7,
          borderRadius: 9999,
          background: AMBER,
          display: "inline-block"
        }}
      />
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          fontWeight: 800,
          color: INK,
          transition: "text-shadow .8s ease",
          textShadow: settled && !reduced ? `0 0 14px ${AMBER}66` : "none"
        }}
      >
        <span ref={ref}>{reduced ? to.toLocaleString(locale) : from.toLocaleString(locale)}</span>
        {suffix}
      </span>
    </span>
  );
}

/* ₹ figure counts up; amber underline wipes left→right beneath it. */
export function RentReveal({
  rent,
  per = "/mo",
  duration = 0.8,
  locale = "en-IN",
  style
}: {
  rent: number;
  per?: string;
  duration?: number;
  locale?: string;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      el.textContent = rent.toLocaleString(locale);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / (duration * 1000)),
        e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(rent * e).toLocaleString(locale);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rent, duration, locale, reduced]);
  return (
    <span style={{ display: "inline-block", position: "relative", paddingBottom: 4, ...style }}>
      <span
        style={{
          fontFamily: "Manrope, Inter, sans-serif",
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          color: INK
        }}
      >
        ₹<span ref={ref}>{reduced ? rent.toLocaleString(locale) : 0}</span>
        <span style={{ fontSize: "0.55em", fontWeight: 500, color: SEC }}>{per}</span>
      </span>
      <motion.span
        aria-hidden
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, ease: EXPO, delay: 0.15 }}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 3,
          borderRadius: 2,
          background: AMBER,
          transformOrigin: "left"
        }}
      />
    </span>
  );
}

/* 3 trust points stagger in with small check pops. */
export function SafetyRow({
  items = ["Verified owner", "Real photos", "No brokerage"],
  stagger = 0.09,
  style
}: {
  items?: string[];
  stagger?: number;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        flexWrap: "wrap",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        ...style
      }}
    >
      {items.map((it, i) => (
        <motion.span
          key={it}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EXPO, delay: i * stagger }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13.5,
            fontWeight: 600,
            color: SEC
          }}
        >
          <motion.span
            initial={reduced ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ ...POP, delay: 0.12 + i * stagger }}
            style={{
              width: 17,
              height: 17,
              borderRadius: 9999,
              background: "#e7f7ee",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none"
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke={GREEN}
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </motion.span>
          {it}
        </motion.span>
      ))}
    </div>
  );
}
