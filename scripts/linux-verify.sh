#!/usr/bin/env bash
# Local Linux reproducibility check (P0-R-G0). Requires Docker; uses no CI minutes.
# Usage: scripts/linux-verify.sh [--platform linux/amd64] [--skip-browsers] [ref]
# Verifies the committed state of <ref> (default: HEAD) from a clean clone inside a pinned
# Ubuntu 24.04 container; results land in tests/output/linux-<arch>/.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLATFORM="linux/$(docker info --format '{{.Architecture}}' | sed 's/aarch64/arm64/;s/x86_64/amd64/')"
SKIP=0
REF=HEAD
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --skip-browsers) SKIP=1; shift ;;
    *) REF="$1"; shift ;;
  esac
done
REF=$(git -C "$ROOT" rev-parse "$REF")
ARCH=${PLATFORM#linux/}
OUT="$ROOT/tests/output/linux-$ARCH"
rm -rf "$OUT" && mkdir -p "$OUT"
IMAGE="vectra-linux-verify:$ARCH"
docker build --platform "$PLATFORM" -t "$IMAGE" "$ROOT/docker/linux-verify"
docker image inspect "$IMAGE" --format '{{.Id}}' > "$OUT/image-id.txt"
docker run --rm --platform "$PLATFORM" --shm-size=2g -e SKIP_BROWSERS="$SKIP" \
  -v "$ROOT:/src:ro" -v "$OUT:/out" "$IMAGE" "$REF"
