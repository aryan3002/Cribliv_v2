# Azure subscription migration runbook (2026-09-13)

Move the Cribliv v2 backend from the current subscription to the sponsored one.
Vercel (web) stays where it is; only its API URL changes.

|               | OLD (current prod)                     | NEW (sponsorship credits)              |
| ------------- | -------------------------------------- | -------------------------------------- |
| Subscription  | `462382ee-6cdd-44a8-bf3c-5ecfb68e61da` | `6b65d070-e038-459a-8a00-1b22ae2f98fc` |
| Tenant        | `dc0dd35e-…`                           | `44dba1c1-…` (adarsh@bayharborexports) |
| Region policy | —                                      | none (India regions OK)                |

Cross-tenant, so `az resource move` is impossible — this is **rebuild + copy data**.

## Status (2026-09-14)

Scope: **backend only**. Frontend stays on Vercel; moving it to Azure Container Apps is a later, separate change
(draft `Dockerfile.web` + `output: "standalone"` saved outside the repo — build needs repo-root `data/` and runtime `apps/web/content/`).

Built in NEW sub, RG `cribliv-prod` (centralindia) — old prod untouched and still serving:

- [x] ACR `criblivprodacr`, Log Analytics `cribliv-prod-logs`, CA env `cribliv-env` (`greenflower-1ce3f92d.centralindia.azurecontainerapps.io`)
- [x] Key Vault `cribliv-prod-kv` — holds `pg-admin-password`
- [x] Postgres `cribliv-prod-db` PG16 B1ms, db `cribliv`, extensions allowlisted; firewall = Azure services + admin Mac IP (no AllowAll)
- [x] Storage `criblivphotos`, containers match old access (`listing-photos`=blob, `rent-agreements`=private), CORS set; first copy 955 + 6 blobs = old counts
- [x] Speech `cribliv-prod-speech` F0; OpenAI `cribliv-prod-openai` (southindia) with `cribliv-embed`; `cribliv-prod-realtime` (eastus2) with `gpt-realtime-mini`
- [x] Interim AI: `cribliv-prod-realtime` (eastus2) now also hosts `cribliv-chat` = **gpt-4o 2024-11-20 Standard 150K TPM** and `cribliv-embed` = text-embedding-3-small GlobalStandard (1536 dims, matches stored vectors); new API + worker `AZURE_OPENAI_ENDPOINT` point here.
      gpt-4o-mini 2024-07-18 was refused in eastus2 (`ServiceModelDeprecated`); new sub has no non-batch gpt-4.1 quota anywhere.
- [ ] `cribliv-chat` on gpt-4.1 — when quota is granted (southindia GlobalStandard), deploy it on `cribliv-prod-openai` and move `AZURE_OPENAI_ENDPOINT` + `azure-openai-api-key` back to that account (API + worker)
- [x] `cribliv-api` running (`cribliv-api.greenflower-1ce3f92d.centralindia.azurecontainerapps.io`, `/v1/health` = ok, db up); `cribliv-worker` created at **minReplicas 0**
- [x] Rehearsal: dump 74 s (4.1 MB) + restore ~4 min from a Mac; all 83 tables match except live-traffic `listing_events` (+1). Only restore error = `SET transaction_timeout` (pg_dump 18 → PG16, harmless)
- [x] Branch edits ready (unmerged): `ci.yml`, `infra/deploy.sh`, `infra/azure-setup.sh`, `infra/azure-storage-cors.sh` → new names
- [ ] Pre-cutover: quota, webhook list, service principal + `AZURE_CREDENTIALS`, cutover window

Cutover for the backend-only scope = §4 with step 5 as a Vercel env change to the new API URL + redeploy.
Before the final restore, drop and recreate the `cribliv` DB on the new server (the rehearsal data is already in it).

## 0. Inventory (verified 2026-09-13)

| Component         | OLD                                                                                             | NEW (proposed)                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Resource group    | `Cribliv` + `CriblivV2_production`                                                              | `cribliv-prod` (centralindia) — one RG                           |
| Container reg.    | `criblivacr` (Basic, admin)                                                                     | `criblivprodacr` (Basic, admin) — name verified free             |
| CA environment    | `cribliv-env` (centralindia)                                                                    | `cribliv-env` (centralindia)                                     |
| API app           | `cribliv-api` 0.5 vCPU/1Gi, min 1, max 2, ingress external :4000                                | same                                                             |
| Worker app        | `cribliv-worker` 0.5 vCPU/1Gi, min 1, cmd `node dist/worker/worker.js`                          | same                                                             |
| Postgres          | `cribliv-db` PG16 B1ms 32 GB, ~4.5 GB used                                                      | `cribliv-prod-db` PG16 B1ms 32 GB — name verified free           |
| PG extensions     | FUZZYSTRMATCH, POSTGIS, POSTGIS_TOPOLOGY, PG_TRGM, PGCRYPTO, PLPGSQL, VECTOR                    | same allowlist (`azure.extensions`)                              |
| Storage           | `criblivimgstorage` (southindia, LRS, public blob) ~380 MB: `listing-photos`, `rent-agreements` | `criblivphotos` (centralindia, LRS, public blob) — verified free |
| Speech            | `cribliv-speech` F0 (centralindia)                                                              | `cribliv-speech` F0 (centralindia)                               |
| OpenAI chat+embed | `cribliv2-openai` (southindia): `cribliv-chat` gpt-4.1, `cribliv-embed` text-embedding-3-small  | same deployment names — **gpt-4.1 quota = 0, request needed**    |
| OpenAI realtime   | `adars-moibam2t-eastus2`: `gpt-realtime-mini`                                                   | new eastus2 account, `gpt-realtime-mini` (quota 40 ✅)           |

Keep deployment **names identical** so only endpoint/key env vars change.
Embeddings MUST stay `text-embedding-3-small` — stored pgvector embeddings depend on it.

### New-sub AI quota (GlobalStandard, checked)

- text-embedding-3-small: 1000 in southindia/eastus2 ✅
- gpt-realtime-mini: 40 in eastus2/swedencentral ✅
- gpt-4.1 / gpt-4o / gpt-4o-mini: **0 everywhere** ❌ → file quota request for gpt-4.1 GlobalStandard.
  Fallback if not granted by cutover: gpt-4o-mini Standard eastus2 (450) under deployment name `cribliv-chat`.

### Things that key off hostnames (checked)

- DB stores `blob_path`, not full URLs → no data rewrite; photo URLs derive from `AZURE_STORAGE_ACCOUNT_NAME` / `PHOTO_PUBLIC_BASE_URL`.
- `apps/web/next.config.mjs` image + CSP use `*.blob.core.windows.net` wildcards → storage rename safe.
- CSP `connect-src` uses `NEXT_PUBLIC_API_BASE_URL` → **baked at build: Vercel must REDEPLOY, not just edit env.**
- API has **no custom domain**; everything points at `cribliv-api.ashyplant-d0cd3af5.centralindia.azurecontainerapps.io`.
- DNS for cribliv.com is GoDaddy (`domaincontrol.com`); `api.cribliv.com` does not exist yet.

## 1. Pre-flight (no prod impact)

- [ ] Quota request: gpt-4.1 GlobalStandard, southindia, on the NEW sub (Portal → Azure AI Foundry → Quotas).
- [ ] Decide: add `api.cribliv.com` custom domain (recommended — future moves become a DNS change).
- [ ] Check external callbacks that point at the old API host: Razorpay webhook URL, D7/WhatsApp callbacks, anything in Google Cloud. List them here: **\_\_**
- [ ] Pick cutover window (late night IST, low traffic).

## 2. Build new stack (no prod impact)

All commands use `--subscription 6b65d070-…` explicitly.

1. RG `cribliv-prod` centralindia.
2. ACR `criblivprodacr` (Basic, admin enabled).
3. Postgres `cribliv-prod-db`: PG16, Standard_B1ms, 32 GB, public access.
   - Set `azure.extensions` = the allowlist above.
   - Firewall: "Allow Azure services" + admin IP only. **Do NOT copy the old `AllowAll 0.0.0.0–255.255.255.255` rule** (old DB is open to the internet today).
4. Storage `criblivphotos` (StorageV2, LRS, allow blob public access), containers `listing-photos`, `rent-agreements` with the same public-access level as old. Run `infra/azure-storage-cors.sh` against it with the prod origins (cribliv.com, www, Vercel prod, localhost).
5. Speech `cribliv-speech` F0 centralindia.
6. OpenAI:
   - southindia account: `cribliv-embed` (text-embedding-3-small v1 GlobalStandard), `cribliv-chat` (gpt-4.1 once quota lands).
   - eastus2 account: `gpt-realtime-mini` (2025-12-15 GlobalStandard).
7. CA environment `cribliv-env` + Log Analytics workspace, centralindia.
8. Build image into new ACR from `origin/master` (`az acr build`).
9. Create `cribliv-api` and `cribliv-worker` with the old sizing/scale/command, registry creds, and:
   - **Secrets** — copy from old unchanged: `jwt-access-secret`, `jwt-refresh-secret`, `d7-key`, `google-maps-apikey`, `gsc-sa-json`, `admin-totp-enc-key`.
     New values: `database-url`, `azure-storage-account-key`, `azure-openai-api-key`, `azure-openai-realtime-api-key`, `azure-speech-key`, registry password.
     (JWT secrets MUST be identical or every logged-in user is signed out. `admin-totp-enc-key` MUST be identical or admin TOTP enrolments become undecryptable.)
   - **Env** — copy all plain env from old apps verbatim (~100 on API, ~20 on worker), then override:
     `AZURE_STORAGE_ACCOUNT_NAME`, `PHOTO_PUBLIC_BASE_URL`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_REALTIME_ENDPOINT`, `AZURE_SPEECH_REGION` (still centralindia).
     `RENT_AGREEMENT_PAN_KEY` / `RENT_AGREEMENT_IP_SALT` are plain env today — copy identically (encrypted PAN data depends on them) and move them into secrets.
   - Start the **worker scaled to 0** until cutover (two workers on two DBs is harmless, but one worker on the new DB before data lands would sweep an empty DB).
10. Copy blobs: `azcopy sync` old → new for both containers (re-run at cutover for the delta).
11. Custom domain (if chosen): GoDaddy CNAME `api` → new API FQDN + TXT `asuid.api` → env verification ID; bind managed cert.

## 3. Rehearsal (no prod impact)

1. `pg_dump -Fc` from old DB → `pg_restore --no-owner --no-acl` into new DB.
2. Row-count diff on key tables (users, listings, listing_photos, leads, payments, admin_actions).
3. Smoke-test new API directly: `/v1/health`, search, listing detail with photos, OTP send to a test phone, Maya realtime session, photo upload (SAS PUT), rent-agreement PDF download.
4. Point a Vercel **preview** at the new API (preview CORS is blocked by design — test via localhost:3000 with `NEXT_PUBLIC_API_BASE_URL` instead).
5. Time the dump+restore → sets the real downtime estimate.

## 4. Cutover (≈15–30 min downtime)

1. Scale OLD worker to 0, OLD api to 0 (writes frozen; site API down).
2. Final `pg_dump` old → drop/recreate new DB → `pg_restore`. Row-count diff.
3. Final `azcopy sync` for both containers.
4. Scale NEW worker to 1. Verify new API health + a search.
5. Vercel prod env: `NEXT_PUBLIC_API_BASE_URL` + `API_BASE_URL` → new URL (`https://api.cribliv.com/v1` or new FQDN). **Redeploy** production.
6. Update external callbacks (Razorpay webhook etc. from pre-flight list).
7. CI switch — create a service principal scoped to `cribliv-prod` RG on the NEW sub, replace GitHub secret `AZURE_CREDENTIALS`, then merge the PR that updates `ACR_NAME`/`RESOURCE_GROUP` in `.github/workflows/ci.yml`, `infra/deploy.sh`, `infra/azure-setup.sh`, `infra/azure-storage-cors.sh` default. Confirm the `deploy-api` run lands on the new app.
8. Smoke test on cribliv.com: homepage counts, search, listing photos, login OTP, owner photo upload, admin login, Maya.

### Rollback (any time before old stack is deleted)

Vercel env back to old URL + redeploy; scale old api/worker back to 1; revert `AZURE_CREDENTIALS` + CI PR.
Writes made to the new DB after cutover are lost on rollback — decide within the first hour.

## 5. After cutover

- Watch for 7 days (Container Apps logs, Vercel runtime errors, worker sweeps running, blog posts generating).
- Then decommission OLD: `Cribliv`, `CriblivV2_production`, and the leftover v1 `Cribliv-migration` RG (VM disk, backup vault, textgen accounts). Take a final `pg_dump` to cold storage first.
- Update `deploymentDocs/HANDOVER.md` + `Credentials.md` URLs.
