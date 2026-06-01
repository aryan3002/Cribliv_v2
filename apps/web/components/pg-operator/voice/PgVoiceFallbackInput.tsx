"use client";
import { useState } from "react";
import { Send } from "lucide-react";

export default function PgVoiceFallbackInput({ onSend }: { onSend: (t: string) => void }) {
  const [v, setV] = useState("");

  const submit = () => {
    if (v.trim()) {
      onSend(v.trim());
      setV("");
    }
  };

  return (
    <div className="pgo-voice-input">
      <input
        className="pgo-voice-input__field"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Type instead…"
        aria-label="text input"
      />
      <button className="pgo-voice-input__send" onClick={submit} aria-label="Send">
        <Send size={16} />
      </button>
    </div>
  );
}
