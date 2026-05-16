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
LOCATION="centralindia"
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
if az containerapp show --name "$API_APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  echo "   ✓ $API_APP_NAME already exists — skipping create"
else
  az containerapp create \
    --name "$API_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$APP_ENV" \
    --image "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" \
    --target-port 4000 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 2
fi

echo ""
echo "── 5. Worker Container App (no ingress, CMD override) ───────────────────"
if az containerapp show --name "$WORKER_APP_NAME" --resource-group "$RESOURCE_GROUP" &>/dev/null; then
  echo "   ✓ $WORKER_APP_NAME already exists — skipping create"
else
  az containerapp create \
    --name "$WORKER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$APP_ENV" \
    --image "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" \
    --min-replicas 1 \
    --max-replicas 1 \
    --command "node" "dist/worker/worker.js"
fi

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
