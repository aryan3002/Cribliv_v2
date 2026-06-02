import "reflect-metadata";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Module, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PgFunnelController } from "../src/modules/pg-operator/pg-funnel.controller";
import { PgFunnelService } from "../src/modules/pg-operator/services/pg-funnel.service";
import { AuthGuard } from "../src/common/auth.guard";

const track = vi.fn(async () => undefined);

function buildApp(opts: { authed: boolean; userId?: string }) {
  @Module({
    controllers: [PgFunnelController],
    providers: [{ provide: PgFunnelService, useValue: { track } }]
  })
  class TestModule {}

  const guard = {
    canActivate: (ctx: any) => {
      if (!opts.authed) return false;
      ctx.switchToHttp().getRequest().user = { id: opts.userId ?? "op-1", role: "operator" };
      return true;
    }
  };
  return { TestModule, guard };
}

async function start(mod: any, guard: any): Promise<INestApplication> {
  const ref = await Test.createTestingModule({ imports: [mod] })
    .overrideGuard(AuthGuard)
    .useValue(guard)
    .compile();
  const app = ref.createNestApplication();
  await app.init();
  return app;
}

describe("POST /pg-operator/funnel (integration)", () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
    track.mockClear();
  });

  it("accepts an authed event (202) and attaches operator id", async () => {
    const { TestModule, guard } = buildApp({ authed: true, userId: "op-7" });
    app = await start(TestModule, guard);
    await request(app.getHttpServer())
      .post("/pg-operator/funnel")
      .send({ event_type: "wizard_started", source: "manual" })
      .expect(202);
    expect(track).toHaveBeenCalledWith(
      "op-7",
      expect.objectContaining({ event_type: "wizard_started", source: "manual" })
    );
  });

  it("rejects unauthenticated (403/401)", async () => {
    const { TestModule, guard } = buildApp({ authed: false });
    app = await start(TestModule, guard);
    const res = await request(app.getHttpServer())
      .post("/pg-operator/funnel")
      .send({ event_type: "wizard_started", source: "manual" });
    expect([401, 403]).toContain(res.status);
    expect(track).not.toHaveBeenCalled();
  });

  it("rejects an invalid event_type (zod)", async () => {
    const { TestModule, guard } = buildApp({ authed: true });
    app = await start(TestModule, guard);
    await request(app.getHttpServer())
      .post("/pg-operator/funnel")
      .send({ event_type: "nonsense", source: "manual" })
      .expect(400);
    expect(track).not.toHaveBeenCalled();
  });
});
