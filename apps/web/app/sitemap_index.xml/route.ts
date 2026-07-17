import { buildSitemapIndexXml } from "../sitemap-chunks";
import { resolveChunkCount } from "../sitemap";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const count = await resolveChunkCount();

  return new Response(buildSitemapIndexXml(BASE_URL, count), {
    headers: {
      "Content-Type": "application/xml"
    }
  });
}
