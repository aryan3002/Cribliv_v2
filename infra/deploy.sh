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

# Tag = git short SHA + UTC timestamp. Ensures every build gets a unique tag so
# `az containerapp update --image` always triggers a new revision (Container Apps
# caches by tag — reusing the same tag is a silent no-op even if image content
# changed). Override via: SHA=mytag ./infra/deploy.sh
SHA="${SHA:-$(git rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)}"
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
