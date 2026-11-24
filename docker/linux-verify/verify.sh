#!/usr/bin/env bash
# Runs inside the container: clean clone of the committed branch from /src (read-only),
# then every P0 check, with timings, versions and artifact hashes written to /out.
set -uo pipefail
REF="${1:-HEAD}"
OUT=/out
mkdir -p "$OUT"
LOG="$OUT/verify.log"
: > "$LOG"
status=0
step() {
  local name="$1"; shift
  local t0; t0=$(date +%s%N)
  echo "### $name: $*" | tee -a "$LOG"
  if "$@" >>"$LOG" 2>&1; then r=PASS; else r=FAIL; status=1; fi
  local ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  printf '%-20s %-5s %6d.%01ds\n' "$name" "$r" $((ms / 1000)) $(((ms % 1000) / 100)) | tee -a "$OUT/summary.txt"
}
: > "$OUT/summary.txt"
{
  echo "uname: $(uname -srm)"; grep PRETTY_NAME /etc/os-release
  echo "node $(node --version), pnpm $(pnpm --version), $(rustc --version), $(cargo --version), $(wasm-bindgen --version)"
} | tee "$OUT/environment.txt"

step clone git clone --quiet /src /work/vectra
cd /work/vectra || exit 1
git checkout --quiet "$REF" && git log -1 --format='commit %H %s' | tee -a "$OUT/environment.txt"
step pnpm-install pnpm install --frozen-lockfile
step wasm-build node scripts/build-wasm.mjs
step vp-check pnpm exec vp check
step vp-test pnpm exec vp test
step cargo-fmt cargo fmt --all --check
step cargo-clippy cargo clippy --workspace --all-targets --locked -- -D warnings
step cargo-test cargo test --workspace --locked
step fixture-manifest node scripts/fixture-manifest.mjs --check
step production-build pnpm run build
if [ "${SKIP_BROWSERS:-0}" != "1" ]; then
  step browser-tests pnpm exec playwright test tests/browser/smoke.spec.ts tests/browser/csp.spec.ts \
    tests/browser/privacy.spec.ts tests/browser/offline-recovery.spec.ts --reporter=list
  cp tests/output/playwright-results.json "$OUT/playwright-results.json" 2>/dev/null || true
fi
step wasm-fingerprint node scripts/wasm-fingerprint.mjs "$OUT/wasm-fingerprint.json"
( cd packages/vector-engine-wasm/pkg && sha256sum * ) > "$OUT/wasm-pkg.sha256"
( cd dist && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > "$OUT/dist.sha256"
echo "exit status $status" | tee -a "$OUT/summary.txt"
exit $status
