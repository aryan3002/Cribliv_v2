"use client";
/**
 * JourneyMotion — Cribliv search→map→listing choreography, all transform/opacity.
 * Reuses MayaOrb / LockChip / RollingCount from ./ListeningHeroMotion.
 *
 * Usage (3 lines):
 *   import { SmartQueryBar, MapHandoff, MapPricePin, ListingCard, RevealSection, Gallery, StickyVisitBar, useViewTransitionNav } from "@/components/motion/JourneyMotion";
 *   const nav = useViewTransitionNav();
 *   <SmartQueryBar chips={chips} count={count} onSubmit={() => nav(() => router.push("/map"))} … />
 */
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MayaOrb, RollingCount, EASE_EXPO, SPRING_POP, type OrbState } from "./ListeningHeroMotion";

/* ── 1 · SmartQueryBar ───────────────────────────────────────────────── */
export type ChipKind = "locality" | "bhk" | "budget" | "furnishing";
export type ParsedChip = { id: string; label: string; kind: ChipKind };

const CHIP_TONES: Record<ChipKind, { bg: string; fg: string; bd: string }> = {
  locality: { bg: "#ebf3ff", fg: "#0052cc", bd: "#bcd6ff" },
  bhk: { bg: "#efeeff", fg: "#4340c4", bd: "#c9c7ff" },
  budget: { bg: "#fef3e2", fg: "#b45309", bd: "#fcd9a0" },
  furnishing: { bg: "#e7f7ee", fg: "#0d7a3f", bd: "#b8e6cb" }
};

export function SmartQueryBar({
  value,
  onChange,
  onSubmit,
  chips,
  count,
  refining = false,
  orbState = "idle",
  getLevel,
  onMicToggle,
  placeholder = "2 BHK near Hazratganj under ₹18k",
  style
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  chips: ParsedChip[];
  count: number;
  refining?: boolean;
  orbState?: OrbState;
  getLevel?: () => number;
  onMicToggle?: () => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 20,
        padding: "10px 12px 8px",
        boxShadow: "0 14px 40px -18px rgba(26,26,46,.25)",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        ...style
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <MayaOrb state={orbState} getLevel={getLevel} size={38} />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
          placeholder={placeholder}
          aria-label="Search homes"
          style={{
            flex: 1,
            minWidth: 0,
            height: 42,
            border: "none",
            outline: "none",
            fontSize: 16,
            fontFamily: "inherit",
            color: "#1a1a2e",
            background: "transparent"
          }}
        />
        {onMicToggle && (
          <button
            onClick={onMicToggle}
            aria-pressed={orbState === "listening"}
            aria-label="Search by voice"
            style={{
              width: 40,
              height: 40,
              flex: "none",
              borderRadius: 9999,
              cursor: "pointer",
              border: `1px solid ${orbState === "listening" ? "#f59e0b" : "#dfe3ea"}`,
              background: orbState === "listening" ? "#fef3e2" : "#fff",
              color: orbState === "listening" ? "#b45309" : "#64748b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>
        )}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 7,
          minHeight: 36,
          marginTop: 4,
          paddingLeft: 48
        }}
      >
        <AnimatePresence mode="popLayout">
          {chips.map((c) => {
            const tone = CHIP_TONES[c.kind];
            return (
              <motion.span
                key={c.id}
                layout
                initial={reduced ? false : { opacity: 0, scale: 0.55 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={SPRING_POP}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "5px 11px",
                  borderRadius: 9999,
                  fontSize: 13,
                  fontWeight: 700,
                  background: tone.bg,
                  color: tone.fg,
                  border: `1px solid ${tone.bd}`,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap"
                }}
              >
                {c.label}
              </motion.span>
            );
          })}
        </AnimatePresence>
        {refining && (
          <motion.span
            aria-label="Maya is refining"
            animate={reduced ? {} : { opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            style={{
              display: "inline-flex",
              padding: "5px 12px",
              borderRadius: 9999,
              fontSize: 13,
              fontWeight: 800,
              background: "#f5f5f7",
              color: "#64748b",
              border: "1px dashed #d5d9e0",
              letterSpacing: ".12em"
            }}
          >
            …
          </motion.span>
        )}
        <span style={{ flex: 1 }} />
        <span
          aria-live="polite"
          style={{ fontSize: 13, fontWeight: 600, color: "#64748b", whiteSpace: "nowrap" }}
        >
          <RollingCount value={count} /> homes
        </span>
      </div>
    </div>
  );
}

/* ── 2 · MapHandoff ──────────────────────────────────────────────────── */
export type MapPinData = {
  id: string;
  x: number;
  y: number; // percent coords
  label?: string;
  count?: number; // count set → cluster bubble
  matched?: boolean;
  featured?: boolean;
};

/** View Transition wrapper (fallback: quick fade via .jm-fade-out on <html>). */
export function useViewTransitionNav() {
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

/** Pins bloom outward from center (stagger by distance); non-matching dim to 15%. */
export function MapHandoff({
  pins,
  active = true,
  center = { x: 50, y: 50 },
  onPinClick,
  style,
  children
}: {
  pins: MapPinData[];
  active?: boolean;
  center?: { x: number; y: number };
  onPinClick?: (pin: MapPinData) => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const reduced = !!useReducedMotion();
  const maxDist = React.useMemo(
    () => Math.max(1, ...pins.map((p) => Math.hypot(p.x - center.x, p.y - center.y))),
    [pins, center]
  );
  return (
    <div style={{ position: "relative", overflow: "hidden", ...style }}>
      {children /* your map tiles / backdrop */}
      {pins.map((p) => {
        const delay = (Math.hypot(p.x - center.x, p.y - center.y) / maxDist) * 0.4;
        const matched = p.matched !== false;
        return (
          <motion.button
            key={p.id}
            onClick={() => onPinClick?.(p)}
            aria-label={p.count ? `${p.count} homes` : p.label}
            initial={reduced ? false : { opacity: 0, scale: 0 }}
            animate={active ? { opacity: matched ? 1 : 0.15, scale: 1 } : { opacity: 0, scale: 0 }}
            transition={{ ...SPRING_POP, delay: reduced ? 0 : delay }}
            whileHover={reduced || !matched ? {} : { scale: 1.08 }}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${p.y}%`,
              translate: "-50% -50%",
              cursor: matched ? "pointer" : "default",
              border: "none",
              padding: 0,
              background: "none",
              fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
            }}
          >
            {p.count ? (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 42,
                  height: 42,
                  borderRadius: 9999,
                  background: "#0066ff",
                  color: "#fff",
                  border: "3px solid #fff",
                  fontFamily: "Manrope, Inter, sans-serif",
                  fontWeight: 800,
                  fontSize: 15,
                  boxShadow: "0 4px 12px rgba(0,102,255,.4)",
                  fontVariantNumeric: "tabular-nums"
                }}
              >
                {p.count}
              </span>
            ) : (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 11px",
                  borderRadius: 9999,
                  background: p.featured ? "#ff5a5f" : "#fff",
                  color: p.featured ? "#fff" : "#1a1a2e",
                  border: p.featured ? "2.5px solid #fff" : "none",
                  fontSize: 12.5,
                  fontWeight: p.featured ? 800 : 700,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  boxShadow: p.featured
                    ? "0 8px 20px rgba(255,90,95,.5)"
                    : "0 4px 14px rgba(26,26,46,.22)"
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 9999,
                    background: p.featured ? "#fff" : "#0066ff"
                  }}
                />
                {p.label}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

/* ── 3 · ListingCard ─────────────────────────────────────────────────── */
export function ListingCard({
  title,
  locality,
  rent,
  verified,
  replyTime,
  image,
  onAskMaya,
  onClick,
  index = 0,
  locale = "en"
}: {
  title: string;
  locality: string;
  rent: number;
  verified?: boolean;
  replyTime?: string;
  image?: React.ReactNode;
  onAskMaya?: () => void;
  onClick?: () => void;
  index?: number;
  locale?: "en" | "hi";
}) {
  const reduced = !!useReducedMotion();
  return (
    <motion.article
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_EXPO, delay: reduced ? 0 : index * 0.06 }}
      whileHover={reduced ? undefined : "hover"}
      variants={{ hover: { y: -4 } }}
      onClick={onClick}
      style={{
        background: "#fff",
        borderRadius: 20,
        overflow: "hidden",
        border: "1px solid #e4e7ec",
        boxShadow: "0 6px 18px -10px rgba(26,26,46,.18)",
        cursor: onClick ? "pointer" : "default",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        position: "relative"
      }}
    >
      <div style={{ position: "relative", height: 148, overflow: "hidden", background: "#eef1f5" }}>
        <motion.div
          initial={reduced ? false : { scale: 1.03 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.7, ease: EASE_EXPO, delay: index * 0.06 }}
          style={{ position: "absolute", inset: 0 }}
        >
          {image ?? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "repeating-linear-gradient(135deg,#eef1f5 0 10px,#e4e8ee 10px 20px)"
              }}
            />
          )}
        </motion.div>
        {verified && (
          <motion.span
            initial={reduced ? false : { opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...SPRING_POP, delay: reduced ? 0 : 0.25 + index * 0.06 }}
            style={{
              position: "absolute",
              left: 10,
              top: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 9999,
              background: "#0d9f4f",
              color: "#fff",
              fontSize: 11.5,
              fontWeight: 800
            }}
          >
            ✓ Verified
          </motion.span>
        )}
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span
            style={{
              fontFamily: "Manrope, Inter, sans-serif",
              fontWeight: 800,
              fontSize: 18,
              color: "#1a1a2e",
              fontVariantNumeric: "tabular-nums"
            }}
          >
            ₹<RollingCount value={rent} style={{ color: "#1a1a2e" }} />
            <span style={{ fontSize: 11.5, fontWeight: 500, color: "#64748b" }}>/mo</span>
          </span>
          {replyTime && (
            <span style={{ fontSize: 11.5, color: "#0d9f4f", fontWeight: 700 }}>{replyTime}</span>
          )}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a2e", marginTop: 3 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 1 }}>{locality}</div>
      </div>
      {onAskMaya && (
        <motion.button
          onClick={(e) => {
            e.stopPropagation();
            onAskMaya();
          }}
          variants={{ hover: { opacity: 1, y: 0 } }}
          initial={reduced ? { opacity: 1 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.25, ease: EASE_EXPO }}
          style={{
            position: "absolute",
            right: 10,
            bottom: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 11px",
            borderRadius: 9999,
            border: "none",
            cursor: "pointer",
            background: "linear-gradient(120deg,#0066ff 0%,#5b57ff 46%,#ff5a5f 100%)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "inherit",
            boxShadow: "0 6px 18px -6px rgba(91,87,255,.55)"
          }}
        >
          <MayaOrb state="idle" size={14} />
          {locale === "hi" ? "Maya से पूछें" : "Ask Maya about this"}
        </motion.button>
      )}
    </motion.article>
  );
}

/* ── 4 · ListingDetail primitives ────────────────────────────────────── */
/** Section reveals when scrolled into view (once). */
export function RevealSection({
  children,
  delay = 0,
  style,
  className
}: {
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const reduced = !!useReducedMotion();
  return (
    <motion.section
      className={className}
      style={style}
      initial={reduced ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: EASE_EXPO, delay }}
    >
      {children}
    </motion.section>
  );
}

/** Cross-fading photo gallery. images: ReactNodes (e.g. <img> or styled divs). */
export function Gallery({
  images,
  height = 320,
  style
}: {
  images: React.ReactNode[];
  height?: number;
  style?: React.CSSProperties;
}) {
  const [i, setI] = React.useState(0);
  const reduced = !!useReducedMotion();
  return (
    <div style={{ ...style }}>
      <div
        style={{
          position: "relative",
          height,
          borderRadius: 20,
          overflow: "hidden",
          background: "#eef1f5"
        }}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={i}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            style={{ position: "absolute", inset: 0 }}
          >
            {images[i]}
          </motion.div>
        </AnimatePresence>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {images.map((_, k) => (
          <button
            key={k}
            onClick={() => setI(k)}
            aria-label={`Photo ${k + 1}`}
            aria-current={k === i}
            style={{
              width: 44,
              height: 32,
              borderRadius: 8,
              cursor: "pointer",
              padding: 0,
              overflow: "hidden",
              border: k === i ? "2px solid #0066ff" : "1px solid #e4e7ec",
              background: "#e4e8ee",
              opacity: k === i ? 1 : 0.65
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Sticky bar slides up once after the user scrolls past `threshold` px. */
export function StickyVisitBar({
  locale = "en",
  onCta,
  threshold = 420
}: {
  locale?: "en" | "hi";
  onCta?: () => void;
  threshold?: number;
}) {
  const reduced = !!useReducedMotion();
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (shown) return;
    const onScroll = () => {
      if (window.scrollY > threshold) setShown(true);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [shown, threshold]);
  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          role="region"
          aria-label="Maya can arrange a visit"
          initial={reduced ? { opacity: 0 } : { y: 72, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={reduced ? { duration: 0.1 } : { duration: 0.6, ease: EASE_EXPO }}
          style={{
            position: "fixed",
            left: "50%",
            bottom: 18,
            translate: "-50%",
            zIndex: 800,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 12px 10px 14px",
            background: "#0b1226",
            color: "#f4f7ff",
            borderRadius: 9999,
            boxShadow: "0 20px 50px -12px rgba(7,11,22,.6)",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
          }}
        >
          <MayaOrb state="idle" size={30} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            {locale === "hi" ? "Maya विज़िट अरेंज कर सकती है" : "Maya can arrange a visit"}
          </span>
          <button
            onClick={onCta}
            style={{
              border: "none",
              cursor: "pointer",
              padding: "9px 16px",
              borderRadius: 9999,
              background: "#ff5a5f",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13.5,
              fontFamily: "inherit"
            }}
          >
            {locale === "hi" ? "विज़िट बुक करें" : "Book a visit"}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
