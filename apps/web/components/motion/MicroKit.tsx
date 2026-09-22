"use client";
/**
 * MicroKit — Cribliv's consistent micro-interaction layer.
 * Wraps the @cribliv/ui look (tokens from Part 0); reduced-motion safe throughout.
 *
 * Usage (3 lines):
 *   import { MotionButton, Toggle, Tabs, Skeleton, SkeletonSwap, useToasts, ToastViewport, usePageTransition } from "@/components/motion/MicroKit";
 *   const { toasts, push } = useToasts();
 *   <MotionButton variant="primary" loading={busy}>Request to book</MotionButton> <ToastViewport toasts={toasts} />
 */
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MayaOrb } from "./ListeningHeroMotion";

const EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
const POP = { type: "spring", stiffness: 420, damping: 24, mass: 0.7 } as const;
const GRADIENT = "linear-gradient(120deg,#0066ff 0%,#5b57ff 46%,#ff5a5f 100%)";
const INK = "#1a1a2e",
  SEC = "#64748b",
  GREEN = "#0d9f4f";

/* ── Button: press scale .97 + shadow tuck; primary = gradient + sheen; loading = orb spinner ── */
export function MotionButton({
  variant = "primary",
  loading = false,
  children,
  style,
  disabled,
  ...rest
}: {
  variant?: "primary" | "secondary" | "tertiary";
  loading?: boolean;
  children: React.ReactNode;
} & React.ComponentProps<typeof motion.button>) {
  const reduced = !!useReducedMotion();
  const [hover, setHover] = React.useState(false);
  const base: React.CSSProperties = {
    position: "relative",
    overflow: "hidden",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    padding: "0 22px",
    borderRadius: 9999,
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 14.5,
    cursor: disabled || loading ? "default" : "pointer",
    transition: "box-shadow .2s ease",
    opacity: disabled ? 0.55 : 1
  };
  const looks: Record<string, React.CSSProperties> = {
    primary: {
      border: "none",
      background: GRADIENT,
      color: "#fff",
      boxShadow: "0 8px 22px -8px rgba(91,87,255,.55)"
    },
    secondary: { border: "1.5px solid #0066ff", background: "#fff", color: "#0066ff" },
    tertiary: { border: "none", background: "transparent", color: "#0066ff" }
  };
  return (
    <motion.button
      whileTap={
        reduced || disabled || loading
          ? undefined
          : { scale: 0.97, boxShadow: "0 3px 10px -6px rgba(91,87,255,.5)" }
      }
      disabled={disabled || loading}
      aria-busy={loading}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      style={{ ...base, ...looks[variant], ...style }}
      {...rest}
    >
      {variant === "primary" && !reduced && (
        <motion.span
          aria-hidden
          animate={{ x: hover ? "220%" : "-120%" }}
          transition={{ duration: hover ? 0.7 : 0, ease: "easeOut" }}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: "45%",
            background: "linear-gradient(105deg, transparent, rgba(255,255,255,.35), transparent)",
            pointerEvents: "none"
          }}
        />
      )}
      <motion.span
        animate={{ opacity: loading ? 0 : 1, scale: loading ? 0.85 : 1 }}
        transition={{ duration: 0.2 }}
        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      >
        {children}
      </motion.span>
      <AnimatePresence>
        {loading && (
          <motion.span
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={POP}
            style={{ position: "absolute", display: "flex" }}
          >
            <motion.span
              animate={reduced ? {} : { rotate: 360 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
              style={{ display: "flex" }}
            >
              <MayaOrb state="idle" size={22} />
            </motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/* ── Toggle: springy thumb ── */
export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  const reduced = !!useReducedMotion();
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 48,
        height: 28,
        borderRadius: 9999,
        border: "none",
        cursor: "pointer",
        padding: 3,
        background: checked ? "#0066ff" : "#d5d9e0",
        display: "flex",
        justifyContent: checked ? "flex-end" : "flex-start",
        transition: "background .25s ease"
      }}
    >
      <motion.span
        layout
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
        style={{
          width: 22,
          height: 22,
          borderRadius: 9999,
          background: "#fff",
          boxShadow: "0 2px 6px rgba(26,26,46,.25)"
        }}
      />
    </button>
  );
}

/* ── Tabs: active pill slides between items (layoutId) ── */
export function Tabs({
  items,
  value,
  onChange
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const reduced = !!useReducedMotion();
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        background: "#f5f5f7",
        borderRadius: 9999,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
      }}
    >
      {items.map((it) => {
        const active = it === value;
        return (
          <button
            key={it}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it)}
            style={{
              position: "relative",
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: "8px 18px",
              borderRadius: 9999,
              fontSize: 13.5,
              fontWeight: 700,
              color: active ? INK : SEC,
              fontFamily: "inherit"
            }}
          >
            {active && (
              <motion.span
                layoutId="microkit-tab-pill"
                transition={
                  reduced ? { duration: 0 } : { type: "spring", stiffness: 450, damping: 32 }
                }
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 9999,
                  background: "#fff",
                  boxShadow: "0 2px 8px rgba(26,26,46,.12)"
                }}
              />
            )}
            <span style={{ position: "relative" }}>{it}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Skeleton + crossfade swap ── */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  style
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        width,
        height,
        borderRadius: radius,
        background: reduced
          ? "#eceef2"
          : "linear-gradient(90deg,#eceef2 25%,#f7f8fa 45%,#eceef2 65%)",
        backgroundSize: "220% 100%",
        animation: reduced ? "none" : "microkit-shimmer 1.4s linear infinite",
        ...style
      }}
    />
  );
}
/* Inject once (or copy into your global CSS): */
export const MICROKIT_KEYFRAMES = `@keyframes microkit-shimmer{from{background-position:180% 0;}to{background-position:-40% 0;}}`;

export function SkeletonSwap({
  loading,
  skeleton,
  children,
  index = 0
}: {
  loading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  index?: number;
}) {
  const reduced = !!useReducedMotion();
  return (
    <div style={{ position: "relative" }}>
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.div key="s" exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            {skeleton}
          </motion.div>
        ) : (
          <motion.div
            key="c"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EXPO, delay: reduced ? 0 : index * 0.07 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Toasts: slide up + settle; success check pop; error calm shake (once) ── */
export type Toast = { id: number; kind: "success" | "error"; text: string };
export function useToasts(ttlMs = 3800) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback(
    (kind: Toast["kind"], text: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, kind, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttlMs);
    },
    [ttlMs]
  );
  return { toasts, push };
}

export function ToastViewport({ toasts }: { toasts: Toast[] }) {
  const reduced = !!useReducedMotion();
  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 22,
        translate: "-50%",
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "center",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
      }}
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            role="status"
            layout
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.95 }}
            animate={
              reduced || t.kind === "success"
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 1, y: 0, scale: 1, x: [0, -5, 4, -2, 0] }
            }
            exit={{ opacity: 0, y: 8 }}
            transition={{ ...POP, x: { duration: 0.4, ease: "easeOut", delay: 0.25 } }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "11px 16px",
              borderRadius: 9999,
              background: "#0b1226",
              color: "#f4f7ff",
              fontSize: 14,
              fontWeight: 600,
              boxShadow: "0 16px 44px -12px rgba(7,11,22,.5)"
            }}
          >
            <motion.span
              initial={reduced ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ ...POP, delay: 0.15 }}
              style={{
                width: 18,
                height: 18,
                borderRadius: 9999,
                flex: "none",
                background: t.kind === "success" ? GREEN : "#ff5a5f",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              {t.kind === "success" ? (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
              ) : (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              )}
            </motion.span>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ── Route transitions: View Transitions API, fade fallback ── */
export function usePageTransition() {
  const reduced = !!useReducedMotion();
  return React.useCallback(
    (navigate: () => void) => {
      const svt = (document as Document & { startViewTransition?: (cb: () => void) => void })
        .startViewTransition;
      if (svt && !reduced) {
        try {
          svt.call(document, navigate);
          return;
        } catch {
          /* fall through */
        }
      }
      if (reduced) {
        navigate();
        return;
      }
      document.documentElement.classList.add("jm-fade-out");
      setTimeout(() => {
        navigate();
        document.documentElement.classList.remove("jm-fade-out");
      }, 220);
    },
    [reduced]
  );
}
