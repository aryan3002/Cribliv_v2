import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { randomInt, randomUUID } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { D7OtpClient, D7OtpVerifyError } from "./d7-otp.client";
import { readOtpProviderConfig } from "./otp-provider.config";

const OTP_PURPOSES = ["login", "contact_unlock", "owner_verify"] as const;

@Injectable()
export class AuthService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(D7OtpClient) private readonly d7OtpClient: D7OtpClient
  ) {}

  async sendOtp(phone_e164: string, purpose: string) {
    if (!/^\+91\d{10}$/.test(phone_e164)) {
      throw new BadRequestException({ code: "invalid_phone", message: "Invalid phone format" });
    }

    if (!OTP_PURPOSES.includes(purpose as (typeof OTP_PURPOSES)[number])) {
      throw new BadRequestException({ code: "invalid_purpose", message: "Invalid OTP purpose" });
    }

    if (this.database.isEnabled()) {
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

      const providerConfig = readOtpProviderConfig();
      if (providerConfig.provider === "mock") {
        const otp = String(randomInt(100000, 999999));
        const inserted = await this.database.query<{ id: string }>(
          `
          INSERT INTO otp_challenges(phone_e164, purpose, otp_hash, expires_at, status)
          VALUES ($1, $2::otp_purpose, $3, now() + interval '5 minutes', 'active')
          RETURNING id::text
          `,
          [phone_e164, purpose, otp]
        );

        return {
          challenge_id: inserted.rows[0].id,
          expires_in_sec: 300,
          retry_after_sec: 30,
          dev_otp: otp
        };
      }

      const d7SendResult = await this.d7OtpClient.sendOtp({ phoneE164: phone_e164 });
      const inserted = await this.database.query<{ id: string }>(
        `
        INSERT INTO otp_challenges(phone_e164, purpose, otp_hash, expires_at, status)
        VALUES ($1, $2::otp_purpose, $3, now() + ($4::int * interval '1 second'), 'active')
        RETURNING id::text
        `,
        [phone_e164, purpose, `d7:${d7SendResult.otpId}`, providerConfig.expirySec]
      );

      return {
        challenge_id: inserted.rows[0].id,
        expires_in_sec: providerConfig.expirySec,
        retry_after_sec: 30
      };
    }

    return this.sendOtpInMemory(phone_e164, purpose);
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

      const providerOtpId = challenge.otp_hash.startsWith("d7:")
        ? challenge.otp_hash.slice(3)
        : null;
      if (providerOtpId) {
        try {
          await this.d7OtpClient.verifyOtp({ otpId: providerOtpId, otpCode: otp_code });
        } catch (error) {
          if (error instanceof D7OtpVerifyError) {
            if (error.code === "invalid_otp") {
              await this.handleInvalidDbOtp(challenge.id, challenge.attempt_count);
            }
            throw new UnauthorizedException({ code: "otp_expired", message: "OTP expired" });
          }
          throw error;
        }
      } else if (challenge.otp_hash !== otp_code) {
        await this.handleInvalidDbOtp(challenge.id, challenge.attempt_count);
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

        if (!userResult.rowCount) {
          userResult = await client.query(
            `
            INSERT INTO users(phone_e164, role, preferred_language)
            VALUES ($1, 'tenant', 'en')
            RETURNING id::text, role::text, phone_e164, preferred_language::text
            `,
            [challenge.phone_e164]
          );

          const userId = userResult.rows[0].id;
          await client.query(
            `
            INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
            VALUES ($1::uuid, 2, 2)
            ON CONFLICT (user_id)
            DO NOTHING
            `,
            [userId]
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
            VALUES ($1::uuid, 'grant_signup', 2, 'user', $1::uuid, '{}'::jsonb)
            `,
            [userId]
          );

          isNewUser = true;
        }

        const sessionToken = randomUUID();
        const sessionResult = await client.query<{ id: string }>(
          `
          INSERT INTO sessions(user_id, refresh_token_hash, expires_at)
          VALUES ($1::uuid, $2, now() + interval '30 days')
          RETURNING id::text
          `,
          [userResult.rows[0].id, sessionToken]
        );

        await client.query("COMMIT");

        return {
          access_token: `acc_${sessionResult.rows[0].id}`,
          refresh_token: `ref_${sessionToken}`,
          user: {
            id: userResult.rows[0].id,
            role: userResult.rows[0].role,
            phone_e164: userResult.rows[0].phone_e164,
            preferred_language: userResult.rows[0].preferred_language
          },
          is_new_user: isNewUser
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

  private async handleInvalidDbOtp(challengeId: string, currentAttemptCount: number) {
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
      const result = await this.database.query<{
        id: string;
        role: string;
        phone_e164: string;
        preferred_language: string;
        wallet_balance: number;
      }>(
        `
        SELECT
          u.id::text,
          u.role::text,
          u.phone_e164,
          u.preferred_language::text,
          COALESCE(w.balance_credits, 0) AS wallet_balance
        FROM users u
        LEFT JOIN wallets w ON w.user_id = u.id
        WHERE u.id = $1::uuid
        LIMIT 1
        `,
        [userId]
      );

      if (result.rowCount && result.rows[0]) {
        return result.rows[0];
      }
    }

    const user = this.appState.users.get(userId);
    return {
      id: user?.id,
      role: user?.role,
      phone_e164: user?.phone,
      preferred_language: user?.preferred_language,
      wallet_balance: this.appState.getWalletBalance(userId)
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

  private sendOtpInMemory(phone_e164: string, purpose: string) {
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

    return {
      challenge_id: id,
      expires_in_sec: 300,
      retry_after_sec: 30,
      dev_otp: otp
    };
  }

  private verifyOtpInMemory(challenge_id: string, otp_code: string) {
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

    if (challenge.otp !== otp_code) {
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
      this.appState.addWalletTxn({
        userId: user.id,
        type: "grant_signup",
        creditsDelta: 2,
        referenceId: user.id
      });
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
      is_new_user: isNewUser
    };
  }
}
