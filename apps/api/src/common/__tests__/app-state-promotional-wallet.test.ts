import { describe, expect, it } from "vitest";
import { AppStateService } from "../app-state.service";

const GRANTED_AT = Date.parse("2026-07-13T08:30:00.000Z");
const EXPIRES_AT = Date.parse("2026-10-11T08:30:00.000Z");

function grantSignupReward(state: AppStateService, userId: string) {
  return state.grantSignupReward(userId, {
    credits: 10,
    expiresAt: new Date(EXPIRES_AT)
  });
}

describe("AppStateService promotional wallet", () => {
  it("grants and exposes 10 promotional credits", () => {
    const state = new AppStateService();
    const userId = "promo-grant-user";

    const txn = grantSignupReward(state, userId);

    expect(txn).toMatchObject({
      userId,
      type: "grant_signup",
      creditsDelta: 10,
      referenceId: userId
    });
    expect(state.getWalletDetails(userId, GRANTED_AT)).toEqual({
      balanceCredits: 10,
      freeCreditsGranted: 10,
      promotionalCreditsRemaining: 10,
      promotionalCreditsExpiresAt: EXPIRES_AT
    });
  });

  it("debits promotional credits before permanent credits", () => {
    const state = new AppStateService();
    const userId = "promo-debit-user";
    grantSignupReward(state, userId);
    state.addWalletTxn({
      userId,
      type: "purchase_pack",
      creditsDelta: 5
    });

    const txn = state.debitWalletCredits(
      {
        userId,
        credits: 4,
        type: "debit_contact_unlock",
        referenceId: "listing-1",
        idempotencyKey: "unlock-1"
      },
      GRANTED_AT
    );
    const replay = state.debitWalletCredits(
      {
        userId,
        credits: 4,
        type: "debit_contact_unlock",
        referenceId: "listing-1",
        idempotencyKey: "unlock-1"
      },
      GRANTED_AT
    );

    expect(txn).toMatchObject({
      creditsDelta: -4,
      metadata: { promotionalCreditsUsed: 4 }
    });
    expect(replay.id).toBe(txn.id);
    expect(state.getWalletDetails(userId, GRANTED_AT)).toEqual({
      balanceCredits: 11,
      freeCreditsGranted: 10,
      promotionalCreditsRemaining: 6,
      promotionalCreditsExpiresAt: EXPIRES_AT
    });
  });

  it("routes legacy negative addWalletTxn calls through promotional-first debit", () => {
    const state = new AppStateService();
    const userId = "legacy-debit-user";
    grantSignupReward(state, userId);

    const txn = state.addWalletTxn({
      userId,
      type: "debit_contact_unlock",
      creditsDelta: -1,
      referenceId: "listing-legacy",
      idempotencyKey: "legacy-unlock"
    });

    expect(txn).toMatchObject({
      creditsDelta: -1,
      metadata: { promotionalCreditsUsed: 1 }
    });
    expect(state.getWalletDetails(userId, GRANTED_AT)).toMatchObject({
      balanceCredits: 9,
      promotionalCreditsRemaining: 9
    });
    expect(state.getWalletDetails(userId, EXPIRES_AT)).toMatchObject({
      balanceCredits: 0,
      promotionalCreditsRemaining: 0
    });
  });

  it("returns an exact idempotent replay after spending the full balance", () => {
    const state = new AppStateService();
    const userId = "full-balance-replay-user";
    grantSignupReward(state, userId);
    const input = {
      userId,
      credits: 10,
      type: "debit_contact_unlock",
      referenceId: "listing-full-balance",
      idempotencyKey: "full-balance-unlock"
    };

    const first = state.debitWalletCredits(input, GRANTED_AT);
    const replay = state.debitWalletCredits(input, GRANTED_AT);

    expect(replay.id).toBe(first.id);
    expect(state.getWalletDetails(userId, GRANTED_AT)).toMatchObject({
      balanceCredits: 0,
      promotionalCreditsRemaining: 0
    });
    expect(
      state
        .listWalletTransactions(userId)
        .filter((txn) => txn.idempotencyKey === input.idempotencyKey)
    ).toHaveLength(1);
  });

  it("rejects a debit key already used by a different wallet transaction", () => {
    const state = new AppStateService();
    const userId = "purchase-key-collision-user";
    grantSignupReward(state, userId);
    state.addWalletTxn({
      userId,
      type: "purchase_pack",
      creditsDelta: 5,
      referenceId: "purchase-1",
      idempotencyKey: "shared-wallet-key"
    });

    expect(() =>
      state.debitWalletCredits(
        {
          userId,
          credits: 1,
          type: "debit_contact_unlock",
          referenceId: "listing-collision",
          idempotencyKey: "shared-wallet-key"
        },
        GRANTED_AT
      )
    ).toThrow(/idempotency/i);
    expect(state.getWalletDetails(userId, GRANTED_AT).balanceCredits).toBe(15);
  });

  it.each([
    {
      label: "type",
      override: { type: "admin_adjustment" }
    },
    {
      label: "reference",
      override: { referenceId: "listing-other" }
    },
    {
      label: "amount",
      override: { credits: 2 }
    }
  ])("rejects an idempotency replay with a different $label", ({ override }) => {
    const state = new AppStateService();
    const userId = `debit-key-collision-${override.type ?? override.referenceId ?? override.credits}`;
    const input = {
      userId,
      credits: 1,
      type: "debit_contact_unlock",
      referenceId: "listing-original",
      idempotencyKey: "debit-collision"
    };
    grantSignupReward(state, userId);
    state.debitWalletCredits(input, GRANTED_AT);

    expect(() =>
      state.debitWalletCredits(
        {
          ...input,
          ...override
        },
        GRANTED_AT
      )
    ).toThrow(/idempotency/i);
    expect(state.getWalletDetails(userId, GRANTED_AT).balanceCredits).toBe(9);
  });

  it("expires only the unused promotional remainder", () => {
    const state = new AppStateService();
    const userId = "promo-expiry-user";
    grantSignupReward(state, userId);
    state.debitWalletCredits(
      {
        userId,
        credits: 3,
        type: "debit_contact_unlock",
        referenceId: "listing-2"
      },
      GRANTED_AT
    );

    expect(state.getWalletDetails(userId, EXPIRES_AT)).toEqual({
      balanceCredits: 0,
      freeCreditsGranted: 10,
      promotionalCreditsRemaining: 0,
      promotionalCreditsExpiresAt: EXPIRES_AT
    });

    const expiryTxn = state
      .listWalletTransactions(userId)
      .find((txn) => txn.type === "expire_signup");
    expect(expiryTxn).toMatchObject({
      creditsDelta: -7,
      metadata: {
        expiredCredits: 7,
        expiresAt: EXPIRES_AT
      }
    });
  });

  it("keeps refund and purchase credits after expiry", () => {
    const state = new AppStateService();
    const userId = "permanent-credit-user";
    grantSignupReward(state, userId);
    state.addWalletTxn({
      userId,
      type: "purchase_pack",
      creditsDelta: 5
    });
    state.addWalletTxn({
      userId,
      type: "refund_no_response",
      creditsDelta: 1
    });

    expect(state.getWalletDetails(userId, EXPIRES_AT + 1)).toEqual({
      balanceCredits: 6,
      freeCreditsGranted: 10,
      promotionalCreditsRemaining: 0,
      promotionalCreditsExpiresAt: EXPIRES_AT
    });
  });

  it("does not expire twice", () => {
    const state = new AppStateService();
    const userId = "single-expiry-user";
    grantSignupReward(state, userId);

    state.getWalletDetails(userId, EXPIRES_AT);
    state.getWalletDetails(userId, EXPIRES_AT + 1);

    expect(state.getWalletDetails(userId, EXPIRES_AT + 2).balanceCredits).toBe(0);
    expect(
      state.listWalletTransactions(userId).filter((txn) => txn.type === "expire_signup")
    ).toHaveLength(1);
  });

  it("applies lazy expiry when reading getWalletBalance", () => {
    const state = new AppStateService();
    const userId = "balance-read-expiry-user";
    state.grantSignupReward(userId, {
      credits: 10,
      expiresAt: new Date(Date.now() - 1)
    });

    expect(state.getWalletBalance(userId)).toBe(0);
    expect(state.getWalletDetails(userId)).toMatchObject({
      balanceCredits: 0,
      promotionalCreditsRemaining: 0
    });
    expect(
      state.listWalletTransactions(userId).filter((txn) => txn.type === "expire_signup")
    ).toHaveLength(1);
  });

  it("rejects invalid and insufficient debits without changing balances", () => {
    const state = new AppStateService();
    const userId = "invalid-debit-user";
    grantSignupReward(state, userId);

    expect(() =>
      state.debitWalletCredits(
        {
          userId,
          credits: 0,
          type: "debit_contact_unlock"
        },
        GRANTED_AT
      )
    ).toThrow();
    expect(() =>
      state.debitWalletCredits(
        {
          userId,
          credits: 11,
          type: "debit_contact_unlock"
        },
        GRANTED_AT
      )
    ).toThrow();
    expect(state.getWalletDetails(userId, GRANTED_AT).balanceCredits).toBe(10);
  });

  it("seeds the tenant wallet from the canonical signup reward instead of a hardcoded 2", () => {
    const original = process.env.SIGNUP_FREE_CREDITS;
    process.env.SIGNUP_FREE_CREDITS = "7";

    try {
      const state = new AppStateService();
      const tenant = state.usersByPhone.get("+919999999902");
      expect(tenant).toBeDefined();
      expect(state.getWalletDetails(tenant!.id)).toMatchObject({
        balanceCredits: 7,
        freeCreditsGranted: 7,
        promotionalCreditsRemaining: 7
      });
    } finally {
      if (original === undefined) delete process.env.SIGNUP_FREE_CREDITS;
      else process.env.SIGNUP_FREE_CREDITS = original;
    }
  });
});
