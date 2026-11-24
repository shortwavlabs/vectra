# P0-R-GEO Stage 13: SVG/PDF regression

**Result: PASS (automated).**
- Both exporters carry the validated scene's geometry exactly.
- Every PDF is vector-only with the right physical size.
- Independent renderers agree.
- The existing export reports are byte-identical to P0-R.
- **GUI inspection (Inkscape, macOS Preview) of bundle v2: OWNER TEST PENDING.**

## Checks
| Requirement | Evidence | Result |
|---|---|---|
| Both exporters consume the same validated geometry | SVG path numbers and decompressed PDF operands equal the scene coordinates: the rejected cases in spline mode (`geo_reproduce`) and in precision mode (`tests/precision.rs::owner_rejected_circles_meet_the_briefs_targets`) | PASS |
| Physical dimensions | All 36 bundle-v2 PDFs: MediaBox width 566.93 pt = 200 mm, height by aspect ratio. All 105 native samples: 425.20 pt = 150 mm | PASS |
| No embedded raster, fonts or external resources | qpdf object scan (no `/Image`, `/XObject`, `/Font`, `/Pattern`, `/Shading`, JavaScript) and `pdfimages -list` = 0 on 105 + 36 PDFs. The SVG allowlist test passes in 3 engines | PASS |
| Correct fill rules and transparent holes | Precision emits even-odd compound paths, like spline. Holes render see-through (resvg vs poppler render comparison; topology metric) | PASS |
| Colour and layer order | Paint order is VTracer's stacked order in both modes; render comparison | PASS |
| Deterministic serialisation | `public_setting_equals_the_evaluated_configuration_and_is_deterministic`; WASM fingerprint precision digest `07fdd00d…` (26 cases); native vs WASM precision SVG **26/26 byte-identical** | PASS |
| Independent renderer agreement (poppler vs resvg, 300 dpi) | Native samples: 105/105, worst 32-px block mean diff 0.93/255 (unchanged spline rows) and 0.76/255 (precision rows). Bundle v2: 36/36, worst 0.12/255 | PASS |
| No regression of the P0 PDF translucency fix | Engine test `translucent_fill_background_and_stroke_are_exported_without_alpha_leaks` passes | PASS |
| Spline exports unchanged | The 79 non-precision rows of the native report are **byte-identical** to the P0-R report | PASS |

Commands:
```bash
cargo run --release -p vector-engine --example export_samples -- tests/output/native
cargo build --release -p vector-engine --example render_compare
node scripts/verify-exports.mjs tests/output/native --dpi 300 --report docs/research/p0-r-geo/artifacts/export/export-verification-native-300dpi.tsv
node scripts/verify-exports.mjs docs/research/p0-r-geo/owner-acceptance-bundle-v2 --width-mm 200 --dpi 300 --report docs/research/p0-r-geo/artifacts/export/export-verification-bundle-v2-300dpi.tsv
NATIVE_SAMPLES_DIR=tests/output/native node scripts/wasm-fingerprint.mjs
```
Tools: qpdf 12.4.2 and poppler 26.11.0, local verification only; they are not bundled or distributed.

The precision geometry is in the scene itself, not a preview or PDF correction. The SVG, the PDF and the workbench preview (which renders the SVG) all carry it.

## Workbench (browser) path
`tests/browser/precision.spec.ts` (Chromium, Firefox, Playwright WebKit) chooses "Fit: precision" in the workbench, traces the two rejected fixtures through the production WASM build, and downloads the SVG:
- `04-color-discs`: byte-identical to `owner-acceptance-bundle-v2/04-color-discs-corrected-precision.svg` in all three engines.
- `05-color-transparent-hole`:
  - Chromium: byte-identical to the bundle file.
  - Firefox and WebKit decode partial alpha differently (P0 limitation), so the test checks the structure there: two subpaths and at most 8 cubics.
- `metrics.precisionFitVersion = 1` in every engine.

Result: 6/6 pass (Chromium, Firefox, WebKit), within the full suite of 54 passed, 9 skipped, 0 failed.

**Bundle v1 through the workbench.** `OWNER_BUNDLE=1 OWNER_BUNDLE_DIR=tests/output/bundle-v1-recheck pnpm exec playwright test tests/browser/owner-bundle.spec.ts --project=chromium` re-generates all 7 bundle-v1 cases with the final build. All **14/14 files are byte-identical** to `docs/research/p0-r/owner-acceptance-bundle/` (`artifacts/browser/bundle-v1-workbench-recheck.txt`).
