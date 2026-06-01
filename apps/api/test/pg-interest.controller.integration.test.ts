import "reflect-metadata";
import { describe, it, expect, afterAll, vi } from "vitest";
import { Module, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PgInterestController } from "../src/modules/pg-operator/pg-interest.controller";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { LeadsService } from "../src/modules/leads/leads.service";
import { AuthGuard } from "../src/common/auth.guard";

const createLead = vi.fn(async () => ({ lead_id: "lead-1", created: true }));

function buildApp(opts: { operatorId: string | null; userId?: string }) {
  const listings = { getActiveListingOperator: async () => opts.operatorId };
  const leads = { createLead };

  @Module({
    controllers: [PgInterestController],
    providers: [
      { provide: PgListingService, useValue: listings },
      { provide: LeadsService, useValue: leads }
    ]
  })
  class TestModule {}

  const allowUser = {
    canActivate: (ctx: any) => {
      ctx.switchToHttp().getRequest().user = { id: opts.userId ?? "tenant-1", role: "tenant" };
      return true;
    }
  };
  return { TestModule, allowUser };
}

async function start(mod: any, guard: any) {
  const ref = await Test.createTestingModule({ imports: [mod] })
    .overrideGuard(AuthGuard)
    .useValue(guard)
    .compile();
  const app = ref.createNestApplication();
  await app.init();
  return app;
}

describe("POST /pg/listings/:id/interest (integration)", () => {
  let app: INestApplication;
  afterAll(async () => app?.close());

  it("creates a lead for an active listing", async () => {
    createLead.mockClear();
    const { TestModule, allowUser } = buildApp({ operatorId: "op-9", userId: "tenant-1" });
    app = await start(TestModule, allowUser);
    const res = await request(app.getHttpServer())
      .post("/pg/listings/11111111-1111-1111-1111-111111111111/interest")
      .expect(201);
    expect(res.body.data).toMatchObject({ interested: true, created: true, lead_id: "lead-1" });
    expect(createLead).toHaveBeenCalledWith({
      listing_id: "11111111-1111-1111-1111-111111111111",
      owner_user_id: "op-9",
      tenant_user_id: "tenant-1"
    });
    await app.close();
  });

  it("404s when there is no active PG listing", async () => {
    const { TestModule, allowUser } = buildApp({ operatorId: null });
    app = await start(TestModule, allowUser);
    await request(app.getHttpServer())
      .post("/pg/listings/11111111-1111-1111-1111-111111111111/interest")
      .expect(404);
    await app.close();
  });

  it("guards self-interest (operator is the caller) without creating a lead", async () => {
    createLead.mockClear();
    const { TestModule, allowUser } = buildApp({ operatorId: "same-user", userId: "same-user" });
    app = await start(TestModule, allowUser);
    const res = await request(app.getHttpServer())
      .post("/pg/listings/11111111-1111-1111-1111-111111111111/interest")
      .expect(201);
    expect(res.body.data).toMatchObject({ interested: false, created: false, reason: "self" });
    expect(createLead).not.toHaveBeenCalled();
    await app.close();
  });
});
