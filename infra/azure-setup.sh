#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-time Azure setup for Cribliv API on Container Apps
#
# Run this ONCE from your local machine. After it succeeds, all future
# deploys happen automatically via GitHub Actions on every push to main.
#
# Prerequisites:
#   brew install azure-cli    (macOS)
#   az login
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Customise these values ────────────────────────────────────────────────────
RESOURCE_GROUP="cribliv-rg"
LOCATION="centralindia"           # or eastus, westeurope, etc.
ACR_NAME="criblivacr"             # Must be globally unique & lowercase only
APP_ENV="cribliv-env"
APP_NAME="cribliv-api"
# ─────────────────────────────────────────────────────────────────────────────

echo "▶ Using subscription: $(az account show --query name -o tsv)"
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

echo ""
echo "── 1. Resource Group ────────────────────────────────────────────────────"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

echo ""
echo "── 2. Azure Container Registry ─────────────────────────────────────────"
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic

ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv)
echo "   ACR login server: $ACR_LOGIN_SERVER"

echo ""
echo "── 3. Container Apps Environment ────────────────────────────────────────"
az containerapp env create \
  --name "$APP_ENV" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION"

echo ""
echo "── 4. Container App (placeholder image — real image arrives from CI) ────"
az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$APP_ENV" \
  --image "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest" \
  --target-port 4000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 3

echo ""
echo "── 5. Managed identity → AcrPull (so Container App can pull images) ─────"
az containerapp identity assign \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --system-assigned

PRINCIPAL_ID=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query identity.principalId -o tsv)

ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)

az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role AcrPull \
  --scope "$ACR_ID"

# Wire the managed identity to the container app registry config
az containerapp registry set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --server "$ACR_LOGIN_SERVER" \
  --identity system

echo ""
echo "── 6. Service principal for GitHub Actions ──────────────────────────────"
echo "   Creating SP with Contributor on the resource group + AcrBuild on ACR…"

SP_JSON=$(az ad sp create-for-rbac \
  --name "github-cribliv-deploy" \
  --role Contributor \
  --scopes "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}" \
  --json-auth)

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo "  DONE. Copy the JSON below and add it as a GitHub secret:"
echo "  Repository → Settings → Secrets → Actions → New secret"
echo "  Name:  AZURE_CREDENTIALS"
echo "  Value: (the JSON block below)"
echo "════════════════════════════════════════════════════════════════════════"
echo "$SP_JSON"
echo ""

APP_URL=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn -o tsv)

echo "════════════════════════════════════════════════════════════════════════"
echo "  Your Container App URL:  https://$APP_URL"
echo ""
echo "  Next steps:"
echo "  1. Add AZURE_CREDENTIALS to GitHub → Settings → Secrets → Actions"
echo "  2. Run infra/set-env-vars.sh to configure the API environment variables"
echo "  3. Add to Vercel: NEXT_PUBLIC_API_BASE_URL=https://$APP_URL/v1"
echo "  4. Push to main → CI deploys the real image automatically"
echo "════════════════════════════════════════════════════════════════════════"
