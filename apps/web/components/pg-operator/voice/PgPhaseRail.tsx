"use client";

import type { VoiceAgentPgPhase } from "@cribliv/shared-types";

interface Props {
  phase: VoiceAgentPgPhase;
}

// Mirrors PG_PHASES (apps/api/.../schema/pg-phase.ts). 'done' is terminal and not
// shown as a rail node. Labels are operator-facing.
const RAIL: Array<{ id: Exclude<VoiceAgentPgPhase, "done">; label: string }> = [
  { id: "greeting", label: "Welcome" },
  { id: "discovery", label: "Details" },
  { id: "pricing", label: "Pricing" },
  { id: "food", label: "Food" },
  { id: "rules", label: "Rules" },
  { id: "media", label: "Photos" },
  { id: "confirmation", label: "Review" }
];

const ORDER: VoiceAgentPgPhase[] = [...RAIL.map((r) => r.id), "done"];

/** Linear phase progress for the voice listing flow. */
export function PgPhaseRail({ phase }: Props) {
  const current = ORDER.indexOf(phase);
  return (
    <ol
      className="pgo-phase-rail"
      style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", gap: 4 }}
    >
      {RAIL.map((node, i) => {
        const state = i < current ? "done" : i === current ? "active" : "upcoming";
        return (
          <li
            key={node.id}
            data-testid={`phase-${node.id}`}
            data-state={state}
            aria-current={state === "active" ? "step" : undefined}
            style={{ flex: 1, textAlign: "center", fontSize: 11 }}
          >
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background:
                  state === "done"
                    ? "var(--pgo-success, #22c55e)"
                    : state === "active"
                      ? "var(--pgo-accent, #6366f1)"
                      : "var(--pgo-border, rgba(255,255,255,0.15))"
              }}
            />
            <span
              style={{
                opacity: state === "upcoming" ? 0.45 : 0.85,
                marginTop: 4,
                display: "block"
              }}
            >
              {node.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
