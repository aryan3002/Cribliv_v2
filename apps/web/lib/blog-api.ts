import { fetchApi } from "./api";

// Client for the public blog API (GET /blog, GET /blog/:slug). Mirrors the
// server BlogService row shapes. All reads are server-side + ISR (the pages set
// `export const revalidate`), so we pass { server: true } like the other
// programmatic pages.

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

export interface BlogFaqItem {
  q: string;
  a: string;
}

export interface BlogSource {
  label: string;
  url?: string | null;
  asof?: string | null;
}

export interface BlogPostDetail {
  id: string;
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  body_en: string | null;
  body_hi: string | null;
  target_keyword: string | null;
  city_slug: string | null;
  category_slug: string | null;
  hero_image_path: string | null;
  author: string;
  sources: BlogSource[];
  faq_items: BlogFaqItem[];
  data_asof: string | null;
  published_at: string | null;
  updated_at: string;
}

export interface BlogRelated {
  slug: string;
  title: string;
}

export async function fetchBlogList(
  params: {
    page?: number;
    page_size?: number;
    category?: string;
    city?: string;
  } = {}
): Promise<{ items: BlogListItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  if (params.category) qs.set("category", params.category);
  if (params.city) qs.set("city", params.city);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    return await fetchApi<{ items: BlogListItem[]; total: number }>(`/blog${suffix}`, undefined, {
      server: true
    });
  } catch {
    return { items: [], total: 0 };
  }
}

export async function fetchBlogPost(
  slug: string
): Promise<{ post: BlogPostDetail; related: BlogRelated[] } | null> {
  try {
    const data = await fetchApi<{ post: BlogPostDetail; related: BlogRelated[] } | null>(
      `/blog/${encodeURIComponent(slug)}`,
      undefined,
      { server: true }
    );
    return data ?? null;
  } catch {
    return null;
  }
}

export async function fetchAllBlogSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  try {
    for (let page = 1; page <= 20; page += 1) {
      const { items, total } = await fetchBlogList({ page, page_size: 50 });
      for (const item of items) slugs.push(item.slug);
      if (items.length === 0 || page * 50 >= total) break;
    }
  } catch {
    // best-effort — sitemap/static params degrade to what we have
  }
  return slugs;
}
