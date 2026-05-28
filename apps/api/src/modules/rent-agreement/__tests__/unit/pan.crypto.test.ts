import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptPan, encryptPan } from "../../crypto/pan.crypto";

const PLAINTEXT = "ABCDE1234F";
const ENV_KEY = "RENT_AGREEMENT_PAN_KEY";

function freshKey(): Buffer {
  return randomBytes(32);
}

describe("pan.crypto", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = savedEnv;
    }
  });

  it("round-trips a PAN string through encrypt then decrypt", () => {
    const key = freshKey();
    const ciphertext = encryptPan(PLAINTEXT, key);
    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(decryptPan(ciphertext, key)).toBe(PLAINTEXT);
  });

  it("produces 50 distinct ciphertexts for the same plaintext (IV uniqueness)", () => {
    const key = freshKey();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const ct = encryptPan(PLAINTEXT, key);
      seen.add(ct.toString("base64"));
    }
    expect(seen.size).toBe(50);
  });

  it("throws when ciphertext has been tampered with (single byte flip)", () => {
    const key = freshKey();
    const ct = encryptPan(PLAINTEXT, key);
    // Flip a byte in the encrypted payload region (after IV+authTag) if present,
    // otherwise flip the auth tag — both must cause decrypt to throw.
    const tampered = Buffer.from(ct);
    const flipIdx = tampered.length - 1;
    tampered[flipIdx] = tampered[flipIdx] ^ 0x01;
    expect(() => decryptPan(tampered, key)).toThrow();
  });

  it("throws when decrypting with the wrong 32-byte key", () => {
    const key = freshKey();
    const other = freshKey();
    const ct = encryptPan(PLAINTEXT, key);
    expect(() => decryptPan(ct, other)).toThrow();
  });

  it("uses RENT_AGREEMENT_PAN_KEY from env when no key arg is passed", () => {
    process.env[ENV_KEY] = freshKey().toString("base64");
    const ct = encryptPan(PLAINTEXT);
    expect(decryptPan(ct)).toBe(PLAINTEXT);
  });

  it("throws a helpful error when env key is missing and no key arg is passed", () => {
    delete process.env[ENV_KEY];
    expect(() => encryptPan(PLAINTEXT)).toThrow(/RENT_AGREEMENT_PAN_KEY/);
  });

  it("throws a helpful error when env key is the wrong length", () => {
    process.env[ENV_KEY] = Buffer.alloc(16, 1).toString("base64");
    expect(() => encryptPan(PLAINTEXT)).toThrow(/RENT_AGREEMENT_PAN_KEY/);
  });

  it("does not leak the plaintext PAN in error messages on failed decrypt", () => {
    const key = freshKey();
    const ct = encryptPan(PLAINTEXT, key);
    const tampered = Buffer.from(ct);
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0x01;
    let captured: unknown;
    try {
      decryptPan(tampered, key);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    expect(message).not.toContain(PLAINTEXT);
    expect(message).toBe("pan decrypt failed");
  });
});
