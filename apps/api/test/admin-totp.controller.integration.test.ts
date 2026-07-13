import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { authenticator } from "otplib";
import { AppStateService } from "../src/common/app-state.service";
import { DatabaseService } from "../src/common/database.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";
import { AdminTotpController } from "../src/modules/auth/admin-totp/admin-totp.controller";
import { AdminTotpService } from "../src/modules/auth/admin-totp/admin-totp.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { D7OtpClient } from "../src/modules/auth/d7-otp.client";

const ADMIN_PHONE = "+919999999903";

// One shared in-memory AppStateService instance so the seeded admin user
// (and any TOTP enrollment state written during the test) is visible across
// every request made against the test app.
const sharedAppState = new AppStateService();
const seededAdmin = sharedAppState.usersByPhone.get(ADMIN_PHONE);
if (!seededAdmin) {
  throw new Error(`seeded admin user ${ADMIN_PHONE} not found in AppStateService`);
}
const adminId = seededAdmin.id;

const fakeDatabase = { isEnabled: () => false };

const adminGuard = {
  canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
    ctx.switchToHttp().getRequest().user = { id: adminId, role: "admin" };
    return true;
  }
};

@Module({
  controllers: [AdminTotpController],
  // Real AuthService + D7OtpClient so the forwardRef(() => AuthService) DI
  // inside AdminTotpService actually resolves through Nest's container.
  providers: [AdminTotpService, AuthService, D7OtpClient, AppStateService, DatabaseService]
})
class TestAdminTotpModule {}

describe("AdminTotpController (integration, in-memory)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.FF_ADMIN_TOTP = "true";
    delete process.env.DATABASE_URL;

    const moduleRef = await Test.createTestingModule({ imports: [TestAdminTotpModule] })
      .overrideProvider(AppStateService)
      .useValue(sharedAppState)
      .overrideProvider(DatabaseService)
      .useValue(fakeDatabase)
      .overrideGuard(AuthGuard)
      .useValue(adminGuard)
      .overrideGuard(RolesGuard)
      .useValue(adminGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 403 totp_disabled when the flag is off", async () => {
    process.env.FF_ADMIN_TOTP = "false";
    try {
      const response = await request(app.getHttpServer())
        .post("/auth/admin/login")
        .send({ phone_e164: ADMIN_PHONE, totp_code: "123456" });

      expect(response.status).toBe(403);
      // ForbiddenException({ code, message }) is passed straight through as
      // the JSON body by Nest's default filter (no `error`/`message` wrapper).
      expect(response.body.code).toBe("totp_disabled");
    } finally {
      process.env.FF_ADMIN_TOTP = "true";
    }
  });

  it("full flow: enroll -> verify -> status -> login", async () => {
    const start = await request(app.getHttpServer())
      .post("/auth/admin/totp/enroll/start")
      .send({});
    expect(start.status).toBe(201);
    expect(start.body.data.otpauth_uri).toMatch(/^otpauth:\/\/totp\//);
    expect(start.body.data.qr_data_url).toMatch(/^data:image\/png/);

    const secret = new URL(start.body.data.otpauth_uri).searchParams.get("secret");
    expect(secret).toBeTruthy();

    const verify = await request(app.getHttpServer())
      .post("/auth/admin/totp/enroll/verify")
      .send({ totp_code: authenticator.generate(secret as string) });
    expect(verify.status).toBe(200);
    expect(verify.body.data.enabled).toBe(true);

    const status = await request(app.getHttpServer()).get("/auth/admin/totp/status");
    expect(status.status).toBe(200);
    expect(status.body.data.enrolled).toBe(true);

    const login = await request(app.getHttpServer())
      .post("/auth/admin/login")
      .send({ phone_e164: ADMIN_PHONE, totp_code: authenticator.generate(secret as string) });
    expect(login.status).toBe(200);
    expect(login.body.data.access_token).toMatch(/^acc_/);
    expect(login.body.data.user.role).toBe("admin");
  });
});
