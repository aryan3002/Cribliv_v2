import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Injectable, Module, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { BadRequestException } from "@nestjs/common";
import { PgLeadsController } from "../src/modules/pg-operator/pg-leads.controller";
import { LeadsService } from "../src/modules/leads/leads.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";

const allowAll = {
  canActivate: (ctx: any) => {
    ctx.switchToHttp().getRequest().user = { id: "op-1", role: "pg_operator" };
    return true;
  }
};

// Records calls + emulates the real transition guard so we can assert the
// controller passes (id, operatorId, status) through and surfaces 400s.
@Injectable()
class FakeLeadsService {
  public calls: Array<{ leadId: string; ownerUserId: string; status: string }> = [];

  async openLeadForOperator() {
    return { lead_id: "lead-1", phone: "+919999999999", tenant_name: "Asha" };
  }

  async updateLeadStatus(leadId: string, ownerUserId: string, status: string) {
    this.calls.push({ leadId, ownerUserId, status });
    if (leadId === "missing") {
      throw new BadRequestException({ code: "not_found", message: "Lead not found" });
    }
    if (status === "deal_done") {
      // emulate an illegal transition from the current status
      throw new BadRequestException({
        code: "invalid_transition",
        message: "Cannot transition from new to deal_done"
      });
    }
    return { lead_id: leadId, status };
  }
}

@Module({
  controllers: [PgLeadsController],
  providers: [{ provide: LeadsService, useClass: FakeLeadsService }]
})
class TestModule {}

describe("PgLeadsController PATCH :id/status", () => {
  let app: INestApplication;
  let fake: FakeLeadsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAll)
      .overrideGuard(RolesGuard)
      .useValue(allowAll)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    fake = moduleRef.get(LeadsService) as unknown as FakeLeadsService;
  });

  afterAll(async () => {
    await app.close();
  });

  it("moves a lead and forwards (id, operatorId, status)", async () => {
    const res = await request(app.getHttpServer())
      .patch("/pg-operator/leads/lead-1/status")
      .send({ status: "contacted" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ lead_id: "lead-1", status: "contacted" });
    expect(fake.calls.at(-1)).toEqual({
      leadId: "lead-1",
      ownerUserId: "op-1",
      status: "contacted"
    });
  });

  it("rejects an unknown status with 400 (zod)", async () => {
    const res = await request(app.getHttpServer())
      .patch("/pg-operator/leads/lead-1/status")
      .send({ status: "archived" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe("invalid_lead_status");
  });

  it("surfaces an illegal transition from the service as 400", async () => {
    const res = await request(app.getHttpServer())
      .patch("/pg-operator/leads/lead-1/status")
      .send({ status: "deal_done" });
    expect(res.status).toBe(400);
  });

  it("surfaces not-found from the service as 400", async () => {
    const res = await request(app.getHttpServer())
      .patch("/pg-operator/leads/missing/status")
      .send({ status: "contacted" });
    expect(res.status).toBe(400);
  });
});
