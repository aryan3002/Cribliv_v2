export type BlogStatus =
  | "brief"
  | "generating"
  | "draft"
  | "needs_attention"
  | "in_review"
  | "published"
  | "archived";

export type BlogGeneratedBy = "planner" | "manual" | "refresh" | "pillar";
export type BlogScript = "en" | "hi" | "hinglish";
export type BriefSource = "gsc_quickwin" | "gap" | "data_trend" | "evergreen" | "manual";
export type BriefStatus = "pending" | "generating" | "done" | "dropped";
export type BlogPostType = "data_report" | "local_guide" | "evergreen" | "query_targeted";

export interface BlogFaqItem {
  q: string;
  a: string;
}

export interface BlogSource {
  label: string;
  url?: string | null;
  asof?: string | null;
}

export interface BlogDataPoint {
  key: string;
  label: string;
  value: number | string;
  unit?: string | null;
}

export interface QualityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  value?: number | string | null;
  threshold?: number | string | null;
}

export interface QualityBreakdown {
  score: number;
  passed: boolean;
  checks: QualityCheck[];
}

export interface BlogPostRow {
  id: string;
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  body_en: string | null;
  body_hi: string | null;
  target_keyword: string | null;
  intent: string | null;
  city_slug: string | null;
  category_id: number | null;
  category_slug?: string | null;
  status: BlogStatus;
  generated_by: BlogGeneratedBy;
  quality_score: number | null;
  quality_breakdown: QualityBreakdown | Record<string, never>;
  faq_items: BlogFaqItem[];
  hero_image_path: string | null;
  author: string;
  sources: BlogSource[];
  data_asof: string | null;
  script: BlogScript;
  is_pillar: boolean;
  brief_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogBriefRow {
  id: string;
  target_keyword: string;
  intent: string | null;
  outline: Array<{ heading: string; subheadings?: string[] }>;
  required_data: BlogDataPoint[];
  internal_link_targets: Array<{ href: string; label: string }>;
  source: BriefSource;
  status: BriefStatus;
  city_slug: string | null;
  category_slug: string | null;
  post_type: BlogPostType;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogListItem {
  slug: string;
  title: string;
  excerpt: string | null;
  category_slug: string | null;
  city_slug: string | null;
  hero_image_path: string | null;
  author: string;
  published_at: string | null;
  data_asof: string | null;
}

// The byline is the desk, not a persona (2026-08 rebrand, migration 0070):
// reports come from live listing data with AI assistance and human review, and
// the byline says so. Mirrors apps/web/lib/blog-author.ts.
export const EDITORIAL_AUTHOR = {
  name: "Cribliv Data Desk",
  slug: "cribliv-data-desk",
  role: "The data desk of Cribliv Times",
  bio_en:
    "The Cribliv Data Desk turns live listing data into rent reports, locality guides and tenant-rights explainers for renters across India. Every figure is sourced from listings live on Cribliv; reports are produced with AI assistance and reviewed by the Cribliv team before publishing.",
  bio_hi:
    "Cribliv डेटा डेस्क लाइव लिस्टिंग डेटा को किराया रिपोर्ट, इलाके की गाइड और किरायेदार-अधिकार लेखों में बदलता है। हर आँकड़ा Cribliv पर लाइव लिस्टिंग से आता है।"
} as const;
