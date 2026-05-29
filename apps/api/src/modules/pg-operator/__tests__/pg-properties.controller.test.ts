import "reflect-metadata";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { PgOperatorController } from "../pg-operator.controller";
import { PgSegmentationService } from "../services/pg-segmentation.service";
import { PgPropertiesService } from "../services/pg-properties.service";
import { AuthGuard } from "../../../common/auth.guard";
import { RolesGuard } from "../../../common/roles.guard";

describe("POST /pg-operator/properties", () => {
  let ctrl: PgOperatorController;
  let propsSvc: {
    createProperty: ReturnType<typeof vi.fn>;
    listProperties: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    propsSvc = { createProperty: vi.fn(), listProperties: vi.fn().mockResolvedValue([]) };
    const mod = await Test.createTestingModule({
      controllers: [PgOperatorController],
      providers: [
        { provide: PgSegmentationService, useValue: { segment: vi.fn() } },
        { provide: PgPropertiesService, useValue: propsSvc }
      ]
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    ctrl = mod.get(PgOperatorController);
  });

  it("creates a property and returns it wrapped in ok()", async () => {
    propsSvc.createProperty.mockResolvedValueOnce({ id: "p1", display_name: "Acme", city_id: 1 });
    const res = await ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-1", {
      display_name: "Acme PG",
      city_slug: "bangalore"
    });
    expect(propsSvc.createProperty).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        display_name: "Acme PG",
        city_slug: "bangalore"
      })
    );
    expect((res as any).data.id).toBe("p1");
  });

  it("rejects without Idempotency-Key", async () => {
    await expect(
      ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, undefined as any, {
        display_name: "Acme PG",
        city_slug: "blr"
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "missing_idempotency_key" })
    });
  });

  it("rejects invalid body via Zod", async () => {
    await expect(
      ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-2", {
        display_name: "",
        city_slug: ""
      } as any)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "invalid_payload" }) });
  });

  it("passes all optional fields through to the service", async () => {
    propsSvc.createProperty.mockResolvedValueOnce({ id: "p2" });
    await ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-3", {
      display_name: "Acme PG",
      city_slug: "bangalore",
      locality_slug: "koramangala",
      internal_code: "ACME-01",
      total_floors: 4,
      metadata: { source: "web" }
    });
    expect(propsSvc.createProperty).toHaveBeenCalledWith("u1", {
      display_name: "Acme PG",
      city_slug: "bangalore",
      locality_slug: "koramangala",
      internal_code: "ACME-01",
      total_floors: 4,
      metadata: { source: "web" }
    });
  });

  it("rejects unknown keys (.strict() schema)", async () => {
    await expect(
      ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-4", {
        display_name: "Acme PG",
        city_slug: "bangalore",
        foobar: 1
      } as any)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "invalid_payload" }) });
  });

  it("rejects city_slug with uppercase / invalid chars", async () => {
    await expect(
      ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-5", {
        display_name: "Acme PG",
        city_slug: "Bangalore"
      } as any)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "invalid_payload" }) });
    await expect(
      ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-5b", {
        display_name: "Acme PG",
        city_slug: "bangalore!"
      } as any)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "invalid_payload" }) });
  });

  it("rejects display_name below 2 chars and above 120 chars", async () => {
    await expect(
      ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-6", {
        display_name: "X",
        city_slug: "blr"
      } as any)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "invalid_payload" }) });
    await expect(
      ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-6b", {
        display_name: "A".repeat(121),
        city_slug: "blr"
      } as any)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "invalid_payload" }) });
  });

  it("propagates ConflictException from service unchanged (multi_property_not_enabled)", async () => {
    const { ConflictException } = await import("@nestjs/common");
    propsSvc.createProperty.mockRejectedValueOnce(
      new ConflictException({
        code: "multi_property_not_enabled",
        message: "multi_property_not_enabled: V1 supports a single property per operator."
      })
    );
    await expect(
      ctrl.createProperty({ id: "u1", role: "pg_operator" } as any, "idem-7", {
        display_name: "Second PG",
        city_slug: "blr"
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "multi_property_not_enabled" })
    });
  });
});
