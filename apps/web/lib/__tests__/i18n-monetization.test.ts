import { describe, it, expect } from "vitest";
import { t } from "../i18n";

const KEYS = [
  "cbGuaranteeIntro",
  "cbRequestButton",
  "cbVerifyButton",
  "cbRequestedTitle",
  "cbStepRequested",
  "cbStepOwnerNotified",
  "cbStepCallOnWay",
  "cbStepRefunded",
  "cbRefundReassure",
  "cbGuestHint",
  "cbMyCallbacks",
  "cbGuaranteeLine",
  "cbGotCall",
  "cbNoCall",
  "cbRefundedCaption",
  "cbConfirmedCaption",
  "cbDisputedCaption",
  "cbCallMadePrompt",
  "cbEmptyState",
  "cbLoginPrompt",
  "cbNoCredits",
  "cbBuyCreditsSub",
  "leadFreeBadge",
  "leadUnlockButton",
  "leadCallNow",
  "leadCallAgain",
  "leadCallReminder",
  "leadExpired",
  "leadNoCredits",
  "leadBuyPackSub",
  "leadBalanceLabel",
  "leadLockedWaiting",
  "gateHeadline",
  "gateSub",
  "gateButton",
  "galleryGateCta",
  "welcomeTitle",
  "welcomeTenantBody",
  "welcomeOwnerBody",
  "welcomeCta",
  "welcomeRewardBadge",
  "welcomeRewardHeading",
  "welcomeRewardSupporting",
  "welcomeRewardLabel",
  "welcomeRewardCreditsFact",
  "welcomeRewardExpiryFact",
  "welcomeRewardCta",
  "welcomeRewardFootnote",
  "welcomeRewardLive",
  "welcomeRewardClose",
  "promotionalCreditExpiry",
  "loginBenefitsTitle",
  "loginBenefit1",
  "loginBenefit2",
  "loginBenefit3",
  "cpTitle",
  "cpWalletBalance",
  "cpUnitPrice",
  "cpBestValue",
  "cpPaySecurely",
  "cpPayWithUpi",
  "cpLoading",
  "cpCancelled",
  "cpPendingWebhook",
  "cpCaptured",
  "cpFailed",
  "cpRetry",
  "cpClose",
  "cpGatewayUnavailable"
] as const;

describe("monetization i18n keys", () => {
  it.each(KEYS)("%s exists in both locales with real Hindi", (key) => {
    const en = t("en", key);
    const hi = t("hi", key);
    expect(en, `${key} en missing`).not.toBe(key); // t() returns the key when missing
    expect(hi, `${key} hi missing`).not.toBe(key);
    expect(hi, `${key} hi is a stub`).not.toBe(en);
  });

  it("keeps caller placeholders intact", () => {
    expect(t("en", "cbStepCallOnWay")).toContain("{time}");
    expect(t("hi", "cbStepCallOnWay")).toContain("{time}");
    expect(t("en", "cbRefundReassure")).toContain("{n}");
    expect(t("hi", "cbRefundReassure")).toContain("{n}");
    expect(t("en", "cpUnitPrice")).toContain("{price}");
    expect(t("hi", "cpUnitPrice")).toContain("{price}");
    expect(t("en", "leadLockedWaiting")).toContain("{n}");
    expect(t("hi", "leadLockedWaiting")).toContain("{n}");
    expect(t("en", "welcomeRewardCreditsFact")).toContain("{credits}");
    expect(t("hi", "welcomeRewardCreditsFact")).toContain("{credits}");
    expect(t("en", "welcomeRewardExpiryFact")).toContain("{date}");
    expect(t("hi", "welcomeRewardExpiryFact")).toContain("{date}");
    expect(t("en", "welcomeRewardLive")).toContain("{credits}");
    expect(t("hi", "welcomeRewardLive")).toContain("{credits}");
    expect(t("en", "welcomeRewardLive")).toContain("{date}");
    expect(t("hi", "welcomeRewardLive")).toContain("{date}");
    expect(t("en", "promotionalCreditExpiry")).toContain("{credits}");
    expect(t("hi", "promotionalCreditExpiry")).toContain("{credits}");
    expect(t("en", "promotionalCreditExpiry")).toContain("{date}");
    expect(t("hi", "promotionalCreditExpiry")).toContain("{date}");
  });

  it("keeps the reward heading professional and the legacy owner copy free of the stale grant", () => {
    expect(t("en", "welcomeRewardHeading")).toBe("Welcome to Cribliv");
    expect(t("en", "welcomeRewardHeading")).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(t("en", "welcomeOwnerBody")).not.toContain("2 tenant leads");
    expect(t("hi", "welcomeOwnerBody")).not.toContain("2 किरायेदार लीड");
  });
});
