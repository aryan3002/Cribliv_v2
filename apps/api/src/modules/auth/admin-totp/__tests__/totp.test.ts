import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { buildOtpauthUri, currentTotpStep, generateTotpSecret, verifyTotpCode } from "../totp";

describe("totp primitives", () => {
  it("generates a non-empty base32 secret", () => {
    const secret = generateTotpSecret();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(10);
  });

  it("builds an otpauth URI with issuer and account", () => {
    const uri = buildOtpauthUri("JBSWY3DPEHPK3PXP", "+919999999903");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("Cribliv%20Admin");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
  });

  it("verifies a freshly generated code and returns the current step", () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    const result = verifyTotpCode(secret, code);
    expect(result.valid).toBe(true);
    expect(result.step).toBe(currentTotpStep());
  });

  it("rejects a wrong code", () => {
    const secret = generateTotpSecret();
    const result = verifyTotpCode(secret, "000000");
    // 000000 is astronomically unlikely to be the live code
    expect(result.valid).toBe(false);
    expect(result.step).toBeNull();
  });
});
