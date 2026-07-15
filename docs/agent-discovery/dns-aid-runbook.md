# DNS for AI Discovery (DNS-AID) — publishing runbook

Publishing the `_agents` DNS entry point that lets an agent discover Cribliv's
machine-readable surface via DNS instead of guessing well-known URLs. This is the
one layer of the agent-discovery program that lives in the **DNS zone**, not in
this repo — the app can only serve the document the record points at.

> Backs the `isitagentready.com` check `checks.discoverability.dnsAid`.

## Maturity caveat — read first

`draft-mozleywilliams-dnsop-dnsaid` is an **individual** Internet-Draft: not
working-group-adopted, no RFC stream, no intended status. Real-world resolver/agent
adoption outside the checker itself is minimal today. Treat this as speculative,
low-priority optimization — the HTTP discovery surface (`api-catalog`,
`mcp/server-card.json`, `agent-skills`, `agent-card.json`) is what actually gets
used. Ship this only if you specifically want the checker item green.

## Current state (2026-07-15)

- **DNS host:** GoDaddy (`ns21/ns22.domaincontrol.com`). Apex → Vercel (`216.198.79.1`).
- **DNSSEC:** not enabled (no DS record at the registry).
- **`_agents` records:** none published.
- **What the record will point at:** `/.well-known/agent-card.json` (added in this
  repo — see [`route.ts`](../../apps/web/app/.well-known/agent-card.json/route.ts)),
  itself linking `api-catalog`, `mcp/server-card.json`, and the agent-skills index.

## The records to publish

Cribliv speaks HTTPS (WebMCP + read API), **not** the A2A protocol, so this is an
`_index` entry point with a normal HTTPS ALPN — not an `_a2a` record with
`alpn="a2a"`.

```
; Portable core — alpn + port are IANA-registered SvcParamKeys, accepted by any
; SVCB-aware DNS provider. Sufficient for the checker to find a valid record.
_index._agents.cribliv.com.  3600  IN  SVCB  1  cribliv.com.  alpn="h2,http/1.1" port=443

; Richer draft form — adds the entry-point path. `well-known` resolves per RFC 8615
; to https://cribliv.com/.well-known/agent-card.json
_index._agents.cribliv.com.  3600  IN  SVCB  1  cribliv.com.  alpn="h2,http/1.1" port=443 well-known="agent-card.json"
```

**Caveat on `well-known`:** it (and `cap` / `cap-sha256`) are draft-proposed,
**not yet IANA-registered** SvcParamKeys. Many DNS UIs/parsers reject unknown
symbolic keys or require the numeric `keyNNNNN=` alias. If the rich form is
rejected, publish the portable core — an agent that finds the record will still
fall back to fetching `/.well-known/agent-card.json` by convention.

## Steps

1. **Confirm SVCB (type 64) support in the GoDaddy DNS manager.** If the
   record-type dropdown has no SVCB/HTTPS option, move the zone to a provider that
   supports SVCB **and** one-click DNSSEC — **Vercel DNS** (already the deploy
   target) or **Cloudflare** are the low-friction choices. GoDaddy has publicly
   backed these agent-discovery standards, so support may be present — verify in
   the UI before assuming a migration is needed.
2. **Add the record.** Name `_index._agents`, type `SVCB`, TTL `3600`, value as
   above (start with the portable core).
3. **Enable DNSSEC** on the zone. The draft says _SHOULD_ (only _MUST_ if you also
   publish TLSA records), so the record resolves without it — validating resolvers
   just won't get authenticated data. It's a one-time toggle at the zone holder;
   after enabling, confirm the DS record propagated to the registry.
4. **Validate** (below), then re-run the `isitagentready.com` check.

## Validation

```bash
# The SVCB record exists and parses
dig +short SVCB _index._agents.cribliv.com

# The document it points at is live
curl -sfL https://cribliv.com/.well-known/agent-card.json | jq .name   # -> "Cribliv"

# DNSSEC chain (DS present at registry, AD flag set by a validating resolver)
dig +short DS cribliv.com
dig +dnssec +multi SVCB _index._agents.cribliv.com | grep -q 'flags:.* ad' && echo "authenticated"
```

Checker: a `"pass"` in `checks.discoverability.dnsAid` of the isitagentready.com
API response.

## Rollback

Delete the `_index._agents` SVCB record. DNSSEC, once enabled, is best left on;
if it must be reverted, disable it at the zone holder **and** remove the DS record
at the registry in the same change to avoid a broken chain / SERVFAIL.

## References

- Draft: https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/
- SVCB/HTTPS RRs: https://www.rfc-editor.org/rfc/rfc9460
- Well-known URIs: https://www.rfc-editor.org/rfc/rfc8615
- Skill: https://isitagentready.com/.well-known/agent-skills/dns-aid/SKILL.md
