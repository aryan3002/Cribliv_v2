import { NextResponse } from "next/server";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

/**
 * RFC 9727 API Catalog — application/linkset+json (RFC 9264).
 *
 * Anchors point at the API base; each linked resource carries the IANA-registered
 * link relation type so an agent can pick the one it understands without having
 * to scrape any docs.
 */
export const dynamic = "force-static";

export function GET() {
  const body = {
    linkset: [
      {
        anchor: `${SITE_URL}/v1`,
        "service-desc": [
          {
            href: `${SITE_URL}/v1/openapi.json`,
            type: "application/openapi+json",
            title: "Cribliv Public API — OpenAPI 3.1"
          }
        ],
        "service-doc": [
          {
            href: `${SITE_URL}/docs/api`,
            type: "text/html",
            title: "Cribliv API documentation"
          },
          {
            href: `${SITE_URL}/.well-known/agent-skills/index.json`,
            type: "application/json",
            title: "Agent Skills index"
          }
        ],
        status: [
          {
            href: `${SITE_URL}/v1/health`,
            type: "application/json",
            title: "Service health"
          }
        ]
      }
    ]
  };

  return new NextResponse(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/linkset+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
