// PgVoiceTimer.tsx
"use client";
import { useEffect, useState } from "react";
const HARD_CAP_MS = 5 * 60 * 1000;

export default function PgVoiceTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, HARD_CAP_MS - (now - startedAt));
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const tone = remaining < 15_000 ? "danger" : remaining < 60_000 ? "warn" : "info";
  return (
    <time role="timer" data-tone={tone}>
      {m}:{s.toString().padStart(2, "0")}
    </time>
  );
}
