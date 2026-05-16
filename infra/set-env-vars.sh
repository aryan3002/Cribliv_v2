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

# PostgreSQL (Azure Database for PostgreSQL Flexible Server, RG: CriblivV2_production)
DATABASE_URL="postgresql://CriblivAdmin:replace-me@cribliv-db.postgres.database.azure.com:5432/cribliv?sslmode=require"

# JWT secrets — generate: openssl rand -hex 32
JWT_ACCESS_SECRET="replace-with-64-char-hex-string"
JWT_REFRESH_SECRET="replace-with-different-64-char-hex-string"

# Azure Blob Storage (account: criblivimgstorage)
# NOTE: var names MUST match what the code reads (AZURE_STORAGE_* prefix)
AZURE_STORAGE_ACCOUNT_NAME="criblivimgstorage"
AZURE_STORAGE_ACCOUNT_KEY="replace-me"
AZURE_STORAGE_CONTAINER_LISTING_PHOTOS="listing-photos"
BLOB_CONTAINER_VERIFICATION="verification-artifacts"
AZURE_STORAGE_SAS_TTL_SECONDS="900"
PHOTO_MAX_FILE_SIZE_BYTES="10485760"
PHOTO_ALLOWED_MIME_TYPES="image/jpeg,image/png,image/webp"
PHOTO_PUBLIC_BASE_URL="https://criblivimgstorage.blob.core.windows.net/listing-photos"

# Azure OpenAI — extraction + conversation + chat/embedding deployments
# Lives on the cribliv2-openai resource (southindia). Endpoint + key as a single set.
AZURE_OPENAI_ENDPOINT="https://cribliv2-openai.openai.azure.com/"
AZURE_OPENAI_API_KEY="replace-me"
AZURE_OPENAI_EXTRACT_DEPLOYMENT="cribliv-chat"
AZURE_OPENAI_CONVERSATION_DEPLOYMENT="cribliv-chat"
AZURE_OPENAI_CHAT_DEPLOYMENT="cribliv-chat"
AZURE_OPENAI_EMBEDDING_DEPLOYMENT="cribliv-embed"
AZURE_AI_TIMEOUT_MS="20000"

# Azure OpenAI Realtime — gpt-realtime-mini is on a SEPARATE Azure Cognitive
# Services resource (East US 2). Different endpoint + key from the main one above.
AZURE_OPENAI_REALTIME_ENDPOINT="https://adars-moibam2t-eastus2.cognitiveservices.azure.com"
AZURE_OPENAI_REALTIME_API_KEY="replace-me"
AZURE_OPENAI_REALTIME_DEPLOYMENT="gpt-realtime-mini"
AZURE_OPENAI_REALTIME_VOICE="sage"                    # alloy | ash | sage | shimmer | echo

# Azure Cognitive Services Speech — STT + TTS for legacy voice pipeline
# Region MUST match the resource's region (cribliv-speech is in centralindia).
AZURE_SPEECH_KEY="replace-me"
AZURE_SPEECH_REGION="centralindia"

# Google Maps — server-side key for Distance Matrix / Routes
GOOGLE_MAPS_APIKEY="replace-me"

# CORS — use * for testing, or your Vercel URL
CORS_ALLOWED_ORIGINS="*"

# Providers
OTP_PROVIDER="mock"                 # mock = OTP printed in logs; d7 = real SMS
AI_ROUTER_PROVIDER="azure"
CAPTURE_MOCK="false"                # owner capture: false = use real OpenAI extractor

# Feature flags — enable all features for testing
FF_PRODUCTION_DB_ONLY="true"
FF_REAL_VERIFICATION_PROVIDER="false"
FF_PG_SALES_LEADS="true"
FF_VOICE_AGENT_ENABLED="true"
FF_VOICE_AGENT_REALTIME="true"
FF_VOICE_SEARCH="true"
FF_OWNER_LISTING_ASSISTED_CAPTURE="true"
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
FF_FEATURED_LISTINGS_ENABLED="true"
FF_AVAILABILITY_TOGGLE_ENABLED="true"
FF_PARTIAL_PHONE_REVEAL_ENABLED="true"
FF_POPULAR_LOCALITIES_ENABLED="true"
FF_SIMILAR_LISTINGS_ENABLED="true"

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
    "azure-openai-realtime-api-key=${AZURE_OPENAI_REALTIME_API_KEY}" \
    "azure-speech-key=${AZURE_SPEECH_KEY}" \
    "google-maps-apikey=${GOOGLE_MAPS_APIKEY}"

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
    AZURE_STORAGE_SAS_TTL_SECONDS="${AZURE_STORAGE_SAS_TTL_SECONDS}" \
    PHOTO_MAX_FILE_SIZE_BYTES="${PHOTO_MAX_FILE_SIZE_BYTES}" \
    PHOTO_ALLOWED_MIME_TYPES="${PHOTO_ALLOWED_MIME_TYPES}" \
    PHOTO_PUBLIC_BASE_URL="${PHOTO_PUBLIC_BASE_URL}" \
    OTP_PROVIDER="${OTP_PROVIDER}" \
    AI_ROUTER_PROVIDER="${AI_ROUTER_PROVIDER}" \
    CAPTURE_MOCK="${CAPTURE_MOCK}" \
    AZURE_OPENAI_ENDPOINT="${AZURE_OPENAI_ENDPOINT}" \
    AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key \
    AZURE_OPENAI_EXTRACT_DEPLOYMENT="${AZURE_OPENAI_EXTRACT_DEPLOYMENT}" \
    AZURE_OPENAI_CONVERSATION_DEPLOYMENT="${AZURE_OPENAI_CONVERSATION_DEPLOYMENT}" \
    AZURE_OPENAI_CHAT_DEPLOYMENT="${AZURE_OPENAI_CHAT_DEPLOYMENT}" \
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT="${AZURE_OPENAI_EMBEDDING_DEPLOYMENT}" \
    AZURE_AI_TIMEOUT_MS="${AZURE_AI_TIMEOUT_MS}" \
    AZURE_OPENAI_REALTIME_ENDPOINT="${AZURE_OPENAI_REALTIME_ENDPOINT}" \
    AZURE_OPENAI_REALTIME_API_KEY=secretref:azure-openai-realtime-api-key \
    AZURE_OPENAI_REALTIME_DEPLOYMENT="${AZURE_OPENAI_REALTIME_DEPLOYMENT}" \
    AZURE_OPENAI_REALTIME_VOICE="${AZURE_OPENAI_REALTIME_VOICE}" \
    AZURE_SPEECH_KEY=secretref:azure-speech-key \
    AZURE_SPEECH_REGION="${AZURE_SPEECH_REGION}" \
    GOOGLE_MAPS_APIKEY=secretref:google-maps-apikey \
    FF_PRODUCTION_DB_ONLY="${FF_PRODUCTION_DB_ONLY}" \
    FF_REAL_VERIFICATION_PROVIDER="${FF_REAL_VERIFICATION_PROVIDER}" \
    FF_PG_SALES_LEADS="${FF_PG_SALES_LEADS}" \
    FF_VOICE_AGENT_ENABLED="${FF_VOICE_AGENT_ENABLED}" \
    FF_VOICE_AGENT_REALTIME="${FF_VOICE_AGENT_REALTIME}" \
    FF_VOICE_SEARCH="${FF_VOICE_SEARCH}" \
    FF_OWNER_LISTING_ASSISTED_CAPTURE="${FF_OWNER_LISTING_ASSISTED_CAPTURE}" \
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
    FF_LISTING_ANALYTICS_ENABLED="${FF_LISTING_ANALYTICS_ENABLED}" \
    FF_FEATURED_LISTINGS_ENABLED="${FF_FEATURED_LISTINGS_ENABLED}" \
    FF_AVAILABILITY_TOGGLE_ENABLED="${FF_AVAILABILITY_TOGGLE_ENABLED}" \
    FF_PARTIAL_PHONE_REVEAL_ENABLED="${FF_PARTIAL_PHONE_REVEAL_ENABLED}" \
    FF_POPULAR_LOCALITIES_ENABLED="${FF_POPULAR_LOCALITIES_ENABLED}" \
    FF_SIMILAR_LISTINGS_ENABLED="${FF_SIMILAR_LISTINGS_ENABLED}"

# ── Worker Container App ──────────────────────────────────────────────────────
# Worker only needs DB + OpenAI (for embedding-recompute sweep job).
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
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT="${AZURE_OPENAI_EMBEDDING_DEPLOYMENT}" \
    AZURE_AI_TIMEOUT_MS="${AZURE_AI_TIMEOUT_MS}" \
    FF_PRODUCTION_DB_ONLY="${FF_PRODUCTION_DB_ONLY}" \
    FF_AI_EMBEDDINGS="${FF_AI_EMBEDDINGS}" \
    FF_AI_RANKING="${FF_AI_RANKING}" \
    FF_WHATSAPP_NOTIFICATIONS="false"

echo ""
echo "✓ Env vars applied to both Container Apps."
echo "  Run ./infra/deploy.sh to build and push the real image."
