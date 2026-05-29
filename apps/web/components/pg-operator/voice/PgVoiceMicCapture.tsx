"use client";
import { useRef, useState } from "react";
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
    // Split at the 32KB boundary
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

  return (
    <div className="pg-mic-capture" data-state={state}>
      <button
        type="button"
        onClick={toggle}
        aria-label="tap to talk"
        data-active={state === "listening"}
      >
        {state === "listening" ? "Stop" : "Tap to talk"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
