import type { BlogFaqItem, BlogSource, QualityBreakdown, QualityCheck } from "./blog.types";

export const MIN_WORDS = 900;
export const MIN_WORDS_DATA = 1200;
export const MIN_DATA_POINTS_DATA = 3;
export const MIN_INTERNAL_LINKS = 3;
export const UNIQUENESS_MIN_DISTANCE = 0.15;
export const MAX_KEYWORD_DENSITY = 0.03;

export const BANNED_PHRASES = [
  "as an ai",
  "in conclusion",
  "it's important to note",
  "as a language model",
  "lorem ipsum",
  "todo",
  "tbd"
];

const PROGRAMMATIC_PREFIXES = ["/city/", "/rent-in/", "/pg/", "/blog/"];
const GAP_WORDS = new Set(["in", "at", "near", "for", "the", "a", "an"]);

export interface QualityInput {
  title: string;
  h1: string;
  bodyHtml: string;
  targetKeyword: string;
  faqItems: BlogFaqItem[];
  sources: BlogSource[];
  isDataPost: boolean;
  citedDataPointCount: number;
  uniquenessDistance: number | null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsForMatching(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function keywordWords(keyword: string): string[] {
  return wordsForMatching(keyword).filter((word) => !GAP_WORDS.has(word));
}

function containsKeyword(text: string, keyword: string): boolean {
  const haystack = wordsForMatching(text);
  const needles = keywordWords(keyword);
  if (needles.length === 0) return false;

  let needleIndex = 0;
  for (const word of haystack) {
    if (word === needles[needleIndex]) {
      needleIndex++;
      if (needleIndex === needles.length) return true;
      continue;
    }
    if (needleIndex > 0 && !GAP_WORDS.has(word)) {
      needleIndex = word === needles[0] ? 1 : 0;
    }
  }
  return false;
}

export function countWords(html: string): number {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    hrefs.push(match[1].trim());
  }
  return hrefs;
}

export function countInternalLinks(html: string): number {
  return extractHrefs(html).filter((href) => {
    if (!href.startsWith("/")) return false;
    if (href.startsWith("//")) return false;
    if (href.startsWith("/#")) return false;
    return true;
  }).length;
}

export function countProgrammaticLinks(html: string): number {
  return extractHrefs(html).filter((href) =>
    PROGRAMMATIC_PREFIXES.some((prefix) => href.startsWith(prefix))
  ).length;
}

export function countCitedDataPoints(html: string, sources: BlogSource[]): number {
  if (sources.length === 0) return 0;
  const text = stripHtml(html);
  const rupeeFigures = text.match(/₹\s?[\d,]+/g) ?? [];
  const percentages = text.match(/\b\d+(?:\.\d+)?\s?%/g) ?? [];
  const sourcedCounts =
    text.match(/\b\d{2,}\b(?=[^.]{0,50}\b(?:listings|median|rent|deposit|bhk|sq\s?ft)\b)/gi) ?? [];
  return rupeeFigures.length + percentages.length + sourcedCounts.length;
}

export function keywordDensity(text: string, keyword: string): number {
  const words = wordsForMatching(text);
  const needles = keywordWords(keyword);
  if (words.length === 0 || needles.length === 0) return 0;

  let hits = 0;
  for (let i = 0; i + needles.length <= words.length; i++) {
    if (needles.every((word, offset) => words[i + offset] === word)) {
      hits++;
    }
  }
  return (hits * needles.length) / words.length;
}

function firstWords(html: string, count: number): string {
  return stripHtml(html).split(/\s+/).slice(0, count).join(" ");
}

function check(
  id: string,
  label: string,
  passed: boolean,
  detail: string,
  value?: number | string | null,
  threshold?: number | string | null
): QualityCheck {
  return { id, label, passed, detail, value, threshold };
}

export function qualityScore(input: QualityInput): QualityBreakdown {
  const plain = stripHtml(input.bodyHtml);
  const lower = plain.toLowerCase();
  const wordCount = countWords(input.bodyHtml);
  const minWords = input.isDataPost ? MIN_WORDS_DATA : MIN_WORDS;
  const internalLinks = countInternalLinks(input.bodyHtml);
  const programmaticLinks = countProgrammaticLinks(input.bodyHtml);
  const density = keywordDensity(plain, input.targetKeyword);
  const banned = BANNED_PHRASES.filter((phrase) => lower.includes(phrase));
  const intro = firstWords(input.bodyHtml, 100);
  const uniquenessPassed =
    input.uniquenessDistance === null || input.uniquenessDistance >= UNIQUENESS_MIN_DISTANCE;

  const checks: QualityCheck[] = [
    check(
      "word_count",
      "Minimum word count",
      wordCount >= minWords,
      `${wordCount} words (need >= ${minWords})`,
      wordCount,
      minWords
    ),
    check(
      "internal_links",
      "Internal links into site pages",
      internalLinks >= MIN_INTERNAL_LINKS && programmaticLinks >= MIN_INTERNAL_LINKS,
      `${internalLinks} internal links, ${programmaticLinks} programmatic links`,
      internalLinks,
      MIN_INTERNAL_LINKS
    ),
    check(
      "data_points",
      input.isDataPost ? "Cited real data points" : "Cited sources",
      input.isDataPost
        ? input.citedDataPointCount >= MIN_DATA_POINTS_DATA
        : input.sources.length >= 1,
      input.isDataPost
        ? `${input.citedDataPointCount} cited data points (need >= ${MIN_DATA_POINTS_DATA})`
        : `${input.sources.length} sources (need >= 1)`,
      input.isDataPost ? input.citedDataPointCount : input.sources.length,
      input.isDataPost ? MIN_DATA_POINTS_DATA : 1
    ),
    check(
      "banned_phrases",
      "No placeholder / hedge / AI phrases",
      banned.length === 0,
      banned.length === 0 ? "Clean" : `Found: ${banned.join(", ")}`
    ),
    check(
      "keyword_placement",
      "Target keyword in title, H1, and first 100 words",
      containsKeyword(input.title, input.targetKeyword) &&
        containsKeyword(input.h1, input.targetKeyword) &&
        containsKeyword(intro, input.targetKeyword),
      `title=${containsKeyword(input.title, input.targetKeyword)} h1=${containsKeyword(
        input.h1,
        input.targetKeyword
      )} intro=${containsKeyword(intro, input.targetKeyword)}`
    ),
    check(
      "keyword_stuffing",
      "Keyword not stuffed",
      density <= MAX_KEYWORD_DENSITY,
      `density ${(density * 100).toFixed(2)}% (max ${(MAX_KEYWORD_DENSITY * 100).toFixed(0)}%)`,
      Number(density.toFixed(4)),
      MAX_KEYWORD_DENSITY
    ),
    check(
      "uniqueness",
      "Sufficiently distinct from existing posts",
      uniquenessPassed,
      input.uniquenessDistance === null
        ? "No existing posts to compare"
        : `cosine distance ${input.uniquenessDistance.toFixed(3)} (need >= ${UNIQUENESS_MIN_DISTANCE})`,
      input.uniquenessDistance,
      UNIQUENESS_MIN_DISTANCE
    )
  ];

  const passed = checks.every((item) => item.passed);
  const score = checks.length > 0 ? checks.filter((item) => item.passed).length / checks.length : 0;
  return { score: Number(score.toFixed(3)), passed, checks };
}
