/**
 * Free credits granted to a new user's wallet at signup. Overridable via
 * SIGNUP_FREE_CREDITS so the launch grant can be dialed back once paid plans
 * go live, without a redeploy. Defaults to 10; ignores non-integer / negative.
 */
export interface SignupReward {
  credits: number;
  expiresAt: Date | null;
}

const SIGNUP_REWARD_DAYS = 90;

function readSignupCreditAmount(): number {
  const raw = process.env.SIGNUP_FREE_CREDITS;
  if (raw === undefined || raw.trim() === "") return 10;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 10;
}

export function signupReward(now = new Date()): SignupReward {
  const credits = readSignupCreditAmount();
  return {
    credits,
    expiresAt:
      credits > 0 ? new Date(now.getTime() + SIGNUP_REWARD_DAYS * 24 * 60 * 60 * 1000) : null
  };
}

export function signupFreeCredits(): number {
  return signupReward().credits;
}
