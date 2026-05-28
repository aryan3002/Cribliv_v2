# D7 Networks OTP — Switch-On Checklist

> When you're ready to send real SMS OTPs (production or staging testing),
> change **exactly these three things** and restart the API.

---

## 1. `apps/api/.env`

| Key                 | Development (current) | Production (switch to)               |
| ------------------- | --------------------- | ------------------------------------ |
| `OTP_PROVIDER`      | `mock`                | `d7`                                 |
| `D7_KEY`            | _(pre-filled below)_  | same key, keep it                    |
| `OTP_SENDER_ID`     | `CribLiv`             | `CribLiv` _(must be approved by D7)_ |
| `D7_OTP_EXPIRY_SEC` | `600`                 | `600` _(10 min, adjust if needed)_   |

**Exact line to change:**

```diff
- OTP_PROVIDER=mock
+ OTP_PROVIDER=d7
```

The D7 key is already set in `apps/api/.env`:

```
D7_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoLWJhY2tlbmQ6YXBwIiwi...
```

---

## 2. What changes in behavior

| Mode   | `dev_otp` in API response | SMS sent          | UI shows hint box      |
| ------ | ------------------------- | ----------------- | ---------------------- |
| `mock` | ✅ yes                    | ❌ no             | ✅ `[Dev] OTP: XXXXXX` |
| `d7`   | ❌ no                     | ✅ yes (real SMS) | ❌ (intentional)       |

When `OTP_PROVIDER=d7`:

- The OTP code is generated and managed entirely by D7 Networks
- `/auth/otp/verify` forwards the code to `api.d7networks.com/verify/v1/otp/verify-otp`
- No database required — the `otp_id` is stored in the in-memory challenge store during local dev

---

## 3. D7 Sender ID approval

Before going live, the sender ID `CribLiv` must be **pre-approved** in your D7 Networks dashboard:

1. Log in at [https://app.d7networks.com](https://app.d7networks.com)
2. Go to **SMS → Sender IDs**
3. Request approval for `CribLiv` (may take 24–48 hours per country)
4. For India (DLT), a DLT entity ID and template ID are required

> Without D7 Sender ID approval, messages may be blocked by Indian telecom operators.

---

## 4. Production environment extra steps

In production (`NODE_ENV=production` or with `DATABASE_URL` set):

```env
# apps/api/.env (production)
OTP_PROVIDER=d7
D7_KEY=<your D7 JWT key>
OTP_SENDER_ID=CribLiv
D7_OTP_EXPIRY_SEC=600
DATABASE_URL=postgresql://user:pass@host:5432/cribliv_v2
FF_PRODUCTION_DB_ONLY=true   # ← make sure this matches whether DB is available
```

With `FF_PRODUCTION_DB_ONLY=true` and a `DATABASE_URL`:

- OTP challenges stored in `otp_challenges` table (persists across restarts)
- Rate limiting works (6 OTPs per phone per 10 minutes, enforced in DB)
- Sessions persist across API restarts

---

## 5. Quick test after enabling D7

```bash
# Send OTP to a real number
curl -s -X POST http://localhost:4000/v1/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone_e164": "+91XXXXXXXXXX", "purpose": "login"}'

# Response will NOT contain dev_otp — check your phone for the SMS
# Then verify:
curl -s -X POST http://localhost:4000/v1/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"challenge_id": "<id from above>", "otp_code": "<6-digit SMS code>"}'
```

---

## 6. Rollback to mock

Set `OTP_PROVIDER=mock` in `apps/api/.env` and restart the API.
The `dev_otp` will appear in the login UI again immediately.
