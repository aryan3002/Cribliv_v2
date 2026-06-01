"use client";
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic, Square } from "lucide-react";
import { PG_AUDIO_CHUNK_MAX } from "@/lib/pg-voice-socket";

type State = "idle" | "connecting" | "listening" | "processing";

interface Props {
  onChunk: (buf: ArrayBuffer) => void;
  onStateChange: (s: State) => void;
  timesliceMs?: number;
}

export default function PgVoiceMicCapture({ onChunk, onStateChange, timesliceMs = 250 }: Props) {
  const [state, setState] = useState<State>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emitBoundedChunks = async (blob: Blob) => {
    const buf = await blob.arrayBuffer();
    if (buf.byteLength <= PG_AUDIO_CHUNK_MAX) {
      onChunk(buf);
      return;
    }
    let offset = 0;
    while (offset < buf.byteLength) {
      const end = Math.min(offset + PG_AUDIO_CHUNK_MAX, buf.byteLength);
      onChunk(buf.slice(offset, end));
      offset = end;
    }
  };

  const start = async () => {
    setError(null);
    try {
      onStateChange("connecting");
      setState("connecting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) void emitBoundedChunks(ev.data);
      };
      recorder.start(timesliceMs);
      recorderRef.current = recorder;
      onStateChange("listening");
      setState("listening");
    } catch (e) {
      setError((e as Error).message);
      onStateChange("idle");
      setState("idle");
    }
  };

  const stop = () => {
    try {
      recorderRef.current?.stop();
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
    onStateChange("idle");
    setState("idle");
  };

  const toggle = () => {
    if (state === "listening" || state === "connecting") stop();
    else void start();
  };

  const isActive = state === "listening";

  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "20px 0" }}
    >
      <motion.button
        type="button"
        onClick={toggle}
        aria-label="tap to talk"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.92 }}
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isActive
            ? "linear-gradient(135deg, #DC2626, var(--pgo-danger, #F87171))"
            : "linear-gradient(135deg, var(--pgo-brand, #7C3AED), #9333EA)",
          color: "#fff",
          boxShadow: isActive
            ? "0 8px 32px var(--pgo-danger-glow, rgba(248,113,113,0.3))"
            : "0 8px 32px var(--pgo-brand-glow, rgba(124,58,237,0.3))",
          cursor: "pointer",
          position: "relative",
          zIndex: 2,
          transition: "all 0.3s ease"
        }}
      >
        {isActive ? (
          <>
            <Square size={24} fill="currentColor" />
            <span className="sr-only">Stop</span>
          </>
        ) : (
          <>
            <Mic size={28} />
            <span className="sr-only">Start</span>
          </>
        )}

        {isActive && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
            style={{
              position: "absolute",
              inset: 0,
              background: "var(--pgo-danger, #F87171)",
              borderRadius: "50%",
              zIndex: -1
            }}
          />
        )}
      </motion.button>

      <span
        style={{
          marginTop: 14,
          fontSize: 13,
          fontWeight: 500,
          color: "var(--pgo-text-secondary, #9CA3AF)"
        }}
      >
        {isActive ? "Listening..." : state === "connecting" ? "Connecting..." : "Tap to speak"}
      </span>

      {error && (
        <p role="alert" className="pgo-error-msg" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
