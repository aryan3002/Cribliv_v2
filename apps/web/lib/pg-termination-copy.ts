export const TERMINATION_REASONS = [
  "duration_cap",
  "idle_timeout",
  "tool_call_cap",
  "concurrent_cap",
  "daily_cap",
  "audio_chunk_too_large",
  "rate_limited",
  "user_end",
  "disconnect"
] as const;

export type TerminationReason = (typeof TERMINATION_REASONS)[number];

export interface TerminationCopy {
  title: string;
  body: string;
  tone: "info" | "warn" | "error";
  silent?: boolean;
}

const COPY: Record<TerminationReason, TerminationCopy> = {
  duration_cap: {
    title: "Session timed out",
    body: "You reached the 5-minute cap. We saved everything Chaya filled in. Finish up in the form below.",
    tone: "warn"
  },
  idle_timeout: {
    title: "We stopped listening",
    body: "No audio for 30 seconds. Tap the mic to resume.",
    tone: "info"
  },
  tool_call_cap: {
    title: "That's a lot of details",
    body: "Chaya filled in plenty. Review and finish the listing in the form.",
    tone: "info"
  },
  concurrent_cap: {
    title: "Voice already running",
    body: "You have Chaya open in another tab. Close that one to start here.",
    tone: "warn"
  },
  daily_cap: {
    title: "Daily voice limit reached",
    body: "You've used 5 voice sessions today. Continue manually or come back tomorrow.",
    tone: "warn"
  },
  audio_chunk_too_large: {
    title: "Audio too large",
    body: "Switching to text input. Type your answer below.",
    tone: "info"
  },
  rate_limited: {
    title: "Slow down a moment",
    body: "Too many messages too quickly. Pause and try again.",
    tone: "warn"
  },
  user_end: {
    title: "Session ended",
    body: "Saved.",
    tone: "info",
    silent: true
  },
  disconnect: {
    title: "Lost connection",
    body: "Your draft is safe. Reconnect when you're ready.",
    tone: "error"
  }
};

export function terminationCopy(reason: TerminationReason | string): TerminationCopy {
  return (COPY as Record<string, TerminationCopy>)[reason] ?? COPY.disconnect;
}
