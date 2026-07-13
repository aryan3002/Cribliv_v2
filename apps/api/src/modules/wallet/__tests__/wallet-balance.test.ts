import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { debitWalletCredits, expireSignupCredits } from "../wallet-balance";

type WalletState = {
  balanceCredits: number;
  promotionalCreditsRemaining: number;
  promotionalCreditsExpiresAt: string | null;
};

type WalletTransaction = {
  id: string;
  txnType: string;
  creditsDelta: number;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
};

class RecordingPoolClient {
  readonly queries: Array<{ text: string; params: unknown[] }> = [];
  readonly transactions: WalletTransaction[];
  wallet: WalletState;
  private nextTransactionId = 1;

  constructor(wallet: WalletState, transactions: WalletTransaction[] = []) {
    this.wallet = { ...wallet };
    this.transactions = transactions.map((txn) => ({ ...txn, metadata: { ...txn.metadata } }));
  }

  asPoolClient(): PoolClient {
    return this as unknown as PoolClient;
  }

  countQueries(fragment: string): number {
    return this.queries.filter(({ text }) => text.toLowerCase().includes(fragment.toLowerCase()))
      .length;
  }

  async query(text: string, params: unknown[] = []) {
    this.queries.push({ text, params });
    const sql = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (sql.includes("from wallets") && sql.includes("for update")) {
      return this.result([
        {
          balance_credits: this.wallet.balanceCredits,
          promotional_credits_remaining: this.wallet.promotionalCreditsRemaining,
          promotional_credits_expires_at: this.wallet.promotionalCreditsExpiresAt
        }
      ]);
    }

    if (
      sql.startsWith("update wallets") &&
      sql.includes("balance_credits = balance_credits - promotional_credits_remaining")
    ) {
      const expiresAt = this.wallet.promotionalCreditsExpiresAt;
      const isDue =
        this.wallet.promotionalCreditsRemaining > 0 &&
        expiresAt !== null &&
        new Date(expiresAt).getTime() <= Date.now();
      if (!isDue) return this.result([]);

      const expiredCredits = this.wallet.promotionalCreditsRemaining;
      this.wallet.balanceCredits -= expiredCredits;
      this.wallet.promotionalCreditsRemaining = 0;
      return this.result([
        {
          balance_credits: this.wallet.balanceCredits,
          promotional_credits_expires_at: expiresAt
        }
      ]);
    }

    if (sql.includes("from wallet_transactions") && sql.includes("idempotency_key")) {
      const existing = this.transactions.find(
        (txn) => txn.idempotencyKey === String(params[1] ?? "")
      );
      return this.result(
        existing
          ? [
              {
                id: existing.id,
                txn_type: existing.txnType,
                credits_delta: existing.creditsDelta,
                reference_type: existing.referenceType,
                reference_id: existing.referenceId,
                metadata: existing.metadata
              }
            ]
          : []
      );
    }

    if (sql.includes("insert into wallet_transactions") && sql.includes("'expire_signup'")) {
      const transaction: WalletTransaction = {
        id: `txn-${this.nextTransactionId++}`,
        txnType: "expire_signup",
        creditsDelta: Number(params[1]),
        referenceType: "user",
        referenceId: String(params[0]),
        idempotencyKey: null,
        metadata: JSON.parse(String(params[2])) as Record<string, unknown>
      };
      this.transactions.push(transaction);
      return this.result([{ id: transaction.id }]);
    }

    if (sql.includes("insert into wallet_transactions")) {
      const idempotencyKey = params[5] === null ? null : String(params[5]);
      const existing = this.transactions.find(
        (txn) => idempotencyKey !== null && txn.idempotencyKey === idempotencyKey
      );
      if (existing) return this.result([]);

      const transaction: WalletTransaction = {
        id: `txn-${this.nextTransactionId++}`,
        txnType: String(params[1]),
        creditsDelta: Number(params[2]),
        referenceType: String(params[3]),
        referenceId: String(params[4]),
        idempotencyKey,
        metadata: JSON.parse(String(params[6])) as Record<string, unknown>
      };
      this.transactions.push(transaction);
      return this.result([{ id: transaction.id }]);
    }

    if (
      sql.startsWith("update wallets") &&
      sql.includes("promotional_credits_remaining = promotional_credits_remaining - $3")
    ) {
      const credits = Number(params[1]);
      const promotionalCreditsUsed = Number(params[2]);
      this.wallet.balanceCredits -= credits;
      this.wallet.promotionalCreditsRemaining -= promotionalCreditsUsed;
      return this.result([
        {
          balance_credits: this.wallet.balanceCredits,
          promotional_credits_remaining: this.wallet.promotionalCreditsRemaining
        }
      ]);
    }

    throw new Error(`Unexpected query: ${text}`);
  }

  private result(rows: Array<Record<string, unknown>>) {
    return {
      command: "",
      rowCount: rows.length,
      oid: 0,
      fields: [],
      rows
    };
  }
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_LISTING_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";

function wallet(overrides: Partial<WalletState> = {}): WalletState {
  return {
    balanceCredits: 10,
    promotionalCreditsRemaining: 0,
    promotionalCreditsExpiresAt: null,
    ...overrides
  };
}

describe("database wallet balance helpers", () => {
  it("expires only the due promotional remainder and records its exact delta", async () => {
    const client = new RecordingPoolClient(
      wallet({
        balanceCredits: 12,
        promotionalCreditsRemaining: 7,
        promotionalCreditsExpiresAt: "2020-01-01T00:00:00.000Z"
      })
    );

    const expired = await expireSignupCredits(client.asPoolClient(), USER_ID);

    expect(expired).toBe(7);
    expect(client.wallet).toMatchObject({
      balanceCredits: 5,
      promotionalCreditsRemaining: 0
    });
    expect(client.transactions).toEqual([
      expect.objectContaining({
        txnType: "expire_signup",
        creditsDelta: -7,
        referenceType: "user",
        referenceId: USER_ID,
        metadata: {
          expired_credits: 7,
          expires_at: "2020-01-01T00:00:00.000Z"
        }
      })
    ]);
  });

  it("does not expire or write the expiry transaction twice", async () => {
    const client = new RecordingPoolClient(
      wallet({
        promotionalCreditsRemaining: 10,
        promotionalCreditsExpiresAt: "2020-01-01T00:00:00.000Z"
      })
    );

    expect(await expireSignupCredits(client.asPoolClient(), USER_ID)).toBe(10);
    expect(await expireSignupCredits(client.asPoolClient(), USER_ID)).toBe(0);

    expect(client.wallet.balanceCredits).toBe(0);
    expect(client.transactions.filter((txn) => txn.txnType === "expire_signup")).toHaveLength(1);
  });

  it("uses promotional credits first for a one-credit debit", async () => {
    const client = new RecordingPoolClient(
      wallet({
        promotionalCreditsRemaining: 3,
        promotionalCreditsExpiresAt: "2999-01-01T00:00:00.000Z"
      })
    );

    const result = await debitWalletCredits(client.asPoolClient(), {
      userId: USER_ID,
      credits: 1,
      txnType: "debit_contact_unlock",
      referenceType: "listing",
      referenceId: LISTING_ID,
      idempotencyKey: "contact-unlock-1"
    });

    expect(result).toEqual({
      status: "success",
      transactionId: "txn-1",
      inserted: true,
      balanceCredits: 9,
      promotionalCreditsUsed: 1
    });
    expect(client.wallet.promotionalCreditsRemaining).toBe(2);
    expect(client.transactions[0].metadata).toEqual({ promotional_credits_used: 1 });
  });

  it("returns an exact zero-balance replay before insufficient rejection without debiting again", async () => {
    const original: WalletTransaction = {
      id: "txn-original",
      txnType: "debit_contact_unlock",
      creditsDelta: -1,
      referenceType: "listing",
      referenceId: LISTING_ID,
      idempotencyKey: "contact-unlock-replay",
      metadata: { promotional_credits_used: 1 }
    };
    const client = new RecordingPoolClient(wallet({ balanceCredits: 0 }), [original]);

    const result = await debitWalletCredits(client.asPoolClient(), {
      userId: USER_ID,
      credits: 1,
      txnType: "debit_contact_unlock",
      referenceType: "listing",
      referenceId: LISTING_ID,
      idempotencyKey: "contact-unlock-replay"
    });

    expect(result).toEqual({
      status: "success",
      transactionId: "txn-original",
      inserted: false,
      balanceCredits: 0,
      promotionalCreditsUsed: 1
    });
    expect(client.wallet).toEqual(wallet({ balanceCredits: 0 }));
    expect(
      client.countQueries("promotional_credits_remaining = promotional_credits_remaining - $3")
    ).toBe(0);
  });

  it("returns insufficient after recording due expiry so the caller can commit it", async () => {
    const client = new RecordingPoolClient(
      wallet({
        balanceCredits: 1,
        promotionalCreditsRemaining: 1,
        promotionalCreditsExpiresAt: "2020-01-01T00:00:00.000Z"
      })
    );

    const result = await debitWalletCredits(client.asPoolClient(), {
      userId: USER_ID,
      credits: 1,
      txnType: "debit_contact_unlock",
      referenceType: "listing",
      referenceId: LISTING_ID,
      idempotencyKey: "expired-insufficient"
    });

    expect(result).toEqual({
      status: "insufficient",
      balanceCredits: 0
    });
    expect(client.wallet).toMatchObject({
      balanceCredits: 0,
      promotionalCreditsRemaining: 0
    });
    expect(client.transactions).toEqual([
      expect.objectContaining({
        txnType: "expire_signup",
        creditsDelta: -1
      })
    ]);
  });

  it.each([
    {
      label: "target",
      existing: {
        txnType: "debit_contact_unlock",
        referenceType: "listing",
        referenceId: OTHER_LISTING_ID,
        creditsDelta: -1
      }
    },
    {
      label: "type",
      existing: {
        txnType: "admin_adjustment",
        referenceType: "admin",
        referenceId: ADMIN_ID,
        creditsDelta: -1
      }
    },
    {
      label: "amount",
      existing: {
        txnType: "debit_contact_unlock",
        referenceType: "listing",
        referenceId: LISTING_ID,
        creditsDelta: -2
      }
    }
  ])("rejects an idempotency key already used for another $label", async ({ existing }) => {
    const client = new RecordingPoolClient(wallet({ balanceCredits: 0 }), [
      {
        id: "txn-conflict",
        idempotencyKey: "shared-key",
        metadata: {},
        ...existing
      }
    ]);

    await expect(
      debitWalletCredits(client.asPoolClient(), {
        userId: USER_ID,
        credits: 1,
        txnType: "debit_contact_unlock",
        referenceType: "listing",
        referenceId: LISTING_ID,
        idempotencyKey: "shared-key"
      })
    ).rejects.toMatchObject({
      code: "idempotency_conflict"
    });
    expect(client.wallet.balanceCredits).toBe(0);
  });

  it("uses the promotional portion first for a multi-credit negative admin adjustment", async () => {
    const client = new RecordingPoolClient(
      wallet({
        balanceCredits: 8,
        promotionalCreditsRemaining: 2,
        promotionalCreditsExpiresAt: "2999-01-01T00:00:00.000Z"
      })
    );

    const result = await debitWalletCredits(client.asPoolClient(), {
      userId: USER_ID,
      credits: 3,
      txnType: "admin_adjustment",
      referenceType: "admin",
      referenceId: ADMIN_ID,
      metadata: { reason: "fraud reversal" }
    });

    expect(result).toMatchObject({
      status: "success",
      inserted: true,
      balanceCredits: 5,
      promotionalCreditsUsed: 2
    });
    expect(client.wallet.promotionalCreditsRemaining).toBe(0);
    expect(client.transactions[0]).toMatchObject({
      creditsDelta: -3,
      metadata: {
        reason: "fraud reversal",
        promotional_credits_used: 2
      }
    });
  });
});
