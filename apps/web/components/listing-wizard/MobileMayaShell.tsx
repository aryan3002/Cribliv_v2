"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, ChevronDown, Sparkles } from "lucide-react";
import type { RealtimeAgentState } from "../../lib/realtime-client";

const MOBILE_MAYA_QUERY = "(max-width: 1100px)";

const STATUS_COPY: Record<RealtimeAgentState, string> = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  ended: "Ended",
  error: "Needs attention"
};

interface MobileMayaShellProps {
  agentState: RealtimeAgentState;
  voiceActive: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}

function useMobileMayaLayout() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_MAYA_QUERY).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia(MOBILE_MAYA_QUERY);
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  return isMobile;
}

export function MobileMayaShell({
  agentState,
  voiceActive,
  expanded,
  onExpandedChange,
  children
}: MobileMayaShellProps) {
  const isMobile = useMobileMayaLayout();
  const previousAgentState = useRef<RealtimeAgentState>(agentState);

  useEffect(() => {
    const finishedReply =
      previousAgentState.current === "speaking" &&
      (agentState === "listening" || agentState === "idle");
    const typingInMaya =
      typeof document !== "undefined" &&
      document.activeElement?.closest(".cz-text-fallback") !== null;

    if (isMobile && expanded && finishedReply && !typingInMaya) {
      onExpandedChange(false);
    }
    previousAgentState.current = agentState;
  }, [agentState, expanded, isMobile, onExpandedChange]);

  const status = STATUS_COPY[agentState];
  const trayHidden = isMobile && !expanded;

  return (
    <div
      className="cz-maya-shell"
      data-mobile={isMobile ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
      data-state={agentState}
    >
      {isMobile && !expanded ? (
        <button
          type="button"
          className="cz-maya-mobile__bubble"
          data-state={agentState}
          data-active={voiceActive ? "true" : "false"}
          aria-label={`Open Maya, ${status.toLowerCase()}`}
          onClick={() => onExpandedChange(true)}
        >
          <span className="cz-maya-mobile__bubble-icon" aria-hidden="true">
            {voiceActive ? <AudioLines size={22} /> : <Sparkles size={22} />}
          </span>
          <span className="cz-maya-mobile__bubble-copy">
            <strong>Maya</strong>
            <span>{status}</span>
          </span>
        </button>
      ) : null}

      <div
        className={isMobile ? "cz-maya-mobile__tray" : "cz-maya-desktop"}
        hidden={trayHidden}
      >
        {isMobile ? (
          <button
            type="button"
            className="cz-maya-mobile__minimize"
            aria-label="Minimize Maya"
            onClick={() => onExpandedChange(false)}
          >
            <ChevronDown size={20} aria-hidden="true" />
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
