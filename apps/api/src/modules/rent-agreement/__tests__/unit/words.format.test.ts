import { describe, expect, it } from "vitest";
import { numberToIndianWords } from "../../format/words.format";

describe("numberToIndianWords — contract examples", () => {
  const cases: Array<[number, string]> = [
    [0, "Zero"],
    [1, "One"],
    [15, "Fifteen"],
    [21, "Twenty One"],
    [100, "One Hundred"],
    [101, "One Hundred One"],
    [1000, "One Thousand"],
    [1234, "One Thousand Two Hundred Thirty Four"],
    [100000, "One Lakh"],
    [123456, "One Lakh Twenty Three Thousand Four Hundred Fifty Six"],
    [10000000, "One Crore"],
    [12345678, "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight"],
    [1000000000, "One Hundred Crore"]
  ];

  it.each(cases)("numberToIndianWords(%i) === %s", (input, expected) => {
    expect(numberToIndianWords(input)).toBe(expected);
  });
});

describe("numberToIndianWords — teens (10–19)", () => {
  const teens: Array<[number, string]> = [
    [10, "Ten"],
    [11, "Eleven"],
    [12, "Twelve"],
    [13, "Thirteen"],
    [14, "Fourteen"],
    [15, "Fifteen"],
    [16, "Sixteen"],
    [17, "Seventeen"],
    [18, "Eighteen"],
    [19, "Nineteen"]
  ];

  it.each(teens)("numberToIndianWords(%i) === %s", (input, expected) => {
    expect(numberToIndianWords(input)).toBe(expected);
  });
});

describe("numberToIndianWords — boundary transitions", () => {
  it("99 → Ninety Nine", () => {
    expect(numberToIndianWords(99)).toBe("Ninety Nine");
  });

  it("100 → One Hundred", () => {
    expect(numberToIndianWords(100)).toBe("One Hundred");
  });

  it("999 → Nine Hundred Ninety Nine", () => {
    expect(numberToIndianWords(999)).toBe("Nine Hundred Ninety Nine");
  });

  it("1000 → One Thousand", () => {
    expect(numberToIndianWords(1000)).toBe("One Thousand");
  });

  it("99999 → Ninety Nine Thousand Nine Hundred Ninety Nine", () => {
    expect(numberToIndianWords(99999)).toBe("Ninety Nine Thousand Nine Hundred Ninety Nine");
  });

  it("100000 → One Lakh", () => {
    expect(numberToIndianWords(100000)).toBe("One Lakh");
  });

  it("9999999 → Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine", () => {
    expect(numberToIndianWords(9999999)).toBe(
      "Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine"
    );
  });

  it("10000000 → One Crore", () => {
    expect(numberToIndianWords(10000000)).toBe("One Crore");
  });

  it("1000000 → Ten Lakh (one million in Indian English)", () => {
    expect(numberToIndianWords(1000000)).toBe("Ten Lakh");
  });
});

describe("numberToIndianWords — error cases", () => {
  it("throws on negative integer", () => {
    expect(() => numberToIndianWords(-1)).toThrow("amount must be non-negative");
  });

  it("throws on non-integer", () => {
    expect(() => numberToIndianWords(1.5)).toThrow("amount must be an integer");
  });

  it("throws on NaN", () => {
    expect(() => numberToIndianWords(Number.NaN)).toThrow("amount must be a finite integer");
  });

  it("throws on positive Infinity", () => {
    expect(() => numberToIndianWords(Number.POSITIVE_INFINITY)).toThrow(
      "amount must be a finite integer"
    );
  });

  it("throws on negative Infinity", () => {
    expect(() => numberToIndianWords(Number.NEGATIVE_INFINITY)).toThrow(
      "amount must be a finite integer"
    );
  });
});
