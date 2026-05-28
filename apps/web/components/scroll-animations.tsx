"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/* ──────────────────────────────────────────────────────────────────────
   AnimateOnScroll — adds `.is-visible` when the element enters the viewport.
   CSS handles the actual transition (opacity + translateY).
   ────────────────────────────────────────────────────────────────────── */
export function AnimateOnScroll({
  children,
  className = "",
  delay = 0,
  threshold = 0.15
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Default to visible so SSR + first paint show content immediately and
  // count toward LCP. We only flip to hidden-then-animate AFTER mount
  // for elements that are still below the fold — and only if the user
  // hasn't asked for reduced motion.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect reduced-motion: leave content visible, no animation.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const rect = el.getBoundingClientRect();
    // Above the fold? Already visible — no animation needed, no CLS.
    if (rect.top < window.innerHeight && rect.bottom > 0) return;

    // Below the fold — hide now, animate in on intersect.
    setVisible(false);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      className={`animate-on-scroll${visible ? " is-visible" : ""} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   CountUp — animate a numeric value from 0→target when visible.
   Supports prefix/suffix strings (e.g. "₹", "+", "%").
   ────────────────────────────────────────────────────────────────────── */
export function CountUp({
  value,
  prefix = "",
  suffix = "",
  duration = 1600
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    setDisplay(0);
    const startTime = performance.now();
    let raf: number;

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, value, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   ScrollDownIndicator — animated chevron at bottom of hero
   ────────────────────────────────────────────────────────────────────── */
export function ScrollDownIndicator() {
  return (
    <div className="scroll-indicator" aria-hidden="true">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    </div>
  );
}
