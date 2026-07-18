import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BadRequestException, Injectable, Module, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PgListingController } from "../src/modules/pg-operator/pg-listing.controller";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { PgPropertiesService } from "../src/modules/pg-operator/services/pg-properties.service";
import { PgDraftService } from "../src/modules/pg-operator/services/pg-draft.service";
import { PgNearbyService } from "../src/modules/pg-operator/services/pg-nearby.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";

const allowAll = {
  canActivate: (ctx: any) => {
    ctx.switchToHttp().getRequest().user = { id: "op-1", role: "pg_operator" };
    return true;
  }
};

@Injectable()
class FakeListingService {
  public calls: Array<{ id: string; operatorId: string; status: string }> = [];
  async setListingStatus(id: string, operatorId: string, status: string) {
    this.calls.push({ id, operatorId, status });
    if (id === "draft-listing") {
      throw new BadRequestException({
        code: "not_approved",
        message: "Submit the listing for review before changing its visibility."
      });
    }
    return { id, status };
  }
}

@Module({
  controllers: [PgListingController],
  providers: [
    { provide: PgListingService, useClass: FakeListingService },
    { provide: PgPropertiesService, useValue: {} },
    { provide: PgDraftService, useValue: {} },
    {
      provide: PgNearbyService,
      useValue: { nearby: async () => ({ metro: [], college: [], office: [] }) }
    }
  ]
})
class TestModule {}

describe("PgListingController PATCH :id/status", () => {
  let app: INestApplication;
  let fake: FakeListingService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAll)
      .overrideGuard(RolesGuard)
      .useValue(allowAll)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    fake = moduleRef.get(PgListingService) as unknown as FakeListingService;
  });

  afterAll(async () => {
    await app.close();
  });

  it("pauses a listing and forwards (id, operatorId, status)", async () => {
    const res = await request(app.getHttpServer())
      .patch("/pg-operator/listings/listing-1/status")
      .send({ status: "paused" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: "listing-1", status: "paused" });
    expect(fake.calls.at(-1)).toEqual({ id: "listing-1", operatorId: "op-1", status: "paused" });
  });

  it("rejects an unknown status with 400 (zod)", async () => {
    const res = await request(app.getHttpServer())
      .patch("/pg-operator/listings/listing-1/status")
      .send({ status: "live" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe("invalid_listing_status");
  });

  it("surfaces a not-approved (draft) listing as 400", async () => {
    const res = await request(app.getHttpServer())
      .patch("/pg-operator/listings/draft-listing/status")
      .send({ status: "active" });
    expect(res.status).toBe(400);
  });
});
