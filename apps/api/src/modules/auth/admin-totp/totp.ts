import { verifySync, generateURI } from "otplib";

const ISSUER = "Cribliv Admin";
const STEP_SECONDS = 30;
const WINDOW = 1; // Allow ±1 time-step (±30s) to tolerate clock skew

export function generateTotpSecret(): string {
  // Import dynamically to avoid circular dependency with alias
  const { generateSecret } = require("otplib");
  return generateSecret();
}

export function buildOtpauthUri(secret: string, accountName: string): string {
  return generateURI({
    secret,
    label: accountName,
    issuer: ISSUER,
    algorithm: "sha1",
    digits: 6,
  });
}

export function currentTotpStep(): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

/**
 * Verify a TOTP code. Returns the absolute time-step that matched so the
 * caller can persist it and reject replays. The window parameter gives us
 * the offset (-1 | 0 | 1), which we use to compute the absolute step.
 */
export function verifyTotpCode(
  secret: string,
  code: string
): { valid: boolean; step: number | null } {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return { valid: false, step: null };
  }

  try {
    const result = verifySync({
      secret,
      token: trimmed,
      algorithm: "sha1",
      digits: 6,
      window: WINDOW,
    });

    // verifySync returns an object like { valid: boolean, delta: number, timeStep: number, ... }
    if (result && result.valid && typeof result.delta === "number") {
      // The absolute step is the current step + delta
      return { valid: true, step: currentTotpStep() + result.delta };
    }

    return { valid: false, step: null };
  } catch (e) {
    return { valid: false, step: null };
  }
}
