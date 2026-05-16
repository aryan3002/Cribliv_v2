# Cribliv v2 — Azure Testing Deployment Handover

> **Started:** 2026-05-16  
> **Operator:** Claude (Opus 4.7) via `superpowers:executing-plans`  
> **Plan source:** [azure-testing-deployment-plan.md](azure-testing-deployment-plan.md)  
> **Project root:** `/Users/satviksarthak/Cribliv_v2`  
> **Branch:** `master`  
> **Status:** _In progress — Task 5 re-running after location fix_

This document is the single source of truth for the testing deployment. It captures: architecture, every file edit (with diffs), every command run, every error and recovery, the operational runbook, and outstanding items.

---

## 1. Architecture (final deployed state)

```
┌─────────────────── Azure Subscription: 462382ee-6cdd-44a8-bf3c-5ecfb68e61da ──────────────────┐
│                                                                                                │
│ ┌─ Resource Group: Cribliv (centralindia) ────────────────────────────────────────────────┐  │
│ │                                                                                          │  │
│ │  Pre-existing Cognitive Services (untouched by this deployment):                        │  │
│ │   • cribliv2-openai          (southindia)  Azure OpenAI — chat + embed (cribliv-chat,   │  │
│ │                                            cribliv-embed deployments)                    │  │
│ │   • cribliv-speech           (centralindia) Azure Cognitive Services Speech (STT+TTS)    │  │
│ │   • cribliv-realtime-openai  (eastus)      (unused for now — superseded by below)        │  │
│ │   • adars-moibam2t-eastus2   (eastus2)     Azure OpenAI Realtime — gpt-realtime-mini     │  │
│ │                                            (Maya concierge over WebRTC)                  │  │
│ │                                                                                          │  │
│ │  NEW resources created by infra/azure-setup.sh:                                          │  │
│ │   • criblivacr (Microsoft.ContainerRegistry, Basic SKU, admin enabled)                  │  │
│ │   • cribliv-env (Microsoft.App/managedEnvironments)                                     │  │
│ │   • cribliv-api    (Microsoft.App/containerApps, external HTTPS :4000, 1–2 replicas)    │  │
│ │   • cribliv-worker (Microsoft.App/containerApps, ingress=none,    1 replica)            │  │
│ │       Same Docker image, CMD override: ["node", "dist/worker/worker.js"]                │  │
│ └──────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                │
│ ┌─ Resource Group: CriblivV2_production (centralindia) ────────────────────────────────────┐ │
│ │   • cribliv-db (Azure Database for PostgreSQL Flexible Server) — database: cribliv       │ │
│ │     Firewall: AllowAll_2026-4-30 (0.0.0.0–255.255.255.255) +                             │ │
│ │                AllowAllAzureServicesAndResourcesWithinAzureIps                           │ │
│ │     Reached by Container Apps from Cribliv RG via public hostname over TLS.              │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────┘

Deploy flow (CLI, run from monorepo root):
  Terminal  → az acr build  (uploads source, builds Dockerfile in Azure cloud  ≈3 min)
            → az containerapp update cribliv-api    (image roll                ≈30s)
            → az containerapp update cribliv-worker (image roll                ≈30s)

Frontend (out of scope for this plan): apps/web is deployed separately to Vercel.
The Vercel project should read NEXT_PUBLIC_API_BASE_URL=https://<cribliv-api FQDN>/v1.
```

### Why centralindia (not southindia as plan said)

The existing `Cribliv` RG was already created in `centralindia`. Switching the Container Apps location to match keeps them in the same region as `cribliv-db` (Postgres) and `cribliv-speech` — lower latency, same cost. The southindia OpenAI is reached over HTTPS and unaffected.

### Why same image for API and worker

Single image = one cache, one deploy, one rollback. The worker container overrides the entrypoint with `["node", "dist/worker/worker.js"]` (set at Container App creation, not in Dockerfile). The API uses the Dockerfile's default `CMD ["node", "dist/main.js"]`.

### Why ACR admin credentials (not managed identity)

For testing simplicity. Production would use managed identity + AcrPull role assignment. This is documented as a known trade-off (see section 7).

---

## 2. Files changed

All three live in `/Users/satviksarthak/Cribliv_v2/infra/`.

### 2.1 `infra/azure-setup.sh` — MODIFIED (103 lines, was 118)

| Property          | Before                                                                                | After                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `RESOURCE_GROUP`  | `cribliv-rg`                                                                          | `Cribliv`                                                                                          |
| `LOCATION`        | `centralindia` (placeholder, would not have matched real RG had it been `southindia`) | `centralindia` (matches existing RG — fixed after Task 5 failed once)                              |
| ACR creation      | `--sku Basic` only                                                                    | `--sku Basic --admin-enabled true`                                                                 |
| Container Apps    | Only API app                                                                          | API app + Worker app (`cribliv-worker`, `ingress none`, CMD `node dist/worker/worker.js`)          |
| API replicas      | `0–3` (scale to zero)                                                                 | `1–2` (always at least one warm)                                                                   |
| Image-pull auth   | Managed identity + AcrPull role assignment                                            | ACR admin credentials wired via `az containerapp registry set --username --password` for both apps |
| GitHub Actions SP | `az ad sp create-for-rbac` step that prints AZURE_CREDENTIALS JSON                    | Removed entirely (CLI-only deploy, no GHA)                                                         |
| Output            | "Add JSON to GitHub Secrets" instructions                                             | "Run set-env-vars.sh and deploy.sh next" instructions                                              |

### 2.2 `infra/set-env-vars.sh` — MODIFIED (204 lines, was 79)

| Property                                              | Before                                                                                  | After                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESOURCE_GROUP`                                      | `cribliv-rg`                                                                            | `Cribliv`                                                                                                                                                                                                                                                                                 |
| App targets                                           | One: `APP_NAME=cribliv-api`                                                             | Two: `API_APP_NAME=cribliv-api`, `WORKER_APP_NAME=cribliv-worker`                                                                                                                                                                                                                         |
| Blob var names (wrong — code reads `AZURE_STORAGE_*`) | `BLOB_ACCOUNT_NAME`, `BLOB_ACCOUNT_KEY`, `BLOB_CONTAINER_LISTING_MEDIA="listing-media"` | `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY` (secret), `AZURE_STORAGE_CONTAINER_LISTING_PHOTOS="listing-photos"`, plus `AZURE_STORAGE_SAS_TTL_SECONDS=900`                                                                                                                   |
| Photo upload config                                   | None                                                                                    | `PHOTO_MAX_FILE_SIZE_BYTES=10485760`, `PHOTO_ALLOWED_MIME_TYPES=image/jpeg,image/png,image/webp`, `PHOTO_PUBLIC_BASE_URL=https://criblivimgstorage.blob.core.windows.net/listing-photos`                                                                                                  |
| Azure OpenAI key                                      | Plain env var                                                                           | Stored as secret `azure-openai-api-key`, referenced via `secretref:`                                                                                                                                                                                                                      |
| OpenAI deployments                                    | Only `AZURE_OPENAI_EXTRACT_DEPLOYMENT`                                                  | Added `_CONVERSATION_DEPLOYMENT`, `_CHAT_DEPLOYMENT` (cribliv-chat), `_EMBEDDING_DEPLOYMENT` (cribliv-embed), `AZURE_AI_TIMEOUT_MS=20000`                                                                                                                                                 |
| Realtime concierge ("Maya")                           | Not configured                                                                          | Full block: separate endpoint `https://adars-moibam2t-eastus2.cognitiveservices.azure.com`, separate API key (stored as secret `azure-openai-realtime-api-key`), `_DEPLOYMENT=gpt-realtime-mini`, `_VOICE=sage`                                                                           |
| Azure Speech key                                      | Plain env var                                                                           | Stored as secret `azure-speech-key`, referenced via `secretref:`                                                                                                                                                                                                                          |
| `AZURE_SPEECH_REGION`                                 | (default `southindia` then `centralindia`)                                              | `centralindia` (matches the real resource region)                                                                                                                                                                                                                                         |
| `GOOGLE_MAPS_APIKEY`                                  | Not set                                                                                 | Stored as secret `google-maps-apikey`, server-side key for Distance Matrix                                                                                                                                                                                                                |
| Providers                                             | `AI_ROUTER_PROVIDER="mock"`                                                             | `AI_ROUTER_PROVIDER="azure"`, added `CAPTURE_MOCK="false"`                                                                                                                                                                                                                                |
| CORS                                                  | `https://your-app.vercel.app`                                                           | `*` (testing wide-open; tighten to Vercel URL for prod)                                                                                                                                                                                                                                   |
| Feature flags (API)                                   | 3 flags                                                                                 | 25 flags (all FF\_\* that the API code reads — voice agent, AI intent/embed/rank, geo, leads, fraud, map, alerts, subscriptions, pins, listings, featured, availability, partial-phone, popular-localities, similar-listings, voice-search, owner-assisted-capture)                       |
| Worker block                                          | Not present                                                                             | Full block: secrets (`database-url`, `azure-openai-api-key`), env vars (`NODE_ENV`, `DATABASE_URL`, `AZURE_OPENAI_ENDPOINT`, `_API_KEY`, `_EMBEDDING_DEPLOYMENT`, `AZURE_AI_TIMEOUT_MS`, `FF_PRODUCTION_DB_ONLY`, `FF_AI_EMBEDDINGS`, `FF_AI_RANKING`, `FF_WHATSAPP_NOTIFICATIONS=false`) |
| Secrets count (API)                                   | 4                                                                                       | 8 (`database-url`, `jwt-access-secret`, `jwt-refresh-secret`, `azure-storage-account-key`, `azure-openai-api-key`, `azure-openai-realtime-api-key`, `azure-speech-key`, `google-maps-apikey`)                                                                                             |

### 2.3 `infra/deploy.sh` — CREATED (new file, 61 lines)

Net-new file. Pipeline:

1. `az acr build --registry criblivacr --image cribliv-api:${SHA} --file Dockerfile .` (cloud build, no local Docker)
2. `az containerapp update --name cribliv-api    --image criblivacr.azurecr.io/cribliv-api:${SHA}`
3. `az containerapp update --name cribliv-worker --image criblivacr.azurecr.io/cribliv-api:${SHA}`
4. Print API FQDN + `/v1/health` URL.

`SHA` defaults to `git rev-parse --short HEAD`; override via `SHA=abc1234 ./infra/deploy.sh` for redeploying a specific commit (rollback).

---

## 3. Commands run + outputs

### Task 1 — Prerequisites (✅)

```
az --version  → 2.85.0
git --version → 2.50.1 (Apple Git-155)
az account show --query id → 462382ee-6cdd-44a8-bf3c-5ecfb68e61da ✓
```

### Tasks 2–4 — File edits (✅)

- Read original `azure-setup.sh` (118 lines) → Write new (103 lines)
- Read original `set-env-vars.sh` (79 lines) → Write iteration 1 (157 lines) → user filled DB/storage values → Write iteration 2 (204 lines) with all missing backend vars (realtime, photo, FF flags)
- Write new `deploy.sh` (61 lines), `chmod +x`
- All three: `bash -n` syntax check passed

### Task 5 attempt 1 — FAILED at step 1 (resource group)

```
▶ Subscription: Azure subscription 1
▶ Subscription ID: 462382ee-6cdd-44a8-bf3c-5ecfb68e61da

── 1. Resource Group ─────────────────────────────────────────────────────
ERROR: (InvalidResourceGroupLocation) Invalid resource group location 'southindia'.
The Resource group already exists in location 'centralindia'.
```

**Cause:** Existing `Cribliv` RG is in `centralindia`, plan assumed `southindia`.
**Fix:** Edited `infra/azure-setup.sh` line 14: `LOCATION="southindia"` → `LOCATION="centralindia"`.

### Task 5 attempt 2 — FAILED at step 2 (ACR)

```
── 1. Resource Group ─────────────────────────────────────────────────────
✓ RG returned (idempotent, centralindia)

── 2. Azure Container Registry ───────────────────────────────────────────
ERROR: (MissingSubscriptionRegistration) The subscription is not registered to use
namespace 'Microsoft.ContainerRegistry'. See https://aka.ms/rps-not-found
```

**Cause:** Subscription had never used ACR or Container Apps before — `Microsoft.ContainerRegistry` and `Microsoft.App` providers both `NotRegistered`. (`Microsoft.OperationalInsights` was already `Registered`.)
**Fix:**

```bash
az provider register --namespace Microsoft.ContainerRegistry &
az provider register --namespace Microsoft.App &
wait
```

Polled every 20s — both reached `Registered` at poll 6 (~100s total).

### Task 5 attempt 3 — running…

---

## 4. Operational runbook

### 4.1 Redeploy after code changes

```bash
cd /Users/satviksarthak/Cribliv_v2
./infra/deploy.sh
```

### 4.2 Redeploy a specific commit (rollback)

```bash
SHA=abc1234 ./infra/deploy.sh
# Or directly:
az containerapp update --name cribliv-api    --resource-group Cribliv --image criblivacr.azurecr.io/cribliv-api:abc1234
az containerapp update --name cribliv-worker --resource-group Cribliv --image criblivacr.azurecr.io/cribliv-api:abc1234
```

Takes ~30s, no downtime.

### 4.3 Update a single env var without a full redeploy

```bash
az containerapp update --name cribliv-api --resource-group Cribliv \
  --set-env-vars "FF_VOICE_AGENT_REALTIME=false"
```

### 4.4 Rotate a secret

```bash
az containerapp secret set --name cribliv-api --resource-group Cribliv \
  --secrets "azure-openai-api-key=<new-key>"
# Then bump revisions:
az containerapp update --name cribliv-api --resource-group Cribliv
```

### 4.5 Watch logs (live)

```bash
az containerapp logs show --name cribliv-api    --resource-group Cribliv --follow
az containerapp logs show --name cribliv-worker --resource-group Cribliv --follow
```

### 4.6 Get the API URL

```bash
az containerapp show --name cribliv-api --resource-group Cribliv \
  --query "properties.configuration.ingress.fqdn" -o tsv
# Health: https://<that fqdn>/v1/health
```

### 4.7 Run a migration after schema change

```bash
DATABASE_URL="postgresql://CriblivAdmin:DBAdmin%402026@cribliv-db.postgres.database.azure.com:5432/cribliv?sslmode=require" \
  pnpm --filter=@cribliv/api db:migrate
```

### 4.8 Tear down (DESTRUCTIVE — don't run unless you mean it)

```bash
# Only deletes Container Apps + ACR + env, NOT cognitive services or Postgres:
az containerapp delete --name cribliv-api    --resource-group Cribliv --yes
az containerapp delete --name cribliv-worker --resource-group Cribliv --yes
az containerapp env delete --name cribliv-env --resource-group Cribliv --yes
az acr delete --name criblivacr --resource-group Cribliv --yes
```

---

## 5. What YOU need to do (now and ongoing)

### Now (while Task 5 finishes and downstream tasks run)

- [x] Fill 6 placeholders in `infra/set-env-vars.sh` ✅ done
- [ ] Confirm any prompt I send before Task 6, 7, 8 (I show the command first)
- [ ] If anything fails, read the error I paste and tell me how to proceed

### After the deployment is up

- [ ] **Vercel env setup** — copy `apps/web/.env.local` values into Vercel project (Settings → Environment Variables). Set `NEXT_PUBLIC_API_BASE_URL=https://<cribliv-api FQDN>/v1`.
- [ ] **Frontend deploy** — push to the Vercel git integration or run `vercel --prod` from `apps/web/`.
- [ ] **CORS tighten-up** — once Vercel URL is known, change `CORS_ALLOWED_ORIGINS` on cribliv-api from `*` to that URL. One-liner above (section 4.3).
- [ ] **Test the golden path** — hit `/v1/health`, then trigger mock OTP, complete a sign-up, create a listing. Watch logs for unexpected errors.

### Before going to production (not testing) later

- [ ] Switch ACR auth from admin credentials → managed identity + AcrPull role.
- [ ] Tighten Postgres firewall (currently `AllowAll`) to specific Container App outbound IPs.
- [ ] Replace `OTP_PROVIDER=mock` with `d7` and add `D7_KEY`, `OTP_API_KEY`, `OTP_SENDER_ID` to the script + secrets.
- [ ] Wire payments: `PAYMENT_PROVIDER_KEY`, `RAZORPAY_WEBHOOK_SECRET`, `UPI_WEBHOOK_SECRET` (skipped here per your decision).
- [ ] Add observability — populate `SENTRY_DSN` once the API actually reads it (code doesn't reference it yet).
- [ ] Set `FF_REAL_VERIFICATION_PROVIDER=true` and wire whichever provider you choose.

---

## 6. Outstanding items / known issues

| Issue                                                         | Severity                     | Notes                                                                                                                                           |
| ------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres firewall is wide open (`0.0.0.0–255.255.255.255`)    | High (prod), Low (testing)   | Acceptable for testing. Tighten before any prod use.                                                                                            |
| ACR uses admin credentials                                    | Medium (prod), Low (testing) | Same as above.                                                                                                                                  |
| `CORS_ALLOWED_ORIGINS="*"`                                    | Medium (prod), Low (testing) | Tighten to Vercel URL once known.                                                                                                               |
| Worker has no autoscaling                                     | Low                          | `--min-replicas 1 --max-replicas 1` is intentional — sweep jobs should not run concurrently.                                                    |
| No `apps/web/.env.local` handling                             | Frontend deploy blocker      | Out of scope for this plan; handle on Vercel side.                                                                                              |
| Three uncommitted files (`infra/*.sh`)                        | Tracking                     | Per your decision: no commits. `set-env-vars.sh` contains real secrets in working tree (will be `git restore`d after Task 6).                   |
| `cribliv-realtime-openai` (eastus) resource exists but unused | Cleanup later                | The `.env` uses `adars-moibam2t-eastus2` instead. Probably an experimental resource — safe to delete from the Azure portal if confirmed unused. |

---

## 7. Branch & git state at handover

- Working in `/Users/satviksarthak/Cribliv_v2` on branch `master` (origin/master).
- Three uncommitted infra changes (per your decision to not commit).
- One pre-existing modified file: `apps/api/tsconfig.tsbuildinfo` (not touched by this work — TypeScript build artifact).
- Two untracked dirs: `docs/superpowers/plans/`, `docs/superpowers/specs/2026-05-16-azure-deployment-design.md` (pre-existing, not touched).

After Task 6 completes and I run `git restore infra/set-env-vars.sh`, only `infra/azure-setup.sh` and `infra/deploy.sh` will remain dirty in the working tree. You can then commit those two when you're ready (suggested message: `infra: add Azure testing deployment scripts for cribliv-api + cribliv-worker`).

---

## 8. Progress log (live updates below)

| Task                                                           | Status     | Started | Finished | Notes                                                         |
| -------------------------------------------------------------- | ---------- | ------- | -------- | ------------------------------------------------------------- |
| 1. Prereqs                                                     | ✅         | 16:??   | 16:??    | az 2.85.0, git 2.50.1, sub matches                            |
| 2. azure-setup.sh edit                                         | ✅         |         |          | 5 markers verified, syntax OK                                 |
| 3. set-env-vars.sh edit (iter 1)                               | ✅         |         |          |                                                               |
| 3a. set-env-vars.sh edit (iter 2 — added missing backend vars) | ✅         |         |          | After user pointed out gaps, code grep confirmed missing vars |
| 4. deploy.sh create                                            | ✅         |         |          | `chmod +x` applied, syntax OK                                 |
| Checkpoint: user fills placeholders                            | ✅         |         |          | All 6 filled by user                                          |
| 5. azure-setup.sh attempt 1                                    | ❌ → fixed |         |          | RG location mismatch, fixed via LOCATION=centralindia         |
| 5. azure-setup.sh attempt 2                                    | ⏳ running |         |          |                                                               |
| 6. set-env-vars.sh run                                         | ⏳ pending |         |          | Will `git restore` immediately after                          |
| 7. Migrations                                                  | ⏳ pending |         |          | 23 migrations via `pnpm --filter=@cribliv/api db:migrate`     |
| 8. First deploy                                                | ⏳ pending |         |          | `az acr build` (~3 min) + 2× containerapp update              |
| 9. Verification                                                | ⏳ pending |         |          | Health check, worker logs, mock OTP                           |
