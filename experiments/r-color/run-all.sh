#!/bin/sh
# Regenerates every R-COLOR measurement and copies the committed artifacts into
# docs/research/r-color/artifacts. macOS only (sips, system ICC profiles). Run from the repo root.
# Needs: pinned Rust 1.96.0 with wasm32-unknown-unknown, Node 24, root `pnpm install`
# (Playwright 1.65.1 browsers), qpdf and poppler. Writes nothing outside experiments/r-color/out
# and docs/research/r-color/artifacts.
set -eu
O=experiments/r-color/out
A=docs/research/r-color/artifacts
M=experiments/r-color/cmm/Cargo.toml
P=/System/Library/ColorSync/Profiles
export RC_SRGB="$P/sRGB Profile.icc" RC_CMYK="$P/Generic CMYK Profile.icc" RC_P3="$P/Display P3.icc" RC_ADOBE="$P/AdobeRGB1998.icc"
mkdir -p "$O" "$A/cmm" "$A/pdf" "$A/decode" "$A/fuzz"
echo "== $(date -u +%FT%TZ) start; $(uptime)" > "$O/run-all-conditions.txt"

cargo test --release --manifest-path "$M"
# 1. Engines: moxcms (NEON) vs Little CMS vs ColorSync; then scalar and tetrahedral builds.
sh experiments/r-color/run-cmm.sh "$O/cmm"
cargo build --release --manifest-path "$M" --no-default-features --features native --bin cmm_compare --target-dir experiments/r-color/cmm/target/scalar
mkdir -p "$O/cmm-scalar" "$O/cmm-tetra"
experiments/r-color/cmm/target/scalar/release/cmm_compare compare "$O/cmm" "$O/cmm-scalar"
cargo build --release --manifest-path "$M" --features tetra --bin cmm_compare --target-dir experiments/r-color/cmm/target/tetra
experiments/r-color/cmm/target/tetra/release/cmm_compare compare "$O/cmm" "$O/cmm-tetra"
# 2. WASM build and bit comparison against both native builds.
cargo build --release --manifest-path "$M" --target wasm32-unknown-unknown --no-default-features --lib
echo "== wasm-check; $(uptime)" >> "$O/run-all-conditions.txt"
node experiments/r-color/wasm-check.mjs "$O/cmm/moxcms-native.json" "$O/cmm-scalar/moxcms-native.json" > "$O/wasm-check.json"
# 3. PDF structures, renders, raster probe.
echo "== pdf; $(uptime)" >> "$O/run-all-conditions.txt"
sh experiments/r-color/run-pdf.sh "$O/pdf"
# 4. Browser decode probe.
cargo build --release --manifest-path "$M" --bin decode_inputs
experiments/r-color/cmm/target/release/decode_inputs "$O/decode"
sips -s format jpeg -s formatOptions best "$O/decode/untagged.png" --out "$O/decode/srgb-tagged.jpg" > /dev/null
sips -e "$O/decode/gen-display-p3.icc" "$O/decode/srgb-tagged.jpg" --out "$O/decode/icc-display-p3.jpg" > /dev/null
echo "== decode; $(uptime)" >> "$O/run-all-conditions.txt"
node experiments/r-color/browser-decode/probe.mjs "$O/decode"
# 5. Malformed-profile probe.
cargo build --release --manifest-path "$M" --bin icc_fuzz
echo "== fuzz; $(uptime)" >> "$O/run-all-conditions.txt"
experiments/r-color/cmm/target/release/icc_fuzz "$O/icc-fuzz.json" 2000
echo "== end; $(uptime)" >> "$O/run-all-conditions.txt"

# Copy numbers only: no PDFs, images or ICC profiles (they embed third-party profiles).
cp "$O/cmm/cmm-comparison.json" "$A/cmm/cmm-comparison.json"
cp "$O/cmm-tetra/cmm-comparison.json" "$A/cmm/cmm-comparison-tetrahedral.json"
cp "$O/cmm/profiles.sha256" "$O/wasm-check.json" "$A/cmm/"
{ head -1 "$O/cmm/cmm-patches.csv"; grep -E "^relative,.*,(lcms-float|moxcms-f32|colorsync-sips-u8)," "$O/cmm/cmm-patches.csv"; } > "$A/cmm/cmm-patches-relative.csv"
cp "$O/pdf/pdf-proto.json" "$O/pdf/render-samples.json" "$A/pdf/"
sed "s#$O/pdf/##" "$O/pdf/inspect.txt" > "$A/pdf/inspect.txt"
cp "$O/decode/expected.json" "$O/decode/browser-decode.json" "$A/decode/"
cp "$O/icc-fuzz.json" "$A/fuzz/icc-fuzz.json"
cp "$O/run-all-conditions.txt" "$A/run-all-conditions.txt"
pnpm exec vp fmt docs/research/r-color
echo "done: artifacts in $A"
