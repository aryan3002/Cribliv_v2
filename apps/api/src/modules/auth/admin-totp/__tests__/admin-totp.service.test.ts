import { beforeEach, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { AdminTotpService } from "../admin-totp.service";
import { AppStateService } from "../../../../common/app-state.service";
import { DatabaseService } from "../../../../common/database.service";
import { AuthService } from "../../auth.service";
import { D7OtpClient } from "../../d7-otp.client";

// In-memory mode: DatabaseService.isEnabled() === false when no DATABASE_URL.
function makeService(): { svc: AdminTotpService; appState: AppStateService } {
  const appState = new AppStateService();
  const database = new DatabaseService(); // isEnabled() false without DATABASE_URL
  const authService = new AuthService(appState, database, new D7OtpClient());
  const svc = new AdminTotpService(appState, database, authService);
  return { svc, appState };
}

const ADMIN_ID = "admin-user-1";

// Asserts on the `code` NestJS puts on `error.response` for
// `new UnauthorizedException({ code, message })` (an HttpException subclass).
// Matches the repo convention used elsewhere, e.g.
// apps/api/src/modules/payments/__tests__/razorpay-orders.service.test.ts.
async function expectRejectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ response: { code } });
}

describe("AdminTotpService (in-memory)", () => {
  let svc: AdminTotpService;
  let appState: AppStateService;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    ({ svc, appState } = makeService());
    // seed an admin user id in the in-memory store
    appState.adminTotp.clear();
  });

  it("status is false before enrollment", async () => {
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: false });
  });

  it("enrollStart returns an otpauth uri + qr, status still not enrolled (pending)", async () => {
    const out = await svc.enrollStart(ADMIN_ID);
    expect(out.otpauth_uri.startsWith("otpauth://totp/")).toBe(true);
    expect(out.qr_data_url.startsWith("data:image/png;base64,")).toBe(true);
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: false });
  });

  it("enrollVerify with a valid code flips to enabled", async () => {
    await svc.enrollStart(ADMIN_ID);
    const secret = appState.adminTotp.get(ADMIN_ID)!.secret;
    const code = authenticator.generate(secret);
    expect(await svc.enrollVerify(ADMIN_ID, code)).toEqual({ enabled: true });
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: true });
  });

  it("enrollVerify with a wrong code throws and stays pending", async () => {
    await svc.enrollStart(ADMIN_ID);
    await expect(svc.enrollVerify(ADMIN_ID, "000000")).rejects.toThrow();
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: false });
  });

  it("reset removes enrollment", async () => {
    await svc.enrollStart(ADMIN_ID);
    const secret = appState.adminTotp.get(ADMIN_ID)!.secret;
    await svc.enrollVerify(ADMIN_ID, authenticator.generate(secret));
    await svc.reset(ADMIN_ID);
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: false });
  });
});

describe("AdminTotpService.verifyLogin (in-memory)", () => {
  const PHONE = "+919999999903"; // seeded admin
  let svc: AdminTotpService;
  let appState: AppStateService;

  beforeEach(async () => {
    delete process.env.DATABASE_URL;
    ({ svc, appState } = makeService());
  });

  async function enroll(userId: string): Promise<string> {
    await svc.enrollStart(userId);
    const secret = appState.adminTotp.get(userId)!.secret;
    await svc.enrollVerify(userId, authenticator.generate(secret));
    return secret;
  }

  it("logs in an enrolled admin with a valid code", async () => {
    const admin = appState.usersByPhone.get(PHONE)!;
    const secret = await enroll(admin.id);
    const out = await svc.verifyLogin(PHONE, authenticator.generate(secret));
    expect(out.access_token.startsWith("acc_")).toBe(true);
    expect(out.user.role).toBe("admin");
    expect(out.user.phone_e164).toBe(PHONE);
  });

  it("rejects a non-admin phone with the generic code (no enumeration)", async () => {
    await expectRejectCode(svc.verifyLogin("+919999999902", "123456"), "invalid_totp");
  });

  it("rejects when the admin is not enrolled with the generic code (no enumeration)", async () => {
    await expectRejectCode(svc.verifyLogin(PHONE, "123456"), "invalid_totp");
  });

  it("rejects an unknown/unregistered phone with the generic code (no enumeration)", async () => {
    await expectRejectCode(svc.verifyLogin("+910000000000", "123456"), "invalid_totp");
  });

  it("rejects an invalid phone format with the generic code (no enumeration)", async () => {
    await expectRejectCode(svc.verifyLogin("12345", "123456"), "invalid_totp");
  });

  it("rejects a wrong code and locks after 5 failures", async () => {
    const admin = appState.usersByPhone.get(PHONE)!;
    await enroll(admin.id);
    for (let i = 0; i < 5; i += 1) {
      await expectRejectCode(svc.verifyLogin(PHONE, "000000"), "invalid_totp");
    }
    // 6th attempt, even with a VALID code, is rejected because the lock is
    // active (proves enforcement) — and with the same generic "invalid_totp"
    // code as every other rejection (proves no enumeration oracle: a locked
    // account is indistinguishable from a wrong code or an unknown phone).
    const secret = appState.adminTotp.get(admin.id)!.secret;
    await expectRejectCode(svc.verifyLogin(PHONE, authenticator.generate(secret)), "invalid_totp");
  });

  it("rejects a replayed code (same step reused)", async () => {
    const admin = appState.usersByPhone.get(PHONE)!;
    const secret = await enroll(admin.id);
    const code = authenticator.generate(secret);
    await svc.verifyLogin(PHONE, code); // consumes the step
    await expect(svc.verifyLogin(PHONE, code)).rejects.toThrow();
  });
});
