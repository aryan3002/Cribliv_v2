import { beforeEach, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { AdminTotpService } from "../admin-totp.service";
import { AppStateService } from "../../../../common/app-state.service";
import { DatabaseService } from "../../../../common/database.service";

// In-memory mode: DatabaseService.isEnabled() === false when no DATABASE_URL.
function makeService(): { svc: AdminTotpService; appState: AppStateService } {
  const appState = new AppStateService();
  const database = new DatabaseService(); // isEnabled() false without DATABASE_URL
  const svc = new AdminTotpService(appState, database);
  return { svc, appState };
}

const ADMIN_ID = "admin-user-1";

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
