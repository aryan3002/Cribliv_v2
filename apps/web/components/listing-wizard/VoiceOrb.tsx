"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { RealtimeAgentState, RealtimeRole } from "../../lib/realtime-client";

/* ──────────────────────────────────────────────────────────────────────
 * VoiceOrb
 *
 * Signature visual element for "Maya". A warm gold orb that:
 *
 *   • Idle  → slow breathing.
 *   • Listening (user) → outer ring of 56 little bars dances with mic RMS.
 *   • Thinking → orb contracts slightly.
 *   • Speaking (assistant) → orb pulses with assistant audio RMS, ring
 *     glows brighter / changes hue.
 *   • Error → goes coral.
 *
 * Audio levels are pushed in via the `userLevel` and `assistantLevel`
 * props (range 0..1) — the parent connects these to RealtimeClient's
 * onAudioLevel callback.
 *
 * Pure CSS + transforms — no canvas or WebGL. ~60fps on M1.
 * ──────────────────────────────────────────────────────────────────── */

const BAR_COUNT = 56;

interface Props {
  state: RealtimeAgentState;
  userLevel: number;
  assistantLevel: number;
  onClick?: () => void;
  size?: number;
}

export function VoiceOrb({ state, userLevel, assistantLevel, onClick, size }: Props) {
  // Smooth the levels a bit so bars don't twitch jaggedly.
  const smoothedLevels = useSmoothedLevels(userLevel, assistantLevel);

  // Pick which signal drives the bars based on state.
  const driver: RealtimeRole = state === "speaking" ? "assistant" : "user";
  const baseLevel =
    state === "idle" || state === "ended"
      ? 0
      : driver === "assistant"
        ? smoothedLevels.assistant
        : smoothedLevels.user;

  // Pre-compute per-bar offsets so each bar reacts slightly differently
  // (gives the ring a more "alive" feel).
  const offsets = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const r = (Math.sin(i * 12.34) + 1) / 2; // deterministic pseudo-random 0..1
      arr.push(0.4 + r * 0.6);
    }
    return arr;
  }, []);

  const wrapStyle: CSSProperties = size ? { width: size, height: size } : {};

  return (
    <button
      type="button"
      className="cz-orb-wrap"
      data-state={state}
      onClick={onClick}
      aria-label="Voice orb"
      style={wrapStyle}
    >
      <div className="cz-orb-glow" />
      <div className="cz-orb" style={orbScale(state, baseLevel)} />
      <div className="cz-orb-ring" aria-hidden>
        {offsets.map((off, i) => {
          const angle = (i / BAR_COUNT) * 360;
          const reactivity = state === "idle" || state === "ended" ? 0 : baseLevel;
          const height = 6 + reactivity * off * 38;
          return (
            <span
              key={i}
              className="cz-orb-ring__bar"
              style={
                {
                  "--rot": `${angle}deg`,
                  "--bar": `${height}px`,
                  opacity: 0.4 + reactivity * 0.6
                } as CSSProperties
              }
            />
          );
        })}
      </div>
    </button>
  );
}

/** Gentle exponential smoothing for the RMS values (~0.55 alpha). */
function useSmoothedLevels(user: number, assistant: number) {
  const [levels, setLevels] = useState({ user: 0, assistant: 0 });
  const userRef = useRef(0);
  const assistRef = useRef(0);
  const targetUser = useRef(user);
  const targetAssist = useRef(assistant);
  const rafRef = useRef<number | null>(null);

  targetUser.current = user;
  targetAssist.current = assistant;

  useEffect(() => {
    const tick = () => {
      const u = userRef.current + (targetUser.current - userRef.current) * 0.55;
      const a = assistRef.current + (targetAssist.current - assistRef.current) * 0.55;
      userRef.current = u;
      assistRef.current = a;
      setLevels({ user: u, assistant: a });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return levels;
}

function orbScale(state: RealtimeAgentState, level: number): CSSProperties {
  if (state === "thinking") return { transform: "scale(0.94)" };
  if (state === "idle" || state === "ended") return {};
  const scale = 1 + level * 0.085;
  return { transform: `scale(${scale.toFixed(3)})` };
}
