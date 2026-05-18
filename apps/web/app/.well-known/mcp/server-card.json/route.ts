import { NextResponse } from "next/server";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

/**
 * MCP Server Card (SEP-1649 / modelcontextprotocol PR #2127).
 *
 * Cribliv currently exposes its tool surface as WebMCP (in-page,
 * navigator.modelContext.provideContext) plus a public read API. There is no
 * separate MCP HTTP/stdio server process today, so the card advertises the
 * WebMCP transport at the homepage URL.
 */
export const dynamic = "force-static";

export function GET() {
  const body = {
    $schema: "https://modelcontextprotocol.io/schemas/server-card.json",
    serverInfo: {
      name: "cribliv",
      version: "0.1.0",
      vendor: "Cribliv",
      homepage: SITE_URL,
      contact: {
        name: "Cribliv Engineering",
        url: `${SITE_URL}/contact`
      }
    },
    transport: {
      type: "webmcp",
      url: `${SITE_URL}/`,
      description:
        "Cribliv exposes its read-only tool surface via the WebMCP API (navigator.modelContext.provideContext) on every public page. There is no separate MCP HTTP server."
    },
    capabilities: {
      tools: [
        { name: "search_listings", description: "Search rentals by city/intent/budget" },
        { name: "open_listing", description: "Navigate to a listing detail page" },
        { name: "list_pgs", description: "List PGs for a city/intent" },
        { name: "open_pg", description: "Navigate to a PG detail page" },
        { name: "navigate", description: "Navigate the active tab to a Cribliv URL" }
      ],
      resources: [
        { uri: `${SITE_URL}/v1/openapi.json`, mimeType: "application/openapi+json" },
        { uri: `${SITE_URL}/.well-known/agent-skills/index.json`, mimeType: "application/json" },
        { uri: `${SITE_URL}/.well-known/api-catalog`, mimeType: "application/linkset+json" }
      ]
    },
    documentation: `${SITE_URL}/docs/api`
  };

  return new NextResponse(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
