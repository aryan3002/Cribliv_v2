import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { AppModule } from "../src/app.module";

describe("GET /v1/openapi.json", () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.OTP_PROVIDER = "mock";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns an OpenAPI 3.1 document with public-only paths", async () => {
    const res = await request(app.getHttpServer()).get("/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/openapi\+json/);

    const doc = res.body;
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info?.title).toBe("Cribliv Public API");
    expect(doc.servers?.[0]?.url).toBeTruthy();

    expect(doc.paths["/health"]).toBeTruthy();
    expect(doc.paths["/listings/search"]).toBeTruthy();
    expect(doc.paths["/listings/{listing_id}"]).toBeTruthy();
    expect(doc.paths["/auth/otp/send"]).toBeTruthy();

    // Admin / owner / tenant endpoints should NOT be documented in the public spec.
    for (const key of Object.keys(doc.paths)) {
      expect(key).not.toMatch(/^\/admin\//);
      expect(key).not.toMatch(/^\/owner\//);
    }
  });

  it("sets a cache-control header for agents", async () => {
    const res = await request(app.getHttpServer()).get("/v1/openapi.json");
    expect(res.headers["cache-control"]).toMatch(/public/);
  });
});
