# WhatsApp Notifications — Setup & Configuration Guide

This document covers everything needed to enable live WhatsApp notifications in CribLiv using the **Meta WhatsApp Business API (Cloud API / WABA)**.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Notification Events](#notification-events)
3. [Environment Variables](#environment-variables)
4. [Meta Developer Setup (Step-by-Step)](#meta-developer-setup)
5. [Template Registration](#template-registration)
6. [Dev / Local Testing (Mock Mode)](#dev--local-testing-mock-mode)
7. [Webhook for Delivery Receipts](#webhook-for-delivery-receipts)
8. [Database Tables](#database-tables)
9. [Feature Flag Checklist](#feature-flag-checklist)
10. [Going Live Checklist](#going-live-checklist)
11. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
User action (e.g. tenant unlocks contact)
        │
        ▼
NestJS service (contacts.service / admin.controller / owner.service)
        │  fire-and-forget
        ▼
NotificationService.send()
        │  checks whatsapp_opt_in flag in users table
        ▼
WhatsAppClient.sendTemplate()
        │
        ├─── WHATSAPP_PROVIDER=mock  →  logs to console (no HTTP call)
        │
        └─── WHATSAPP_PROVIDER=meta  →  POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
                                                │
                                                ▼
                                        Meta Cloud API
                                                │ delivers to recipient
                                                ▼
                                        notification_log table (audit trail)

Worker (queued mode):
outbound_events table  →  worker polls every 60 s
  event_type starts with "notification.whatsapp.*"
        │
        ▼
WhatsAppClient.sendTemplate()
```

**Immediate mode** (default for all current triggers): fires the API call inline, fire-and-forget. Failures are logged but do not affect the primary request.

**Queued mode**: inserts into `outbound_events` table, dispatched by the background worker with automatic exponential-backoff retry (up to 6 attempts).

---

## Notification Events

| Event Type                | Trigger                          | Recipient             | Template                     |
| ------------------------- | -------------------------------- | --------------------- | ---------------------------- |
| `owner.contact_unlocked`  | Tenant unlocks owner contact     | Property owner        | `owner_contact_unlocked_hi`  |
| `owner.listing_approved`  | Admin approves listing           | Property owner        | `listing_approved_hi`        |
| `owner.listing_rejected`  | Admin rejects listing            | Property owner        | `listing_rejected_hi`        |
| `owner.listing_paused`    | Admin pauses listing             | Property owner        | `listing_paused_hi`          |
| `owner.listing_submitted` | Owner submits listing for review | Property owner        | `listing_submitted_hi`       |
| `tenant.contact_unlocked` | (future) Tenant unlocks contact  | Tenant (confirmation) | `tenant_contact_unlocked_hi` |

All notifications are gated by the user's `whatsapp_opt_in` flag (set via the Settings page toggle).

---

## Environment Variables

Add these to your `.env` file (see `.env.example` for the block):

```dotenv
## ——— WhatsApp Notifications (Meta Cloud API / WABA) ———

# Set to "false" to disable all WhatsApp notifications globally
FF_WHATSAPP_NOTIFICATIONS=true

# "mock" logs messages locally without hitting Meta API (default for dev)
# "meta" sends real WhatsApp messages via Meta Cloud API
WHATSAPP_PROVIDER=mock

# From Meta Business Manager → WhatsApp → API Setup
WHATSAPP_PHONE_NUMBER_ID=

# Permanent system user access token (NOT a short-lived user token)
WHATSAPP_API_TOKEN=

# Optional: only set if you need to pin to a specific API version
# Defaults to: https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
WHATSAPP_API_URL=
```

### Variable Details

| Variable                    | Required for prod | Description                                                                                    |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `FF_WHATSAPP_NOTIFICATIONS` | Yes               | Master on/off flag. Set `false` to silently skip all notifications.                            |
| `WHATSAPP_PROVIDER`         | Yes               | `mock` (dev/staging) or `meta` (production)                                                    |
| `WHATSAPP_PHONE_NUMBER_ID`  | Yes (meta)        | Numeric ID of the WhatsApp Business phone number, e.g. `123456789012345`                       |
| `WHATSAPP_API_TOKEN`        | Yes (meta)        | Bearer token. Use a **System User** permanent token—never a short-lived token.                 |
| `WHATSAPP_API_URL`          | No                | Override if you need a specific API version. Auto-constructed from `PHONE_NUMBER_ID` if blank. |

---

## Meta Developer Setup

### Step 1 — Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **Create App**
2. Choose **Business** type
3. Give it a name (e.g. `CribLiv Production`)
4. Under **Add Products**, find **WhatsApp** and click **Set up**

### Step 2 — Create / Link a WhatsApp Business Account (WABA)

1. In the app dashboard, go to **WhatsApp → Getting Started**
2. Either create a new WABA or link an existing Meta Business account's WABA
3. You'll get a temporary test phone number automatically — use this for dev

### Step 3 — Add a Real Phone Number (Production)

1. Go to **WhatsApp → API Setup → Phone Numbers**
2. Click **Add phone number**
3. Enter the business phone number you own and complete verification (call or SMS)
4. This gives you the `WHATSAPP_PHONE_NUMBER_ID`

### Step 4 — Create a System User Token

> ⚠️ Do **NOT** use your personal Facebook user token. It expires and breaks production.

1. Go to [business.facebook.com](https://business.facebook.com) → **Settings → Users → System Users**
2. Create a new System User with **Admin** role
3. Click **Add Assets** → select your WhatsApp Business Account → give **Full Control**
4. Click **Generate Token** → select your app → enable permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Select **Never** for token expiry
6. Copy the token → set as `WHATSAPP_API_TOKEN`

### Step 5 — Verify Setup

Test with a curl call (replace placeholders):

```bash
curl -X POST \
  "https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${WHATSAPP_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "91XXXXXXXXXX",
    "type": "template",
    "template": {
      "name": "hello_world",
      "language": { "code": "en_US" }
    }
  }'
```

You should receive a JSON response with a `messages[0].id`. If you get a `200`, your credentials work.

---

## Template Registration

Each notification template must be **pre-approved by Meta** before it can be sent. Template approval typically takes 1–3 business days.

### How to Submit Templates

1. Go to **WhatsApp Manager** (business.facebook.com → your WABA → Message Templates)
2. Click **Create Template**
3. Category: choose **Utility** (for transactional notifications like ours)
4. Language: **Hindi (`hi`)**
5. Fill in the template body using `{{1}}`, `{{2}}` as variable placeholders

### Required Templates

Submit each of the following. The `{{1}}`, `{{2}}` values correspond to the `bodyParams` array built in [notification.templates.ts](../apps/api/src/modules/notifications/notification.templates.ts).

---

#### `owner_contact_unlocked_hi`

**Category:** Utility  
**Language:** Hindi (`hi`)

**Body:**

```
नमस्ते! आपकी प्रॉपर्टी "{{1}}" को {{2}} ने देखा और आपका नंबर लिया है। कृपया {{3}} के अंदर उन्हें call या WhatsApp करें, वरना rental request रद्द हो जाएगी।

CribLiv पर जाएं: https://cribliv.com/owner/contact-unlocks
```

**Params:** `{{1}}` = listing title, `{{2}}` = tenant name, `{{3}}` = response deadline (e.g. "12 घंटे")

---

#### `listing_approved_hi`

**Category:** Utility  
**Language:** Hindi (`hi`)

**Body:**

```
बधाई हो! आपकी प्रॉपर्टी "{{1}}" ({{2}}) को CribLiv पर approve कर दिया गया है। अब किरायेदार इसे देख और contact कर सकते हैं।

अपनी listing देखें: https://cribliv.com/owner/listings
```

**Params:** `{{1}}` = listing title, `{{2}}` = city

---

#### `listing_rejected_hi`

**Category:** Utility  
**Language:** Hindi (`hi`)

**Body:**

```
आपकी प्रॉपर्टी "{{1}}" review में reject हो गई। कारण: {{2}}

सुधार करके दोबारा submit करें: https://cribliv.com/owner/listings
किसी सवाल के लिए support@cribliv.com पर लिखें।
```

**Params:** `{{1}}` = listing title, `{{2}}` = rejection reason

---

#### `listing_paused_hi`

**Category:** Utility  
**Language:** Hindi (`hi`)

**Body:**

```
आपकी प्रॉपर्टी "{{1}}" को temporarily pause कर दिया गया है। कारण: {{2}}

अधिक जानकारी के लिए: https://cribliv.com/owner/listings
```

**Params:** `{{1}}` = listing title, `{{2}}` = pause reason

---

#### `listing_submitted_hi`

**Category:** Utility  
**Language:** Hindi (`hi`)

**Body:**

```
आपकी प्रॉपर्टी "{{1}}" सफलतापूर्वक submit हो गई है। हमारी team 24-48 घंटों में इसे review करेगी।

अपनी listing track करें: https://cribliv.com/owner/listings
```

**Params:** `{{1}}` = listing title

---

#### `tenant_contact_unlocked_hi` (future)

**Category:** Utility  
**Language:** Hindi (`hi`)

**Body:**

```
आपने "{{1}}" का owner contact unlock किया है। Owner का नंबर: {{2}}

याद रखें: 12 घंटे में response नहीं मिला तो आपका credit वापस मिलेगा।
```

**Params:** `{{1}}` = listing title, `{{2}}` = owner phone

---

### Post-Approval

Once approved, Meta assigns each template a name and status (`APPROVED`). Verify via:

```bash
curl "https://graph.facebook.com/v21.0/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?name=listing_approved_hi" \
  -H "Authorization: Bearer ${WHATSAPP_API_TOKEN}"
```

The template names in the API response must **exactly match** the `templateName` values in [notification.templates.ts](../apps/api/src/modules/notifications/notification.templates.ts).

---

## Dev / Local Testing (Mock Mode)

When `WHATSAPP_PROVIDER=mock` (default), no HTTP calls are made. Messages are logged to the API console:

```
[WhatsAppClient] [MOCK] WhatsApp → +919876543210 | template=owner_contact_unlocked_hi | params=["आपकी प्रॉपर्टी","एक किरायेदार","12 घंटे"]
```

You'll also see structured telemetry events:

```json
{
  "event": "whatsapp.send_mock",
  "ts": "...",
  "to": "+919876543210",
  "template": "owner_contact_unlocked_hi",
  "mock_message_id": "mock_1234_abc"
}
```

To test end-to-end with real messages in staging, set:

```dotenv
WHATSAPP_PROVIDER=meta
WHATSAPP_PHONE_NUMBER_ID=<test number ID from Meta>
WHATSAPP_API_TOKEN=<your system user token>
```

Meta's test phone numbers can only send to pre-registered numbers — add your own number in the Meta dashboard under **WhatsApp → Getting Started → To**.

---

## Webhook for Delivery Receipts

To update `notification_log.status` from `delivered` → `read` and track message failures, register a webhook in Meta:

1. Go to your Meta App → **WhatsApp → Configuration → Webhook**
2. Set **Callback URL** to: `https://api.cribliv.com/v1/webhooks/whatsapp`
3. Set **Verify Token**: choose a random secret string and store it as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in `.env`
4. Subscribe to fields: `messages` (includes status updates: `sent`, `delivered`, `read`, `failed`)

> ⚠️ The webhook endpoint is **not yet implemented**. This is a future enhancement. Delivery status currently relies on the send API response only.

---

## Database Tables

### `notification_log`

Created by [migration 0008](../infra/migrations/0008_whatsapp_notification_log.sql).

| Column                   | Type        | Description                                 |
| ------------------------ | ----------- | ------------------------------------------- |
| `id`                     | bigserial   | Auto-increment PK                           |
| `user_id`                | uuid        | FK to `users.id` (recipient)                |
| `channel`                | text        | `whatsapp` (extendable to `sms`, `email`)   |
| `notification_type`      | text        | e.g. `owner.contact_unlocked`               |
| `recipient_phone_masked` | text        | e.g. `+919****10` (never stores full phone) |
| `provider_message_id`    | text        | Meta WABA message ID                        |
| `status`                 | text        | `pending`, `delivered`, `failed`, `read`    |
| `metadata`               | jsonb       | Extra info (future use)                     |
| `created_at`             | timestamptz | When notification was sent                  |
| `updated_at`             | timestamptz | Auto-updated by trigger                     |

### `outbound_events` (queued mode)

WhatsApp events use `event_type` starting with `notification.whatsapp.*`. The worker dispatches these to `WhatsAppClient` instead of the CRM webhook. The `payload` jsonb column contains:

```json
{
  "notification_type": "owner.contact_unlocked",
  "recipient_user_id": "uuid",
  "recipient_phone": "+919876543210",
  "template_name": "owner_contact_unlocked_hi",
  "language_code": "hi",
  "body_params": ["listing title", "tenant name", "12 घंटे"]
}
```

---

## Feature Flag Checklist

| Flag                        | Default           | Effect when `false`                         |
| --------------------------- | ----------------- | ------------------------------------------- |
| `FF_WHATSAPP_NOTIFICATIONS` | `true`            | All notification sends are silently skipped |
| `WHATSAPP_PROVIDER=mock`    | local dev default | No HTTP calls, logs to console only         |

User-level gating: `users.whatsapp_opt_in` (boolean) — toggled via Settings page at `/settings`. If `false`, the user receives no WhatsApp messages regardless of the feature flag.

---

## Going Live Checklist

- [ ] Meta Business Account verified
- [ ] WhatsApp Business Account (WABA) created and phone number added
- [ ] Phone number verified via call/SMS
- [ ] All 5 templates submitted and **approved** in Meta Business Manager
- [ ] System User created with permanent non-expiring token
- [ ] Token has `whatsapp_business_messaging` + `whatsapp_business_management` permissions
- [ ] `WHATSAPP_PHONE_NUMBER_ID` set in production `.env`
- [ ] `WHATSAPP_API_TOKEN` set in production `.env` (stored in secret manager, not plain-text)
- [ ] `WHATSAPP_PROVIDER=meta` set in production `.env`
- [ ] `FF_WHATSAPP_NOTIFICATIONS=true` set in production `.env`
- [ ] Tested with a real Indian mobile number — message delivered and rendered correctly
- [ ] Migration `0008_whatsapp_notification_log.sql` applied to production DB
- [ ] Monitoring: confirmed `notification_log` rows are being created with `status=delivered`
- [ ] (Optional) Webhook endpoint implemented and registered for delivery receipts

---

## Troubleshooting

### Messages not sending in production

1. Check logs for `whatsapp.send_skipped` — means `WHATSAPP_PROVIDER != meta` or credentials missing
2. Check logs for `whatsapp.send_failed` — includes the Meta error message. Common causes:
   - `190` — token expired or invalid → regenerate system user token
   - `131030` — template not approved or name mismatch → check template status in Meta Business Manager
   - `100` — phone number not valid E.164 format → check `users.phone_e164` DB column

### User not receiving messages

1. Confirm `users.whatsapp_opt_in = true` for that user in DB:
   ```sql
   SELECT id, phone_e164, whatsapp_opt_in FROM users WHERE id = '<user_id>';
   ```
2. Check `notification_log` for recent rows for that user:
   ```sql
   SELECT * FROM notification_log WHERE user_id = '<user_id>' ORDER BY created_at DESC LIMIT 10;
   ```
3. Confirm the user's number is a valid WhatsApp-registered number

### Template rejected by Meta

- Avoid using URLs in template body unless they are fixed (no variable URLs)
- Avoid promotional language — use utility/transactional category only
- Do not include `OTP`, `password`, or `pin` in template names or body
- Resubmit with revised copy after 24 hours

### Worker not dispatching queued events

Check `outbound_events` table for stuck events:

```sql
SELECT id, event_type, status, attempt_count, last_error, next_attempt_at
FROM outbound_events
WHERE event_type LIKE 'notification.whatsapp.%'
  AND status != 'dispatched'
ORDER BY created_at DESC
LIMIT 20;
```

If `attempt_count >= 6` and `status = 'failed'`, the event has exhausted retries. Check `last_error` for the Meta API error message.
