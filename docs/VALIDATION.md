# Validation and benchmark plan
All gates unexecuted. Targets are provisional and must be ratified with P0 evidence.

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
