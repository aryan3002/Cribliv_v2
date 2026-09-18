import { describe, expect, it } from "vitest";

import { inrToPaise, paiseToInr, rateInrToPaise, ratePaiseToInr } from "../dto/money";
import { roundToRupee, splitLargestRemainder } from "../pure/rent-money";

describe("roundToRupee", () => {
  it("rounds half-up to the nearest 100 paise", () => {
    expect(roundToRupee(0)).toBe(0);
    expect(roundToRupee(149)).toBe(100);
    expect(roundToRupee(150)).toBe(200);
    expect(roundToRupee(570000)).toBe(570000);
    expect(roundToRupee(-150)).toBe(-100); // half-up towards +∞ for negatives too (discount lines)
  });
});

describe("splitLargestRemainder", () => {
  it("makes the parts sum exactly to the whole in rupee multiples", () => {
    expect(splitLargestRemainder(100000, 3)).toEqual([33400, 33300, 33300]);
    expect(splitLargestRemainder(100000, 1)).toEqual([100000]);
    expect(splitLargestRemainder(200, 3)).toEqual([100, 100, 0]);
    expect(splitLargestRemainder(89600, 4)).toEqual([22400, 22400, 22400, 22400]);
  });
  it("rejects a non-positive part count or a non-rupee total", () => {
    expect(() => splitLargestRemainder(100000, 0)).toThrow(RangeError);
    expect(() => splitLargestRemainder(100050, 2)).toThrow(RangeError);
  });
});

describe("dto/money", () => {
  it("converts whole rupees to paise and back", () => {
    expect(inrToPaise(9000)).toBe(900000);
    expect(paiseToInr(900000)).toBe(9000);
    expect(paiseToInr("900000")).toBe(9000);
    expect(paiseToInr(BigInt(900000))).toBe(9000);
  });
  it("rounds paise to the nearest rupee on the way out", () => {
    expect(paiseToInr(570049)).toBe(5700);
    expect(paiseToInr(570050)).toBe(5701);
  });
  it("refuses fractional or negative rupees on the way in", () => {
    expect(() => inrToPaise(12.5)).toThrow(RangeError);
    expect(() => inrToPaise(-1)).toThrow(RangeError);
    expect(inrToPaise(-1, { allowNegative: true })).toBe(-100);
  });
  it("carries the electricity rate as a two-place decimal", () => {
    expect(ratePaiseToInr(850)).toBe(8.5);
    expect(ratePaiseToInr(null)).toBeNull();
    expect(rateInrToPaise(8.5)).toBe(850);
    expect(rateInrToPaise(0.5)).toBe(50);
    expect(() => rateInrToPaise(8.555)).toThrow(RangeError);
  });
});
