import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHoldToTalk } from "../useHoldToTalk";

describe("useHoldToTalk", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports unsupported when SpeechRecognition is absent", () => {
    // Delete SpeechRecognition from window if it exists
    const w = window as unknown as Record<string, unknown>;
    const original = w.SpeechRecognition;
    delete w.SpeechRecognition;

    const { result } = renderHook(() =>
      useHoldToTalk({ lang: "en-IN", onInterim: () => {}, onFinal: () => {} })
    );
    expect(result.current.supported).toBe(false);

    // Restore
    if (original) w.SpeechRecognition = original;
  });

  it("start() flips state to listening when supported", () => {
    class FakeRec {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: null | (() => void) = null;
      onend: null | (() => void) = null;
      onerror: null | ((e: unknown) => void) = null;
      onresult: null | ((e: unknown) => void) = null;
      start() {
        this.onstart?.();
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    const w = window as unknown as Record<string, unknown>;
    const original = w.SpeechRecognition;
    w.SpeechRecognition = FakeRec;

    const { result } = renderHook(() =>
      useHoldToTalk({ lang: "en-IN", onInterim: () => {}, onFinal: () => {} })
    );
    expect(result.current.supported).toBe(true);
    act(() => result.current.start());
    expect(result.current.state).toBe("listening");

    // Restore
    if (original) w.SpeechRecognition = original;
    else delete w.SpeechRecognition;
  });
});
