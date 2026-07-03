import { resolveChunkCount } from "../sitemap";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const count = await resolveChunkCount();
  const now = new Date().toISOString();
  const entries = Array.from(
    { length: count },
    (_, id) =>
      `  <sitemap><loc>${BASE_URL}/sitemap/${id}.xml</loc><lastmod>${now}</lastmod></sitemap>`
  ).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml"
    }
  });
}
