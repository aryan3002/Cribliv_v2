import { afterEach, describe, expect, it } from "vitest";
import { OtpProviderResolver } from "../src/modules/auth/otp/otp-provider.resolver";

const mock = { name: "mock" } as never;
const whatsapp = { name: "whatsapp" } as never;
const d7 = { name: "d7" } as never;

function makeResolver() {
  return new OtpProviderResolver(mock, whatsapp, d7);
}

afterEach(() => {
  delete process.env.OTP_PROVIDER;
  delete process.env.OTP_CHANNEL_PRIMARY;
});

describe("OtpProviderResolver.forSend", () => {
  it("returns d7 when OTP_CHANNEL_PRIMARY is unset (ships inert)", () => {
    process.env.OTP_PROVIDER = "d7";
    expect(makeResolver().forSend({ recentWhatsAppAttempts: 0 }).name).toBe("d7");
  });

  it("returns whatsapp when OTP_CHANNEL_PRIMARY=whatsapp", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    expect(makeResolver().forSend({ recentWhatsAppAttempts: 0 }).name).toBe("whatsapp");
  });

  it("ignores a requested sms channel while the gate is closed", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    const resolver = makeResolver();

    expect(resolver.forSend({ requestedChannel: "sms", recentWhatsAppAttempts: 0 }).name).toBe(
      "whatsapp"
    );
    expect(resolver.forSend({ requestedChannel: "sms", recentWhatsAppAttempts: 1 }).name).toBe(
      "whatsapp"
    );
  });

  it("honours a requested sms channel once 2 whatsapp attempts exist", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";

    expect(
      makeResolver().forSend({ requestedChannel: "sms", recentWhatsAppAttempts: 2 }).name
    ).toBe("d7");
  });

  it("still defaults to whatsapp past the gate when sms is not requested", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";

    expect(makeResolver().forSend({ recentWhatsAppAttempts: 5 }).name).toBe("whatsapp");
  });

  it("returns mock whenever OTP_PROVIDER=mock, ignoring channel config", () => {
    process.env.OTP_PROVIDER = "mock";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";

    expect(
      makeResolver().forSend({ requestedChannel: "sms", recentWhatsAppAttempts: 9 }).name
    ).toBe("mock");
  });

  it("returns mock when OTP_PROVIDER is unset entirely", () => {
    expect(makeResolver().forSend({ recentWhatsAppAttempts: 0 }).name).toBe("mock");
  });
});

describe("OtpProviderResolver.isSmsFallbackAvailable", () => {
  it("is false below the threshold and true at or above it", () => {
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    const resolver = makeResolver();

    expect(resolver.isSmsFallbackAvailable(0)).toBe(false);
    expect(resolver.isSmsFallbackAvailable(1)).toBe(false);
    expect(resolver.isSmsFallbackAvailable(2)).toBe(true);
    expect(resolver.isSmsFallbackAvailable(3)).toBe(true);
  });

  it("is false when whatsapp is not the primary channel", () => {
    expect(makeResolver().isSmsFallbackAvailable(5)).toBe(false);
  });
});

describe("OtpProviderResolver.sms", () => {
  it("returns the d7 provider, bypassing the gate", () => {
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    expect(makeResolver().sms().name).toBe("d7");
  });
});

describe("OtpProviderResolver.forMarker", () => {
  it("routes a wa marker to whatsapp regardless of current config", () => {
    process.env.OTP_CHANNEL_PRIMARY = "sms";
    expect(makeResolver().forMarker("wa:abcdef").name).toBe("whatsapp");
  });

  it("routes a d7 marker to d7 regardless of current config", () => {
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    expect(makeResolver().forMarker("d7:otp_1").name).toBe("d7");
  });

  it("routes bare digits to mock", () => {
    expect(makeResolver().forMarker("123456").name).toBe("mock");
  });
});
