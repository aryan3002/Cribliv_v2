import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RealtimeAgentState } from "../../../lib/realtime-client";
import { MobileMayaShell } from "../MobileMayaShell";

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

function Harness({
  agentState = "idle",
  initialExpanded = false
}: {
  agentState?: RealtimeAgentState;
  initialExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [voiceActive] = useState(true);

  return (
    <>
      <output data-testid="voice-active">{String(voiceActive)}</output>
      <MobileMayaShell
        agentState={agentState}
        voiceActive={voiceActive}
        expanded={expanded}
        onExpandedChange={setExpanded}
      >
        <aside aria-label="Voice concierge" data-testid="voice-session">
          Active realtime client
        </aside>
      </MobileMayaShell>
    </>
  );
}

describe("MobileMayaShell", () => {
  it("renders a collapsed Maya bubble by default on mobile", () => {
    installMatchMedia(true);

    render(<Harness />);

    expect(screen.getByRole("button", { name: /open maya/i })).toBeVisible();
    expect(screen.getByTestId("voice-session")).toBeInTheDocument();
    expect(screen.getByTestId("voice-session").closest("[hidden]")).not.toBeNull();
  });

  it("opens and collapses the tray without toggling or unmounting the voice session", () => {
    installMatchMedia(true);

    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /open maya/i }));
    expect(screen.getByRole("button", { name: /minimize maya/i })).toBeVisible();
    expect(screen.getByTestId("voice-active")).toHaveTextContent("true");
    expect(screen.getByTestId("voice-session")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /minimize maya/i }));
    expect(screen.getByRole("button", { name: /open maya/i })).toBeVisible();
    expect(screen.getByTestId("voice-active")).toHaveTextContent("true");
    expect(screen.getByTestId("voice-session")).toBeInTheDocument();
  });

  it("auto-collapses after Maya finishes speaking while retaining the session", () => {
    installMatchMedia(true);

    const { rerender } = render(<Harness agentState="speaking" initialExpanded />);
    expect(screen.getByRole("button", { name: /minimize maya/i })).toBeVisible();

    rerender(<Harness agentState="listening" initialExpanded />);

    expect(screen.getByRole("button", { name: /open maya/i })).toBeVisible();
    expect(screen.getByTestId("voice-active")).toHaveTextContent("true");
    expect(screen.getByTestId("voice-session")).toBeInTheDocument();
  });

  it("shows active listening status on the collapsed bubble", () => {
    installMatchMedia(true);

    render(<Harness agentState="listening" />);

    expect(screen.getByRole("button", { name: /open maya, listening/i })).toBeVisible();
    expect(screen.getByText("Listening")).toBeVisible();
  });

  it("keeps the existing desktop panel visible without a floating bubble", () => {
    installMatchMedia(false);

    render(<Harness />);

    expect(screen.queryByRole("button", { name: /open maya/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("voice-session")).toBeVisible();
  });
});
