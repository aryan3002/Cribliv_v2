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
  "leadFreeBadge",
  "leadUnlockButton",
  "leadCallNow",
  "leadCallAgain",
  "leadCallReminder",
  "leadExpired",
  "leadNoCredits",
  "leadBuyPackSub",
  "leadBuyPackButton",
  "leadPaidRefresh",
  "leadOpenUpi",
  "leadCreditsAdded",
  "gateHeadline",
  "gateSub",
  "gateButton",
  "galleryGateCta",
  "welcomeTitle",
  "welcomeTenantBody",
  "welcomeOwnerBody",
  "welcomeCta",
  "loginBenefitsTitle",
  "loginBenefit1",
  "loginBenefit2",
  "loginBenefit3"
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
  });
});
