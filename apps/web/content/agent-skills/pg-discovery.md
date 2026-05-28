---
name: pg-discovery
description: Discover paying-guest (PG) accommodations on Cribliv by city, locality, gender, and tenant type.
version: 0.1.0
---

# Find PGs (paying-guest accommodations)

PGs are first-class on Cribliv and modeled separately from flats/houses, but they
share the same search endpoint with `intent=pg-*` slugs.

## JSON API

```
GET /v1/listings/search?intent=pg-for-students&city={city}
GET /v1/listings/search?intent=pg-for-working-professionals&city={city}
```

Filterable attributes for PGs include:

- `gender`: `male`, `female`, `unisex`
- `tenant_type`: `students`, `working_professionals`, `family`
- `meals_included`: `boolean`

## HTML surface

| Goal        | URL pattern                                            |
| ----------- | ------------------------------------------------------ |
| PG detail   | `/{locale}/pg/{id}`                                    |
| PG city hub | `/{locale}/city/{city_slug}` (filter to PGs in the UI) |

## Notes

- PG segments have richer metadata at `POST /v1/pg/segment` (operator-only,
  not exposed for public agents).
- Use `intent` slug filtering rather than a dedicated `/pgs` endpoint.
