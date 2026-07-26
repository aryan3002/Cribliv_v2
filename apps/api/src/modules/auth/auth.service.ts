import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { isRateLimitingDisabled } from "../../common/rate-limit.util";
import { expireSignupCredits } from "../wallet/wallet-balance";
import { D7OtpClient } from "./d7-otp.client";
import { signupReward } from "./signup-credits";
import { WhatsAppClient } from "../notifications/whatsapp.client";
import { MockOtpProvider } from "./otp/mock-otp.provider";
import { WhatsAppOtpProvider } from "./otp/whatsapp-otp.provider";
import { D7OtpProvider } from "./otp/d7-otp.provider";
import { OtpProviderResolver } from "./otp/otp-provider.resolver";
import {
  OtpUndeliverableError,
  OtpVerifyError,
  type OtpSendResult
} from "./otp/otp-provider.interface";

const OTP_PURPOSES = ["login", "contact_unlock", "owner_verify"] as const;

/**
 * How long an already-rotated refresh token may be replayed for.
 *
 * Rotation is only safe when the caller reliably receives the replacement, and
 * next-auth v5's RSC `auth()` branch drops the Set-Cookie carrying it. Within
 * this window a repeat presentation returns the same successor instead of 401,
 * so a lost rotation self-heals on the next session poll. Kept short so genuine
 * refresh-token theft is still caught by the reuse check.
 */
export const REFRESH_REUSE_GRACE = "5 minutes";

export function timingSafeOtpEqual(expected: string, provided: string): boolean {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  return expected.length === provided.length && timingSafeEqual(expectedDigest, providedDigest);
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(D7OtpClient) private readonly d7OtpClient: D7OtpClient,
    @Inject(OtpProviderResolver) private readonly otpProviders?: OtpProviderResolver
  ) {}

  /**
   * test/auth-d7.provider.test.ts constructs AuthService with three positional
   * args, so the resolver can be absent. Fall back to one wired to the
   * injected D7 client in that case.
   */
  private get providers(): OtpProviderResolver {
    if (this.otpProviders) {
      return this.otpProviders;
    }
    return new OtpProviderResolver(
      new MockOtpProvider(),
      new WhatsAppOtpProvider(new WhatsAppClient()),
      new D7OtpProvider(this.d7OtpClient)
    );
  }

  async sendOtp(
    phone_e164: string,
    purpose: string,
    clientIp?: string,
    channel?: "whatsapp" | "sms"
  ) {
    if (!/^\+91\d{10}$/.test(phone_e164)) {
      throw new BadRequestException({ code: "invalid_phone", message: "Invalid phone format" });
    }

    if (!OTP_PURPOSES.includes(purpose as (typeof OTP_PURPOSES)[number])) {
      throw new BadRequestException({ code: "invalid_purpose", message: "Invalid OTP purpose" });
    }

    if (this.database.isEnabled()) {
      // Load-test bypass: when DISABLE_RATE_LIMIT=true (non-production only),
      // skip the per-phone and per-IP OTP limits so a k6 run can mint its whole
      // token pool from one IP. Mirrors ConditionalThrottlerGuard; never active
      // in production. See common/rate-limit.util.ts.
      const rateLimitDisabled = isRateLimitingDisabled();

      // Per-phone rate limit: max 6 OTP sends per 10 minutes
      if (!rateLimitDisabled) {
        const recent = await this.database.query<{ count: number }>(
          `
          SELECT count(*)::int AS count
          FROM otp_challenges
          WHERE phone_e164 = $1
            AND created_at > now() - interval '10 minutes'
          `,
          [phone_e164]
        );

        if ((recent.rows[0]?.count ?? 0) >= 6) {
          throw new HttpException(
            {
              code: "otp_rate_limited",
              message: "Too many OTP requests"
            },
            HttpStatus.TOO_MANY_REQUESTS
          );
        }
      }

      // Per-IP rate limit: max 20 OTP sends per hour per IP
      if (!rateLimitDisabled && clientIp && clientIp !== "unknown") {
        const ipRecent = await this.database.query<{ count: number }>(
          `
          SELECT count(*)::int AS count
          FROM otp_challenges
          WHERE client_ip = $1
            AND created_at > now() - interval '1 hour'
          `,
          [clientIp]
        );

        if ((ipRecent.rows[0]?.count ?? 0) >= 20) {
          this.logger.warn(`IP rate limited: ${clientIp}`);
          throw new HttpException(
            {
              code: "otp_ip_rate_limited",
              message: "Too many OTP requests from this network"
            },
            HttpStatus.TOO_MANY_REQUESTS
          );
        }
      }

      // Skipped entirely while WhatsApp is off, so the SMS-only path issues
      // exactly the queries it did before this change.
      const recentWhatsAppAttempts = this.providers.isWhatsAppPrimary()
        ? await this.countRecentWhatsAppAttempts(phone_e164)
        : 0;
      let provider = this.providers.forSend({
        requestedChannel: channel,
        recentWhatsAppAttempts
      });

      let sent: OtpSendResult;
      try {
        sent = await provider.send({ phoneE164: phone_e164 });
      } catch (error) {
        // Meta told us this number has no WhatsApp account. That is permanent,
        // so fall through to SMS now rather than making the user burn two more
        // doomed attempts before the escape hatch appears. A transient failure
        // (timeout, 5xx) is NOT caught here — it must surface rather than
        // silently spending an SMS that costs ~43x a WhatsApp message.
        if (error instanceof OtpUndeliverableError) {
          this.logger.log(`WhatsApp undeliverable for ${phone_e164}, falling back to SMS`);
          provider = this.providers.sms();
          sent = await provider.send({ phoneE164: phone_e164 });
        } else {
          throw error;
        }
      }

      const inserted = await this.database.query<{ id: string }>(
        `
        INSERT INTO otp_challenges(phone_e164, purpose, otp_hash, expires_at, status, client_ip)
        VALUES ($1, $2::otp_purpose, $3, now() + ($4::int * interval '1 second'), 'active', $5)
        RETURNING id::text
        `,
        [phone_e164, purpose, sent.marker, sent.expirySec, clientIp || null]
      );

      const attemptsAfterSend =
        provider.name === "whatsapp" ? recentWhatsAppAttempts + 1 : recentWhatsAppAttempts;

      return {
        challenge_id: inserted.rows[0].id,
        expires_in_sec: sent.expirySec,
        retry_after_sec: 30,
        channel: provider.name === "d7" ? ("sms" as const) : (provider.name as "whatsapp" | "mock"),
        sms_fallback_available: this.providers.isSmsFallbackAvailable(attemptsAfterSend),
        ...(sent.devOtp ? { dev_otp: sent.devOtp } : {})
      };
    }

    return this.sendOtpInMemory(phone_e164, purpose);
  }

  /**
   * Mint a session for an already-resolved user, inside a caller-provided
   * transaction/client. Shared by the OTP verify path and admin TOTP login so
   * both produce identical sessions. Stamps last_login_at.
   */
  async issueSessionTokens(
    client: Awaited<ReturnType<DatabaseService["getClient"]>>,
    userId: string,
    role: string
  ): Promise<{ access_token: string; refresh_token: string }> {
    await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1::uuid`, [userId]);
    // Admin sessions are short-lived (4 hours) since admin accounts carry the
    // most sensitive privileges; other roles get the standard 30-day session.
    // last_login_at also feeds the Owner Health Score (recency signal) and the
    // Fraud Intelligence Feed (flags inactive owners), so it's stamped above
    // regardless of role.
    const sessionDuration = role === "admin" ? "4 hours" : "30 days";
    const sessionToken = randomUUID();
    const sessionResult = await client.query<{ id: string }>(
      `
      INSERT INTO sessions(user_id, refresh_token_hash, expires_at)
      VALUES ($1::uuid, $2, now() + interval '${sessionDuration}')
      RETURNING id::text
      `,
      [userId, sessionToken]
    );
    return {
      access_token: `acc_${sessionResult.rows[0].id}`,
      refresh_token: `ref_${sessionToken}`
    };
  }

  async verifyOtp(challenge_id: string, otp_code: string) {
    if (this.database.isEnabled()) {
      if (!/^[0-9a-f-]{36}$/i.test(challenge_id)) {
        throw new UnauthorizedException({ code: "invalid_otp", message: "Invalid OTP" });
      }

      const challengeResult = await this.database.query<{
        id: string;
        phone_e164: string;
        otp_hash: string;
        attempt_count: number;
        expires_at: string;
        status: "active" | "verified" | "expired" | "blocked";
      }>(
        `
        SELECT id::text, phone_e164, otp_hash, attempt_count, expires_at::text, status::text
        FROM otp_challenges
        WHERE id = $1::uuid
        `,
        [challenge_id]
      );

      const challenge = challengeResult.rows[0];
      if (!challenge) {
        throw new UnauthorizedException({ code: "invalid_otp", message: "Invalid OTP" });
      }

      if (challenge.status === "blocked") {
        throw new UnauthorizedException({ code: "otp_blocked", message: "OTP challenge blocked" });
      }

      if (new Date(challenge.expires_at).getTime() < Date.now()) {
        throw new UnauthorizedException({ code: "otp_expired", message: "OTP expired" });
      }

      const provider = this.providers.forMarker(challenge.otp_hash);
      try {
        await provider.verify({
          marker: challenge.otp_hash,
          phoneE164: challenge.phone_e164,
          code: otp_code
        });
      } catch (error) {
        if (error instanceof OtpVerifyError) {
          if (error.code === "invalid_otp") {
            // Always throws: invalid_otp, or otp_blocked at the 5th attempt.
            await this.handleInvalidDbOtp(challenge.id, challenge.attempt_count);
          }
          throw new UnauthorizedException({ code: "otp_expired", message: "OTP expired" });
        }
        throw error;
      }

      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");

        await client.query(
          `
          UPDATE otp_challenges
          SET status = 'verified', consumed_at = now(), updated_at = now()
          WHERE id = $1::uuid
          `,
          [challenge.id]
        );

        let userResult = await client.query<{
          id: string;
          role: "tenant" | "owner" | "pg_operator" | "admin";
          phone_e164: string;
          preferred_language: "en" | "hi";
        }>(
          `
          SELECT id::text, role::text, phone_e164, preferred_language::text
          FROM users
          WHERE phone_e164 = $1
          LIMIT 1
          `,
          [challenge.phone_e164]
        );

        let isNewUser = false;
        let reward: ReturnType<typeof signupReward> | undefined;

        if (!userResult.rowCount) {
          const rewardNow = new Date();
          reward = signupReward(rewardNow);
          userResult = await client.query(
            `
            INSERT INTO users(
              phone_e164,
              role,
              preferred_language,
              created_at,
              updated_at
            )
            VALUES ($1, 'tenant', 'en', $2::timestamptz, $2::timestamptz)
            RETURNING id::text, role::text, phone_e164, preferred_language::text
            `,
            [challenge.phone_e164, rewardNow]
          );

          const userId = userResult.rows[0].id;
          await client.query(
            `
            INSERT INTO wallets(
              user_id,
              balance_credits,
              free_credits_granted,
              promotional_credits_remaining,
              promotional_credits_expires_at
            )
            VALUES ($1::uuid, $2, $2, $2, $3::timestamptz)
            ON CONFLICT (user_id)
            DO NOTHING
            `,
            [userId, reward.credits, reward.expiresAt]
          );

          await client.query(
            `
            INSERT INTO wallet_transactions(
              wallet_user_id,
              txn_type,
              credits_delta,
              reference_type,
              reference_id,
              metadata
            )
            VALUES ($1::uuid, 'grant_signup', $2, 'user', $1::uuid, '{}'::jsonb)
            `,
            [userId, reward.credits]
          );

          isNewUser = true;
        }

        // Stamp last_login_at + mint session (shared with admin TOTP login).
        const tokens = await this.issueSessionTokens(
          client,
          userResult.rows[0].id,
          userResult.rows[0].role
        );

        await client.query("COMMIT");

        return {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          user: {
            id: userResult.rows[0].id,
            role: userResult.rows[0].role,
            phone_e164: userResult.rows[0].phone_e164,
            preferred_language: userResult.rows[0].preferred_language
          },
          is_new_user: isNewUser,
          ...(reward
            ? {
                signup_reward: {
                  credits_granted: reward.credits,
                  expires_at: reward.expiresAt?.toISOString() ?? null
                }
              }
            : {})
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    return this.verifyOtpInMemory(challenge_id, otp_code);
  }

  /**
   * Counts WhatsApp OTP attempts for this phone in the last 10 minutes.
   * Drives the SMS fallback gate. Derived from the marker prefix rather than a
   * dedicated column, so no migration is required.
   */
  private async countRecentWhatsAppAttempts(phoneE164: string): Promise<number> {
    const result = await this.database.query<{ count: number }>(
      `
      SELECT count(*)::int AS count
      FROM otp_challenges
      WHERE phone_e164 = $1
        AND otp_hash LIKE 'wa:%'
        AND created_at > now() - interval '10 minutes'
      `,
      [phoneE164]
    );
    return result.rows[0]?.count ?? 0;
  }

  private async handleInvalidDbOtp(
    challengeId: string,
    currentAttemptCount: number
  ): Promise<never> {
    const attempts = currentAttemptCount + 1;
    const status = attempts >= 5 ? "blocked" : "active";

    await this.database.query(
      `
      UPDATE otp_challenges
      SET attempt_count = $2, status = $3::otp_status, updated_at = now()
      WHERE id = $1::uuid
      `,
      [challengeId, attempts, status]
    );

    if (status === "blocked") {
      throw new UnauthorizedException({
        code: "otp_blocked",
        message: "OTP challenge blocked"
      });
    }

    throw new UnauthorizedException({ code: "invalid_otp", message: "Invalid OTP" });
  }

  async logout(refresh_token: string) {
    if (!refresh_token) {
      throw new BadRequestException({ code: "invalid_token", message: "Refresh token required" });
    }

    if (this.database.isEnabled()) {
      const token = refresh_token.startsWith("ref_") ? refresh_token.slice(4) : refresh_token;
      await this.database.query(
        `
        UPDATE sessions
        SET revoked_at = now(), updated_at = now()
        WHERE refresh_token_hash = $1 AND revoked_at IS NULL
        `,
        [token]
      );
      return { success: true };
    }

    for (const [accessToken, session] of this.appState.sessions.entries()) {
      if (session.refreshToken === refresh_token) {
        this.appState.sessions.delete(accessToken);
      }
    }

    return { success: true };
  }

  async getMe(userId: string) {
    if (this.database.isEnabled()) {
      const client = await this.database.getClient();
      let inTransaction = false;
      try {
        await client.query("BEGIN");
        inTransaction = true;
        await expireSignupCredits(client, userId);
        const result = await client.query<{
          id: string;
          role: string;
          phone_e164: string;
          full_name: string | null;
          preferred_language: string;
          whatsapp_opt_in: boolean;
          wallet_balance: number;
          promotional_credits_remaining: number;
          promotional_credits_expires_at: string | null;
        }>(
          `
          SELECT
            u.id::text,
            u.role::text,
            u.phone_e164,
            u.full_name,
            u.preferred_language::text,
            u.whatsapp_opt_in,
            COALESCE(w.balance_credits, 0) AS wallet_balance,
            COALESCE(w.promotional_credits_remaining, 0)
              AS promotional_credits_remaining,
            w.promotional_credits_expires_at::text
              AS promotional_credits_expires_at
          FROM users u
          LEFT JOIN wallets w ON w.user_id = u.id
          WHERE u.id = $1::uuid
          LIMIT 1
          `,
          [userId]
        );
        await client.query("COMMIT");
        inTransaction = false;

        if (result.rowCount && result.rows[0]) {
          return result.rows[0];
        }
      } catch (error) {
        if (inTransaction) {
          try {
            await client.query("ROLLBACK");
          } catch {
            // Preserve the error that aborted the wallet read.
          }
        }
        throw error;
      } finally {
        client.release();
      }
    }

    const user = this.appState.users.get(userId);
    const wallet = this.appState.getWalletDetails(userId);
    return {
      id: user?.id,
      role: user?.role,
      phone_e164: user?.phone,
      full_name: user?.full_name ?? null,
      preferred_language: user?.preferred_language,
      whatsapp_opt_in: user?.whatsapp_opt_in ?? false,
      wallet_balance: wallet.balanceCredits,
      promotional_credits_remaining: wallet.promotionalCreditsRemaining,
      promotional_credits_expires_at:
        wallet.promotionalCreditsExpiresAt === null
          ? null
          : new Date(wallet.promotionalCreditsExpiresAt).toISOString()
    };
  }

  async updateProfile(
    userId: string,
    body: { full_name?: string; preferred_language?: "en" | "hi"; whatsapp_opt_in?: boolean }
  ) {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        id: string;
        full_name: string | null;
        preferred_language: "en" | "hi";
        whatsapp_opt_in: boolean;
      }>(
        `
        UPDATE users
        SET
          full_name = COALESCE($2, full_name),
          preferred_language = COALESCE($3::lang_code, preferred_language),
          whatsapp_opt_in = COALESCE($4, whatsapp_opt_in),
          updated_at = now()
        WHERE id = $1::uuid
        RETURNING id::text, full_name, preferred_language::text, whatsapp_opt_in
        `,
        [
          userId,
          body.full_name ?? null,
          body.preferred_language ?? null,
          typeof body.whatsapp_opt_in === "boolean" ? body.whatsapp_opt_in : null
        ]
      );

      if (result.rowCount && result.rows[0]) {
        return result.rows[0];
      }
    }

    const user = this.appState.users.get(userId);
    if (!user) {
      return {};
    }

    user.full_name = body.full_name ?? user.full_name;
    user.preferred_language = body.preferred_language ?? user.preferred_language;
    user.whatsapp_opt_in = body.whatsapp_opt_in ?? user.whatsapp_opt_in;

    return {
      id: user.id,
      full_name: user.full_name,
      preferred_language: user.preferred_language,
      whatsapp_opt_in: user.whatsapp_opt_in ?? false
    };
  }

  async refreshToken(refresh_token: string) {
    if (!refresh_token) {
      throw new BadRequestException({ code: "invalid_token", message: "Refresh token required" });
    }

    if (this.database.isEnabled()) {
      const token = refresh_token.startsWith("ref_") ? refresh_token.slice(4) : refresh_token;
      const result = await this.database.query<{
        session_id: string;
        user_id: string;
        role: string;
        is_live: boolean;
        rotated_to: string | null;
        within_grace: boolean;
      }>(
        `
        SELECT
          s.id::text AS session_id,
          s.user_id::text,
          u.role::text,
          (s.revoked_at IS NULL AND s.expires_at > now()) AS is_live,
          s.rotated_to_session_id::text AS rotated_to,
          (s.revoked_at IS NOT NULL AND s.revoked_at > now() - $2::interval) AS within_grace
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.refresh_token_hash = $1
        LIMIT 1
        `,
        [token, REFRESH_REUSE_GRACE]
      );

      const row = result.rows[0];
      if (!result.rowCount || !row) {
        throw new UnauthorizedException({
          code: "invalid_token",
          message: "Invalid or expired refresh token"
        });
      }

      // Already rotated, but recently enough that the caller plausibly never
      // received the replacement (see 0068). Replay the same successor rather
      // than stranding them with tokens we have already revoked.
      if (!row.is_live) {
        if (row.rotated_to && row.within_grace) {
          const successor = await this.database.query<{
            session_id: string;
            refresh_token_hash: string;
          }>(
            `
            SELECT s.id::text AS session_id, s.refresh_token_hash
            FROM sessions s
            WHERE s.id = $1::uuid
              AND s.revoked_at IS NULL
              AND s.expires_at > now()
            LIMIT 1
            `,
            [row.rotated_to]
          );

          if (successor.rowCount && successor.rows[0]) {
            return {
              access_token: `acc_${successor.rows[0].session_id}`,
              refresh_token: `ref_${successor.rows[0].refresh_token_hash}`
            };
          }
        }

        throw new UnauthorizedException({
          code: "invalid_token",
          message: "Invalid or expired refresh token"
        });
      }

      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");
        const newToken = randomUUID();
        const sessionDuration = row.role === "admin" ? "4 hours" : "30 days";
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO sessions(user_id, refresh_token_hash, expires_at)
           VALUES ($1::uuid, $2, now() + $3::interval)
           RETURNING id::text`,
          [row.user_id, newToken, sessionDuration]
        );
        await client.query(
          `UPDATE sessions
             SET revoked_at = now(), updated_at = now(), rotated_to_session_id = $2::uuid
           WHERE refresh_token_hash = $1`,
          [token, inserted.rows[0].id]
        );
        await client.query("COMMIT");
        return {
          access_token: `acc_${inserted.rows[0].id}`,
          refresh_token: `ref_${newToken}`
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // In-memory path
    const rotated = this.appState.rotateSession(refresh_token);
    if (!rotated) {
      throw new UnauthorizedException({
        code: "invalid_token",
        message: "Invalid or expired refresh token"
      });
    }
    return { access_token: rotated.accessToken, refresh_token: rotated.refreshToken };
  }

  // ── Role upgrade request ─────────────────────────────────────────────────

  async requestRoleUpgrade(userId: string, requestedRole: "owner" | "pg_operator") {
    // ── Fetch user — DB-first, fall back to in-memory ──────────────────────
    let currentRole: string = "tenant";

    if (this.database.isEnabled()) {
      const result = await this.database.query<{ id: string; role: string }>(
        `SELECT id::text, role::text FROM users WHERE id = $1::uuid LIMIT 1`,
        [userId]
      );
      if (!result.rowCount || !result.rows[0]) {
        throw new BadRequestException({ code: "user_not_found", message: "User not found" });
      }
      currentRole = result.rows[0].role;
    } else {
      const user = this.appState.users.get(userId);
      if (!user) {
        throw new BadRequestException({ code: "user_not_found", message: "User not found" });
      }
      currentRole = user.role;
    }

    // Idempotent: if user already has the requested role, return success
    if (currentRole === requestedRole) {
      return {
        request_id: null,
        status: "already_granted",
        requested_role: requestedRole,
        role: currentRole
      };
    }

    // Non-tenants with a different incompatible role (e.g. admin) should not downgrade
    if (currentRole !== "tenant" && currentRole !== requestedRole) {
      throw new BadRequestException({
        code: "already_has_role",
        message: `User already has role '${currentRole}' — contact admin to change`
      });
    }

    // ── IN-MEMORY (dev) MODE: grant role immediately ──────────────────────
    // No admin approval needed in local development — improves DX.
    if (!this.database.isEnabled()) {
      this.appState.setUserRole(userId, requestedRole);
      this.logger.log(
        `[RoleUpgrade] IMMEDIATE GRANT user=${userId} role=${requestedRole} (in-memory mode)`
      );
      return {
        request_id: null,
        status: "granted",
        requested_role: requestedRole,
        role: requestedRole
      };
    }

    // ── DB MODE: grant immediately via UPDATE ─────────────────────────────
    // For local development the DB is the active store, so we update the
    // users table directly (same DX as the in-memory path).
    // In production deployments, swap this for a pending-approval flow.
    await this.database.query(
      `UPDATE users SET role = $2::user_role, updated_at = now() WHERE id = $1::uuid`,
      [userId, requestedRole]
    );
    this.logger.log(`[RoleUpgrade] IMMEDIATE GRANT user=${userId} role=${requestedRole} (db mode)`);
    return {
      request_id: null,
      status: "granted",
      requested_role: requestedRole,
      role: requestedRole
    };
  }

  private async sendOtpInMemory(phone_e164: string, purpose: string) {
    const existing = [...this.appState.challenges.values()].filter((c) => c.phone === phone_e164);
    const recentCount = existing.filter(
      (c) => Date.now() - (c.expiresAt - 5 * 60_000) < 10 * 60_000
    ).length;

    if (recentCount >= 6) {
      throw new HttpException(
        {
          code: "otp_rate_limited",
          message: "Too many OTP requests"
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // Mock OTP — always used in local dev (OTP_PROVIDER=mock).
    // To use real SMS: set OTP_PROVIDER=d7 in apps/api/.env (see D7_SETUP.md).
    const otp = String(randomInt(100000, 999999));
    const id = randomUUID();
    this.appState.challenges.set(id, {
      id,
      phone: phone_e164,
      purpose,
      otp,
      attempts: 0,
      expiresAt: Date.now() + 5 * 60_000
    });

    // Always log at INFO level so the OTP is visible in the terminal console
    this.logger.log(`\n╔══════════════════════════════════════╗
║   [DEV] MOCK OTP for ${phone_e164}   ║
║   Code: ${otp}                           ║
╚══════════════════════════════════════╝`);
    return {
      challenge_id: id,
      expires_in_sec: 300,
      retry_after_sec: 30,
      // Mirrors the DB path's shape so the client sees one contract whether or
      // not DATABASE_URL is set. This path never reaches a real provider, so
      // the SMS escape hatch is always closed.
      channel: "mock" as const,
      sms_fallback_available: false,
      dev_otp: otp // returned to client so login page can auto-fill
    };
  }

  private async verifyOtpInMemory(challenge_id: string, otp_code: string) {
    const challenge = this.appState.challenges.get(challenge_id);
    if (!challenge) {
      throw new UnauthorizedException({ code: "invalid_otp", message: "Invalid OTP" });
    }

    if (challenge.blockedUntil && challenge.blockedUntil > Date.now()) {
      throw new UnauthorizedException({ code: "otp_blocked", message: "OTP challenge blocked" });
    }

    if (challenge.expiresAt < Date.now()) {
      throw new UnauthorizedException({ code: "otp_expired", message: "OTP expired" });
    }

    if (!timingSafeOtpEqual(challenge.otp, otp_code)) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) {
        challenge.blockedUntil = Date.now() + 30 * 60_000;
        throw new UnauthorizedException({ code: "otp_blocked", message: "OTP challenge blocked" });
      }

      throw new UnauthorizedException({ code: "invalid_otp", message: "Invalid OTP" });
    }

    this.appState.challenges.delete(challenge_id);
    let user = this.appState.usersByPhone.get(challenge.phone);
    let isNewUser = false;
    let reward: ReturnType<typeof signupReward> | undefined;

    if (!user) {
      const userId = randomUUID();
      user = {
        id: userId,
        phone: challenge.phone,
        role: "tenant",
        preferred_language: "en"
      };
      this.appState.users.set(user.id, user);
      this.appState.usersByPhone.set(user.phone, user);
      this.appState.wallets.set(user.id, 0);
      this.appState.walletTxns.set(user.id, []);
      reward = signupReward();
      this.appState.grantSignupReward(user.id, reward);
      isNewUser = true;
    }

    const session = this.appState.createSession(user.id);
    return {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      user: {
        id: user.id,
        role: user.role,
        phone_e164: user.phone,
        preferred_language: user.preferred_language
      },
      is_new_user: isNewUser,
      ...(reward
        ? {
            signup_reward: {
              credits_granted: reward.credits,
              expires_at: reward.expiresAt?.toISOString() ?? null
            }
          }
        : {})
    };
  }
}
