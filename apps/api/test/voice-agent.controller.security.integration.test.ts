import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { VoiceAgentController } from "../src/modules/voice-agent/voice-agent.controller";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";
import { ROLES_KEY } from "../src/common/roles.decorator";

describe("VoiceAgentController security", () => {
  it("marks owner voice-agent endpoints as owner/pg_operator protected", () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, VoiceAgentController) ?? []) as Array<
      new (...args: unknown[]) => unknown
    >;
    const roles = (Reflect.getMetadata(ROLES_KEY, VoiceAgentController) ?? []) as string[];

    expect(guards).toEqual(expect.arrayContaining([AuthGuard, RolesGuard]));
    expect(roles).toEqual(expect.arrayContaining(["owner", "pg_operator"]));
  });
});
