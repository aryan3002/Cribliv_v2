import { ConfidenceTier } from "./owner.capture.types";

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export function normalizeDigits(input: string): string {
  return input.replace(/[०-९]/g, (char) => String(DEVANAGARI_DIGITS.indexOf(char)));
}

export function parseIndianNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }

  if (typeof raw !== "string") {
    return undefined;
  }

  const normalized = normalizeDigits(raw.trim().toLowerCase());
  if (!normalized) {
    return undefined;
  }

  const cleaned = normalized
    .replace(/,/g, "")
    .replace(/₹|rs\.?|inr/g, "")
    .trim();
  const numberMatch = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!numberMatch) {
    return undefined;
  }

  const value = Number(numberMatch[1]);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const hasThousandUnit = /(k\b|thousand|हजार|हज़ार)/.test(cleaned);
  if (hasThousandUnit) {
    return Math.floor(value * 1000);
  }

  const hasLakhUnit = /(l\b|lac\b|lakh|लाख)/.test(cleaned);
  if (hasLakhUnit) {
    return Math.floor(value * 100000);
  }

  return Math.floor(value);
}

export function toConfidenceTier(score: number | undefined): ConfidenceTier {
  if (!Number.isFinite(score)) {
    return "medium";
  }
  if ((score as number) > 0.85) {
    return "high";
  }
  if ((score as number) < 0.6) {
    return "low";
  }
  return "medium";
}

export function normalizeWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function slugify(raw: string): string {
  return normalizeWhitespace(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function parseBooleanLike(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (["true", "yes", "1", "included"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0", "not_included"].includes(normalized)) {
    return false;
  }
  return undefined;
}
