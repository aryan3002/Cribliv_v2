import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

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
    isConnected: () => true // skip connect() path; we drive events directly
  };
  const emit = (e: string, payload?: any) => (listeners[e] ?? []).forEach((cb) => cb(payload));
  return { socket, emit, listeners };
});

vi.mock("@/lib/pg-voice-socket", () => ({
  createPgVoiceSocket: () => h.socket,
  setPgVoiceToken: vi.fn(),
  PG_AUDIO_CHUNK_MAX: 32768
}));
vi.mock("../PgVoiceMicCapture", () => ({ default: () => <div data-testid="mic" /> }));
vi.mock("../PgVoiceTimer", () => ({ default: () => <span /> }));
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

import PgVoicePanel from "../PgVoicePanel";
import { PgFieldHighlightProvider } from "../PgFieldHighlightContext";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

function renderPanel(setField = vi.fn(), dispatch = vi.fn()) {
  const state: any = {
    assistantMode: "voice",
    draft: {},
    pendingPhotos: [],
    currentStep: 1,
    undoStack: []
  };
  render(
    <PgFieldHighlightProvider value={{ field: null, setField }}>
      <PgVoicePanel
        locale="en"
        userId={VALID_UUID}
        state={state}
        dispatch={dispatch}
        orb="listening"
        setOrb={() => {}}
        onClose={() => {}}
      />
    </PgFieldHighlightProvider>
  );
  return { setField, dispatch };
}

beforeEach(() => {
  for (const k of Object.keys(h.listeners)) delete h.listeners[k];
});

describe("PgVoicePanel inline co-pilot (Task 4b)", () => {
  it("dispatches into the wizard draft and highlights the just-filled field", () => {
    const { setField, dispatch } = renderPanel();
    act(() =>
      h.emit("field_extracted", {
        field: "property.display_name",
        value: "Sunrise PG",
        confidence: 0.95,
        draft_id: "d1"
      })
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "VOICE_EXTRACTED", field: "property.display_name" })
    );
    expect(setField).toHaveBeenCalledWith("property.display_name");
  });

  it("shows a confirm card with undo for a low-confidence extraction", () => {
    const dispatch = vi.fn();
    renderPanel(vi.fn(), dispatch);
    act(() =>
      h.emit("field_extracted", {
        field: "property.city_slug",
        value: "lucknow",
        confidence: 0.4,
        draft_id: "d1"
      })
    );
    expect(screen.getByText(/please confirm/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: "UNDO_LAST" });
  });

  it("does not show a confirm card for a high-confidence extraction", () => {
    renderPanel();
    act(() =>
      h.emit("field_extracted", {
        field: "property.display_name",
        value: "Sunrise PG",
        confidence: 0.9,
        draft_id: "d1"
      })
    );
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("advances the phase rail on phase_changed", () => {
    renderPanel();
    act(() =>
      h.emit("phase_changed", { from: "greeting", to: "pricing", fields_captured_count: 1 })
    );
    expect(screen.getByTestId("phase-pricing").getAttribute("data-state")).toBe("active");
  });
});
