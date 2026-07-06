"use client";
import { motion } from "framer-motion";
import { Keyboard, Mic } from "lucide-react";

const FF_VOICE =
  typeof process !== "undefined" ? process.env.NEXT_PUBLIC_FF_PG_VOICE_LISTING === "true" : false;

interface Props {
  onManual: () => void;
  onVoice?: () => void;
}

export default function PgCaptureEntry({ onManual, onVoice }: Props) {
  return (
    <div className="pgo-page">
      <div className="pgo-glass pgo-glass--lg">
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 className="pgo-heading pgo-heading--lg">How would you like to list?</h1>
          <p className="pgo-desc" style={{ marginTop: 8 }}>
            Choose a method below. Nothing is published until you review and submit.
          </p>
        </div>

        <div className="pgo-capture-options">
          {/* Manual (type it myself) */}
          <motion.button
            type="button"
            className="pgo-glass pgo-glass--sm pgo-capture-option"
            style={{ padding: "24px 16px", textAlign: "center", cursor: "pointer", border: "none" }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={onManual}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 12,
                color: "var(--pgo-accent)"
              }}
            >
              <Keyboard size={32} />
            </div>
            <h3 className="pgo-heading pgo-heading--sm" style={{ marginBottom: 6 }}>
              Type it myself
            </h3>
            <p className="pgo-desc" style={{ fontSize: 13 }}>
              Fill in the step-by-step wizard at your own pace.
            </p>
          </motion.button>

          {/* Voice (Talk to list) */}
          <motion.button
            type="button"
            className="pgo-glass pgo-glass--sm pgo-capture-option"
            style={{
              padding: "24px 16px",
              textAlign: "center",
              cursor: FF_VOICE ? "pointer" : "not-allowed",
              opacity: FF_VOICE ? 1 : 0.55,
              border: "none"
            }}
            whileHover={FF_VOICE ? { scale: 1.02 } : {}}
            whileTap={FF_VOICE ? { scale: 0.97 } : {}}
            disabled={!FF_VOICE}
            onClick={() => FF_VOICE && onVoice?.()}
            aria-disabled={!FF_VOICE}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 12,
                color: "var(--pgo-accent)"
              }}
            >
              <Mic size={32} />
            </div>
            <h3 className="pgo-heading pgo-heading--sm" style={{ marginBottom: 6 }}>
              Talk to list
            </h3>
            <p className="pgo-desc" style={{ fontSize: 13 }}>
              {FF_VOICE
                ? "Describe your PG by voice — AI fills the form."
                : "Voice listing — enabling soon"}
            </p>
          </motion.button>
        </div>
      </div>
    </div>
  );
}
