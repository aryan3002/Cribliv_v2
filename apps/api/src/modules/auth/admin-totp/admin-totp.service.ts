import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import * as QRCode from "qrcode";
import { AppStateService } from "../../../common/app-state.service";
import { DatabaseService } from "../../../common/database.service";
import { AuthService } from "../auth.service";
import { decryptTotpSecret, encryptTotpSecret } from "./totp.crypto";
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from "./totp";

export interface AdminTotpRecord {
  secret: string;
  status: "pending" | "enabled";
  lastUsedStep: number | null;
  failedAttempts: number;
  lockedUntil: Date | null;
}

@Injectable()
export class AdminTotpService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService
  ) {}

  // ── Enrollment ──────────────────────────────────────────────────────────

  async enrollStart(
    userId: string,
    accountLabel = "admin"
  ): Promise<{ otpauth_uri: string; qr_data_url: string }> {
    const secret = generateTotpSecret();
    const otpauthUri = buildOtpauthUri(secret, accountLabel);
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);

    if (this.database.isEnabled()) {
      const encrypted = encryptTotpSecret(secret);
      await this.database.query(
        `
        INSERT INTO admin_totp(user_id, secret_encrypted, status, last_used_step, failed_attempts, locked_until, enabled_at, updated_at)
        VALUES ($1::uuid, $2, 'pending', NULL, 0, NULL, NULL, now())
        ON CONFLICT (user_id) DO UPDATE
          SET secret_encrypted = EXCLUDED.secret_encrypted,
              status = 'pending',
              last_used_step = NULL,
              failed_attempts = 0,
              locked_until = NULL,
              enabled_at = NULL,
              updated_at = now()
        `,
        [userId, encrypted]
      );
    } else {
      this.appState.adminTotp.set(userId, {
        secret,
        status: "pending",
        lastUsedStep: null,
        failedAttempts: 0,
        lockedUntil: null
      });
    }

    return { otpauth_uri: otpauthUri, qr_data_url: qrDataUrl };
  }

  async enrollVerify(userId: string, code: string): Promise<{ enabled: true }> {
    const record = await this.getSecretRecord(userId);
    if (!record) {
      throw new BadRequestException({ code: "totp_not_started", message: "Start enrollment first" });
    }
    const { valid } = verifyTotpCode(record.secret, code);
    if (!valid) {
      throw new UnauthorizedException({ code: "invalid_totp", message: "Incorrect code" });
    }

    if (this.database.isEnabled()) {
      await this.database.query(
        `UPDATE admin_totp SET status = 'enabled', enabled_at = now(), updated_at = now() WHERE user_id = $1::uuid`,
        [userId]
      );
    } else {
      const mem = this.appState.adminTotp.get(userId);
      if (mem) mem.status = "enabled";
    }
    return { enabled: true };
  }

  async status(userId: string): Promise<{ enrolled: boolean }> {
    const record = await this.getSecretRecord(userId);
    return { enrolled: !!record && record.status === "enabled" };
  }

  async reset(userId: string): Promise<{ reset: true }> {
    if (this.database.isEnabled()) {
      await this.database.query(`DELETE FROM admin_totp WHERE user_id = $1::uuid`, [userId]);
    } else {
      this.appState.adminTotp.delete(userId);
    }
    return { reset: true };
  }

  // ── Shared read helper (used by login in Task 7) ────────────────────────

  async getSecretRecord(userId: string): Promise<AdminTotpRecord | null> {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        secret_encrypted: Buffer;
        status: "pending" | "enabled";
        last_used_step: string | null;
        failed_attempts: number;
        locked_until: string | null;
      }>(
        `SELECT secret_encrypted, status, last_used_step, failed_attempts, locked_until FROM admin_totp WHERE user_id = $1::uuid LIMIT 1`,
        [userId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        secret: decryptTotpSecret(row.secret_encrypted),
        status: row.status,
        lastUsedStep: row.last_used_step === null ? null : Number(row.last_used_step),
        failedAttempts: row.failed_attempts,
        lockedUntil: row.locked_until ? new Date(row.locked_until) : null
      };
    }
    const mem = this.appState.adminTotp.get(userId);
    if (!mem) return null;
    return {
      secret: mem.secret,
      status: mem.status,
      lastUsedStep: mem.lastUsedStep,
      failedAttempts: mem.failedAttempts,
      lockedUntil: mem.lockedUntil ? new Date(mem.lockedUntil) : null
    };
  }

  // ── Login (Task 7) ───────────────────────────────────────────────────────

  private static readonly MAX_FAILURES = 5;
  private static readonly LOCKOUT_MS = 15 * 60 * 1000;

  async verifyLogin(
    phoneE164: string,
    code: string
  ): Promise<{
    access_token: string;
    refresh_token: string;
    user: { id: string; role: string; phone_e164: string; preferred_language: string };
  }> {
    if (!/^\+91\d{10}$/.test(phoneE164)) {
      throw new UnauthorizedException({ code: "invalid_totp", message: "Invalid credentials" });
    }

    const user = await this.findAdminByPhone(phoneE164);
    // Generic error — never reveal whether the phone is a (non-)admin.
    if (!user) {
      throw new UnauthorizedException({ code: "invalid_totp", message: "Invalid credentials" });
    }

    const record = await this.getSecretRecord(user.id);
    if (!record || record.status !== "enabled") {
      throw new UnauthorizedException({ code: "invalid_totp", message: "Invalid credentials" });
    }

    if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({ code: "totp_locked", message: "Account temporarily locked" });
    }

    const { valid, step } = verifyTotpCode(record.secret, code);
    const isReplay =
      valid && step !== null && record.lastUsedStep !== null && step <= record.lastUsedStep;

    if (!valid || isReplay) {
      const failures = record.failedAttempts + 1;
      const lockUntil =
        failures >= AdminTotpService.MAX_FAILURES
          ? new Date(Date.now() + AdminTotpService.LOCKOUT_MS)
          : null;
      await this.recordFailure(user.id, failures, lockUntil);
      throw new UnauthorizedException({ code: "invalid_totp", message: "Invalid credentials" });
    }

    await this.recordSuccess(user.id, step as number);
    return this.mintSession(user);
  }

  private async findAdminByPhone(
    phoneE164: string
  ): Promise<{ id: string; role: string; phone_e164: string; preferred_language: string } | null> {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        id: string;
        role: string;
        phone_e164: string;
        preferred_language: string;
      }>(
        `SELECT id::text, role::text, phone_e164, preferred_language::text FROM users WHERE phone_e164 = $1 AND role = 'admin' LIMIT 1`,
        [phoneE164]
      );
      return result.rows[0] ?? null;
    }
    const mem = this.appState.usersByPhone.get(phoneE164);
    if (!mem || mem.role !== "admin") return null;
    return {
      id: mem.id,
      role: mem.role,
      phone_e164: mem.phone,
      preferred_language: mem.preferred_language
    };
  }

  private async recordFailure(userId: string, failures: number, lockUntil: Date | null) {
    if (this.database.isEnabled()) {
      await this.database.query(
        `UPDATE admin_totp SET failed_attempts = $2, locked_until = $3, updated_at = now() WHERE user_id = $1::uuid`,
        [userId, failures, lockUntil]
      );
    } else {
      const mem = this.appState.adminTotp.get(userId);
      if (mem) {
        mem.failedAttempts = failures;
        mem.lockedUntil = lockUntil ? lockUntil.getTime() : null;
      }
    }
  }

  private async recordSuccess(userId: string, step: number) {
    if (this.database.isEnabled()) {
      await this.database.query(
        `UPDATE admin_totp SET last_used_step = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1::uuid`,
        [userId, step]
      );
    } else {
      const mem = this.appState.adminTotp.get(userId);
      if (mem) {
        mem.lastUsedStep = step;
        mem.failedAttempts = 0;
        mem.lockedUntil = null;
      }
    }
  }

  private async mintSession(user: {
    id: string;
    role: string;
    phone_e164: string;
    preferred_language: string;
  }) {
    if (this.database.isEnabled()) {
      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");
        const tokens = await this.authService.issueSessionTokens(client, user.id, user.role);
        await client.query("COMMIT");
        return { ...tokens, user };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    const session = this.appState.createSession(user.id);
    return {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      user
    };
  }
}
