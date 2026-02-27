import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/en/tenant/",
          "/en/owner/",
          "/en/admin/",
          "/hi/tenant/",
          "/hi/owner/",
          "/hi/admin/"
        ]
      }
    ],
    sitemap: `${BASE_URL}/sitemap.xml`
  };
}
