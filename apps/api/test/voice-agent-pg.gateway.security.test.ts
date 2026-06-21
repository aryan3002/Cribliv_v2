import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { GATEWAY_OPTIONS } from "@nestjs/websockets/constants";
import { VoiceAgentPgGateway } from "../src/modules/voice-agent-pg/voice-agent-pg.gateway";

describe("VoiceAgentPgGateway CORS hardening", () => {
  it("uses explicit CORS origin list instead of wildcard true", () => {
    const options = (Reflect.getMetadata(GATEWAY_OPTIONS, VoiceAgentPgGateway) ?? {}) as {
      cors?: unknown;
    };
    expect(options.cors).not.toBe(true);
    expect(options.cors).toMatchObject({ credentials: true });
  });
});
