#!/bin/sh
# R-COLOR-02 engine comparison: moxcms vs Little CMS vs ColorSync (sips). macOS only (sips).
# Usage: sh experiments/r-color/run-cmm.sh [out-dir]   (from the repository root)
set -eu
OUT=${1:-experiments/r-color/out/cmm}
P=/System/Library/ColorSync/Profiles
export RC_SRGB="$P/sRGB Profile.icc" RC_CMYK="$P/Generic CMYK Profile.icc" RC_P3="$P/Display P3.icc" RC_ADOBE="$P/AdobeRGB1998.icc"
mkdir -p "$OUT"
uptime > "$OUT/conditions.txt"
ps -Ao pcpu,comm -r | head -8 >> "$OUT/conditions.txt"
sw_vers >> "$OUT/conditions.txt"
shasum -a 256 "$RC_SRGB" "$RC_CMYK" "$RC_P3" "$RC_ADOBE" > "$OUT/profiles.sha256"
cargo build --release --manifest-path experiments/r-color/cmm/Cargo.toml --bin cmm_compare
BIN=experiments/r-color/cmm/target/release/cmm_compare
"$BIN" chart "$OUT/chart.png"
sips -e "$RC_SRGB" "$OUT/chart.png" --out "$OUT/chart-srgb.png" > /dev/null
for intent in perceptual relative saturation absolute; do
  sips -s format tiff -M "$RC_CMYK" "$intent" "$OUT/chart-srgb.png" --out "$OUT/sips-cmyk-$intent.tif" > /dev/null
done
sips -s format tiff -M "$RC_P3" relative "$OUT/chart-srgb.png" --out "$OUT/sips-p3-relative.tif" > /dev/null
sips -s format tiff -M "$RC_ADOBE" relative "$OUT/chart-srgb.png" --out "$OUT/sips-adobe-relative.tif" > /dev/null
"$BIN" compare "$OUT" "$OUT"
uptime >> "$OUT/conditions.txt"
echo "wrote $OUT/cmm-comparison.json"
