import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { isRateLimitingDisabled } from "./rate-limit.util";

/**
 * ThrottlerGuard variant that can be globally disabled for load testing.
 *
 * The CribLiv k6 load-test suite pre-authenticates ~37 OTP tokens from a single
 * IP in setup(), which the per-IP OTP limiter (10/60s) would otherwise reject.
 * Setting DISABLE_RATE_LIMIT=true turns off ALL throttling so a load run can
 * mint its token pools and drive sustained traffic from one host.
 *
 * SAFETY: the flag is ignored when NODE_ENV=production, so it can never silently
 * disable rate limiting in prod even if the env var leaks into a prod deploy.
 * Default behaviour (flag unset) is identical to the stock ThrottlerGuard.
 */
@Injectable()
export class ConditionalThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isRateLimitingDisabled()) {
      return true;
    }
    return super.canActivate(context);
  }
}
