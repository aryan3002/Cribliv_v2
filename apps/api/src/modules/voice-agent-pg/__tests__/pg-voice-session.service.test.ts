import { describe, it, expect, vi } from "vitest";
import { PgVoiceSessionService } from "../services/pg-voice-session.service";
import { AppStateService } from "../../../common/app-state.service";

function makeDeps() {
  const db = { isEnabled: () => false, query: vi.fn() } as any;
  const state = new AppStateService();
  return { db, state };
}

describe("PgVoiceSessionService", () => {
  it("creates a session with phase=greeting and prompt version", async () => {
    const { db, state } = makeDeps();
    const svc = new PgVoiceSessionService(db, state);
    const s = await svc.startSession({
      operatorUserId: "op-1",
      locale: "en",
      systemPromptVersion: "v1.0"
    });
    expect(s.phase).toBe("greeting");
    expect(s.system_prompt_version).toBe("v1.0");
    expect(s.operator_user_id).toBe("op-1");
  });

  it("appendTranscript stores an entry", async () => {
    const { db, state } = makeDeps();
    const svc = new PgVoiceSessionService(db, state);
    const s = await svc.startSession({
      operatorUserId: "op-1",
      locale: "en",
      systemPromptVersion: "v1.0"
    });
    await svc.appendTranscript(s.id, {
      role: "user",
      text: "Hi",
      ts: new Date().toISOString()
    });
    const fresh = state.getPgVoiceSession(s.id) as any;
    expect(fresh.transcript.length).toBe(1);
    expect(fresh.transcript[0].text).toBe("Hi");
  });

  it("logExtraction stores an entry in extraction_log", async () => {
    const { db, state } = makeDeps();
    const svc = new PgVoiceSessionService(db, state);
    const s = await svc.startSession({
      operatorUserId: "op-1",
      locale: "en",
      systemPromptVersion: "v1.0"
    });
    await svc.logExtraction(s.id, {
      field: "pg_details.total_beds",
      value: 24,
      confidence: 0.9,
      tool: "extract_room_config",
      phase: "discovery",
      ts: new Date().toISOString()
    });
    const fresh = state.getPgVoiceSession(s.id) as any;
    expect(fresh.extraction_log.length).toBe(1);
  });

  it("updatePhase mutates phase", async () => {
    const { db, state } = makeDeps();
    const svc = new PgVoiceSessionService(db, state);
    const s = await svc.startSession({
      operatorUserId: "op-1",
      locale: "en",
      systemPromptVersion: "v1.0"
    });
    await svc.updatePhase(s.id, "pricing");
    expect((state.getPgVoiceSession(s.id) as any).phase).toBe("pricing");
  });

  it("endSession sets ended_at", async () => {
    const { db, state } = makeDeps();
    const svc = new PgVoiceSessionService(db, state);
    const s = await svc.startSession({
      operatorUserId: "op-1",
      locale: "en",
      systemPromptVersion: "v1.0"
    });
    await svc.endSession(s.id);
    expect((state.getPgVoiceSession(s.id) as any).ended_at).toBeTruthy();
  });
});
