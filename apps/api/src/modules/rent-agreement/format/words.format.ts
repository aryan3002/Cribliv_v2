/** Converts a non-negative integer rupee amount to Indian English words. */

const ONES: readonly string[] = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine"
];

const TEENS: readonly string[] = [
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];

const TENS: readonly string[] = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety"
];

function twoDigitsToWords(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const rem = n % 10;
  return rem === 0 ? TENS[tens] : `${TENS[tens]} ${ONES[rem]}`;
}

function threeDigitsToWords(n: number): string {
  if (n < 100) return twoDigitsToWords(n);
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  const head = `${ONES[hundreds]} Hundred`;
  return rem === 0 ? head : `${head} ${twoDigitsToWords(rem)}`;
}

export function numberToIndianWords(rupees: number): string {
  if (typeof rupees !== "number" || Number.isNaN(rupees) || !Number.isFinite(rupees)) {
    throw new Error("amount must be a finite integer");
  }
  if (!Number.isInteger(rupees)) {
    throw new Error("amount must be an integer");
  }
  if (rupees < 0) {
    throw new Error("amount must be non-negative");
  }
  if (rupees === 0) return "Zero";

  const crore = Math.floor(rupees / 10000000);
  const afterCrore = rupees % 10000000;
  const lakh = Math.floor(afterCrore / 100000);
  const afterLakh = afterCrore % 100000;
  const thousand = Math.floor(afterLakh / 1000);
  const remainder = afterLakh % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitsToWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitsToWords(thousand)} Thousand`);
  if (remainder > 0) parts.push(threeDigitsToWords(remainder));

  return parts.join(" ");
}
