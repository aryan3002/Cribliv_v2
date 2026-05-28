---
name: contact-flow
description: How an agent can hand off a verified Cribliv listing to a human user for contact and shortlisting.
version: 0.1.0
---

# Contact + shortlist flow

Cribliv requires an authenticated tenant session for any contact, shortlist, or
booking action. Agents cannot complete these flows headlessly — the OTP is
delivered to the user's phone, not to the agent.

## Recommended hand-off

1. Search and rank listings using `search-listings` + `get-listing`.
2. Cite each candidate with its public URL `/{locale}/listing/{id}`.
3. To take action, redirect the human user to the same URL — the page exposes
   "Contact owner", "Shortlist", and "Book a visit" CTAs that trigger the OTP
   handshake (`/v1/auth/otp/send` + `/v1/auth/otp/verify`).

## Auth shape (for documentation only)

- `POST /v1/auth/otp/send` → `{ challenge_id }`
- `POST /v1/auth/otp/verify` → `{ access_token }` where the token has the form
  `acc_<uuid>` and is sent as `Authorization: Bearer acc_<uuid>` on subsequent
  protected requests.

## Out of scope for agents

The following endpoints are NOT exposed for headless agent use:

- `POST /v1/contacts/*` — owner contact (rate-limited, anti-spam)
- `POST /v1/shortlist/*` — tenant shortlist
- `POST /v1/leads/*` — owner lead capture

If you need write access for an authorized agent integration, contact
`partners@cribliv.com` for a per-agent credential.
