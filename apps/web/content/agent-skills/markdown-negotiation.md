---
name: markdown-negotiation
description: Cribliv returns markdown versions of public HTML pages when the agent sends Accept text/markdown.
version: 0.1.0
---

# Markdown for agents

Any public Cribliv URL on the marketing surface (homepage, city, locality,
listing detail, PG detail, about/faq/pricing/terms/privacy/how-it-works/become-owner)
will return a markdown response when the request includes:

```
Accept: text/markdown
```

The response carries:

- `Content-Type: text/markdown; charset=utf-8`
- `x-markdown-tokens: <int>` — coarse token estimate (chars / 4)
- `Vary: Accept`

If markdown is requested for a route that does not have a hand-authored or
auto-generated markdown rendering yet, the server falls back to a 406-equivalent
plain markdown stub pointing at the JSON API.

## When to use

- Grounding LLM responses with citations to specific Cribliv pages.
- Indexing Cribliv content for retrieval without parsing HTML.

## When NOT to use

- Authenticated dashboards (`/tenant/*`, `/owner/*`, `/admin/*`) — no markdown
  variant is available.
- Image-heavy listing previews — fetch photos directly via the URLs in the JSON
  API instead.
