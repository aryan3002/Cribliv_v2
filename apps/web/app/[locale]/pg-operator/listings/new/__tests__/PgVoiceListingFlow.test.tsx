import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  const socket = {
    on: (e: string, cb: any) => {
      (listeners[e] ??= []).push(cb);
    },
    off: (e: string, cb: any) => {
      listeners[e] = (listeners[e] ?? []).filter((x) => x !== cb);
    },
    connect: vi.fn(),
    start: vi.fn(),
    end: vi.fn(),
    sendText: vi.fn(),
    sendAudio: vi.fn(),
    isConnected: () => true
  };
  const emit = (e: string, payload?: any) => (listeners[e] ?? []).forEach((cb) => cb(payload));
  const push = vi.fn();
  return { socket, emit, push, listeners };
});

vi.mock("@/lib/pg-voice-socket", () => ({
  createPgVoiceSocket: () => h.socket,
  setPgVoiceToken: vi.fn(),
  PG_AUDIO_CHUNK_MAX: 32768
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/pg-funnel", () => ({ trackPgFunnel: vi.fn(), setPgFunnelToken: vi.fn() }));
vi.mock("@/lib/pg-operator-api", () => ({
  putPgDraft: vi.fn(async () => ({ draft_id: "vd-1", updated_at: "t" }))
}));
vi.mock("@/components/pg-operator/voice/PgVoiceMicCapture", () => ({
  default: () => <div data-testid="mic" />
}));
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: any) => <div {...rest}>{children}</div>
    }
  )
}));

import PgVoiceListingFlow from "../PgVoiceListingFlow";

beforeEach(() => {
  h.push.mockClear();
  for (const k of Object.keys(h.listeners)) delete h.listeners[k];
  // jsdom doesn't implement scrollIntoView (PgChatThread auto-scrolls on append).
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

function mount() {
  return render(<PgVoiceListingFlow userId="op-1" accessToken={null} locale="en" />);
}

describe("PgVoiceListingFlow", () => {
  it("shows the mic once the session is ready", () => {
    mount();
    expect(screen.queryByTestId("mic")).toBeNull(); // connecting…
    act(() => h.emit("session_ready"));
    expect(screen.getByTestId("mic")).toBeTruthy();
  });

  it("renders a confirm card on field_extracted and advances the phase rail", () => {
    mount();
    act(() => h.emit("session_ready"));
    act(() =>
      h.emit("field_extracted", {
        field: "property.display_name",
        value: "Sunrise PG",
        confidence: 0.9,
        draft_id: "vd-1"
      })
    );
    expect(screen.getByText("Sunrise PG")).toBeTruthy();
    act(() =>
      h.emit("phase_changed", { from: "greeting", to: "pricing", fields_captured_count: 1 })
    );
    expect(screen.getByTestId("phase-pricing").getAttribute("data-state")).toBe("active");
  });

  it("on session_ended shows the Review CTA that routes into the wizard review step", () => {
    mount();
    act(() => h.emit("session_ready"));
    act(() => h.emit("session_ended", { draft_id: "vd-1", listing_id: null, reason: "user_done" }));
    const cta = screen.getByRole("button", { name: /review your listing/i });
    fireEvent.click(cta);
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(String(h.push.mock.calls[0][0])).toContain("step=review");
  });
});
