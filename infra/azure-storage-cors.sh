#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Configure CORS on the Azure Storage Account used for listing photos.
#
# Browsers PUT directly to the SAS-signed blob URL when uploading listing
# photos. Without a storage-account CORS rule the preflight OPTIONS request
# is rejected with:
#   "No 'Access-Control-Allow-Origin' header is present on the requested
#    resource."
#
# This script is idempotent — it clears existing blob-service CORS rules
# then re-adds the ones below. Re-run after adding/removing allowed origins.
#
# Required env vars (or defaults shown):
#   AZURE_STORAGE_ACCOUNT_NAME   default: criblivimgstorage
#   AZURE_STORAGE_ACCOUNT_KEY    REQUIRED — pulled from set-env-vars.sh
#   CORS_BLOB_ALLOWED_ORIGINS    default: localhost + Vercel prod + previews
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ACCOUNT_NAME="${AZURE_STORAGE_ACCOUNT_NAME:-criblivimgstorage}"
ACCOUNT_KEY="${AZURE_STORAGE_ACCOUNT_KEY:-}"

if [[ -z "${ACCOUNT_KEY}" ]]; then
  echo "✗ AZURE_STORAGE_ACCOUNT_KEY is required." >&2
  echo "  Either export it, or:" >&2
  echo "    export AZURE_STORAGE_ACCOUNT_KEY=\$(az storage account keys list \\" >&2
  echo "      --account-name ${ACCOUNT_NAME} --query '[0].value' -o tsv)" >&2
  exit 1
fi

# Default origins: localhost dev, the production Vercel domain, and the
# preview-deployment pattern. Override by exporting CORS_BLOB_ALLOWED_ORIGINS
# as a comma-separated list (Azure CORS does not natively support wildcards
# inside an origin — each origin must be exact, e.g. "https://app.example.com".
# Use "*" only as a single entry, never combined with specific origins).
DEFAULT_ORIGINS=(
  "http://localhost:3000"
  "http://localhost:3001"
  "https://cribliv-v2-web.vercel.app"
)
if [[ -n "${CORS_BLOB_ALLOWED_ORIGINS:-}" ]]; then
  IFS=',' read -r -a ORIGINS <<< "${CORS_BLOB_ALLOWED_ORIGINS}"
else
  ORIGINS=("${DEFAULT_ORIGINS[@]}")
fi

ALLOWED_METHODS="GET HEAD OPTIONS PUT"
# Headers the browser sends on the SAS PUT preflight. x-ms-blob-type is the
# Block Blob marker; the rest are required by the Azure SDK / browser fetch.
ALLOWED_HEADERS="x-ms-blob-type,x-ms-version,x-ms-date,content-type,content-length,authorization,if-match,if-none-match"
# Response headers we want the browser to expose to JS (mostly for debugging).
EXPOSED_HEADERS="x-ms-request-id,x-ms-version,content-length,content-type,etag"
MAX_AGE_SECONDS=3600

echo "▶ Storage account : ${ACCOUNT_NAME}"
echo "▶ Origins         : ${ORIGINS[*]}"
echo "▶ Methods         : ${ALLOWED_METHODS}"
echo "▶ Max age         : ${MAX_AGE_SECONDS}s"
echo ""

echo "── 1. Clearing existing blob-service CORS rules ──────────────────────────"
az storage cors clear \
  --services b \
  --account-name "${ACCOUNT_NAME}" \
  --account-key "${ACCOUNT_KEY}"

echo ""
echo "── 2. Adding CORS rule per origin ────────────────────────────────────────"
for origin in "${ORIGINS[@]}"; do
  echo "   + ${origin}"
  az storage cors add \
    --services b \
    --account-name "${ACCOUNT_NAME}" \
    --account-key "${ACCOUNT_KEY}" \
    --origins "${origin}" \
    --methods ${ALLOWED_METHODS} \
    --allowed-headers "${ALLOWED_HEADERS}" \
    --exposed-headers "${EXPOSED_HEADERS}" \
    --max-age "${MAX_AGE_SECONDS}" \
    --output none
done

echo ""
echo "── 3. Verification ───────────────────────────────────────────────────────"
az storage cors list \
  --services b \
  --account-name "${ACCOUNT_NAME}" \
  --account-key "${ACCOUNT_KEY}" \
  --output table

echo ""
echo "✓ Blob-service CORS configured. Preflight should now succeed."
echo "  Note: CORS rule changes can take up to ~30s to propagate."
