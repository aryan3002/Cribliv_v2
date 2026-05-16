# Cribliv v2 — Azure Testing Deployment Plan

> **Date:** 2026-05-16  
> **Environment:** Testing (not production-grade)  
> **Deploy method:** CLI only — `az acr build` + `az containerapp update`  
> **No GitHub Actions setup required**

---

## Summary

Deploy the Cribliv v2 NestJS backend (API + Worker) to Azure Container Apps for testing. The same Docker image serves both containers — the worker uses a CMD override to run `node dist/worker/worker.js` instead of `node dist/main.js`.

**3 files change. 9 tasks to execute.**

| File                    | Action | Why                                                               |
| ----------------------- | ------ | ----------------------------------------------------------------- |
| `infra/azure-setup.sh`  | Modify | Wrong RG/location, missing worker app, unneeded GitHub Actions SP |
| `infra/set-env-vars.sh` | Modify | Wrong blob var names, missing voice/AI vars, missing worker block |
| `infra/deploy.sh`       | Create | CLI deploy script doesn't exist yet                               |

---

## Architecture

```
┌─────────────────── Azure Resource Group: Cribliv (southindia) ──────────────────────┐
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐    │
│  │              Container Apps Environment: cribliv-env                        │    │
│  │                                                                             │    │
│  │  ┌──────────────────────────────┐   ┌────────────────────────────────────┐ │    │
│  │  │  cribliv-api                 │   │  cribliv-worker                    │ │    │
│  │  │  CMD: node dist/main.js      │   │  CMD: node dist/worker/worker.js   │ │    │
│  │  │  Port: 4000 (HTTPS external) │   │  No ingress (internal only)        │ │    │
│  │  │  Replicas: 1–2               │   │  Replicas: 1                       │ │    │
│  │  └──────────┬───────────────────┘   └──────────────┬─────────────────────┘ │    │
│  │             │ same image                            │ same image            │    │
│  │             └──────────────┬────────────────────────┘                      │    │
│  │                            ▼                                               │    │
│  │             ┌──────────────────────────┐                                   │    │
│  │             │  criblivacr.azurecr.io   │  (ACR Basic, admin credentials)  │    │
│  │             │  cribliv-api:<git-sha>   │                                   │    │
│  │             └──────────────────────────┘                                   │    │
│  └─────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                      │
│  External Azure services (pre-existing):                                             │
│  • Azure Database for PostgreSQL Flexible Server                                     │
│  • Azure Blob Storage (listing photos via SAS, verification artifacts)               │
│  • Azure OpenAI (chat extraction + embeddings + realtime WebRTC concierge)           │
│  • Azure Cognitive Services Speech (STT + TTS for legacy voice agent)                │
└──────────────────────────────────────────────────────────────────────────────────────┘

Deploy flow (CLI, run from monorepo root):
  Terminal → az acr build (uploads source, builds in Azure ~3 min)
           → az containerapp update (API, ~30s)
           → az containerapp update (Worker, ~30s)
```

---

## Prerequisites

Before starting any task, verify:

```bash
# Azure CLI installed
az --version

# Logged in
az account show --query "{name:name,id:id}"
# Expected subscription ID: 462382ee-6cdd-44a8-bf3c-5ecfb68e61da

# If wrong subscription:
az account set --subscription 462382ee-6cdd-44a8-bf3c-5ecfb68e61da

# Git available (deploy.sh uses git rev-parse for image tagging)
git --version
```

**Values to collect before Task 6 (have them ready):**

```
[ ] DATABASE_URL        postgres://user:pass@host.postgres.database.azure.com:5432/cribliv_v2?sslmode=require
[ ] AZURE_STORAGE_ACCOUNT_NAME   Azure Portal → Storage Accounts → your account → name
[ ] AZURE_STORAGE_ACCOUNT_KEY    Portal → Storage Account → Security + networking → Access keys → key1
[ ] AZURE_OPENAI_ENDPOINT        Portal → Azure OpenAI → Keys and Endpoint → Endpoint
[ ] AZURE_OPENAI_API_KEY         Portal → Azure OpenAI → Keys and Endpoint → KEY 1
[ ] AZURE_OPENAI_EXTRACT_DEPLOYMENT        your deployed model name (e.g. gpt-4o)
[ ] AZURE_OPENAI_CONVERSATION_DEPLOYMENT   your deployed model name
[ ] AZURE_OPENAI_REALTIME_DEPLOYMENT       your realtime model name (e.g. gpt-realtime-mini)
[ ] AZURE_SPEECH_KEY    Portal → Cognitive Services → Keys and Endpoint → KEY 1
```

---

## File 1: infra/azure-setup.sh (MODIFY)

**What changes:** Resource group `cribliv-rg` → `Cribliv`, location `centralindia` → `southindia`, add worker Container App, replace GitHub Actions SP step with ACR admin credential setup.

Replace the entire file with:

```bash
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-time Azure setup for Cribliv v2 — TESTING environment
#
# Creates: Resource Group → ACR (admin enabled) → Container Apps Environment
#          → cribliv-api (external HTTPS) + cribliv-worker (internal)
#
# No GitHub Actions service principal needed — CLI deploy only.
# Re-running is safe (resources already existing are skipped).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RESOURCE_GROUP="Cribliv"
LOCATION="southindia"
ACR_NAME="criblivacr"
APP_ENV="cribliv-env"
API_APP_NAME="cribliv-api"
WORKER_APP_NAME="cribliv-worker"

echo "▶ Subscription: $(az account show --query name -o tsv)"
echo "▶ Subscription ID: $(az account show --query id -o tsv)"

echo ""
echo "── 1. Resource Group ─────────────────────────────────────────────────────"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

echo ""
echo "── 2. Azure Container Registry (Basic SKU, admin credentials enabled) ───"
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --admin-enabled true

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
echo "   ACR login server: $ACR_LOGIN_SERVER"

echo ""
echo "── 3. Container Apps Environment ────────────────────────────────────────"
az containerapp env create \
  --name "$APP_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION"

echo ""
echo "── 4. API Container App (external HTTPS, port 4000) ─────────────────────"
az containerapp create \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$APP_ENV" \
  --image "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" \
  --target-port 4000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 2

echo ""
echo "── 5. Worker Container App (internal only, CMD override) ────────────────"
az containerapp create \
  --name "$WORKER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$APP_ENV" \
  --image "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" \
  --ingress none \
  --min-replicas 1 \
  --max-replicas 1 \
  --command "node" "dist/worker/worker.js"

echo ""
echo "── 6. Wire ACR admin credentials to both Container Apps ─────────────────"
ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

az containerapp registry set \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --server "$ACR_LOGIN_SERVER" \
  --username "$ACR_USERNAME" \
  --password "$ACR_PASSWORD"

az containerapp registry set \
  --name "$WORKER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --server "$ACR_LOGIN_SERVER" \
  --username "$ACR_USERNAME" \
  --password "$ACR_PASSWORD"

API_URL=$(az containerapp show \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  DONE — resources created in: $RESOURCE_GROUP ($LOCATION)"
echo "  API placeholder URL: https://$API_URL"
echo ""
echo "  Next steps:"
echo "  1. Fill in real values in infra/set-env-vars.sh"
echo "  2. Run: chmod +x infra/set-env-vars.sh && ./infra/set-env-vars.sh"
echo "  3. Run: pnpm --filter=@cribliv/api db:migrate"
echo "  4. Run: chmod +x infra/deploy.sh && ./infra/deploy.sh"
echo "════════════════════════════════════════════════════════════════════════"
```

---

## File 2: infra/set-env-vars.sh (MODIFY)

**What changes:**

- Fix `RESOURCE_GROUP` → `Cribliv`
- Fix blob storage var names (3 wrong names → correct names that code actually reads)
- Add all missing Azure OpenAI vars (conversation, realtime, voice, timeout)
- Move API key + speech key to secrets (not plain env vars)
- Add all feature flags for voice + AI features
- Add complete worker block

Replace the entire file with:

```bash
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Configure env vars on both Cribliv Container Apps — TESTING environment
#
# ⚠ Fill in ALL placeholder values below before running.
# ⚠ Do NOT commit this file after filling in real values.
# Re-running safely overwrites existing values.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RESOURCE_GROUP="Cribliv"
API_APP_NAME="cribliv-api"
WORKER_APP_NAME="cribliv-worker"

# ── Fill in your real values ──────────────────────────────────────────────────

# PostgreSQL (Azure Database for PostgreSQL Flexible Server)
DATABASE_URL="postgres://user:password@your-host.postgres.database.azure.com:5432/cribliv_v2?sslmode=require"

# JWT secrets — generate: openssl rand -hex 32
JWT_ACCESS_SECRET="replace-with-64-char-hex-string"
JWT_REFRESH_SECRET="replace-with-different-64-char-hex-string"

# Azure Blob Storage
# NOTE: var names MUST match what the code reads (AZURE_STORAGE_* prefix)
AZURE_STORAGE_ACCOUNT_NAME="replace-me"
AZURE_STORAGE_ACCOUNT_KEY="replace-me"
AZURE_STORAGE_CONTAINER_LISTING_PHOTOS="listing-photos"
BLOB_CONTAINER_VERIFICATION="verification-artifacts"

# Azure OpenAI — extraction + conversation + realtime voice concierge
AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/"
AZURE_OPENAI_API_KEY="replace-me"
AZURE_OPENAI_EXTRACT_DEPLOYMENT="gpt-4o"              # your deployed model name
AZURE_OPENAI_CONVERSATION_DEPLOYMENT="gpt-4o"         # can reuse same deployment
AZURE_OPENAI_REALTIME_DEPLOYMENT="gpt-realtime-mini"  # or your realtime deployment
AZURE_OPENAI_REALTIME_VOICE="sage"                    # alloy | ash | sage | shimmer | echo
AZURE_AI_TIMEOUT_MS="20000"

# Azure Cognitive Services Speech — STT + TTS for legacy voice pipeline
AZURE_SPEECH_KEY="replace-me"
AZURE_SPEECH_REGION="southindia"

# CORS — use * for testing, or your Vercel URL
CORS_ALLOWED_ORIGINS="*"

# Providers
OTP_PROVIDER="mock"           # mock = OTP printed in logs; d7 = real SMS
AI_ROUTER_PROVIDER="azure"

# Feature flags — enable all features for testing
FF_PRODUCTION_DB_ONLY="true"
FF_REAL_VERIFICATION_PROVIDER="false"
FF_PG_SALES_LEADS="true"
FF_VOICE_AGENT_ENABLED="true"
FF_VOICE_AGENT_REALTIME="true"
FF_AI_INTENT_CLASSIFIER="true"
FF_AI_EMBEDDINGS="true"
FF_AI_RANKING="true"
FF_AI_CONVERSATION_CONTEXT="true"
FF_GEO_SEARCH_ENABLED="true"
FF_LEAD_MANAGEMENT_ENABLED="true"
FF_FRAUD_DETECTION_ENABLED="true"
FF_MAP_BROWSING_ENABLED="true"
FF_SAVED_SEARCH_ALERTS_ENABLED="true"
FF_SUBSCRIPTION_PLANS_ENABLED="true"
FF_SEEKER_PINS_ENABLED="true"
FF_ALERT_ZONES_ENABLED="true"
FF_LISTING_ANALYTICS_ENABLED="true"

# ── API Container App ─────────────────────────────────────────────────────────

echo "▶ Storing secrets on API Container App…"
az containerapp secret set \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets \
    "database-url=${DATABASE_URL}" \
    "jwt-access-secret=${JWT_ACCESS_SECRET}" \
    "jwt-refresh-secret=${JWT_REFRESH_SECRET}" \
    "azure-storage-account-key=${AZURE_STORAGE_ACCOUNT_KEY}" \
    "azure-openai-api-key=${AZURE_OPENAI_API_KEY}" \
    "azure-speech-key=${AZURE_SPEECH_KEY}"

echo "▶ Setting env vars on API Container App…"
az containerapp update \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars \
    NODE_ENV=production \
    PORT=4000 \
    CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS}" \
    DATABASE_URL=secretref:database-url \
    JWT_ACCESS_SECRET=secretref:jwt-access-secret \
    JWT_REFRESH_SECRET=secretref:jwt-refresh-secret \
    AZURE_STORAGE_ACCOUNT_NAME="${AZURE_STORAGE_ACCOUNT_NAME}" \
    AZURE_STORAGE_ACCOUNT_KEY=secretref:azure-storage-account-key \
    AZURE_STORAGE_CONTAINER_LISTING_PHOTOS="${AZURE_STORAGE_CONTAINER_LISTING_PHOTOS}" \
    BLOB_CONTAINER_VERIFICATION="${BLOB_CONTAINER_VERIFICATION}" \
    OTP_PROVIDER="${OTP_PROVIDER}" \
    AI_ROUTER_PROVIDER="${AI_ROUTER_PROVIDER}" \
    AZURE_OPENAI_ENDPOINT="${AZURE_OPENAI_ENDPOINT}" \
    AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key \
    AZURE_OPENAI_EXTRACT_DEPLOYMENT="${AZURE_OPENAI_EXTRACT_DEPLOYMENT}" \
    AZURE_OPENAI_CONVERSATION_DEPLOYMENT="${AZURE_OPENAI_CONVERSATION_DEPLOYMENT}" \
    AZURE_OPENAI_REALTIME_DEPLOYMENT="${AZURE_OPENAI_REALTIME_DEPLOYMENT}" \
    AZURE_OPENAI_REALTIME_VOICE="${AZURE_OPENAI_REALTIME_VOICE}" \
    AZURE_AI_TIMEOUT_MS="${AZURE_AI_TIMEOUT_MS}" \
    AZURE_SPEECH_KEY=secretref:azure-speech-key \
    AZURE_SPEECH_REGION="${AZURE_SPEECH_REGION}" \
    FF_PRODUCTION_DB_ONLY="${FF_PRODUCTION_DB_ONLY}" \
    FF_REAL_VERIFICATION_PROVIDER="${FF_REAL_VERIFICATION_PROVIDER}" \
    FF_PG_SALES_LEADS="${FF_PG_SALES_LEADS}" \
    FF_VOICE_AGENT_ENABLED="${FF_VOICE_AGENT_ENABLED}" \
    FF_VOICE_AGENT_REALTIME="${FF_VOICE_AGENT_REALTIME}" \
    FF_AI_INTENT_CLASSIFIER="${FF_AI_INTENT_CLASSIFIER}" \
    FF_AI_EMBEDDINGS="${FF_AI_EMBEDDINGS}" \
    FF_AI_RANKING="${FF_AI_RANKING}" \
    FF_AI_CONVERSATION_CONTEXT="${FF_AI_CONVERSATION_CONTEXT}" \
    FF_GEO_SEARCH_ENABLED="${FF_GEO_SEARCH_ENABLED}" \
    FF_LEAD_MANAGEMENT_ENABLED="${FF_LEAD_MANAGEMENT_ENABLED}" \
    FF_FRAUD_DETECTION_ENABLED="${FF_FRAUD_DETECTION_ENABLED}" \
    FF_MAP_BROWSING_ENABLED="${FF_MAP_BROWSING_ENABLED}" \
    FF_SAVED_SEARCH_ALERTS_ENABLED="${FF_SAVED_SEARCH_ALERTS_ENABLED}" \
    FF_SUBSCRIPTION_PLANS_ENABLED="${FF_SUBSCRIPTION_PLANS_ENABLED}" \
    FF_SEEKER_PINS_ENABLED="${FF_SEEKER_PINS_ENABLED}" \
    FF_ALERT_ZONES_ENABLED="${FF_ALERT_ZONES_ENABLED}" \
    FF_LISTING_ANALYTICS_ENABLED="${FF_LISTING_ANALYTICS_ENABLED}"

# ── Worker Container App ──────────────────────────────────────────────────────
# Worker only needs DB + OpenAI (for ranking recompute) + Speech (not used in worker)
# All sweep jobs connect directly to PostgreSQL via the DATABASE_URL pool.

echo ""
echo "▶ Storing secrets on Worker Container App…"
az containerapp secret set \
  --name "$WORKER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets \
    "database-url=${DATABASE_URL}" \
    "azure-openai-api-key=${AZURE_OPENAI_API_KEY}"

echo "▶ Setting env vars on Worker Container App…"
az containerapp update \
  --name "$WORKER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars \
    NODE_ENV=production \
    DATABASE_URL=secretref:database-url \
    AZURE_OPENAI_ENDPOINT="${AZURE_OPENAI_ENDPOINT}" \
    AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key \
    FF_PRODUCTION_DB_ONLY="${FF_PRODUCTION_DB_ONLY}" \
    FF_WHATSAPP_NOTIFICATIONS="false"

echo ""
echo "✓ Env vars applied to both Container Apps."
echo "  Run ./infra/deploy.sh to build and push the real image."
```

---

## File 3: infra/deploy.sh (CREATE — new file)

Create this file at `infra/deploy.sh`:

```bash
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# CLI deploy for Cribliv v2 — build in ACR, roll both Container Apps.
#
# No GitHub Actions, no local Docker needed.
# Run from the monorepo root: ./infra/deploy.sh
#
# Usage:
#   ./infra/deploy.sh           — deploy current HEAD
#   SHA=abc1234 ./infra/deploy.sh  — deploy a specific commit
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RESOURCE_GROUP="Cribliv"
ACR_NAME="criblivacr"
API_APP_NAME="cribliv-api"
WORKER_APP_NAME="cribliv-worker"

SHA="${SHA:-$(git rev-parse --short HEAD)}"
IMAGE="${ACR_NAME}.azurecr.io/cribliv-api:${SHA}"

echo "════════════════════════════════════════════════════════════════════════"
echo "  Deploying cribliv-api:${SHA}"
echo "  Resource group: $RESOURCE_GROUP"
echo "════════════════════════════════════════════════════════════════════════"

echo ""
echo "── Step 1: Build image in Azure Container Registry ─────────────────────"
echo "   (Source is uploaded to ACR and built there — no local Docker needed)"
az acr build \
  --registry "$ACR_NAME" \
  --image "cribliv-api:${SHA}" \
  --file Dockerfile \
  .

echo ""
echo "── Step 2: Roll API Container App ──────────────────────────────────────"
az containerapp update \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$IMAGE"

echo ""
echo "── Step 3: Roll Worker Container App ───────────────────────────────────"
az containerapp update \
  --name "$WORKER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$IMAGE"

FQDN=$(az containerapp show \
  --name "$API_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" \
  -o tsv)

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  SHA:     $SHA"
echo "  Image:   $IMAGE"
echo "  API URL: https://$FQDN"
echo "  Health:  https://$FQDN/v1/health"
echo "════════════════════════════════════════════════════════════════════════"
```

---

## Execution Tasks

### Task 1: Verify Prerequisites

```bash
az --version          # Azure CLI installed
git --version         # git available
az account show --query "{name:name,id:id}" -o table
# Confirm subscription ID: 462382ee-6cdd-44a8-bf3c-5ecfb68e61da
```

If wrong subscription:

```bash
az account set --subscription 462382ee-6cdd-44a8-bf3c-5ecfb68e61da
```

---

### Task 2: Update infra/azure-setup.sh

- [ ] Read current file: `infra/azure-setup.sh`
- [ ] Replace entire file with content from **File 1** section above
- [ ] Verify changes: `git diff infra/azure-setup.sh`
- [ ] Commit: `git add infra/azure-setup.sh && git commit -m "infra: fix azure-setup for Cribliv RG/southindia, add worker app"`

---

### Task 3: Update infra/set-env-vars.sh

- [ ] Read current file: `infra/set-env-vars.sh`
- [ ] Replace entire file with content from **File 2** section above (keep placeholder values — do NOT fill in real values yet)
- [ ] Verify changes: `git diff infra/set-env-vars.sh`
- [ ] Commit: `git add infra/set-env-vars.sh && git commit -m "infra: fix blob var names, add voice/AI vars, add worker block"`

---

### Task 4: Create infra/deploy.sh

- [ ] Create new file `infra/deploy.sh` with content from **File 3** section above
- [ ] Make executable: `chmod +x infra/deploy.sh`
- [ ] Commit: `git add infra/deploy.sh && git commit -m "infra: add CLI deploy script"`

---

### Task 5: Run azure-setup.sh — One-time Infrastructure

```bash
cd /Users/satviksarthak/Cribliv_v2
chmod +x infra/azure-setup.sh
./infra/azure-setup.sh
```

Expected runtime: 4–7 minutes. Watch for errors.

**Verify resources created:**

```bash
az resource list --resource-group Cribliv --output table
```

Expected rows:

- `criblivacr` (Microsoft.ContainerRegistry/registries)
- `cribliv-env` (Microsoft.App/managedEnvironments)
- `cribliv-api` (Microsoft.App/containerApps)
- `cribliv-worker` (Microsoft.App/containerApps)

---

### Task 6: Fill in set-env-vars.sh and Run It

- [ ] Open `infra/set-env-vars.sh` in editor
- [ ] Fill in every `replace-me` value from the prerequisites checklist
- [ ] Run:

```bash
chmod +x infra/set-env-vars.sh
./infra/set-env-vars.sh
```

Expected: Prints "Storing secrets…" and "Setting env vars…" for API, then Worker. No errors.

**Verify secrets on API:**

```bash
az containerapp secret list \
  --name cribliv-api \
  --resource-group Cribliv \
  --output table
```

Expected secrets: `database-url`, `jwt-access-secret`, `jwt-refresh-secret`, `azure-storage-account-key`, `azure-openai-api-key`, `azure-speech-key`

**IMPORTANT: Do NOT commit set-env-vars.sh with real values.**

```bash
git restore infra/set-env-vars.sh  # reset to placeholder version
```

---

### Task 7: Run Database Migrations

**Allow your IP through the PostgreSQL firewall (if needed):**

```bash
MY_IP=$(curl -s ifconfig.me)
az postgres flexible-server firewall-rule create \
  --resource-group Cribliv \
  --name your-postgres-server-name \
  --rule-name allow-dev-machine \
  --start-ip-address "$MY_IP" \
  --end-ip-address "$MY_IP"
```

**Run all 23 migrations:**

```bash
DATABASE_URL="postgres://user:pass@your-host.postgres.database.azure.com:5432/cribliv_v2?sslmode=require" \
  pnpm --filter=@cribliv/api db:migrate
```

Expected: Each migration file printed, ending with no error.

**Verify (optional):**

```bash
psql "$DATABASE_URL" -c "\dt" 2>/dev/null | head -30
```

---

### Task 8: First Deploy

```bash
cd /Users/satviksarthak/Cribliv_v2
./infra/deploy.sh
```

Expected output sequence:

1. `Building cribliv-api:<sha> in Azure Container Registry...` — takes ~3 min
2. `Rolling API Container App...` — takes ~30s
3. `Rolling Worker Container App...` — takes ~30s
4. Final block with API URL and health URL

---

### Task 9: Verify

**API health check:**

```bash
FQDN=$(az containerapp show \
  --name cribliv-api \
  --resource-group Cribliv \
  --query "properties.configuration.ingress.fqdn" -o tsv)

curl -s "https://$FQDN/v1/health" | jq .
```

Expected: `200 OK` with JSON. If 503, wait 15s and retry (cold start from scale-to-zero).

**Worker logs (confirm all 11 jobs started):**

```bash
az containerapp logs show \
  --name cribliv-worker \
  --resource-group Cribliv \
  --tail 30
```

Expected: JSON log line with `"worker": "started"` and `"jobs": [...]` listing all 11 jobs.

**Test mock OTP login:**

```bash
# Trigger OTP send (mock — prints code in API logs)
curl -X POST "https://$FQDN/v1/auth/otp/send" \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999901"}'

# Check logs for OTP code
az containerapp logs show --name cribliv-api --resource-group Cribliv --tail 20
# Look for: "Mock OTP: 123456"
```

---

## Day-to-Day Commands

```bash
# Redeploy after code changes (run from monorepo root)
./infra/deploy.sh

# Watch API logs live
az containerapp logs show --name cribliv-api --resource-group Cribliv --follow

# Watch worker logs live
az containerapp logs show --name cribliv-worker --resource-group Cribliv --follow

# Get API URL
az containerapp show \
  --name cribliv-api \
  --resource-group Cribliv \
  --query "properties.configuration.ingress.fqdn" -o tsv

# Update a single env var without full redeploy
az containerapp update \
  --name cribliv-api \
  --resource-group Cribliv \
  --set-env-vars "SOME_VAR=new-value"

# Run migrations after schema changes
DATABASE_URL="postgres://..." pnpm --filter=@cribliv/api db:migrate
```

---

## Rollback

If a deploy breaks something, roll both apps back to any previous SHA:

```bash
PREVIOUS_SHA="paste-git-sha-here"

az containerapp update \
  --name cribliv-api \
  --resource-group Cribliv \
  --image criblivacr.azurecr.io/cribliv-api:$PREVIOUS_SHA

az containerapp update \
  --name cribliv-worker \
  --resource-group Cribliv \
  --image criblivacr.azurecr.io/cribliv-api:$PREVIOUS_SHA
```

Takes ~30s. No downtime during rollback.

---

## Environment Variable Reference

| Variable                                 | Set As  | Used By      | Notes                                     |
| ---------------------------------------- | ------- | ------------ | ----------------------------------------- |
| `DATABASE_URL`                           | Secret  | API + Worker | PostgreSQL connection string              |
| `JWT_ACCESS_SECRET`                      | Secret  | API          | Bearer token signing                      |
| `JWT_REFRESH_SECRET`                     | Secret  | API          | Refresh token signing                     |
| `AZURE_STORAGE_ACCOUNT_NAME`             | Env var | API          | Blob photo upload                         |
| `AZURE_STORAGE_ACCOUNT_KEY`              | Secret  | API          | Blob SAS generation                       |
| `AZURE_STORAGE_CONTAINER_LISTING_PHOTOS` | Env var | API          | Photo container name                      |
| `BLOB_CONTAINER_VERIFICATION`            | Env var | API          | Verification artifacts                    |
| `AZURE_OPENAI_ENDPOINT`                  | Env var | API + Worker | Base URL for all OpenAI calls             |
| `AZURE_OPENAI_API_KEY`                   | Secret  | API + Worker | Auth for all OpenAI calls                 |
| `AZURE_OPENAI_EXTRACT_DEPLOYMENT`        | Env var | API          | Listing data extraction model             |
| `AZURE_OPENAI_CONVERSATION_DEPLOYMENT`   | Env var | API          | Voice agent conversation model            |
| `AZURE_OPENAI_REALTIME_DEPLOYMENT`       | Env var | API          | WebRTC realtime model (gpt-realtime-mini) |
| `AZURE_OPENAI_REALTIME_VOICE`            | Env var | API          | Realtime voice (sage/alloy/ash/etc.)      |
| `AZURE_AI_TIMEOUT_MS`                    | Env var | API          | OpenAI request timeout (default 20000)    |
| `AZURE_SPEECH_KEY`                       | Secret  | API          | Azure Cognitive Services auth             |
| `AZURE_SPEECH_REGION`                    | Env var | API          | southindia                                |
| `OTP_PROVIDER`                           | Env var | API          | `mock` (logs code) or `d7` (real SMS)     |
| `AI_ROUTER_PROVIDER`                     | Env var | API          | `azure` enables real AI features          |
| `FF_VOICE_AGENT_ENABLED`                 | Env var | API          | Enables Socket.IO voice gateway           |
| `FF_VOICE_AGENT_REALTIME`                | Env var | API          | Enables WebRTC realtime concierge         |
| `FF_AI_*`                                | Env var | API          | Enable AI intent/embedding/ranking        |

---

## Feature Flags — Testing Values

All flags default to `false` unless set. For testing, set these to `true`:

| Flag                            | Default | Set to   | Unlocks                          |
| ------------------------------- | ------- | -------- | -------------------------------- |
| `FF_VOICE_AGENT_ENABLED`        | false   | **true** | Socket.IO voice gateway          |
| `FF_VOICE_AGENT_REALTIME`       | false   | **true** | WebRTC realtime concierge (Maya) |
| `FF_AI_INTENT_CLASSIFIER`       | false   | **true** | AI-powered search intent         |
| `FF_AI_EMBEDDINGS`              | false   | **true** | pgvector embedding search        |
| `FF_AI_RANKING`                 | false   | **true** | Composite score ranking          |
| `FF_AI_CONVERSATION_CONTEXT`    | false   | **true** | Conversational search context    |
| `FF_GEO_SEARCH_ENABLED`         | false   | **true** | PostGIS geo search               |
| `FF_LEAD_MANAGEMENT_ENABLED`    | false   | **true** | PG sales leads                   |
| `FF_FRAUD_DETECTION_ENABLED`    | false   | **true** | Fraud feed + flags               |
| `FF_MAP_BROWSING_ENABLED`       | false   | **true** | CriblMap                         |
| `FF_SUBSCRIPTION_PLANS_ENABLED` | false   | **true** | Owner subscription plans         |
| `FF_SEEKER_PINS_ENABLED`        | false   | **true** | Seeker location pins             |
| `FF_ALERT_ZONES_ENABLED`        | false   | **true** | Geo alert zones                  |

Flags that stay `false` for testing:

- `FF_REAL_VERIFICATION_PROVIDER` — keep false (uses mock verification)
- `FF_AADHAAR_EKYC_ENABLED` — keep false

---

## Opus Execution Prompt

Copy this prompt when handing off to Opus:

```
Read this plan file first:
/Users/satviksarthak/ObsidianVault 2/03-Development/Projects/Cribliv-v2/Deployment/azure-testing-deployment-plan.md

Then invoke `superpowers:executing-plans` to execute it task by task with review checkpoints.

Context:
- Project root: /Users/satviksarthak/Cribliv_v2
- Azure subscription: 462382ee-6cdd-44a8-bf3c-5ecfb68e61da
- Resource group: Cribliv (southindia)
- ACR name: criblivacr

Rules:
- Read every file before editing it (never overwrite blindly)
- Tasks 2–4 are file edits — use the exact content from the plan
- Tasks 5–9 run az CLI commands — show me the command before running it so I can confirm
- After Task 4 (file edits done), pause and ask me to fill in real values in set-env-vars.sh before continuing
- Do NOT commit set-env-vars.sh after I fill in real values — run git restore infra/set-env-vars.sh immediately after running it
- Invoke `superpowers:verification-before-completion` before marking any task complete
- If any az command fails, stop and show me the full error — do not try to work around it
```
