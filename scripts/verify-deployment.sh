#!/usr/bin/env bash
# Verifies a deployed (or locally served) Vectra build: HTTP responses, MIME types, security and
# cache headers, then the browser suite (CSP enforcement, tracing, export, privacy, offline
# cancellation recovery) against that origin.
# Usage: scripts/verify-deployment.sh https://<preview-host> [--headers-only]
set -euo pipefail
BASE="${1:?usage: verify-deployment.sh <base-url> [--headers-only]}"
BASE="${BASE%/}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
fail=0
check() { # name, url, expected-regex for "header: value" lines
  local name="$1" url="$2"; shift 2
  local headers; headers=$(curl -fsSI "$url" | tr -d '\r') || { echo "FAIL $name: request failed"; fail=1; return; }
  for re in "$@"; do
    if grep -qiE "$re" <<<"$headers"; then echo "ok   $name: $re"; else echo "FAIL $name: missing $re"; fail=1; fi
  done
}
index=$(curl -fsS "$BASE/")
js=$(grep -oE 'assets/index-[^"]+\.js' <<<"$index" | head -1)
worker=$(curl -fsS "$BASE/$js" | grep -oE 'vectorize\.worker-[^"]+\.js' | head -1)
wasm=$(curl -fsS "$BASE/sw.js" | grep -oE 'assets/vector_engine_wasm_bg-[^"]+\.wasm' | head -1)
CSP="content-security-policy: .*script-src 'self' 'wasm-unsafe-eval'"
check "index" "$BASE/" '^content-type: text/html' "$CSP" "x-content-type-options: nosniff" "referrer-policy: no-referrer" "cross-origin-opener-policy: same-origin" "x-frame-options: DENY"
check "main js" "$BASE/$js" '^content-type: (application|text)/javascript' "cache-control: .*immutable"
check "worker" "$BASE/assets/$worker" '^content-type: (application|text)/javascript' "$CSP" "cache-control: .*immutable"
check "wasm" "$BASE/$wasm" '^content-type: application/wasm' "cache-control: .*immutable"
check "service worker" "$BASE/sw.js" '^content-type: (application|text)/javascript' "cache-control: no-cache"
check "notices" "$BASE/THIRD-PARTY-NOTICES.txt" '^content-type: text/plain'
[ "${2:-}" = "--headers-only" ] && exit $fail
cd "$ROOT"
PW_BASE_URL="$BASE" pnpm exec playwright test tests/browser/smoke.spec.ts tests/browser/csp.spec.ts \
  tests/browser/privacy.spec.ts tests/browser/offline-recovery.spec.ts --reporter=list || fail=1
exit $fail
