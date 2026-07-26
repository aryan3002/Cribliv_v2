import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppOtpProvider, hashOtp } from "../src/modules/auth/otp/whatsapp-otp.provider";
import {
  OtpUndeliverableError,
  OtpVerifyError
} from "../src/modules/auth/otp/otp-provider.interface";

function fakeClient(result: { success: boolean; error?: string }) {
  return { sendTemplate: vi.fn().mockResolvedValue(result) };
}

describe("WhatsAppOtpProvider", () => {
  beforeEach(() => {
    process.env.WHATSAPP_OTP_TEMPLATE_NAME = "cribliv_login_otp";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    delete process.env.WHATSAPP_OTP_EXPIRY_SEC;
  });

  it("stores a hash of the code, never the code itself", async () => {
    const client = fakeClient({ success: true });
    const provider = new WhatsAppOtpProvider(client as never);

    const result = await provider.send({ phoneE164: "+919044904818" });

    expect(result.marker.startsWith("wa:")).toBe(true);
    expect(result.devOtp).toBeUndefined();

    const sentCode = client.sendTemplate.mock.calls[0][0].bodyParams[0];
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(result.marker).toBe(`wa:${hashOtp(sentCode)}`);
    expect(result.marker).not.toContain(sentCode);
  });

  it("sends the code in both body and button params", async () => {
    const client = fakeClient({ success: true });
    const provider = new WhatsAppOtpProvider(client as never);

    await provider.send({ phoneE164: "+919044904818", languageCode: "hi" });

    const msg = client.sendTemplate.mock.calls[0][0];
    expect(msg.templateName).toBe("cribliv_login_otp");
    expect(msg.languageCode).toBe("hi");
    expect(msg.buttonParams).toEqual(msg.bodyParams);
  });

  it("defaults to the en template language", async () => {
    const client = fakeClient({ success: true });
    const provider = new WhatsAppOtpProvider(client as never);

    await provider.send({ phoneE164: "+919044904818" });

    expect(client.sendTemplate.mock.calls[0][0].languageCode).toBe("en");
  });

  it("throws OtpUndeliverableError when Meta reports no WhatsApp account", async () => {
    const client = fakeClient({ success: false, error: "(#131026) Message undeliverable" });
    const provider = new WhatsAppOtpProvider(client as never);

    await expect(provider.send({ phoneE164: "+919044904818" })).rejects.toBeInstanceOf(
      OtpUndeliverableError
    );
  });

  it("throws a generic error on a transient failure, not undeliverable", async () => {
    const client = fakeClient({ success: false, error: "ETIMEDOUT" });
    const provider = new WhatsAppOtpProvider(client as never);

    await expect(provider.send({ phoneE164: "+919044904818" })).rejects.toThrow();
    await expect(provider.send({ phoneE164: "+919044904818" })).rejects.not.toBeInstanceOf(
      OtpUndeliverableError
    );
  });

  it("throws otp_provider_misconfigured when the template name is unset", async () => {
    delete process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    const provider = new WhatsAppOtpProvider(fakeClient({ success: true }) as never);

    await expect(provider.send({ phoneE164: "+919044904818" })).rejects.toThrow();
  });

  it("verifies the correct code", async () => {
    const provider = new WhatsAppOtpProvider(fakeClient({ success: true }) as never);

    await expect(
      provider.verify({ marker: `wa:${hashOtp("123456")}`, phoneE164: "+91", code: "123456" })
    ).resolves.toBeUndefined();
  });

  it("rejects a wrong code as invalid_otp", async () => {
    const provider = new WhatsAppOtpProvider(fakeClient({ success: true }) as never);

    await expect(
      provider.verify({ marker: `wa:${hashOtp("123456")}`, phoneE164: "+91", code: "000000" })
    ).rejects.toBeInstanceOf(OtpVerifyError);
  });

  it("rejects a malformed marker as invalid_otp rather than crashing", async () => {
    const provider = new WhatsAppOtpProvider(fakeClient({ success: true }) as never);

    await expect(
      provider.verify({ marker: "wa:not-hex", phoneE164: "+91", code: "123456" })
    ).rejects.toBeInstanceOf(OtpVerifyError);
  });
});
