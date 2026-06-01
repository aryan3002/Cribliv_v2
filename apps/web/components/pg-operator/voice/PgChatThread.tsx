"use client";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export interface PgChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool-signal";
  text: string;
  ts: number;
}

/**
 * Text-mode conversation view. Mirrors the visual rhythm of the voice transcript
 * bubbles but with first-class assistant typing/thinking indicators and a stable
 * keying scheme so messages don't shuffle on append.
 */
export default function PgChatThread({
  messages,
  thinking
}: {
  messages: PgChatMessage[];
  thinking: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, thinking]);

  if (messages.length === 0 && !thinking) {
    return (
      <div className="pgo-voice-sheet__empty">
        <Sparkles size={36} className="pgo-animate-float" aria-hidden />
        <p style={{ marginTop: 12 }}>Connecting to Chaya…</p>
      </div>
    );
  }

  return (
    <div className="pgo-chat-thread" role="log" aria-live="polite">
      {messages.map((m) => {
        if (m.role === "tool-signal") {
          return (
            <div key={m.id} className="pgo-chat-tool">
              <Sparkles size={12} aria-hidden /> {m.text}
            </div>
          );
        }
        const isUser = m.role === "user";
        return (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className={`pgo-bubble ${isUser ? "pgo-bubble--user" : "pgo-bubble--ai"}`}
          >
            {m.text}
          </motion.div>
        );
      })}
      {thinking && (
        <div
          className="pgo-bubble pgo-bubble--ai pgo-bubble--thinking"
          aria-label="Assistant thinking"
        >
          <span className="pgo-loading-dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
