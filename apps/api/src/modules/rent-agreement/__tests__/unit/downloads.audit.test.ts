import { describe, expect, it } from "vitest";
import { hashIp } from "../../downloads/downloads.audit";

describe("hashIp", () => {
  it("returns a 64-char hex SHA-256 of ip+salt", () => {
    const result = hashIp("203.0.113.42", "saltA");
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same (ip, salt)", () => {
    expect(hashIp("203.0.113.42", "saltA")).toBe(hashIp("203.0.113.42", "saltA"));
  });

  it("differs when the salt rotates (no cross-rotation lookup)", () => {
    const oldHash = hashIp("203.0.113.42", "saltA");
    const newHash = hashIp("203.0.113.42", "saltB");
    expect(oldHash).not.toBe(newHash);
  });

  it("falls back to env RENT_AGREEMENT_IP_SALT when salt omitted", () => {
    const prev = process.env.RENT_AGREEMENT_IP_SALT;
    process.env.RENT_AGREEMENT_IP_SALT = "env-salt";
    try {
      const direct = hashIp("203.0.113.42", "env-salt");
      const viaEnv = hashIp("203.0.113.42");
      expect(viaEnv).toBe(direct);
    } finally {
      if (prev === undefined) delete process.env.RENT_AGREEMENT_IP_SALT;
      else process.env.RENT_AGREEMENT_IP_SALT = prev;
    }
  });
});
