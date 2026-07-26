import { describe, expect, it, vi } from "vitest";
import { AuthController } from "../src/modules/auth/auth.controller";

describe("AuthController sendOtp IP extraction", () => {
  it("uses req.ip instead of trusting raw x-forwarded-for header", async () => {
    const authService = {
      sendOtp: vi.fn(async () => ({ challenge_id: "ch-1" }))
    } as any;
    const controller = new AuthController(authService);

    await controller.sendOtp(
      { phone_e164: "+919999999901", purpose: "login" },
      {
        ip: "10.0.0.7",
        headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.7" }
      }
    );

    // 4th arg is the optional OTP channel, absent here because the request
    // body carries no `channel` — the client only sends it for SMS fallback.
    expect(authService.sendOtp).toHaveBeenCalledWith(
      "+919999999901",
      "login",
      "10.0.0.7",
      undefined
    );
  });
});
