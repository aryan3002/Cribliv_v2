"use client";
import { useEffect, useRef, useState } from "react";
import { createPgVoiceSocket, disconnectPgVoiceSocket } from "@/lib/pg-voice-socket";
import PgVoiceTimer from "./PgVoiceTimer";
import PgVoiceFallbackInput from "./PgVoiceFallbackInput";
import PgVoiceMicCapture from "./PgVoiceMicCapture";
import { handleSessionEnded } from "./handlers/handleSessionEnded";
import { handleFieldExtracted } from "./handlers/handleFieldExtracted";
import { handlePhaseChanged } from "./handlers/handlePhaseChanged";

export default function PgVoicePanel({
  locale,
  state,
  dispatch,
  orb,
  setOrb,
  onClose
}: {
  locale: string;
  state: any;
  dispatch: any;
  orb: string;
  setOrb: (s: any) => void;
  onClose: () => void;
}) {
  const [startedAt] = useState(Date.now());
  const [phase, setPhase] = useState<string>("greeting");
  const [transcript, setTranscript] = useState<string[]>([]);
  const sockRef = useRef(createPgVoiceSocket({ userId: "session-user" }));
  const toast = useRef({ show: (args: any) => console.warn("toast:", args) });

  useEffect(() => {
    const s = sockRef.current;
    s.connect();
    s.on("session_ready" as any, () => setOrb("listening"));
    s.on("phase_changed" as any, (ev: any) => handlePhaseChanged(ev, { setPhase }));
    s.on("field_extracted" as any, (ev: any) =>
      handleFieldExtracted(ev, {
        dispatch,
        onTranscriptLine: (l) => setTranscript((p) => [...p, l])
      })
    );
    s.on("session_ended" as any, (ev: any) => {
      handleSessionEnded(ev, { toast: toast.current });
      setOrb("ended");
      onClose();
    });
    s.start({ locale: locale === "hi" ? "hi" : "en" });
    return () => disconnectPgVoiceSocket();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside role="dialog" aria-label="Chaya voice assistant" className="pg-voice-panel">
      <header>
        <PgVoiceTimer startedAt={startedAt} />
        <span data-phase={phase}>{phase}</span>
        <button onClick={onClose} aria-label="Minimize">
          ×
        </button>
      </header>
      <PgVoiceMicCapture
        onChunk={(buf) => sockRef.current.sendAudio(buf)}
        onStateChange={(s) => setOrb(s)}
      />
      <ul className="pg-transcript">
        {transcript.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <PgVoiceFallbackInput onSend={(text) => sockRef.current.sendText(text)} />
      <footer>
        <button onClick={() => sockRef.current.end()}>End session</button>
      </footer>
    </aside>
  );
}
