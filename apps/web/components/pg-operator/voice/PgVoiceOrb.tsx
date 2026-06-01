"use client";
import { Dispatch, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Loader2 } from "lucide-react";
import type { PgWizardAction, PgWizardState } from "@/lib/pg-wizard-state";

const PgVoicePanel = dynamic(() => import("./PgVoicePanel"), { ssr: false });

type OrbState = "idle" | "connecting" | "listening" | "processing" | "ended";

export default function PgVoiceOrb({
  state,
  dispatch,
  locale,
  userId
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
  /** Real operator UUID from server-side session — required for socket handshake. */
  userId: string | null;
}) {
  const [orb, setOrb] = useState<OrbState>("idle");
  const [open, setOpen] = useState(false);

  const isListening = orb === "listening";
  const isLoading = orb === "connecting" || orb === "processing";

  return (
    <>
      <div className={`pgo-orb ${isListening ? "pgo-orb--listening" : ""}`}>
        {/* Aurora rings */}
        <div className="pgo-orb__ring" />
        <div className="pgo-orb__ring" />
        <div className="pgo-orb__ring" />

        <motion.button
          type="button"
          className="pgo-orb__btn"
          data-state={orb}
          onClick={() => setOpen(true)}
          aria-label="Open Chaya voice assistant"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
        >
          {isLoading ? (
            <Loader2
              size={28}
              className="pgo-animate-spin"
              style={{ animation: "pgo-spin 1s linear infinite" }}
            />
          ) : (
            <Mic size={28} />
          )}
        </motion.button>

        <div className="pgo-orb__tooltip">✨ Ask Chaya</div>
      </div>

      <AnimatePresence>
        {open && (
          <PgVoicePanel
            locale={locale}
            userId={userId}
            state={state}
            dispatch={dispatch}
            orb={orb}
            setOrb={setOrb}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
