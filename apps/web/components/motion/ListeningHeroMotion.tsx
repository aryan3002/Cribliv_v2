"use client";
/**
 * ListeningHeroMotion — Cribliv homepage "listening hero" motion layer.
 * Drop-in primitives that WRAP your existing hero markup; search logic/props stay intact.
 *
 * Usage (3 lines):
 *   import "@/app/motion.css"; // (already imported globally in app/layout.tsx)
 *   import { HeroMotion, MapFade, GlowBloom, GlassRise, HeadlineStagger, ParallaxPins, PricePin, MicOrbSwap, LockChip, RollingCount, Waveform, useRotatingPlaceholder, useCommitSubmit } from "@/components/motion/ListeningHeroMotion";
 *   <HeroMotion><MapFade>{backdrop}</MapFade><GlowBloom/><ParallaxPins>{pins.map((p,i)=><PricePin key={p.id} index={i} featured={p.featured} style={p.pos}>{p.label}</PricePin>)}</ParallaxPins><GlassRise>{yourSearchGlass}</GlassRise></HeroMotion>
 */
import * as React from "react";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "framer-motion";

/* ── Motion tokens (house style) ─────────────────────────────────────── */
export const EASE_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_POP: [number, number, number, number] = [0.34, 1.56, 0.64, 1];
export const SPRING_POP = { type: "spring", stiffness: 420, damping: 24, mass: 0.7 } as const;

/* ── Root: pointer tracking + reduced-motion context ─────────────────── */
type HeroCtx = {
  mx: ReturnType<typeof useMotionValue<number>>;
  my: ReturnType<typeof useMotionValue<number>>;
  reduced: boolean;
};
const Ctx = React.createContext<HeroCtx | null>(null);

export function HeroMotion({
  children,
  className,
  style
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  return (
    <Ctx.Provider value={{ mx, my, reduced }}>
      <div
        className={className}
        style={{ position: "relative", overflow: "hidden", ...style }}
        onPointerMove={onMove}
        onPointerLeave={() => {
          mx.set(0);
          my.set(0);
        }}
      >
        {children}
      </div>
    </Ctx.Provider>
  );
}
const useHero = () => {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("ListeningHeroMotion primitives must live inside <HeroMotion>");
  return c;
};

/* ── Beat 1: backdrop fade, glow bloom, glass rise, headline stagger ─── */
export function MapFade({
  children,
  style,
  className
}: {
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  const { reduced } = useHero();
  return (
    <motion.div
      aria-hidden
      className={className}
      style={style}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/** Signature-gradient bloom behind the search glass. Position via style/className. */
export function GlowBloom({
  style,
  className,
  opacity = 0.5,
  delay = 0.15
}: {
  style?: React.CSSProperties;
  className?: string;
  opacity?: number;
  delay?: number;
}) {
  const { reduced } = useHero();
  return (
    <motion.div
      aria-hidden
      className={`lhm-glow ${className ?? ""}`}
      style={style}
      initial={reduced ? false : { opacity: 0, scale: 0.55 }}
      animate={{ opacity, scale: 1 }}
      transition={{ duration: 0.9, ease: EASE_EXPO, delay }}
    />
  );
}

/** Wrap the existing search glass: rises 12px + fades in (ease-out expo). */
export const GlassRise = React.forwardRef<
  HTMLDivElement,
  { children: React.ReactNode; delay?: number; style?: React.CSSProperties; className?: string }
>(function GlassRise({ children, delay = 0.25, style, className }, ref) {
  const { reduced } = useHero();
  return (
    <motion.div
      ref={ref}
      className={className}
      style={style}
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE_EXPO, delay }}
    >
      {children}
    </motion.div>
  );
});

/** Splits text into words, staggered 40ms apart. */
export function HeadlineStagger({
  text,
  delay = 0.35,
  stagger = 0.04,
  className,
  style,
  as: Tag = "span"
}: {
  text: string;
  delay?: number;
  stagger?: number;
  className?: string;
  style?: React.CSSProperties;
  as?: React.ElementType;
}) {
  const { reduced } = useHero();
  const words = text.split(/\s+/);
  return (
    <Tag className={className} style={style}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          style={{ display: "inline-block", whiteSpace: "pre" }}
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: EASE_EXPO, delay: delay + i * stagger }}
        >
          {w + (i < words.length - 1 ? " " : "")}
        </motion.span>
      ))}
    </Tag>
  );
}

/* ── Beat 2: pins — spring pop + idle parallax ───────────────────────── */
export function ParallaxPins({
  strength = 3,
  children,
  style,
  className
}: {
  strength?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  const { mx, my, reduced } = useHero();
  const x = useSpring(useTransform(mx, [-0.5, 0.5], [-strength, strength]), {
    stiffness: 55,
    damping: 16
  });
  const y = useSpring(useTransform(my, [-0.5, 0.5], [-strength, strength]), {
    stiffness: 55,
    damping: 16
  });
  return (
    <motion.div
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        willChange: "transform",
        ...(reduced ? {} : { x, y }),
        ...style
      }}
    >
      {children}
    </motion.div>
  );
}

export function PricePin({
  index = 0,
  featured = false,
  baseDelay = 0.6,
  children,
  style,
  className
}: {
  index?: number;
  featured?: boolean;
  baseDelay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  const { reduced } = useHero();
  return (
    <motion.span
      className={`${featured ? "lhm-pin-featured" : "lhm-pin"} ${className ?? ""}`}
      style={style}
      initial={reduced ? false : { opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...SPRING_POP, delay: baseDelay + index * 0.045 }}
    >
      {children}
    </motion.span>
  );
}

/* ── Beat 3: Maya's listening orb (liquid-mercury pearl, per spec) ───── */
export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "ended";
const ORB_CFG: Record<OrbState, { scale: number; reactivity: number }> = {
  idle: { scale: 1, reactivity: 0 },
  listening: { scale: 1, reactivity: 1 },
  thinking: { scale: 0.92, reactivity: 0.15 },
  speaking: { scale: 1.02, reactivity: 1.05 },
  ended: { scale: 1, reactivity: 0 }
};
const PHI = Array.from({ length: 14 }, (_, i) => i * 1.71);

export function buildOrbPath(
  t: number,
  level: number,
  reactivity: number,
  R0: number,
  c: number
): string {
  const N = 14,
    pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const breath = 0.06 * Math.sin(1.5 * t + PHI[i]);
    const bulge = level * 0.18 * reactivity * Math.sin(3 * t + 1.7 * PHI[i]);
    const r = R0 * (1 + breath + bulge);
    pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
  }
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N],
      p1 = pts[i],
      p2 = pts[(i + 1) % N],
      p3 = pts[(i + 2) % N];
    d +=
      `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ` +
      `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ` +
      `${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + "Z";
}

/** getLevel: return live mic/TTS level 0..1; omitted → gentle simulation while active. */
export function MayaOrb({
  state = "idle",
  getLevel,
  size = 46
}: {
  state?: OrbState;
  getLevel?: () => number;
  size?: number;
}) {
  const reduced = !!useReducedMotion();
  const pathRef = React.useRef<SVGPathElement>(null);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const sim = React.useRef({ level: 0, scale: 1 });
  const gid = React.useId().replace(/[:]/g, "");
  const c = size / 2,
    R0 = size * 0.348;

  React.useEffect(() => {
    const p = pathRef.current;
    if (!p) return;
    if (reduced) {
      p.setAttribute("d", buildOrbPath(0, 0, 0, R0, c));
      return;
    }
    let raf = 0;
    const loop = () => {
      const t = performance.now() / 1000;
      const cfg = ORB_CFG[stateRef.current];
      const active = cfg.reactivity > 0;
      const target = getLevel
        ? getLevel()
        : active
          ? 0.25 + Math.abs(Math.sin(t * 3.1)) * 0.55 + Math.random() * 0.15
          : 0;
      sim.current.level += (Math.min(1, target) - sim.current.level) * 0.12; // flow, never jitter
      sim.current.scale += (cfg.scale - sim.current.scale) * 0.08;
      p.setAttribute(
        "d",
        buildOrbPath(t, sim.current.level, cfg.reactivity, R0 * sim.current.scale, c)
      );
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced, getLevel, R0, c]);

  return (
    <span
      aria-hidden
      style={{ position: "relative", display: "inline-block", width: size, height: size }}
    >
      <span className="lhm-orb-halo" />
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: "relative", display: "block" }}
      >
        <defs>
          <radialGradient id={gid} cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#f4f7ff" />
            <stop offset="35%" stopColor="#7fa9ff" />
            <stop offset="68%" stopColor="#5b57ff" />
            <stop offset="100%" stopColor="#241a4d" />
          </radialGradient>
        </defs>
        <path ref={pathRef} fill={`url(#${gid})`} />
        <ellipse
          cx={size * 0.37}
          cy={size * 0.3}
          rx={size * 0.113}
          ry={size * 0.078}
          fill="#fff"
          opacity={0.8}
        />
      </svg>
    </span>
  );
}

/** Crossfades your search icon ↔ Maya's orb when voice is active. */
export function MicOrbSwap({
  active,
  orbState = "listening",
  icon,
  getLevel,
  size = 46
}: {
  active: boolean;
  orbState?: OrbState;
  icon: React.ReactNode;
  getLevel?: () => number;
  size?: number;
}) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flex: "none"
      }}
    >
      <motion.span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
        animate={{ opacity: active ? 0 : 1, scale: active ? 0.6 : 1 }}
        transition={{ duration: 0.3, ease: EASE_EXPO }}
      >
        {icon}
      </motion.span>
      <motion.span
        style={{ position: "absolute", inset: 0 }}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ duration: 0.35, ease: EASE_EXPO }}
      >
        {active && <MayaOrb state={orbState} getLevel={getLevel} size={size} />}
      </motion.span>
    </span>
  );
}

/** Amber waveform bars driven by getLevel (or simulated when omitted). */
export function Waveform({
  getLevel,
  bars = 5,
  color = "#f59e0b"
}: {
  getLevel?: () => number;
  bars?: number;
  color?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const reduced = !!useReducedMotion();
  React.useEffect(() => {
    if (reduced || !ref.current) return;
    let raf = 0,
      level = 0;
    const loop = () => {
      const t = performance.now() / 1000;
      level += ((getLevel ? getLevel() : 0.3 + Math.abs(Math.sin(t * 3.1)) * 0.5) - level) * 0.15;
      const kids = ref.current!.children as HTMLCollectionOf<HTMLElement>;
      for (let i = 0; i < kids.length; i++)
        kids[i].style.transform =
          `scaleY(${Math.max(0.25, level * (0.55 + 0.45 * Math.sin(t * 9 + i * 1.9)) * 2.4).toFixed(2)})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reduced, getLevel]);
  return (
    <span
      ref={ref}
      aria-hidden
      style={{ display: "inline-flex", alignItems: "center", gap: 2.5, height: 18 }}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 7,
            borderRadius: 2,
            background: color,
            display: "inline-block",
            transformOrigin: "center"
          }}
        />
      ))}
    </span>
  );
}

/** Rotating example query for the placeholder. Pauses while `paused` (e.g. user typed). */
export function useRotatingPlaceholder(
  queries: string[],
  intervalMs = 3200,
  paused = false
): string {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setI((v) => (v + 1) % queries.length), intervalMs);
    return () => clearInterval(id);
  }, [queries, intervalMs, paused]);
  return queries[i % queries.length];
}

/* ── Beat 4: chip pop + rolling match count ──────────────────────────── */
export function LockChip({
  children,
  className,
  style
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  return (
    <motion.span
      className={className}
      style={style}
      initial={reduced ? false : { opacity: 0, scale: 0.55 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.38, ease: EASE_POP }}
    >
      {children}
    </motion.span>
  );
}

/** Amber tabular count that rolls to each new value (jumps under reduced motion). */
export function RollingCount({
  value,
  duration = 0.55,
  locale = "en-IN",
  className,
  style
}: {
  value: number;
  duration?: number;
  locale?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduced = !!useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const cur = React.useRef(value);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced) {
      cur.current = value;
      el.textContent = value.toLocaleString(locale);
      return;
    }
    const from = cur.current,
      start = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / (duration * 1000)),
        e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (value - from) * e);
      cur.current = v;
      el.textContent = v.toLocaleString(locale);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, locale, reduced]);
  return (
    <span
      ref={ref}
      className={className}
      style={{ fontVariantNumeric: "tabular-nums", color: "#f59e0b", fontWeight: 800, ...style }}
    >
      {value.toLocaleString(locale)}
    </span>
  );
}

/* ── Beat 5: commit pulse + View Transition handoff (fallback: fade) ─── */
export function useCommitSubmit() {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const reduced = !!useReducedMotion();
  const commit = React.useCallback(
    (navigate: () => void) => {
      const el = panelRef.current;
      if (el && !reduced)
        el.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(.982)", offset: 0.35 },
            { transform: "scale(1.004)", offset: 0.7 },
            { transform: "scale(1)" }
          ],
          { duration: 300, easing: "cubic-bezier(.34,1.56,.64,1)" }
        );
      const go = () => {
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
        document.documentElement.classList.add("lhm-fade-out");
        setTimeout(() => {
          navigate();
          document.documentElement.classList.remove("lhm-fade-out");
        }, 240);
      };
      setTimeout(go, reduced ? 0 : 230);
    },
    [reduced]
  );
  return { panelRef, commit };
}
