---
name: search-listings
description: Search verified rental listings on Cribliv by city, locality, intent, budget, and BHK.
version: 0.1.0
---

# Search listings on Cribliv

Cribliv exposes listing search through both an HTML browse surface and a public JSON
endpoint. Use whichever fits your channel.

## JSON API

```
GET /v1/listings/search
  ?city={city_slug}
  &locality={locality_slug}
  &intent={intent_slug}
  &budget_min={int}
  &budget_max={int}
  &bhk={1|2|3|4+}
  &page={int}
  &page_size={int <= 50}
```

- All parameters are optional except — practically — `city`.
- `intent` slugs come from the `service-doc` (e.g. `flat-on-rent`, `pg-for-students`,
  `family-housing`). The full list is in `/v1/openapi.json` under
  `components.schemas`.
- Responses are wrapped in the standard envelope `{ ok: true, data: { results, total, page, page_size } }`.

## HTML surface (deep links)

| Goal              | URL pattern                                                   |
| ----------------- | ------------------------------------------------------------- |
| City hub          | `/{locale}/city/{city_slug}`                                  |
| Search results    | `/{locale}/search?city={city}&intent={intent}&budget_max={n}` |
| Locality page     | `/{locale}/city/{city}/{locality}`                            |
| Locality + intent | `/{locale}/city/{city}/{locality}/{intent}`                   |
| Near a landmark   | `/{locale}/city/{city}/near/{landmark}`                       |
| Near a metro stop | `/{locale}/city/{city}/metro/{station}`                       |

`{locale}` is `en` or `hi`. All HTML pages support `Accept: text/markdown` for an
agent-friendly response (see the `markdown-negotiation` skill).

## Recommended flow

1. Resolve the user's city to a slug (case-insensitive, `-` separated).
2. Call `/v1/listings/search` with the highest-signal filters first.
3. Cite individual listings using `/{locale}/listing/{id}` URLs.
