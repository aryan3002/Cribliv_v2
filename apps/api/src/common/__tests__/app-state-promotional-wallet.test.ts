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
});
