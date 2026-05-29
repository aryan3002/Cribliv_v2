import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// MediaRecorder + getUserMedia must be mocked before importing the component.
const recorderInstance: any = {
  state: "inactive",
  start: vi.fn(),
  stop: vi.fn(),
  ondataavailable: null as null | ((ev: { data: Blob }) => void)
};

class MockMediaRecorder {
  constructor(_stream: MediaStream, _opts?: MediaRecorderOptions) {
    return recorderInstance;
  }
  static isTypeSupported = vi.fn().mockReturnValue(true);
}

const getUserMedia = vi.fn();

beforeEach(() => {
  recorderInstance.state = "inactive";
  recorderInstance.ondataavailable = null;
  recorderInstance.start.mockReset();
  recorderInstance.stop.mockReset();
  getUserMedia.mockReset();
  (globalThis as any).MediaRecorder = MockMediaRecorder;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: {
      getUserMedia: getUserMedia.mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }]
      })
    },
    configurable: true
  });
});

import PgVoiceMicCapture from "../PgVoiceMicCapture";

describe("PgVoiceMicCapture", () => {
  it("starts recording on first tap, transitions to listening", async () => {
    const onChunk = vi.fn();
    const onStateChange = vi.fn();
    render(<PgVoiceMicCapture onChunk={onChunk} onStateChange={onStateChange} />);
    fireEvent.click(screen.getByRole("button", { name: /tap to talk/i }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ audio: true }));
    await waitFor(() => expect(recorderInstance.start).toHaveBeenCalledWith(250));
    expect(onStateChange).toHaveBeenCalledWith("connecting");
    expect(onStateChange).toHaveBeenCalledWith("listening");
    expect(screen.getByRole("button")).toHaveTextContent(/stop/i);
  });

  it("forwards chunks ≤32KB unsplit", async () => {
    const onChunk = vi.fn();
    render(<PgVoiceMicCapture onChunk={onChunk} onStateChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /tap to talk/i }));
    await waitFor(() => expect(recorderInstance.start).toHaveBeenCalled());
    const blob = new Blob([new Uint8Array(10_000)], { type: "audio/webm;codecs=opus" });
    await act(async () => {
      recorderInstance.ondataavailable?.({ data: blob });
      // allow the async arrayBuffer + emit
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect((onChunk.mock.calls[0][0] as ArrayBuffer).byteLength).toBe(10_000);
  });

  it("splits oversize chunks at the 32KB boundary", async () => {
    const onChunk = vi.fn();
    render(<PgVoiceMicCapture onChunk={onChunk} onStateChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /tap to talk/i }));
    await waitFor(() => expect(recorderInstance.start).toHaveBeenCalled());
    const blob = new Blob([new Uint8Array(80_000)], { type: "audio/webm;codecs=opus" });
    await act(async () => {
      recorderInstance.ondataavailable?.({ data: blob });
      await Promise.resolve();
      await Promise.resolve();
    });
    // 80,000 / 32,768 = 2 full + remainder = 3 chunks
    expect(onChunk.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [arg] of onChunk.mock.calls) {
      expect((arg as ArrayBuffer).byteLength).toBeLessThanOrEqual(32_768);
    }
    const totalBytes = onChunk.mock.calls.reduce(
      (sum, [arg]) => sum + (arg as ArrayBuffer).byteLength,
      0
    );
    expect(totalBytes).toBe(80_000);
  });

  it("ignores zero-byte chunks", async () => {
    const onChunk = vi.fn();
    render(<PgVoiceMicCapture onChunk={onChunk} onStateChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /tap to talk/i }));
    await waitFor(() => expect(recorderInstance.start).toHaveBeenCalled());
    const blob = new Blob([], { type: "audio/webm;codecs=opus" });
    await act(async () => {
      recorderInstance.ondataavailable?.({ data: blob });
      await Promise.resolve();
    });
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("stops recording on second tap, transitions to idle", async () => {
    const onStateChange = vi.fn();
    render(<PgVoiceMicCapture onChunk={() => {}} onStateChange={onStateChange} />);
    const btn = screen.getByRole("button", { name: /tap to talk/i });
    fireEvent.click(btn);
    await waitFor(() => expect(recorderInstance.start).toHaveBeenCalled());
    recorderInstance.state = "recording";
    fireEvent.click(screen.getByRole("button"));
    expect(recorderInstance.stop).toHaveBeenCalled();
    expect(onStateChange).toHaveBeenLastCalledWith("idle");
  });

  it("surfaces mic permission errors as an alert and returns to idle", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("Permission denied"));
    const onStateChange = vi.fn();
    render(<PgVoiceMicCapture onChunk={() => {}} onStateChange={onStateChange} />);
    fireEvent.click(screen.getByRole("button", { name: /tap to talk/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/permission denied/i));
    expect(onStateChange).toHaveBeenCalledWith("idle");
  });

  it("uses opus codec when supported", async () => {
    render(<PgVoiceMicCapture onChunk={() => {}} onStateChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /tap to talk/i }));
    await waitFor(() =>
      expect(MockMediaRecorder.isTypeSupported).toHaveBeenCalledWith("audio/webm;codecs=opus")
    );
  });
});
