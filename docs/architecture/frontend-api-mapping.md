# Frontend API Mapping (Phase 1 Recovery)

This document freezes the frontend-to-backend mapping for owner/admin flows.

## Owner Listings

### `POST /v1/owner/listings`

Request:

```json
{
  "listing_type": "flat_house|pg",
  "title": "string",
  "description": "string",
  "rent": 25000,
  "deposit": 50000,
  "location": {
    "city": "noida",
    "locality": "sector-62",
    "address_line1": "...",
    "landmark": "...",
    "pincode": "201309",
    "masked_address": "Sector 62"
  },
  "property_fields": {
    "bhk": 2,
    "bathrooms": 2,
    "area_sqft": 900,
    "furnishing": "semi_furnished",
    "preferred_tenant": "any"
  },
  "pg_fields": {
    "total_beds": 20,
    "occupancy_type": "co_living",
    "room_sharing_options": ["double"],
    "food_included": true,
    "curfew_time": "22:00",
    "attached_bathroom": true
  }
}
```

Response:

```json
{
  "listing_id": "uuid",
  "status": "draft"
}
```

### `PATCH /v1/owner/listings/:id`

Request: same shape as create, partial allowed.

Response:

```json
{
  "listing_id": "uuid",
  "status": "draft|pending_review|active|rejected|paused|archived",
  "updated_at": "iso"
}
```

### `POST /v1/owner/listings/:id/submit`

Request:

```json
{ "agree_terms": true }
```

Response:

```json
{ "listing_id": "uuid", "status": "pending_review" }
```

## Owner Photos

### `POST /v1/owner/listings/:id/photos/presign`

Headers:

- `Idempotency-Key` (required)

Request:

```json
{
  "files": [
    {
      "client_upload_id": "stable-id",
      "content_type": "image/jpeg",
      "size_bytes": 12345
    }
  ]
}
```

Response:

```json
{
  "uploads": [
    {
      "client_upload_id": "stable-id",
      "upload_url": "https://...",
      "blob_path": "listing-id/stable-id",
      "expires_at": "iso"
    }
  ]
}
```

### `POST /v1/owner/listings/:id/photos/complete`

Headers:

- `Idempotency-Key` (required)

Request:

```json
{
  "files": [
    {
      "client_upload_id": "stable-id",
      "blob_path": "listing-id/stable-id",
      "is_cover": false,
      "sort_order": 0
    }
  ]
}
```

Response:

```json
{
  "photo_ids": ["uuid"],
  "accepted_count": 1
}
```

## Owner Verification

### `POST /v1/owner/verification/video`

Request:

```json
{
  "listing_id": "uuid",
  "artifact_blob_path": "verification-artifacts/video.mp4",
  "vendor_reference": "optional"
}
```

Response:

```json
{ "attempt_id": "uuid", "result": "pending" }
```

### `POST /v1/owner/verification/electricity`

Request:

```json
{
  "listing_id": "uuid",
  "consumer_id": "string",
  "address_text": "string",
  "bill_artifact_blob_path": "optional"
}
```

Response:

```json
{
  "attempt_id": "uuid",
  "address_match_score": 90,
  "result": "pass|manual_review|fail|pending"
}
```

### `GET /v1/owner/verification/status?listing_id=:id`

Response:

```json
{
  "overall_status": "unverified|pending|verified|failed",
  "attempts": [
    {
      "id": "uuid",
      "verification_type": "video_liveness|electricity_bill_match",
      "liveness_score": 93,
      "address_match_score": 90,
      "threshold": 85,
      "result": "pending|pass|fail|manual_review",
      "created_at": "iso"
    }
  ]
}
```

## PG Segmentation

### `POST /v1/pg/segment`

Request:

```json
{ "total_beds": 20 }
```

Response:

```json
{ "path": "self_serve|sales_assist", "next_step": "string" }
```

## Admin Review

### `GET /v1/admin/review/listings`

Response shape currently consumed by frontend:

```json
{
  "items": [
    {
      "id": "uuid",
      "status": "draft|pending_review|active|rejected|paused|archived",
      "listing_type": "flat_house|pg",
      "title": "string",
      "owner_user_id": "uuid",
      "verification_status": "unverified|pending|verified|failed",
      "created_at": "iso"
    }
  ],
  "total": 1
}
```

### `POST /v1/admin/review/listings/:id/decision`

Request:

```json
{ "decision": "approve|reject|pause", "reason": "required for reject/pause" }
```

Response:

```json
{ "listing_id": "uuid", "new_status": "active|rejected|paused" }
```

### `GET /v1/admin/review/verifications`

Response:

```json
{
  "items": [
    {
      "id": "uuid",
      "listing_id": "uuid|null",
      "user_id": "uuid",
      "verification_type": "video_liveness|electricity_bill_match",
      "result": "pending|pass|fail|manual_review",
      "address_match_score": 90,
      "liveness_score": 93,
      "threshold": 85,
      "created_at": "iso"
    }
  ],
  "total": 1
}
```

### `POST /v1/admin/review/verifications/:attempt_id/decision`

Request:

```json
{ "decision": "pass|fail|manual_review", "reason": "optional" }
```

Response:

```json
{ "attempt_id": "uuid", "new_result": "pass|fail|manual_review" }
```

## Field Mapping Notes

- Owner list response in backend currently emits camelCase (`listingType`, `monthlyRent`, `verificationStatus`, `createdAt`).
  Frontend adapter normalizes both camelCase and snake_case to avoid drift.
- Admin endpoints emit snake_case keys; frontend maps to camelCase view-models.
- No route signature changes are required for this recovery slice.
