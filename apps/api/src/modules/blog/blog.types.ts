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

export const EDITORIAL_AUTHOR = {
  name: "Aditi Sharma",
  slug: "aditi-sharma",
  role: "Rental Markets Editor, Cribliv",
  bio_en:
    "Aditi Sharma covers India's rental markets for Cribliv, turning live listing data into practical guidance for tenants. She has tracked rents across Lucknow and the NCR since 2023.",
  bio_hi:
    "अदिति शर्मा Cribliv के लिए भारत के किराया बाज़ार पर लिखती हैं और लाइव लिस्टिंग डेटा को किरायेदारों के लिए व्यावहारिक सलाह में बदलती हैं।"
} as const;
