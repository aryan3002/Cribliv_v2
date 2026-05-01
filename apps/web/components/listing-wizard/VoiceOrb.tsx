"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { RealtimeAgentState, RealtimeRole } from "../../lib/realtime-client";

/* ──────────────────────────────────────────────────────────────────────
 * VoiceOrb — Liquid mercury blob
 *
 * A soft, organic SVG blob that morphs and bulges with audio. Replaces
 * the older rigid sphere + 56-bar ring. The shape is a closed Catmull-Rom
 * curve through 14 anchor points; each anchor's radial distance from
 * center oscillates with a per-point sine wave (idle wobble) plus an
 * audio-reactive bulge term. A radial gradient + Gaussian-blurred halo
 * give it the pearl/mercury feel.
 *
 * Path updates run inside a single requestAnimationFrame loop and are
 * written directly to the DOM via setAttribute — React never re-renders
 * during animation.
 * ──────────────────────────────────────────────────────────────────── */

const POINTS = 14;
const VIEW = 100;
const CENTER = VIEW / 2;
const BASE_R = 32;

// Per-point phase + frequency, computed once.
const ANCHORS = (() => {
  const arr: { theta: number; phi: number; omega: number }[] = [];
  for (let i = 0; i < POINTS; i++) {
    const theta = (i / POINTS) * Math.PI * 2;
    const phi = i * 0.7;
    // Mix of low frequencies so points drift slowly past each other.
    const omega = 0.45 + ((i * 0.13) % 0.55);
    arr.push({ theta, phi, omega });
  }
  return arr;
})();

interface Props {
  state: RealtimeAgentState;
  userLevel: number;
  assistantLevel: number;
  onClick?: () => void;
  size?: number;
}

export function VoiceOrb({ state, userLevel, assistantLevel, onClick, size }: Props) {
  const wrapStyle: CSSProperties = size ? { width: size, height: size } : {};

  // Refs the rAF loop reads/writes — avoids re-rendering React 60fps.
  const stateRef = useRef(state);
  const userRef = useRef(userLevel);
  const assistRef = useRef(assistantLevel);
  stateRef.current = state;
  userRef.current = userLevel;
  assistRef.current = assistantLevel;

  const innerPathRef = useRef<SVGPathElement | null>(null);
  const outerPathRef = useRef<SVGPathElement | null>(null);

  // Stable id for the per-instance gradient + filter so multiple orbs
  // on the same page wouldn't collide.
  const uid = useMemo(() => `orb-${Math.random().toString(36).slice(2, 9)}`, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Static rounded blob, no animation.
      const d = buildBlobPath(0, 0, "idle");
      innerPathRef.current?.setAttribute("d", d);
      outerPathRef.current?.setAttribute("d", d);
      return;
    }

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let smoothedLevel = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t += dt;

      const s = stateRef.current;
      const target =
        s === "idle" || s === "ended" ? 0 : s === "speaking" ? assistRef.current : userRef.current;
      // Exponential smoothing so the blob doesn't twitch.
      smoothedLevel += (target - smoothedLevel) * 0.18;

      const d = buildBlobPath(t, smoothedLevel, s);
      innerPathRef.current?.setAttribute("d", d);
      outerPathRef.current?.setAttribute("d", d);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <button
      type="button"
      className="cz-orb-wrap"
      data-state={state}
      onClick={onClick}
      aria-label="Voice orb"
      style={wrapStyle}
    >
      <svg
        className="cz-orb-svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        data-state={state}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`${uid}-fill`} cx="38%" cy="32%" r="78%">
            <stop offset="0%" stopColor="var(--cz-orb-c1)" />
            <stop offset="55%" stopColor="var(--cz-orb-c2)" />
            <stop offset="100%" stopColor="var(--cz-orb-c3)" />
          </radialGradient>
          <radialGradient id={`${uid}-halo`} cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="var(--cz-orb-c2)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--cz-orb-c2)" stopOpacity="0" />
          </radialGradient>
          <filter id={`${uid}-blur`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.4" />
          </filter>
        </defs>
        {/* Soft halo — same path, larger + blurred, behind the main body */}
        <path
          ref={outerPathRef}
          fill={`url(#${uid}-halo)`}
          filter={`url(#${uid}-blur)`}
          transform={`translate(${CENTER} ${CENTER}) scale(1.18) translate(-${CENTER} -${CENTER})`}
        />
        {/* Main blob */}
        <path ref={innerPathRef} fill={`url(#${uid}-fill)`} />
        {/* Specular highlight — fixed, gives the pearl/3D feel */}
        <ellipse
          cx={CENTER - 9}
          cy={CENTER - 13}
          rx={9}
          ry={5.5}
          fill="rgba(255,255,255,0.55)"
          transform="rotate(-22, 41, 37)"
          style={{ pointerEvents: "none" }}
        />
        <circle
          cx={CENTER - 13}
          cy={CENTER - 17}
          r={2.4}
          fill="rgba(255,255,255,0.85)"
          style={{ pointerEvents: "none" }}
        />
      </svg>
    </button>
  );
}

/* ── Path generation ────────────────────────────────────────────────── */

function buildBlobPath(t: number, level: number, state: RealtimeAgentState): string {
  // State-driven base radius and reactivity scaling.
  const baseScale = state === "thinking" ? 0.92 : state === "speaking" ? 1.02 : 1;
  const reactivity = state === "idle" || state === "ended" ? 0 : state === "speaking" ? 1.05 : 1;
  const R0 = BASE_R * baseScale;

  // Compute deformed anchor positions.
  const pts: { x: number; y: number }[] = new Array(POINTS);
  for (let i = 0; i < POINTS; i++) {
    const a = ANCHORS[i];
    const breath = 0.06 * Math.sin(a.omega * t + a.phi);
    const bulge = level * 0.18 * reactivity * Math.sin(a.omega * t * 2 + a.phi * 1.7);
    const r = R0 * (1 + breath + bulge);
    pts[i] = {
      x: CENTER + r * Math.cos(a.theta),
      y: CENTER + r * Math.sin(a.theta)
    };
  }

  return catmullRomToBezier(pts);
}

/**
 * Convert a closed loop of points into a smooth cubic-Bezier path string.
 * Uses centripetal Catmull-Rom with tension 0.5 — guaranteed to pass
 * through every anchor with no corners.
 */
function catmullRomToBezier(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n < 2) return "";
  const tension = 0.5;
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension * 2;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension * 2;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension * 2;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension * 2;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d + " Z";
}

// Re-export the role type so other call sites that imported it from this
// module continue to work.
export type { RealtimeRole };
