import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptTotpSecret, encryptTotpSecret } from "../totp.crypto";

const SECRET = "JBSWY3DPEHPK3PXP";
const ENV_KEY = "ADMIN_TOTP_ENC_KEY";

function freshKey(): Buffer {
  return randomBytes(32);
}

describe("totp.crypto", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  it("round-trips a secret through encrypt then decrypt", () => {
    const key = freshKey();
    const ct = encryptTotpSecret(SECRET, key);
    expect(Buffer.isBuffer(ct)).toBe(true);
    expect(decryptTotpSecret(ct, key)).toBe(SECRET);
  });

  it("produces distinct ciphertexts for the same secret (IV uniqueness)", () => {
    const key = freshKey();
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) seen.add(encryptTotpSecret(SECRET, key).toString("base64"));
    expect(seen.size).toBe(25);
  });

  it("throws when the ciphertext is tampered with", () => {
    const key = freshKey();
    const ct = encryptTotpSecret(SECRET, key);
    ct[ct.length - 1] ^= 0xff;
    expect(() => decryptTotpSecret(ct, key)).toThrow();
  });

  it("throws when the env key is missing and no key is passed", () => {
    expect(() => encryptTotpSecret(SECRET)).toThrow();
  });

  it("reads the key from ADMIN_TOTP_ENC_KEY when no key arg is passed", () => {
    const key = freshKey();
    process.env[ENV_KEY] = key.toString("base64");
    const ct = encryptTotpSecret(SECRET);
    expect(decryptTotpSecret(ct)).toBe(SECRET);
  });
});
