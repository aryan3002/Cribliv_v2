/**
 * Free credits granted to a new user's wallet at signup. Overridable via
 * SIGNUP_FREE_CREDITS so the launch grant can be dialed back once paid plans
 * go live, without a redeploy. Defaults to 10; ignores non-integer / negative.
 */
export function signupFreeCredits(): number {
  const raw = process.env.SIGNUP_FREE_CREDITS;
  if (raw === undefined || raw.trim() === "") return 10;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 10;
}
