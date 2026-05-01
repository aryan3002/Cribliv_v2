#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Set environment variables on the Cribliv API Container App.
#
# Run this after azure-setup.sh, filling in your real values below.
# You can re-run it any time to update a variable.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Match these to what you used in azure-setup.sh ───────────────────────────
RESOURCE_GROUP="cribliv-rg"
APP_NAME="cribliv-api"
# ─────────────────────────────────────────────────────────────────────────────

# ── Fill in your real values ──────────────────────────────────────────────────
DATABASE_URL="postgres://user:password@your-azure-postgres-host:5432/cribliv_v2"
JWT_ACCESS_SECRET="replace-with-a-long-random-string"
JWT_REFRESH_SECRET="replace-with-a-different-long-random-string"
CORS_ALLOWED_ORIGINS="https://your-app.vercel.app"   # your Vercel frontend URL

BLOB_ACCOUNT_NAME="replace-me"
BLOB_ACCOUNT_KEY="replace-me"
BLOB_CONTAINER_LISTING_MEDIA="listing-media"
BLOB_CONTAINER_VERIFICATION="verification-artifacts"

# Leave as mock until you have real credentials
OTP_PROVIDER="mock"
AI_ROUTER_PROVIDER="mock"

# Azure AI / Speech (optional — leave empty to keep disabled)
AZURE_SPEECH_KEY=""
AZURE_SPEECH_REGION=""
AZURE_OPENAI_ENDPOINT=""
AZURE_OPENAI_API_KEY=""
AZURE_OPENAI_EXTRACT_DEPLOYMENT=""
# ─────────────────────────────────────────────────────────────────────────────

echo "▶ Storing secrets on Container App…"

az containerapp secret set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets \
    "database-url=${DATABASE_URL}" \
    "jwt-access-secret=${JWT_ACCESS_SECRET}" \
    "jwt-refresh-secret=${JWT_REFRESH_SECRET}" \
    "blob-account-key=${BLOB_ACCOUNT_KEY}"

echo "▶ Setting environment variables…"

az containerapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars \
    NODE_ENV=production \
    PORT=4000 \
    CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS}" \
    DATABASE_URL=secretref:database-url \
    JWT_ACCESS_SECRET=secretref:jwt-access-secret \
    JWT_REFRESH_SECRET=secretref:jwt-refresh-secret \
    BLOB_ACCOUNT_NAME="${BLOB_ACCOUNT_NAME}" \
    BLOB_ACCOUNT_KEY=secretref:blob-account-key \
    BLOB_CONTAINER_LISTING_MEDIA="${BLOB_CONTAINER_LISTING_MEDIA}" \
    BLOB_CONTAINER_VERIFICATION="${BLOB_CONTAINER_VERIFICATION}" \
    OTP_PROVIDER="${OTP_PROVIDER}" \
    AI_ROUTER_PROVIDER="${AI_ROUTER_PROVIDER}" \
    AZURE_SPEECH_KEY="${AZURE_SPEECH_KEY}" \
    AZURE_SPEECH_REGION="${AZURE_SPEECH_REGION}" \
    AZURE_OPENAI_ENDPOINT="${AZURE_OPENAI_ENDPOINT}" \
    AZURE_OPENAI_API_KEY="${AZURE_OPENAI_API_KEY}" \
    AZURE_OPENAI_EXTRACT_DEPLOYMENT="${AZURE_OPENAI_EXTRACT_DEPLOYMENT}" \
    FF_REAL_VERIFICATION_PROVIDER=false \
    FF_PG_SALES_LEADS=true \
    FF_PRODUCTION_DB_ONLY=true

echo ""
echo "✓ Environment variables set. Restart the Container App to apply:"
echo "  az containerapp revision restart --name $APP_NAME --resource-group $RESOURCE_GROUP --revision \$(az containerapp revision list --name $APP_NAME --resource-group $RESOURCE_GROUP --query '[0].name' -o tsv)"
