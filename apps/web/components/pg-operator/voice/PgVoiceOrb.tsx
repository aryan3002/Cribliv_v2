// PgVoiceOrb.tsx
"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
const PgVoicePanel = dynamic(() => import("./PgVoicePanel"), { ssr: false });

type OrbState = "idle" | "connecting" | "listening" | "processing" | "ended";

export default function PgVoiceOrb({
  state,
  dispatch,
  locale
}: {
  state: any;
  dispatch: any;
  locale: string;
}) {
  const [orb, setOrb] = useState<OrbState>("idle");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="pg-voice-orb"
        data-state={orb}
        aria-label="Open Chaya voice assistant"
        onClick={() => setOpen(true)}
      >
        🎙
      </button>
      {open && (
        <PgVoicePanel
          locale={locale}
          state={state}
          dispatch={dispatch}
          orb={orb}
          setOrb={setOrb}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
