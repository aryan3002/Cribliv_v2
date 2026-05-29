"use client";
import { useState } from "react";
export default function PgVoiceFallbackInput({ onSend }: { onSend: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="pg-voice-fallback">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Type instead…"
        aria-label="text input"
      />
      <button
        onClick={() => {
          if (v.trim()) {
            onSend(v.trim());
            setV("");
          }
        }}
      >
        Send
      </button>
    </div>
  );
}
