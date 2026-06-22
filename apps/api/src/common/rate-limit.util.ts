/**
 * Single source of truth for the load-test rate-limit bypass.
 *
 * Returns true only when DISABLE_RATE_LIMIT=true AND NODE_ENV is not
 * "production". Honoured by BOTH the global ConditionalThrottlerGuard (framework
 * throttler) and the service-level OTP limits in auth.service (per-phone /
 * per-IP), so a k6 load run can mint its whole token pool from one IP.
 *
 * SAFETY: the production guard means this can never disable rate limiting in a
 * prod deploy even if the env var leaks. Default (flag unset) = limits enforced.
 */
export function isRateLimitingDisabled(): boolean {
  return process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production";
}
