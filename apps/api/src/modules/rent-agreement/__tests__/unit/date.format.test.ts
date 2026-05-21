import { describe, expect, it, test } from "vitest";
import { formatLegalDate } from "../../format/date.format";

describe("formatLegalDate", () => {
  describe("ordinal suffixes", () => {
    test.each([
      ["2026-01-01", "1st January, 2026"],
      ["2026-01-02", "2nd January, 2026"],
      ["2026-01-03", "3rd January, 2026"],
      ["2026-01-04", "4th January, 2026"],
      ["2026-01-05", "5th January, 2026"],
      ["2026-01-10", "10th January, 2026"],
      ["2026-01-11", "11th January, 2026"],
      ["2026-01-12", "12th January, 2026"],
      ["2026-01-13", "13th January, 2026"],
      ["2026-01-14", "14th January, 2026"],
      ["2026-01-20", "20th January, 2026"],
      ["2026-01-21", "21st January, 2026"],
      ["2026-01-22", "22nd January, 2026"],
      ["2026-01-23", "23rd January, 2026"],
      ["2026-01-24", "24th January, 2026"],
      ["2026-01-30", "30th January, 2026"],
      ["2026-01-31", "31st January, 2026"]
    ])("formats %s as %s", (input, expected) => {
      expect(formatLegalDate(input)).toBe(expected);
    });
  });

  describe("month names", () => {
    test.each([
      ["2026-01-15", "15th January, 2026"],
      ["2026-02-15", "15th February, 2026"],
      ["2026-03-15", "15th March, 2026"],
      ["2026-04-15", "15th April, 2026"],
      ["2026-05-15", "15th May, 2026"],
      ["2026-06-15", "15th June, 2026"],
      ["2026-07-15", "15th July, 2026"],
      ["2026-08-15", "15th August, 2026"],
      ["2026-09-15", "15th September, 2026"],
      ["2026-10-15", "15th October, 2026"],
      ["2026-11-15", "15th November, 2026"],
      ["2026-12-15", "15th December, 2026"],
      ["2026-12-31", "31st December, 2026"]
    ])("formats %s as %s", (input, expected) => {
      expect(formatLegalDate(input)).toBe(expected);
    });
  });

  describe("leap year handling", () => {
    it("accepts Feb 29 in a leap year (2024)", () => {
      expect(formatLegalDate("2024-02-29")).toBe("29th February, 2024");
    });

    it("throws for Feb 29 in a non-leap year (2026)", () => {
      expect(() => formatLegalDate("2026-02-29")).toThrow("invalid date");
    });

    it("throws for Feb 30", () => {
      expect(() => formatLegalDate("2024-02-30")).toThrow("invalid date");
    });

    it("throws for April 31", () => {
      expect(() => formatLegalDate("2026-04-31")).toThrow("invalid date");
    });
  });

  describe("timestamp form", () => {
    it("accepts full ISO timestamp and uses UTC date only", () => {
      expect(formatLegalDate("2026-01-01T15:30:00.000Z")).toBe("1st January, 2026");
    });

    it("does not shift dates by local timezone at midnight UTC", () => {
      expect(formatLegalDate("2026-01-01T00:00:00.000Z")).toBe("1st January, 2026");
    });

    it("handles late-day timestamps without rolling over", () => {
      expect(formatLegalDate("2026-12-31T23:59:59.999Z")).toBe("31st December, 2026");
    });
  });

  describe("invalid inputs", () => {
    it("throws on non-date string", () => {
      expect(() => formatLegalDate("not-a-date")).toThrow("invalid date");
    });

    it("throws on empty string", () => {
      expect(() => formatLegalDate("")).toThrow("invalid date");
    });

    it("throws on garbage that Date can't parse", () => {
      expect(() => formatLegalDate("2026-13-01")).toThrow("invalid date");
    });

    it("throws on malformed prefix", () => {
      expect(() => formatLegalDate("26-1-1")).toThrow("invalid date");
    });
  });
});
