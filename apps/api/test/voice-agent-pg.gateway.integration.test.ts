import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { VoiceAgentPgGateway } from "../src/modules/voice-agent-pg/voice-agent-pg.gateway";
import { PgVoiceSessionService } from "../src/modules/voice-agent-pg/services/pg-voice-session.service";
import { PgExtractionService } from "../src/modules/voice-agent-pg/services/pg-extraction.service";
import { PgConversationOrchestrator } from "../src/modules/voice-agent-pg/services/pg-conversation-orchestrator.service";
import { PgLlmClient } from "../src/modules/voice-agent-pg/services/pg-llm-client.service";
import { DatabaseService } from "../src/common/database.service";
import { AppStateService } from "../src/common/app-state.service";

const fakeDb = {
  isEnabled: () => false,
  query: async () => ({ rows: [] })
};

// LLM client is only exercised in text mode. Voice-mode integration tests
// never hit it; stub it out so we don't need Azure OpenAI credentials in CI.
const fakeLlm = {
  requestTurn: async () => ({ finalText: "", toolCalls: [], done: true })
};

@Module({
  providers: [
    VoiceAgentPgGateway,
    PgVoiceSessionService,
    PgExtractionService,
    PgConversationOrchestrator,
    AppStateService,
    { provide: DatabaseService, useValue: fakeDb },
    { provide: PgLlmClient, useValue: fakeLlm }
  ]
})
class TestPgVoiceModule {}

describe("VoiceAgentPgGateway (integration)", () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestPgVoiceModule]
    }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    const addr = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}/voice-agent-pg`;
  });

  afterAll(async () => {
    await app.close();
  });

  let testOperatorCounter = 0;
  // Gateway now validates operator UUID format and rejects non-UUID handshakes
  // with `unauth_handshake`. Tests synthesise a deterministic UUID per client.
  function makeOpUuid(n: number): string {
    const seq = String(n).padStart(12, "0");
    return `00000000-0000-0000-0000-${seq}`;
  }
  async function newClient(): Promise<ClientSocket> {
    testOperatorCounter++;
    const c = ioClient(url, {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: false,
      auth: { userId: makeOpUuid(testOperatorCounter) }
    });
    await new Promise<void>((resolve, reject) => {
      const tm = setTimeout(() => reject(new Error(`connect timeout url=${url}`)), 4000);
      c.once("connect", () => {
        clearTimeout(tm);
        resolve();
      });
      c.once("connect_error", (e) => {
        clearTimeout(tm);
        reject(new Error(`connect_error: ${e.message} url=${url}`));
      });
    });
    return c;
  }

  async function startSession(client: ClientSocket): Promise<{ session_id: string }> {
    return new Promise((resolve) => {
      client.once("session_ready", (data: { session_id: string; phase: string }) => resolve(data));
      client.emit("start_session", { locale: "en" });
    });
  }

  it("emits session_ready on start_session", async () => {
    const c = await newClient();
    const ready = await startSession(c);
    expect(ready.session_id).toBeTruthy();
    c.disconnect();
  });

  it("emits field_extracted when extract_property_basics tool_call succeeds", async () => {
    const c = await newClient();
    await startSession(c);
    const ev = await new Promise<{ field: string; value: unknown }>((resolve) => {
      c.once("field_extracted", resolve);
      c.emit("tool_call", {
        name: "extract_property_basics",
        input: { display_name: "Hostel B" },
        pg_property_id: "prop-1"
      });
    });
    expect(ev.field).toBe("property.display_name");
    expect(ev.value).toBe("Hostel B");
    c.disconnect();
  });

  it("emits error on unknown tool", async () => {
    const c = await newClient();
    await startSession(c);
    const err = await new Promise<{ code: string }>((resolve) => {
      c.once("error", resolve);
      c.emit("tool_call", { name: "extract_quantum", input: {} });
    });
    expect(err.code).toBe("unknown_tool");
    c.disconnect();
  });

  it("emits validation error on invalid input", async () => {
    const c = await newClient();
    await startSession(c);
    const err = await new Promise<{ code: string }>((resolve) => {
      c.once("error", resolve);
      c.emit("tool_call", {
        name: "extract_property_basics",
        input: { display_name: "" },
        pg_property_id: "prop-1"
      });
    });
    expect(err.code).toBe("validation_failed");
    c.disconnect();
  });

  it("emits phase_changed when greeting -> discovery on first tool_call", async () => {
    const c = await newClient();
    await startSession(c);

    // greeting -> discovery is unconditional on first tool_call; listen up-front.
    const phase = await new Promise<{ from: string; to: string }>((resolve, reject) => {
      const tm = setTimeout(() => reject(new Error("phase_changed timeout")), 3000);
      c.once("phase_changed", (data: { from: string; to: string }) => {
        clearTimeout(tm);
        resolve(data);
      });
      c.emit("tool_call", {
        name: "extract_property_basics",
        input: { display_name: "Hostel C" },
        pg_property_id: "prop-1"
      });
    });
    expect(phase.from).toBe("greeting");
    expect(phase.to).toBe("discovery");
    c.disconnect();
  });

  it("end_session cleans up + emits session_ended", async () => {
    const c = await newClient();
    await startSession(c);
    const ended = await new Promise<{ draft_id: string | null }>((resolve) => {
      c.once("session_ended", resolve);
      c.emit("end_session");
    });
    expect(ended).toBeDefined();
    c.disconnect();
  });
});
