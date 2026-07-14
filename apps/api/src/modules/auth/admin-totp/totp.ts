import { authenticator } from "otplib";

const ISSUER = "Cribliv Admin";
const STEP_SECONDS = 30;

// Allow ±1 time-step (±30s) to tolerate clock skew between server and phone.
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUri(secret: string, accountName: string): string {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

export function currentTotpStep(): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

/**
 * Verify a TOTP code. Returns the absolute time-step that matched so the
 * caller can persist it and reject replays. `checkDelta` yields the offset
 * (-1 | 0 | 1) of the matching window, or null when nothing matches.
 */
export function verifyTotpCode(
  secret: string,
  code: string
): { valid: boolean; step: number | null } {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return { valid: false, step: null };
  }
  const delta = authenticator.checkDelta(trimmed, secret);
  if (delta === null || delta === undefined) {
    return { valid: false, step: null };
  }
  return { valid: true, step: currentTotpStep() + delta };
}
