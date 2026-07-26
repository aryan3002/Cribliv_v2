"use client";
/**
 * VoiceListingMotion — Maya listens and the listing fills itself.
 * Motion/orchestration layer only: your wizard keeps its own state; drive these via props/callbacks.
 *
 * Usage (3 lines):
 *   import { FieldFill, StrengthMeter, ConfirmChip, PublishCelebration } from "@/components/motion/VoiceListingMotion";
 *   import { MayaOrb, Waveform } from "@/components/motion/ListeningHeroMotion";
 *   <FieldFill label="Locality" value={v} status={s} onFilled={next} /> <StrengthMeter value={0.75} />
 */
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MayaOrb } from "./ListeningHeroMotion";

const EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
const POP = { type: "spring", stiffness: 420, damping: 24, mass: 0.7 } as const;
const AMBER = "#f59e0b",
  GREEN = "#0d9f4f",
  INK = "#1a1a2e",
  SEC = "#64748b";
const GRADIENT = "linear-gradient(120deg,#0066ff 0%,#5b57ff 46%,#ff5a5f 100%)";

export type FieldStatus = "empty" | "filling" | "done";

/* Amber flash while filling, value types in, green check taps on done.
   status="filling" starts the type-in; onFilled fires when typing completes. */
export function FieldFill({
  label,
  value,
  status,
  onFilled,
  typeMsPerChar = 34,
  style
}: {
  label: string;
  value: string;
  status: FieldStatus;
  onFilled?: () => void;
  typeMsPerChar?: number;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  const [text, setText] = React.useState(status === "done" ? value : "");
  const doneRef = React.useRef(onFilled);
  doneRef.current = onFilled;
  React.useEffect(() => {
    if (status === "empty") {
      setText("");
      return;
    }
    if (status === "done") {
      setText(value);
      return;
    }
    if (reduced) {
      setText(value);
      doneRef.current?.();
      return;
    }
    const chars = Array.from(value);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setText(chars.slice(0, i).join(""));
      if (i >= chars.length) {
        clearInterval(id);
        doneRef.current?.();
      }
    }, typeMsPerChar);
    return () => clearInterval(id);
  }, [status, value, reduced, typeMsPerChar]);
  const active = status === "filling";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 12,
        background: active ? "#fef3e2" : "#fff",
        border: `1px solid ${active ? "#fcd9a0" : "#e4e7ec"}`,
        transition: "background .35s ease, border-color .35s ease",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        ...style
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: SEC
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: INK,
            minHeight: 22,
            fontVariantNumeric: "tabular-nums"
          }}
        >
          {text || <span style={{ color: "#c3c9d4", fontWeight: 500 }}>—</span>}
          {active && !reduced && (
            <span aria-hidden style={{ borderRight: `2px solid ${AMBER}`, marginLeft: 1 }} />
          )}
        </div>
      </div>
      <AnimatePresence>
        {status === "done" && (
          <motion.span
            initial={reduced ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={POP}
            style={{
              width: 20,
              height: 20,
              borderRadius: 9999,
              background: GREEN,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none"
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/* Listing-strength meter: springs toward value; amber → green past `good`. */
export function StrengthMeter({
  value,
  good = 0.7,
  label = "Listing strength",
  style
}: {
  value: number;
  good?: number;
  label?: string;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  const v = Math.max(0, Math.min(1, value));
  const isGood = v >= good;
  return (
    <div style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          fontWeight: 700,
          marginBottom: 6
        }}
      >
        <span style={{ color: SEC }}>{label}</span>
        <span
          aria-live="polite"
          style={{ color: isGood ? GREEN : "#b45309", fontVariantNumeric: "tabular-nums" }}
        >
          {Math.round(v * 100)}%{isGood ? " · Good" : ""}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 9999, background: "#f5f5f7", overflow: "hidden" }}>
        <motion.div
          initial={false}
          animate={{ scaleX: v, backgroundColor: isGood ? GREEN : AMBER }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 22 }}
          style={{ height: "100%", borderRadius: 9999, transformOrigin: "left", scaleX: 0 }}
        />
      </div>
    </div>
  );
}

/* Ambiguity confirm chip: slides up; tapping confirms with a pop. */
export function ConfirmChip({
  question,
  yes = "✓ हाँ",
  no = "✕ नहीं",
  onYes,
  onNo,
  style
}: {
  question: string;
  yes?: string;
  no?: string;
  onYes: () => void;
  onNo: () => void;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  return (
    <motion.div
      role="group"
      aria-label={question}
      initial={reduced ? false : { opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10 }}
      transition={POP}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 10px 9px 16px",
        background: "#0b1226",
        color: "#f4f7ff",
        borderRadius: 9999,
        boxShadow: "0 14px 40px -12px rgba(7,11,22,.5)",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 14,
        fontWeight: 600,
        ...style
      }}
    >
      {question}
      <motion.button
        whileTap={reduced ? undefined : { scale: 0.92 }}
        onClick={onYes}
        style={{
          border: "none",
          cursor: "pointer",
          padding: "7px 14px",
          borderRadius: 9999,
          background: GREEN,
          color: "#fff",
          fontWeight: 700,
          fontSize: 13.5,
          fontFamily: "inherit"
        }}
      >
        {yes}
      </motion.button>
      <motion.button
        whileTap={reduced ? undefined : { scale: 0.92 }}
        onClick={onNo}
        style={{
          border: "1px solid rgba(255,255,255,.25)",
          cursor: "pointer",
          padding: "7px 14px",
          borderRadius: 9999,
          background: "transparent",
          color: "#f4f7ff",
          fontWeight: 700,
          fontSize: 13.5,
          fontFamily: "inherit"
        }}
      >
        {no}
      </motion.button>
    </motion.div>
  );
}

/* Restrained success: one gradient ring, rising "You're live ✨", card assembles. */
export function PublishCelebration({
  show,
  title = "You're live ✨",
  card,
  onDone,
  doneAfterMs = 2600
}: {
  show: boolean;
  title?: string;
  card?: React.ReactNode;
  onDone?: () => void;
  doneAfterMs?: number;
}) {
  const reduced = !!useReducedMotion();
  React.useEffect(() => {
    if (!show) return;
    const id = setTimeout(() => onDone?.(), reduced ? 400 : doneAfterMs);
    return () => clearTimeout(id);
  }, [show, reduced, doneAfterMs, onDone]);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 22,
            background: "rgba(255,253,250,.94)",
            backdropFilter: "blur(6px)",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
          }}
        >
          <div style={{ position: "relative", width: 96, height: 96 }}>
            {!reduced && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0.6, scale: 0.7 }}
                animate={{ opacity: 0, scale: 2.1 }}
                transition={{ duration: 0.9, ease: "easeOut", delay: 0.1 }}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 9999,
                  padding: 3,
                  background: GRADIENT,
                  WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                  WebkitMaskComposite: "xor",
                  maskComposite: "exclude"
                }}
              />
            )}
            <MayaOrb state={reduced ? "idle" : "speaking"} size={96} />
          </div>
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EXPO, delay: 0.2 }}
            style={{
              fontFamily: "Manrope, Inter, sans-serif",
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: "-.03em",
              color: INK
            }}
          >
            {title}
          </motion.div>
          {card && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 20, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ ...POP, delay: 0.45 }}
            >
              {card}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
