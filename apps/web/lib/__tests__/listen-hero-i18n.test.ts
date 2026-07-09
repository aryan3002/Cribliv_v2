import { describe, expect, it } from "vitest";
import { t } from "../i18n";

const KEYS = [
  "listenHeroTitle",
  "listenHeroSub",
  "listenHeroCountIdle",
  "listenHeroCountMatching",
  "listenHeroCountReady",
  "listenHeroListening",
  "listenHeroGrowing",
  "listenHeroExample1",
  "listenHeroExample2",
  "listenHeroExample3",
  "listenHeroCityStrip",
  "mayaSectionTitle",
  "mayaSectionSub",
  "mayaSectionCta"
];

describe("listening hero i18n", () => {
  it("has en and hi values for every key (t returns the key itself when missing)", () => {
    for (const key of KEYS) {
      expect(t("en", key), key).not.toBe(key);
      expect(t("hi", key), key).not.toBe(key);
    }
  });

  it("count strings carry the {n} slot and city strings the {city} slot", () => {
    expect(t("en", "listenHeroCountIdle")).toContain("{n}");
    expect(t("hi", "listenHeroCountIdle")).toContain("{n}");
    expect(t("en", "listenHeroCountIdle")).toContain("{city}");
    expect(t("en", "listenHeroGrowing")).toContain("{city}");
  });
});
