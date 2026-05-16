# Vercel Environment Setup for Cribliv v2 Frontend

> **Audience:** You, setting up the Vercel project that will host `apps/web`.
> **Backend dependency:** The Azure deployment described in `HANDOVER.md` must be live first.
> **API URL:** `https://cribliv-api.ashyplant-d0cd3af5.centralindia.azurecontainerapps.io`

This document is the **single source of truth for every environment variable Vercel needs**. Copy-paste sections below into Vercel's Settings → Environment Variables.

---

## How Vercel env vars work (quick refresher)

- Each variable has **three independent scopes**: Production, Preview, Development.
- Variables prefixed with `NEXT_PUBLIC_` are bundled into the client JS and visible in the browser. **Never put secrets there.**
- Variables without `NEXT_PUBLIC_` prefix are server-side only (Next.js API routes, server components, middleware, `getServerSideProps`).
- Changes only take effect on the **next deployment** — push a commit or trigger a redeploy from the dashboard.

---

## All env vars — categorized + copy-paste ready

### 1. NextAuth (auth.js v5)

These power user sessions. Apply to: **Production, Preview, Development.**

```bash
AUTH_SECRET=bO6bGMRI+pCBHLdCfhoVBBId3s3mwvGY0YWQg04RIQM=
NEXTAUTH_SECRET=bO6bGMRI+pCBHLdCfhoVBBId3s3mwvGY0YWQg04RIQM=
NEXTAUTH_URL=https://<your-vercel-domain>
```

| Var               | Where it's used                                     | Notes                                                                                     |
| ----------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AUTH_SECRET`     | NextAuth v5 internal — encrypts JWT session cookies | Must match across deployments or sessions invalidate                                      |
| `NEXTAUTH_SECRET` | Legacy v4 name — kept for any unupdated references  | Same value as AUTH_SECRET                                                                 |
| `NEXTAUTH_URL`    | Used in OAuth callback URLs + email links           | **MUST match the actual Vercel domain.** Update after first deploy when you know the URL. |

⚠️ **First deploy chicken-and-egg:** you don't know the Vercel URL until after the first deploy. Workflow:

1. Initial set: `NEXTAUTH_URL=https://placeholder.vercel.app`
2. First deploy succeeds → Vercel shows you the real URL (e.g. `cribliv-web.vercel.app`)
3. Update `NEXTAUTH_URL=https://cribliv-web.vercel.app`
4. Trigger a redeploy from Vercel dashboard
5. Sign-in flows now work

---

### 2. Backend wiring (POINTS TO AZURE BACKEND)

This is what connects your frontend to the live backend.

```bash
NEXT_PUBLIC_API_BASE_URL=https://cribliv-api.ashyplant-d0cd3af5.centralindia.azurecontainerapps.io/v1
API_BASE_URL=https://cribliv-api.ashyplant-d0cd3af5.centralindia.azurecontainerapps.io/v1
```

| Var                        | Where it's used                                                           | Notes                                              |
| -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | Browser-side API calls (client components, browser fetch)                 | Visible to browsers — safe (just a URL, no secret) |
| `API_BASE_URL`             | Server-side calls (Next.js API routes, server components calling the API) | Same value, server-only scope                      |

🔁 **If the Azure API URL ever changes:** update both. Same value, both variables.

---

### 3. Frontend feature flags

These control which UI features are enabled. Apply to: **Production, Preview, Development.**

```bash
NEXT_PUBLIC_FF_VOICE_AGENT_ENABLED=true
NEXT_PUBLIC_FF_VOICE_REALTIME=true
```

| Var                                  | Effect when true                                          |
| ------------------------------------ | --------------------------------------------------------- |
| `NEXT_PUBLIC_FF_VOICE_AGENT_ENABLED` | Shows the voice agent UI / Socket.IO connect button       |
| `NEXT_PUBLIC_FF_VOICE_REALTIME`      | Shows the "Talk to Maya" WebRTC realtime concierge option |

Other backend feature flags (`FF_*` without `NEXT_PUBLIC_` prefix) live on Azure and don't need to be duplicated here.

---

### 4. Google Maps

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyDjPBuNnu-aoZeOJvAPv0uWRHj3nDyRUSY
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=87bf173e32cd6d6767c22a93
```

| Var                               | Used by                                                      | Notes                                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Map rendering, Places autocomplete, the CriblMap browse page | Currently set to "Application restrictions: None" so it works from browser AND server. **TODO:** Create an HTTP referrer–restricted browser key + a separate IP-restricted server key (server one goes on Azure as `GOOGLE_MAPS_APIKEY`, already set there). |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`  | Cloud Map ID for dark-mode styling and AdvancedMarkerElement | Required for using google.maps.marker.AdvancedMarkerElement                                                                                                                                                                                                  |

---

### 5. PostHog analytics (India region)

```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_vVpokD963nKF97znJmkJeQferXHeQjNNUe2ANzurSVPv
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
POSTHOG_API_KEY=phc_vVpokD963nKF97znJmkJeQferXHeQjNNUe2ANzurSVPv
```

| Var                        | Used by                                                        | Notes                                                                         |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `NEXT_PUBLIC_POSTHOG_KEY`  | Browser-side event tracking                                    | Safe to expose (PostHog routes to India region based on key prefix)           |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog ingestion endpoint                                     | Use `app.posthog.com` — PostHog routes to your project's region automatically |
| `POSTHOG_API_KEY`          | Server-side event ingestion (reserved — not actively used yet) | Same value as the public key for now                                          |

⚠️ Tracking is **disabled** if the key is missing or empty. Leave blank in Preview/Development if you don't want preview deploys polluting analytics.

---

### 6. Node mode

```bash
NODE_ENV=production
```

Vercel sets this automatically based on the deployment scope (Production → `production`, Preview/Development → `development`). You can omit this — Vercel will get it right.

---

## Complete env block — copy this into Vercel directly

For the lazy / quick path. Paste all into Vercel **Settings → Environment Variables → Bulk import** (`.env` format):

```bash
# ─── NextAuth ──────────────────────────────────────────────────────────────
AUTH_SECRET=bO6bGMRI+pCBHLdCfhoVBBId3s3mwvGY0YWQg04RIQM=
NEXTAUTH_SECRET=bO6bGMRI+pCBHLdCfhoVBBId3s3mwvGY0YWQg04RIQM=
NEXTAUTH_URL=https://placeholder.vercel.app

# ─── Backend (Azure Container Apps) ────────────────────────────────────────
NEXT_PUBLIC_API_BASE_URL=https://cribliv-api.ashyplant-d0cd3af5.centralindia.azurecontainerapps.io/v1
API_BASE_URL=https://cribliv-api.ashyplant-d0cd3af5.centralindia.azurecontainerapps.io/v1

# ─── Frontend feature flags ────────────────────────────────────────────────
NEXT_PUBLIC_FF_VOICE_AGENT_ENABLED=true
NEXT_PUBLIC_FF_VOICE_REALTIME=true

# ─── Google Maps ───────────────────────────────────────────────────────────
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyDjPBuNnu-aoZeOJvAPv0uWRHj3nDyRUSY
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=87bf173e32cd6d6767c22a93

# ─── PostHog analytics (India region) ──────────────────────────────────────
NEXT_PUBLIC_POSTHOG_KEY=phc_vVpokD963nKF97znJmkJeQferXHeQjNNUe2ANzurSVPv
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
POSTHOG_API_KEY=phc_vVpokD963nKF97znJmkJeQferXHeQjNNUe2ANzurSVPv
```

Then after first deploy → update `NEXTAUTH_URL` with the real Vercel domain.

---

## What NOT to put in Vercel (these live on Azure)

These are all **backend** env vars and are already configured on the Azure Container Apps via `infra/set-env-vars.sh`. **Do not duplicate them in Vercel** — they don't belong there and will just be noise:

- `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY`
- `AZURE_OPENAI_*` (all of them — endpoint, API key, deployments, realtime, etc.)
- `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
- `GOOGLE_MAPS_APIKEY` (note: the lowercase `key` without `_API_` — this is the server-side variant)
- All `FF_*` without the `NEXT_PUBLIC_` prefix
- `OTP_PROVIDER`, `D7_KEY`, `OTP_API_KEY`, `OTP_SENDER_ID`
- `PAYMENT_PROVIDER_KEY`, `RAZORPAY_WEBHOOK_SECRET`, `UPI_WEBHOOK_SECRET`
- `CAPTURE_MOCK`, `AI_ROUTER_PROVIDER`
- `PHOTO_*` (file size limits, MIME types, public base URL)
- `CORS_ALLOWED_ORIGINS` (this is backend-side; controls what frontend domains the API accepts)

If you ever need to rotate or update any of these, do it via the Azure CLI:

```bash
az containerapp secret set --name cribliv-api -g Cribliv --secrets "azure-openai-api-key=<new value>"
az containerapp update --name cribliv-api -g Cribliv  # to roll the revision
```

Or re-run `./infra/set-env-vars.sh` after editing it locally.

---

## Vercel project configuration (not env vars)

The settings below go in Vercel project **Settings → General**, not in env vars:

| Setting          | Value                                        |
| ---------------- | -------------------------------------------- |
| Framework Preset | Next.js                                      |
| Root Directory   | `apps/web`                                   |
| Build Command    | `pnpm build` (default)                       |
| Install Command  | `cd ../.. && pnpm install --frozen-lockfile` |
| Output Directory | `.next` (default)                            |
| Node.js Version  | 20.x (default)                               |

The custom Install Command tells Vercel to install dependencies from the monorepo root, not just from `apps/web`. Without this, `pnpm install` would fail to find the workspace.

---

## After first deploy — checklist

- [ ] Frontend serves: `curl -I https://<your-vercel-domain>` → 200
- [ ] Frontend → API connectivity: open the site in a browser, open DevTools → Network tab, navigate to any page that calls the API. You should see requests to `https://cribliv-api.ashyplant…/v1/*` returning 200.
- [ ] Sign-in works:
  1. Click sign in on the site, enter `+919999999900` (or any `+91` + 10-digit phone)
  2. The frontend should call `POST /v1/auth/otp/send` and get a `challenge_id` back
  3. In the test/dev environment (OTP_PROVIDER=mock on backend), the API response includes a `dev_otp` field — paste that as the code
  4. You're signed in
- [ ] Create a listing → confirms photo upload (Azure Blob SAS) round-trips correctly
- [ ] Open the map view → confirms `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is loading correctly
- [ ] **Tighten CORS on Azure backend** once you confirm the Vercel domain:
  ```bash
  az containerapp update --name cribliv-api -g Cribliv \
    --set-env-vars "CORS_ALLOWED_ORIGINS=https://<your-vercel-domain>"
  ```
  Replace `*` with the locked-down origin to prevent random sites from calling your API.

---

## Custom domain setup (optional)

If you want `app.cribliv.com` (or any custom domain) instead of `cribliv-web.vercel.app`:

1. Vercel → Project → Settings → Domains → "Add" → `app.cribliv.com`
2. Vercel will display DNS records (typically a `CNAME` to `cname.vercel-dns.com`).
3. Add those records in your DNS provider (Cloudflare, Route53, Namecheap, etc.).
4. Wait 1–10 minutes for DNS propagation. Vercel automatically provisions a Let's Encrypt TLS certificate.
5. Update env vars:
   - `NEXTAUTH_URL=https://app.cribliv.com`
6. Trigger a redeploy from the Vercel dashboard.
7. Update backend CORS:
   ```bash
   az containerapp update --name cribliv-api -g Cribliv \
     --set-env-vars "CORS_ALLOWED_ORIGINS=https://app.cribliv.com"
   ```

---

## Troubleshooting

| Symptom                                              | Likely cause                                                    | Fix                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Pages render but API calls fail with `CORS error`    | Backend CORS_ALLOWED_ORIGINS doesn't include your Vercel URL    | Run the `az containerapp update` snippet above with the right origin |
| `[next-auth][error] No secret provided`              | `AUTH_SECRET` missing or wrong in Vercel                        | Re-set in Vercel env, redeploy                                       |
| Sign-in works but `/api/auth/session` returns `null` | `NEXTAUTH_URL` doesn't match the actual deployed URL            | Update `NEXTAUTH_URL` to the real URL, redeploy                      |
| Map shows "For development purposes only" overlay    | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` missing or restricted         | Verify env var, check Google Cloud console restrictions              |
| Voice agent button missing                           | `NEXT_PUBLIC_FF_VOICE_AGENT_ENABLED` is `false` or missing      | Set to `true` in Vercel env, redeploy                                |
| `Failed to fetch` for all API calls                  | `NEXT_PUBLIC_API_BASE_URL` wrong, or Azure API down             | `curl https://cribliv-api…/v1/health` to verify backend              |
| API requests come back as 401 Unauthorized           | Token not being sent OR backend JWT secrets rotated mid-session | Sign out and back in to get a fresh token                            |

---

## Where this differs from `apps/web/.env.local`

Your local `apps/web/.env.local` has these _additional_ values that you should NOT put in Vercel:

- `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1` — local-only; Vercel uses the Azure URL instead
- `API_BASE_URL=http://localhost:4000/v1` — same
- `NEXTAUTH_URL=http://localhost:3000` — local-only

These exist for `pnpm dev` to point your local frontend at your local backend.

Local-only setup remains the same — you don't need to update `apps/web/.env.local` after the Azure deploy. It points to localhost; Vercel points to Azure.

---

_End of Vercel env reference._
