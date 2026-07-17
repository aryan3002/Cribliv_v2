import { NextResponse } from "next/server";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

/**
 * Agent Card — the canonical entry point an AI agent lands on after resolving
 * Cribliv via DNS for AI Discovery (DNS-AID, draft-mozleywilliams-dnsop-dnsaid).
 *
 * The `_index._agents.cribliv.com` SVCB record carries `well-known=agent-card.json`,
 * which per RFC 8615 resolves to this document. It is a discovery manifest, not an
 * A2A service endpoint: Cribliv exposes its tool surface as WebMCP (in-page,
 * navigator.modelContext.provideContext) plus a read-only public HTTP API. There
 * is no A2A (Agent2Agent) JSON-RPC endpoint, so this card links out to the
 * machine-readable surfaces an agent can actually use rather than advertising a
 * task endpoint that would fail.
 *
 * See docs/agent-discovery/dns-aid-runbook.md for the DNS records this backs.
 */
export const dynamic = "force-static";

export function GET() {
  const body = {
    name: "Cribliv",
    description:
      "Rental and PG (paying-guest) accommodation marketplace for India. Search listings and PGs by city, intent, and budget over a read-only public HTTP API or in-page WebMCP tools.",
    homepage: SITE_URL,
    version: "0.1.0",
    provider: {
      organization: "Cribliv",
      url: SITE_URL,
      contact: `${SITE_URL}/contact`
    },
    interaction: {
      webmcp: {
        url: `${SITE_URL}/`,
        description:
          "Read-only tool surface exposed via the WebMCP API (navigator.modelContext.provideContext) on every public page."
      },
      httpApi: {
        base: `${SITE_URL}/v1`,
        openapi: `${SITE_URL}/v1/openapi.json`,
        health: `${SITE_URL}/v1/health`,
        auth: "none — public read-only endpoints"
      }
    },
    discovery: {
      apiCatalog: `${SITE_URL}/.well-known/api-catalog`,
      mcpServerCard: `${SITE_URL}/.well-known/mcp/server-card.json`,
      agentSkills: `${SITE_URL}/.well-known/agent-skills/index.json`
    },
    capabilities: {
      tools: [
        { name: "search_listings", description: "Search rentals by city/intent/budget" },
        { name: "open_listing", description: "Navigate to a listing detail page" },
        { name: "list_pgs", description: "List PGs for a city/intent" },
        { name: "open_pg", description: "Navigate to a PG detail page" },
        { name: "navigate", description: "Navigate the active tab to a Cribliv URL" }
      ]
    },
    note: "Cribliv does not expose an A2A (Agent2Agent) JSON-RPC endpoint. Use the WebMCP surface or the public HTTP API described above."
  };

  return new NextResponse(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
