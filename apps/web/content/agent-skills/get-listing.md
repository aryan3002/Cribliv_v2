---
name: get-listing
description: Fetch a single Cribliv listing by ID (price, address, BHK, photos, verification status).
version: 0.1.0
---

# Fetch a listing

```
GET /v1/listings/{listing_id}
```

`listing_id` is a UUID. Returns the standard envelope:

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "title": "string",
    "price_inr": 18000,
    "bhk": "2",
    "address": "string",
    "city_slug": "lucknow",
    "locality_slug": "gomti-nagar",
    "photos": ["https://.../photo.jpg"],
    "verified": true
  }
}
```

`verified: true` means an owner-verified listing (12-hour refund guarantee).

## Related

- `GET /v1/listings/{listing_id}/similar` — up to 10 similar listings.
- HTML detail page: `/{locale}/listing/{id}` (supports `Accept: text/markdown`).
