# Validation and benchmark plan
Targets are provisional. Results are in docs/research/p0, docs/research/p0-r and docs/research/p0-r-geo.

**Geometric fidelity (P0-R-GEO, 2026-11-24).** An analytic geometry corpus of 42 fixtures (validation, held-out, negative controls) is scored with validated metrics:
- centre, radius, radial and curvature deviation;
- tangent continuity, corners, topology and complexity.

Thresholds were pre-registered in docs/research/p0-r-geo/GEOMETRIC-FIDELITY-METRICS.md. Precision fit passes 34 of 44 fixtures (spline: 0). Per-fixture results and every miss are in GEOMETRY-VALIDATION.md. Default (spline) outputs are byte-identical across a 114-case regression corpus.

**Tested state (2026-11-24):**
- **Executed:**
  - Synthetic corpus and geometry quality, including an analytic 4× deviation probe.
  - Export verification: qpdf, pdfimages, and poppler vs resvg renders.
  - Privacy interception, offline workflow and offline cancellation recovery.
  - Desktop performance on an upscaled corpus (P0) and on a native-resolution CC0/public-domain corpus (P0-R).
  - Cross-host WASM output equivalence (macOS vs Linux).
- **Platforms:** macOS arm64 and Ubuntu 24.04 arm64 (container); Chromium 159, Firefox 159, Playwright WebKit 27.2.
- **Not yet run:**
  - linux/amd64 (emulation crashes rustc).
  - Real Safari, iOS and Android.
  - Owner art review and Inkscape/Preview round-trips (bundle prepared).
  - Real deployment (owner action).
- **Open quality items:** the IoU ≥ 0.98 target is still **missed** by default spline fitting on the star (0.977) and rings (0.975). P0-R proposes measuring edge deviation against analytic shapes; see GEOMETRY-QUALITY-DISPOSITION. Thresholds are not changed until the maintainer decides.

## Corpus
Create procedural fixtures: circle, nested rings, sharp corners, 1px strokes, transparent antialiased logo, adjacent color blocks, gradient, checkerboard, noise, rotated EXIF JPEG, malformed input and oversized header. Add licensed/public-domain photos, scans and botanical artwork with source/license/hash manifest. No private user artwork in public repo. Hold out a separate art set.

## Quality
Rasterize vectors independently at source size; measure binary IoU (target >=0.98 on simple synthetic shapes), color error (Lab delta E summary), topology (component/hole counts exact on synthetic fixtures), edge deviation, path/anchor count and bytes. Report per-fixture metrics, not just averages. Stylized presets assessed against declared tone mapping, vector-only content, repeatability, and manual blind review; pixel similarity is not the goal for stylistic output. Compare Illustrator/Inkscape if owner supplies exports; record settings and versions.

## Export gate
Parse generated SVG XML, allowlist elements/attributes, assert zero image/foreignObject/external references. Inspect PDF with qpdf and pdfimages -list or equivalent; assert zero image XObjects (including nested forms), check content streams contain path paint operators, page size within 0.1 pt, and render with independent PDF renderer. Compare output at 150/300 DPI to scene rendering; test clips, holes, alpha and overlapping fills. Reject unsupported geometry, no silent fallback. Round-trip inspect in Inkscape and a PDF viewer.

## Performance
Record hardware, browser/version, exact dependencies, dimensions, settings, cold/warm, p50/p95, peak memory where observable. Test 1, 4, 12 and 24 MP fixtures on desktop Chrome/Firefox/Safari, plus mobile Safari feasibility. Start with input cap 20 MiB/12 MP desktop and lower mobile limits pending evidence; show explicit resize choice. Proposed target 1 MP preview <=2s p95 on reference desktop; 4 MP final <=10s p95; no trace-induced main-thread long tasks >50ms during processing; cancellation UI acknowledgement <=200ms. Path cap starting 100k primitives, adjustable only with safety bounds. Report failures and do not claim universal support.

## Privacy and reliability
Intercept all requests during import/trace/export; assert no artwork bytes, names or settings leave device; repeat offline after assets load. Test malformed files, alpha, cancellation, stale results, rapid slider edits, memory cleanup over 20 jobs, worker crash recovery, keyboard navigation and screen-reader labels. Verify deterministic output hashes for identical input/settings/version/seed within declared runtime; cross-platform numerical tolerances documented.

## Evidence reporting
Each gate: PASS/PARTIAL/FAIL/NOT RUN; commit, tool versions, command, fixture IDs, raw logs/metrics, limitations and reproducer. No green gate based solely on code inspection. Keep CI lightweight; run expensive matrices locally or on explicit demand.
