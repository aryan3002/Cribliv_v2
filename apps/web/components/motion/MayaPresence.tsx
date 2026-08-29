"use client";
/**
 * MayaPresence — MayaDock (global concierge launcher) + MayaHeroIntro (once-per-session entrance).
 * Orb comes from ./ListeningHeroMotion so Maya is identical everywhere.
 *
 * Usage (3 lines, in app/layout.tsx):
 *   import { MayaDock, MayaHeroIntro } from "@/components/motion/MayaPresence";
 *   // inside <body>: <MayaHeroIntro locale="en" />   (homepage only; no-op after first run / reduced motion)
 *   //                <MayaDock locale="en" onSubmit={(text) => router.push(`/search?q=${text}`)} />
 */
import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MayaOrb, Waveform, EASE_EXPO, type OrbState } from "./ListeningHeroMotion";

const GRADIENT = "linear-gradient(120deg,#0066ff 0%,#5b57ff 46%,#ff5a5f 100%)";
const SPRING_PANEL = { type: "spring", stiffness: 380, damping: 30, mass: 0.9 } as const;

const STR = {
  en: {
    ask: "Ask Maya",
    close: "Close Maya",
    send: "Send",
    nudge1: "Looking for a home?",
    nudge2: "घर ढूँढ रहे हैं? — बताइए।",
    placeholder: "Type or speak — “2 BHK near Hazratganj under ₹18k”",
    mic: "Speak to Maya",
    micStop: "Stop listening",
    hello: "Hi! Tell me what you're looking for — I'll search, filter and shortlist.",
    state: {
      idle: "Maya",
      listening: "LISTENING",
      thinking: "Thinking…",
      speaking: "Maya",
      ended: "Maya"
    } as Record<OrbState, string>
  },
  hi: {
    ask: "Maya से पूछें",
    close: "बंद करें",
    send: "भेजें",
    nudge1: "घर ढूँढ रहे हैं? — बताइए।",
    nudge2: "Looking for a home?",
    placeholder: "लिखें या बोलें — “हज़रतगंज के पास 2 BHK, ₹18k तक”",
    mic: "Maya से बोलें",
    micStop: "रोकें",
    hello: "नमस्ते! बताइए क्या चाहिए — मैं खोजकर शॉर्टलिस्ट कर दूँगी।",
    state: {
      idle: "Maya",
      listening: "सुन रही हूँ",
      thinking: "सोच रही हूँ…",
      speaking: "Maya",
      ended: "Maya"
    } as Record<OrbState, string>
  }
};

/* ── (1) MayaDock ────────────────────────────────────────────────────── */
export function MayaDock({
  locale = "en",
  onSubmit,
  orbState: extState,
  getLevel,
  onMicToggle,
  nudgeDelayMs = 20000,
  offset = 24,
  zIndex = 900,
  children
}: {
  locale?: "en" | "hi";
  onSubmit?: (text: string) => void;
  /** Control the orb from your voice pipeline; omitted → built-in demo cycle on mic tap. */
  orbState?: OrbState;
  getLevel?: () => number;
  onMicToggle?: (active: boolean) => void;
  nudgeDelayMs?: number;
  offset?: number;
  zIndex?: number;
  /** Panel body (chat thread). Omitted → greeting line. */
  children?: React.ReactNode;
}) {
  const t = STR[locale];
  const reduced = !!useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [pill, setPill] = React.useState(true);
  const [nudge, setNudge] = React.useState(false);
  const [hot, setHot] = React.useState(false); // hover/focus
  const [innerState, setInnerState] = React.useState<OrbState>("idle");
  const [text, setText] = React.useState("");
  const orbState = extState ?? innerState;
  const launcherRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const micTimers = React.useRef<number[]>([]);

  /* pill collapses after 4s or on scroll; re-expands on hover/focus */
  React.useEffect(() => {
    const id = window.setTimeout(() => setPill(false), 4000);
    const onScroll = () => setPill(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(id);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* idle nudge — once per session, never under reduced motion */
  React.useEffect(() => {
    if (reduced || open) return;
    if (sessionStorage.getItem("cribliv.maya.nudged")) return;
    const id = window.setTimeout(() => {
      sessionStorage.setItem("cribliv.maya.nudged", "1");
      setNudge(true);
      window.setTimeout(() => setNudge(false), 5200);
    }, nudgeDelayMs);
    return () => clearTimeout(id);
  }, [reduced, nudgeDelayMs, open]);

  /* Esc closes, focus trap while open, focus restore on close */
  React.useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button, input, textarea, a[href], [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        launcherRef.current?.focus();
      }
      if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const clearMic = () => {
    micTimers.current.forEach(clearTimeout);
    micTimers.current = [];
  };
  const toggleMic = () => {
    const active = orbState !== "listening";
    onMicToggle?.(active);
    if (extState !== undefined) return; // controlled
    clearMic();
    if (!active) {
      setInnerState("idle");
      return;
    }
    setInnerState("listening");
    micTimers.current.push(
      window.setTimeout(() => setInnerState("thinking"), 2600),
      window.setTimeout(() => setInnerState("speaking"), 3400),
      window.setTimeout(() => setInnerState("ended"), 5200),
      window.setTimeout(() => setInnerState("idle"), 5800)
    );
  };
  React.useEffect(() => clearMic, []);

  const submit = () => {
    if (!text.trim()) return;
    onSubmit?.(text.trim());
    setText("");
  };
  const showPill = pill || hot;

  return (
    <div
      style={{
        position: "fixed",
        right: offset,
        bottom: offset,
        zIndex,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
      }}
    >
      {/* nudge bubble */}
      <AnimatePresence>
        {nudge && !open && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 8, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.5, ease: EASE_EXPO }}
            style={{
              position: "absolute",
              right: 0,
              bottom: 76,
              width: 232,
              padding: "12px 14px",
              background: "#ffffff",
              color: "#1a1a2e",
              borderRadius: 16,
              borderBottomRightRadius: 6,
              boxShadow: "0 12px 32px -8px rgba(26,26,46,.28)",
              fontSize: 13.5,
              lineHeight: 1.45
            }}
          >
            <strong style={{ display: "block", fontWeight: 700 }}>{t.nudge1}</strong>
            <span style={{ color: "#64748b" }}>{t.nudge2}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Maya concierge"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.82, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 10 }}
            transition={reduced ? { duration: 0.1 } : SPRING_PANEL}
            style={{
              position: "absolute",
              right: 0,
              bottom: 72,
              width: 360,
              maxWidth: "calc(100vw - 32px)",
              transformOrigin: "bottom right",
              background: "#ffffff",
              borderRadius: 20,
              boxShadow: "0 28px 70px -18px rgba(26,26,46,.4)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column"
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: "linear-gradient(175deg,#070b16,#0b1226)",
                color: "#f4f7ff"
              }}
            >
              <MayaOrb state={orbState} getLevel={getLevel} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "Manrope, Inter, sans-serif",
                    fontWeight: 800,
                    fontSize: 15
                  }}
                >
                  Maya
                </div>
                <div
                  aria-live="polite"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: ".12em",
                    color: orbState === "listening" ? "#f59e0b" : "rgba(244,247,255,.55)",
                    display: "flex",
                    alignItems: "center",
                    gap: 7
                  }}
                >
                  {t.state[orbState]}
                  {orbState === "listening" && <Waveform getLevel={getLevel} bars={5} />}
                </div>
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  launcherRef.current?.focus();
                }}
                aria-label={t.close}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9999,
                  border: "1px solid rgba(255,255,255,.2)",
                  background: "transparent",
                  color: "#f4f7ff",
                  cursor: "pointer",
                  fontSize: 15,
                  lineHeight: 1
                }}
              >
                ✕
              </button>
            </header>
            <div
              style={{
                padding: 16,
                minHeight: 160,
                maxHeight: 320,
                overflowY: "auto",
                fontSize: 14,
                color: "#1a1a2e",
                lineHeight: 1.5
              }}
            >
              {children ?? (
                <div
                  style={{
                    background: "#f5f5f7",
                    borderRadius: 14,
                    borderTopLeftRadius: 5,
                    padding: "10px 13px",
                    maxWidth: "88%"
                  }}
                >
                  {t.hello}
                </div>
              )}
            </div>
            <footer
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: 12,
                borderTop: "1px solid #eceef2"
              }}
            >
              <button
                onClick={toggleMic}
                aria-pressed={orbState === "listening"}
                aria-label={orbState === "listening" ? t.micStop : t.mic}
                style={{
                  width: 40,
                  height: 40,
                  flex: "none",
                  borderRadius: 9999,
                  cursor: "pointer",
                  border: `1px solid ${orbState === "listening" ? "#f59e0b" : "#dfe3ea"}`,
                  background: orbState === "listening" ? "#fef3e2" : "#ffffff",
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
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={t.placeholder}
                aria-label={t.placeholder}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 40,
                  border: "1px solid #dfe3ea",
                  borderRadius: 12,
                  padding: "0 12px",
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                  color: "#1a1a2e"
                }}
              />
              <button
                onClick={submit}
                aria-label={t.send}
                style={{
                  width: 40,
                  height: 40,
                  flex: "none",
                  borderRadius: 9999,
                  border: "none",
                  cursor: "pointer",
                  background: "#0066ff",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 2L11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>

      {/* launcher */}
      <motion.button
        ref={launcherRef}
        data-maya-dock-anchor
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t.ask}
        onHoverStart={() => setHot(true)}
        onHoverEnd={() => setHot(false)}
        onFocus={() => setHot(true)}
        onBlur={() => setHot(false)}
        animate={
          nudge && !reduced ? { y: [0, -8, 0, -4, 0] } : { y: 0, scale: hot && !reduced ? 1.06 : 1 }
        }
        transition={
          nudge
            ? { duration: 0.9, ease: EASE_EXPO }
            : { type: "spring", stiffness: 300, damping: 20 }
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginLeft: "auto",
          padding: 3,
          borderRadius: 9999,
          border: "none",
          cursor: "pointer",
          background: GRADIENT,
          opacity: 1,
          boxShadow: hot
            ? "0 10px 34px -6px rgba(91,87,255,.65)"
            : "0 8px 26px -8px rgba(91,87,255,.5)",
          transition: "box-shadow .3s cubic-bezier(.16,1,.3,1)"
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            borderRadius: 9999,
            background: "#0b1226"
          }}
        >
          <MayaOrb state={open ? "idle" : orbState} getLevel={getLevel} size={44} />
        </span>
        <AnimatePresence initial={false}>
          {showPill && !open && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.35, ease: EASE_EXPO }}
              style={{
                overflow: "hidden",
                whiteSpace: "nowrap",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14.5,
                paddingRight: 18
              }}
            >
              {t.ask}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}

/* ── (2) MayaHeroIntro ───────────────────────────────────────────────── */
export function MayaHeroIntro({
  locale = "en",
  onDone,
  dockOffset = 24,
  size = 88,
  storageKey = "cribliv.maya.intro"
}: {
  locale?: "en" | "hi";
  onDone?: () => void;
  dockOffset?: number;
  size?: number;
  storageKey?: string;
}) {
  const reduced = !!useReducedMotion();
  const [mounted, setMounted] = React.useState(false);
  const [stage, setStage] = React.useState<"assemble" | "breathe" | "drop" | "done">("assemble");
  const [target, setTarget] = React.useState({ x: 0, y: 0 });
  // Render nothing until after mount so server and first client render agree
  // (this component reads window/sessionStorage — SSR-safe gate, no hydration mismatch).
  React.useEffect(() => setMounted(true), []);
  const play = React.useMemo(() => {
    if (!mounted || typeof window === "undefined") return false;
    return !reduced && !sessionStorage.getItem(storageKey);
  }, [mounted, reduced, storageKey]);
  const drops = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        x: (Math.random() * 2 - 1) * 280,
        y: (Math.random() * 2 - 1) * 190,
        s: 7 + Math.random() * 11,
        d: i * 0.032
      })),
    []
  );

  React.useEffect(() => {
    if (!mounted) return;
    if (!play) {
      onDone?.();
      return;
    }
    sessionStorage.setItem(storageKey, "1");
    const cx = window.innerWidth / 2,
      cy = window.innerHeight * 0.42;
    const t1 = window.setTimeout(() => setStage("breathe"), 680);
    const t2 = window.setTimeout(() => {
      // shared-element style drop into the dock anchor (or bottom-right fallback)
      const anchor = document.querySelector("[data-maya-dock-anchor]")?.getBoundingClientRect();
      const tx = anchor ? anchor.left + anchor.width / 2 : window.innerWidth - dockOffset - 31;
      const ty = anchor ? anchor.top + anchor.height / 2 : window.innerHeight - dockOffset - 31;
      setTarget({ x: tx - cx, y: ty - cy });
      setStage("drop");
    }, 1620);
    const t3 = window.setTimeout(() => {
      setStage("done");
      onDone?.();
    }, 2420);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, mounted]);

  if (!play || stage === "done") return null;
  const assembled = stage !== "assemble";
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none" }}>
      <motion.div
        style={{
          position: "fixed",
          left: "50%",
          top: "42%",
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2
        }}
        animate={
          stage === "drop"
            ? { x: target.x, y: target.y, scale: 44 / size, opacity: [1, 1, 0] }
            : { x: 0, y: 0, scale: 1 }
        }
        transition={
          stage === "drop"
            ? { duration: 0.7, ease: EASE_EXPO, opacity: { times: [0, 0.85, 1], duration: 0.7 } }
            : undefined
        }
      >
        {/* mercury droplets fly together (600ms, ease-out expo) */}
        {drops.map((p, i) => (
          <motion.span
            key={i}
            initial={{ x: p.x, y: p.y, opacity: 0, scale: 0.5 }}
            animate={
              assembled
                ? { x: 0, y: 0, opacity: 0, scale: 0.4 }
                : { x: 0, y: 0, opacity: 1, scale: 1 }
            }
            transition={{ duration: 0.6, ease: EASE_EXPO, delay: assembled ? 0 : p.d }}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: p.s,
              height: p.s,
              marginLeft: -p.s / 2,
              marginTop: -p.s / 2,
              borderRadius: 9999,
              background:
                "radial-gradient(circle at 38% 32%, #f4f7ff 0%, #7fa9ff 40%, #5b57ff 75%, #241a4d 100%)"
            }}
          />
        ))}
        {/* the assembled orb breathes once */}
        <motion.span
          initial={{ opacity: 0, scale: 0.7 }}
          animate={assembled ? { opacity: 1, scale: [0.9, 1.05, 1] } : { opacity: 0 }}
          transition={{ duration: 0.85, ease: EASE_EXPO }}
          style={{ position: "absolute", inset: 0, display: "block" }}
        >
          <MayaOrb state="idle" size={size} />
        </motion.span>
      </motion.div>
    </div>
  );
}
