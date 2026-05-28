import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AppStateService } from "../src/common/app-state.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { D7OtpVerifyError } from "../src/modules/auth/d7-otp.client";

type DbChallengeStatus = "active" | "verified" | "expired" | "blocked";

interface DbChallenge {
  id: string;
  phone_e164: string;
  otp_hash: string;
  attempt_count: number;
  status: DbChallengeStatus;
  expires_at: string;
}

interface DbUser {
  id: string;
  role: "tenant" | "owner" | "pg_operator" | "admin";
  phone_e164: string;
  preferred_language: "en" | "hi";
}

function getErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) {
    return undefined;
  }
  const response = error.getResponse();
  if (response && typeof response === "object" && "code" in response) {
    return (response as { code?: string }).code;
  }
  return undefined;
}

function createFakeDb(input: { challenges?: DbChallenge[]; users?: DbUser[] } = {}) {
  const challenges = new Map<string, DbChallenge>(
    (input.challenges ?? []).map((challenge) => [challenge.id, challenge])
  );
  const users = new Map<string, DbUser>((input.users ?? []).map((user) => [user.phone_e164, user]));
  let sessionCounter = 0;

  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (text.includes("FROM otp_challenges") && text.includes("count(*)::int")) {
      return { rowCount: 1, rows: [{ count: 0 }] };
    }

    if (text.includes("INSERT INTO otp_challenges")) {
      const id = `00000000-0000-4000-8000-00000000000${challenges.size + 1}`;
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const challenge: DbChallenge = {
        id,
        phone_e164: String(params[0]),
        otp_hash: String(params[2]),
        attempt_count: 0,
        status: "active",
        expires_at: expiresAt
      };
      challenges.set(id, challenge);
      return { rowCount: 1, rows: [{ id }] };
    }

    if (
      text.includes(
        "SELECT id::text, phone_e164, otp_hash, attempt_count, expires_at::text, status::text"
      )
    ) {
      const challenge = challenges.get(String(params[0]));
      return {
        rowCount: challenge ? 1 : 0,
        rows: challenge ? [{ ...challenge }] : []
      };
    }

    if (text.includes("UPDATE otp_challenges") && text.includes("SET attempt_count =")) {
      const challenge = challenges.get(String(params[0]));
      if (challenge) {
        challenge.attempt_count = Number(params[1]);
        challenge.status = String(params[2]) as DbChallengeStatus;
      }
      return { rowCount: challenge ? 1 : 0, rows: [] };
    }

    throw new Error(`Unhandled DB query:\n${text}`);
  });

  const client = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
        return { rowCount: 0, rows: [] };
      }

      if (text.includes("UPDATE otp_challenges") && text.includes("status = 'verified'")) {
        const challenge = challenges.get(String(params[0]));
        if (challenge) {
          challenge.status = "verified";
        }
        return { rowCount: challenge ? 1 : 0, rows: [] };
      }

      if (text.includes("SELECT id::text, role::text, phone_e164, preferred_language::text")) {
        const user = users.get(String(params[0]));
        return {
          rowCount: user ? 1 : 0,
          rows: user ? [user] : []
        };
      }

      if (text.includes("INSERT INTO users(phone_e164, role, preferred_language)")) {
        const user: DbUser = {
          id: `20000000-0000-4000-8000-00000000000${users.size + 1}`,
          role: "tenant",
          phone_e164: String(params[0]),
          preferred_language: "en"
        };
        users.set(user.phone_e164, user);
        return { rowCount: 1, rows: [user] };
      }

      if (
        text.includes("INSERT INTO wallets(") ||
        text.includes("INSERT INTO wallet_transactions(")
      ) {
        return { rowCount: 1, rows: [] };
      }

      if (text.includes("INSERT INTO sessions(user_id, refresh_token_hash, expires_at)")) {
        sessionCounter += 1;
        const id = `30000000-0000-4000-8000-00000000000${sessionCounter}`;
        return { rowCount: 1, rows: [{ id }] };
      }

      throw new Error(`Unhandled DB client query:\n${text}`);
    }),
    release: vi.fn()
  };

  return {
    database: {
      isEnabled: () => true,
      query,
      getClient: async () => client
    },
    state: {
      challenges,
      users
    }
  };
}

function setD7Env() {
  process.env.OTP_PROVIDER = "d7";
  process.env.D7_KEY = "test-d7-key";
  process.env.D7_BASE_URL = "https://api.d7networks.com";
  process.env.OTP_SENDER_ID = "CRIBLV";
  process.env.D7_OTP_CONTENT_TEMPLATE =
    "Greetings from CribLiv, your mobile verification code is: {}";
  process.env.D7_OTP_EXPIRY_SEC = "300";
}

describe("AuthService D7 provider", () => {
  beforeEach(() => {
    setD7Env();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OTP_PROVIDER;
    delete process.env.D7_KEY;
    delete process.env.D7_BASE_URL;
    delete process.env.D7_OTP_CONTENT_TEMPLATE;
    delete process.env.D7_OTP_EXPIRY_SEC;
  });

  it("stores d7 challenge reference and does not return dev_otp", async () => {
    const { database, state } = createFakeDb();
    const d7Client = {
      sendOtp: vi.fn().mockResolvedValue({ otpId: "otp_123456" }),
      verifyOtp: vi.fn()
    };
    const service = new AuthService(new AppStateService(), database as never, d7Client as never);

    const result = await service.sendOtp("+919999999991", "login");

    expect(result.challenge_id).toBeTruthy();
    expect("dev_otp" in result).toBe(false);
    const challenge = state.challenges.get(result.challenge_id);
    expect(challenge?.otp_hash).toBe("d7:otp_123456");
    expect(d7Client.sendOtp).toHaveBeenCalledWith({ phoneE164: "+919999999991" });
  });

  it("verifies a d7 challenge and issues session tokens", async () => {
    const challengeId = "11111111-1111-4111-8111-111111111111";
    const { database } = createFakeDb({
      challenges: [
        {
          id: challengeId,
          phone_e164: "+919999999991",
          otp_hash: "d7:otp_abcdef",
          attempt_count: 0,
          status: "active",
          expires_at: new Date(Date.now() + 60_000).toISOString()
        }
      ],
      users: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          role: "admin",
          phone_e164: "+919999999991",
          preferred_language: "en"
        }
      ]
    });
    const d7Client = {
      sendOtp: vi.fn(),
      verifyOtp: vi.fn().mockResolvedValue({ success: true })
    };
    const service = new AuthService(new AppStateService(), database as never, d7Client as never);

    const result = await service.verifyOtp(challengeId, "123456");

    expect(d7Client.verifyOtp).toHaveBeenCalledWith({
      otpId: "otp_abcdef",
      otpCode: "123456"
    });
    expect(result.access_token.startsWith("acc_")).toBe(true);
    expect(result.refresh_token.startsWith("ref_")).toBe(true);
    expect(result.user.role).toBe("admin");
  });

  it("increments invalid attempts and blocks after threshold", async () => {
    const challengeId = "11111111-1111-4111-8111-111111111112";
    const { database } = createFakeDb({
      challenges: [
        {
          id: challengeId,
          phone_e164: "+919999999992",
          otp_hash: "d7:otp_invalid",
          attempt_count: 0,
          status: "active",
          expires_at: new Date(Date.now() + 60_000).toISOString()
        }
      ]
    });
    const d7Client = {
      sendOtp: vi.fn(),
      verifyOtp: vi.fn().mockRejectedValue(new D7OtpVerifyError("invalid_otp", "Invalid OTP"))
    };
    const service = new AuthService(new AppStateService(), database as never, d7Client as never);

    for (let i = 1; i <= 4; i += 1) {
      try {
        await service.verifyOtp(challengeId, "000000");
        throw new Error("Expected verifyOtp to throw invalid_otp");
      } catch (error) {
        expect(getErrorCode(error)).toBe("invalid_otp");
      }
    }

    try {
      await service.verifyOtp(challengeId, "000000");
      throw new Error("Expected verifyOtp to throw otp_blocked");
    } catch (error) {
      expect(getErrorCode(error)).toBe("otp_blocked");
    }
  });

  it("fails sendOtp when d7 send fails and does not fallback", async () => {
    const { database, state } = createFakeDb();
    const d7Client = {
      sendOtp: vi
        .fn()
        .mockRejectedValue(
          new HttpException(
            { code: "otp_provider_error", message: "OTP provider request failed" },
            502
          )
        ),
      verifyOtp: vi.fn()
    };
    const service = new AuthService(new AppStateService(), database as never, d7Client as never);

    try {
      await service.sendOtp("+919999999993", "login");
      throw new Error("Expected sendOtp to throw");
    } catch (error) {
      expect(getErrorCode(error)).toBe("otp_provider_error");
    }

    expect(state.challenges.size).toBe(0);
  });
});
