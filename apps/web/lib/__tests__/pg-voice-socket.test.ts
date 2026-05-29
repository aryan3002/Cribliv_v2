import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ──────────────────────────────────────────────────────────────────────
 * Mock socket.io-client
 *
 * vi.mock() is hoisted to the top of the file, so any variables it
 * references must be declared inside vi.hoisted(). We share a single
 * stub object across tests; the afterEach hook calls
 * disconnectPgVoiceSocket() which:
 *   (a) resets our module-level singleton (handle = null, socket = null)
 *   (b) invokes socketStub.removeAllListeners + socketStub.disconnect.
 * Because the stub object is reused for the next test's `io()` call,
 * we reset its mock fns (and `connected` flag) in beforeEach for
 * full isolation.
 * ──────────────────────────────────────────────────────────────────── */

const mocks = vi.hoisted(() => {
  const emit = vi.fn();
  const on = vi.fn();
  const off = vi.fn();
  const connect = vi.fn();
  const disconnect = vi.fn();
  const removeAllListeners = vi.fn();
  const socketStub: any = {
    emit,
    on,
    off,
    connect,
    disconnect,
    removeAllListeners,
    connected: false
  };
  const io = vi.fn(() => socketStub);
  return { emit, on, off, connect, disconnect, removeAllListeners, socketStub, io };
});

vi.mock("socket.io-client", () => ({ io: mocks.io }));

import {
  createPgVoiceSocket,
  disconnectPgVoiceSocket,
  PG_AUDIO_CHUNK_MAX
} from "../pg-voice-socket";

describe("pg-voice-socket", () => {
  beforeEach(() => {
    mocks.emit.mockReset();
    mocks.on.mockReset();
    mocks.off.mockReset();
    mocks.connect.mockReset();
    mocks.disconnect.mockReset();
    mocks.removeAllListeners.mockReset();
    mocks.io.mockClear();
    mocks.socketStub.connected = false;
  });

  afterEach(() => {
    disconnectPgVoiceSocket();
  });

  // ─── Spec tests ──────────────────────────────────────────────────────

  it("start() emits start_session", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    s.start({ locale: "en" });
    expect(mocks.emit).toHaveBeenCalledWith("start_session", { locale: "en" });
  });

  it("sendText() emits text_input", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    s.sendText("hello");
    expect(mocks.emit).toHaveBeenCalledWith("text_input", { text: "hello" });
  });

  it("sendAudio() rejects >32KB chunks", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    expect(() => s.sendAudio(new Uint8Array(32_769).buffer)).toThrow(/32/);
  });

  it("returns singleton", () => {
    const a = createPgVoiceSocket({ userId: "u1" });
    const b = createPgVoiceSocket({ userId: "u1" });
    expect(a).toBe(b);
  });

  // ─── Strengthening tests ─────────────────────────────────────────────

  it("disconnectPgVoiceSocket() resets the singleton — next create returns a NEW handle", () => {
    const a = createPgVoiceSocket({ userId: "u1" });
    disconnectPgVoiceSocket();
    const b = createPgVoiceSocket({ userId: "u1" });
    expect(b).not.toBe(a);
    // io() should have been invoked twice — once per fresh singleton
    expect(mocks.io).toHaveBeenCalledTimes(2);
  });

  it("sendAudio() accepts Uint8Array", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    const u8 = new Uint8Array(1024);
    expect(() => s.sendAudio(u8)).not.toThrow();
    expect(mocks.emit).toHaveBeenCalledWith("audio_chunk", u8);
  });

  it("sendAudio() at exactly 32KB succeeds (boundary inclusive)", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    const buf = new Uint8Array(PG_AUDIO_CHUNK_MAX).buffer;
    expect(() => s.sendAudio(buf)).not.toThrow();
    expect(mocks.emit).toHaveBeenCalledWith("audio_chunk", buf);
  });

  it("sendAudio() at 32KB+1 throws", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    expect(() => s.sendAudio(new Uint8Array(PG_AUDIO_CHUNK_MAX + 1).buffer)).toThrow(/32/);
  });

  it("end() emits end_session with no args", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    s.end();
    expect(mocks.emit).toHaveBeenCalledWith("end_session");
  });

  it("on() registers handler on underlying socket", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    const cb = vi.fn();
    s.on("session_ready", cb);
    expect(mocks.on).toHaveBeenCalledWith("session_ready", cb);
  });

  it("isConnected() reflects underlying socket state", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    expect(s.isConnected()).toBe(false);
    mocks.socketStub.connected = true;
    expect(s.isConnected()).toBe(true);
  });

  it("start() with pg_property_id passes it through to emit", () => {
    const s = createPgVoiceSocket({ userId: "u1" });
    s.start({ locale: "hi", pg_property_id: "prop-123" });
    expect(mocks.emit).toHaveBeenCalledWith("start_session", {
      locale: "hi",
      pg_property_id: "prop-123"
    });
  });
});
