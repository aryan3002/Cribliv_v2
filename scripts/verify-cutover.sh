#!/usr/bin/env bash
#
# verify-cutover.sh — prove a v1→v2 deploy is cutover-ready.
#
# Checks, against a target base URL:
#   1. homepage returns 200 (serving v2, not redirected away)
#   2. /sitemap_index.xml returns 200
#   3. /robots.txt matches the host (Disallow-all on *.vercel.app, Sitemap on cribliv.com)
#   4. every indexed v1 URL (from the GSC Pages export) 301s → a live v2 200
#
# Run it BEFORE the DNS flip against the Vercel deploy, and AFTER against cribliv.com:
#   ./scripts/verify-cutover.sh https://cribliv-v2-web.vercel.app
#   ./scripts/verify-cutover.sh https://cribliv.com
#
# Optional 2nd arg = path to the GSC Pages CSV (default ~/Downloads/cribliv/Pages.csv).
#
set -uo pipefail

BASE="${1:-https://cribliv.com}"
CSV="${2:-$HOME/Downloads/cribliv/Pages.csv}"
BASE="${BASE%/}"
MAX_URLS="${MAX_URLS:-25}"

pass=0
fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }          # no follow
first_hop() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "$1"; }
final_code() { curl -sL -o /dev/null -w '%{http_code}' --max-time 25 "$1"; }   # follow redirects

echo "== Cutover verification: $BASE =="

# 1. Homepage — follows the internal `/` → `/en` locale redirect; final must be 200.
c=$(final_code "$BASE/")
[ "$c" = "200" ] && ok "homepage 200 (after /→/en locale redirect)" || bad "homepage expected 200, got $c (redirecting to v1 or broken?)"

# 2. Sitemap
c=$(code "$BASE/sitemap_index.xml")
[ "$c" = "200" ] && ok "sitemap_index.xml 200" || bad "sitemap_index.xml expected 200, got $c"

# 3. robots.txt sanity (host-aware)
robots=$(curl -s --max-time 20 "$BASE/robots.txt")
host=$(printf '%s' "$BASE" | sed -E 's#https?://##; s#/.*##; s#:.*##')
if [ "$host" = "cribliv.com" ] || [ "$host" = "www.cribliv.com" ]; then
  printf '%s' "$robots" | grep -q "Sitemap:" \
    && ok "robots.txt allows indexing on $host" \
    || bad "robots.txt on the production host is NOT serving the allow/sitemap variant"
else
  printf '%s' "$robots" | grep -qE '^Disallow: /$' \
    && ok "robots.txt blocks indexing on non-production host ($host)" \
    || bad "robots.txt on $host is NOT Disallow-all — the preview could get indexed"
fi

# 4. v1 → v2 redirects (paths pulled from the GSC Pages export)
echo "-- v1 URL redirects (from $CSV) --"
if [ ! -f "$CSV" ]; then
  bad "GSC Pages CSV not found at $CSV — skipping redirect checks (pass it as arg 2)"
else
  paths=$(grep -oE 'https?://[^",[:space:]]*/(properties|pgs)/[^",[:space:]]*' "$CSV" \
            | sed -E 's#https?://[^/]+##' | sort -u | head -n "$MAX_URLS")
  if [ -z "$paths" ]; then
    bad "no /properties/ or /pgs/ URLs found in $CSV"
  else
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      read -r hop loc <<<"$(first_hop "$BASE$p")"
      fin=$(final_code "$BASE$p")
      if { [ "$hop" = "301" ] || [ "$hop" = "308" ]; } && [ "$fin" = "200" ]; then
        ok "$p → $hop → 200"
      else
        bad "$p → first=$hop final=$fin (want 301→200)  loc=${loc:-none}"
      fi
    done <<<"$paths"
  fi
fi

echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
