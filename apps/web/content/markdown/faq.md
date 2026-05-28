# Frequently Asked Questions

## Is Cribliv really broker-free?

Yes. Owners list directly. Tenants contact owners directly. We don't take a
brokerage cut.

## What's the 12-hour refund guarantee?

If you book a property and decide it's not for you within 12 hours of payment,
we refund the booking amount in full. The owner is informed and the listing
re-opened.

## How are owners verified?

We collect government ID (Aadhaar) and a property ownership document
(registry, electricity bill, sale deed). Listings are flagged "Verified" only
after both checks pass.

## Where do you operate?

Delhi NCR, Chandigarh, Jaipur, and Lucknow today. We're expanding to more
North Indian cities.

## How do PGs differ from flats?

PGs are room-shared accommodations operated by a single owner. Cribliv treats
PGs as first-class — see `/en/pg` and the `pg-discovery` agent skill.

## Can AI agents use Cribliv programmatically?

Yes. We publish:

- An OpenAPI 3.1 spec at `/v1/openapi.json`
- An API catalog at `/.well-known/api-catalog`
- An Agent Skills index at `/.well-known/agent-skills/index.json`
- An MCP server card at `/.well-known/mcp/server-card.json`
- WebMCP tools on every public page (`navigator.modelContext.provideContext`)

All marketing pages also support `Accept: text/markdown` for grounded retrieval.
