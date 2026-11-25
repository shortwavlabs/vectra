#!/bin/sh
# R-COLOR-04 PDF structure prototype, structural checks and two independent renders.
# Usage: sh experiments/r-color/run-pdf.sh [out-dir]   (from the repository root; macOS for sips)
set -eu
OUT=${1:-experiments/r-color/out/pdf}
P=/System/Library/ColorSync/Profiles
export RC_SRGB="$P/sRGB Profile.icc" RC_CMYK="$P/Generic CMYK Profile.icc" RC_P3="$P/Display P3.icc"
mkdir -p "$OUT"
uptime > "$OUT/conditions.txt"
cargo build --release --manifest-path experiments/r-color/cmm/Cargo.toml --bin pdf_proto --bin render_sample
B=experiments/r-color/cmm/target/release
"$B/pdf_proto" "$OUT"
: > "$OUT/inspect.txt"
for f in "$OUT"/*.pdf; do
  v=$(basename "$f" .pdf)
  { echo "== $v"; qpdf --check "$f" 2>&1 | head -3; pdfinfo -box "$f" 2>&1 | grep -E "Box|PDF version";
    echo "pdfimages rows: $(pdfimages -list "$f" 2>&1 | tail -n +3 | wc -l | tr -d ' ')";
    echo "pdffonts rows: $(pdffonts "$f" 2>&1 | tail -n +3 | wc -l | tr -d ' ')";
    qpdf --qdf --object-streams=disable "$f" - | grep -a -c -E "GTS_PDFXVersion" | sed 's/^/GTS_PDFXVersion keys: /'; } >> "$OUT/inspect.txt"
  pdftoppm -r 72 -png -singlefile "$f" "$OUT/$v.poppler"
  sips -s format png "$f" --out "$OUT/$v.quartz.png" > /dev/null
done
"$B/render_sample" "$OUT"
uptime >> "$OUT/conditions.txt"
echo "wrote $OUT/pdf-proto.json $OUT/render-samples.json $OUT/inspect.txt"
