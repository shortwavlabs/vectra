# P0-R-GEO final report: geometric fidelity closure

Date: 2026-11-24 · Branch `p0/technical-feasibility` (PR #3, not merged) · Previously reviewed head `f5b7768` · Apple M5 Max, macOS 26.6.2. RFC-002 and P1 have not been started.

## Summary
**The defects.**
- The owner rejected the circular geometry of `04-color-discs` and `05-color-transparent-hole`.
- Both are reproduced byte-for-byte from the exact bundle settings.
- The distortion is in the tracing stage, not in serialisation. VTracer's spline construction:
  - fits through the corners of a binary pixel mask;
  - pushes the outline outward;
  - cuts it into noise-split slices;
  - fits each slice with one cubic at a 10 px tolerance, with no tangent continuity.
- The discs additionally suffer from about 6 % of antialiased blend pixels clustered on the wrong side.

**The correction: an explicit, opt-in precision fit mode** (`fit.mode = "precision"`, `PRECISION_FIT_VERSION` 1).
- **Unchanged from VTracer:** segmentation, colour fitting and stacking.
- **Replaced:** per-region curve fitting, with Vectra-owned code:
  - sub-pixel boundaries recovered from the antialiased source;
  - G1-continuous cubics, straight lines and rebuilt corners;
  - circles and arcs only where the residuals prove them.
- **Selection.** It was chosen over VTracer parameter tuning, a lattice-only refit and pure recognition, after an evaluation against thresholds pre-registered on a 42-fixture analytic corpus. The held-out set was run once, after the freeze.

**Results on the two rejected cases.**

| Case | Measure | P0 (spline) | Precision |
|---|---|---|---|
| 05 hole | RMS / max radial deviation | 0.315 / 0.640 px | 0.016 / 0.045 px |
| 05 hole | tangent breaks | 7 | 0 |
| 05 hole | path | 11 irregular cubics | a clean 4-cubic circle |
| 04 discs | centre error | up to 0.60 px | ≤ 0.05 px |
| 04 discs | RMS / max radial deviation | up to 0.53 / 1.05 px | ≤ 0.057 / 0.26 px |
| 04 discs | tangent breaks | 19 | 0 |

The curvature-uniformity target added in this study is still missed on the discs within a few pixels of three-colour junctions.

**Photographic tracing**, approved by the owner, is untouched. It stays the default, and 326 of 326 regression output files (114 cases, including the native-resolution photos) are byte-identical to the frozen baseline.

## Gate matrix
| Gate | Result | Evidence |
|---|---|---|
| Original circle defects reproduced | **PASS** | DEFECT-REPRODUCTION: bundle SVG and PDF reproduced byte-for-byte (05 needs the browser premultiplied-decode model). Scene = SVG = PDF coordinates. Per-stage error measured; annotated 16× overlays |
| Root cause established | **PASS** | ROOT-CAUSE-ANALYSIS: the VTracer replay equals the scene. Classified causes: lattice quantisation, outward outset (0.31–0.38 px), noise-split slices at a 10 px tolerance, no G1 joins, and (04 only) misassigned blend pixels. Serialisation ruled out (≤ 0.005 px) |
| Geometric metrics validated | **PASS** | GEOMETRIC-FIDELITY-METRICS. `geometry_metrics.rs` (3 tests): an ideal circle scores ~0; kinks and flattening are detected while IoU stays > 0.99; more nodes are not rewarded; occlusion and lost holes are handled. Three measurement amendments recorded and applied to every variant |
| Circle and ellipse correction | **PASS** for antialiased sources; tier C **PARTIAL** | All antialiased circles (r = 3–120, fractional centres, 2×2 to 16×16 antialiasing) and all 3 ellipses pass tier A/B, held-out included (centre ≤ 0.07, RMS ≤ 0.08, max ≤ 0.18 px, 0 breaks). The hard-thresholded circle meets only the tier C position limits (RMS 0.22, max 0.49 px; 10 breaks, 81 anchors) |
| Overlapping coloured disc correction | **PARTIAL** | All of the brief's targets are met on 04, `discs-two-wide` and held-out `h-discs-three` (worst centre 0.050, RMS 0.057, max 0.26 px). The position targets are also met on `discs-two-deep` (0.066 / 0.077 / 0.40) and `discs-x2`. Missed: the added curvature-uniformity target near junctions (04, `discs-two-deep`, `discs-x2`), one 16.5° break and one lower-layer speck on `discs-two-deep`, and a speck on `discs-x2`. Classified; the fix is architectural (P1) |
| Transparent circular hole correction | **PASS** | 05 passes every target, the added ones included. So do holes at r = 10/20/30/33/40, scale ×0.5/×2, rings, the thin alpha ring and the two-hole disc |
| General geometric regression | **PARTIAL** | Squares, rotated rectangles, triangle, compound holes and held-out rectangle pass. Missed by margin: straight-edge curvature next to rebuilt corners (star, rounded rectangles: 0.014–0.32 /px vs 0.005), and corners of 2–3 px bars (2.3 px). Spline fails every one of these worse |
| Organic negative controls | **PASS** | 7/7 (6 + held-out) follow the irregular truth: organic RMS ≤ 0.076 px, max ≤ 0.21 px, against spline's 0.31–0.54 / 0.6–1.24 px. **0 recognised substitutions** |
| Photographic regression | **PASS** | PHOTOGRAPHIC-REGRESSION: 326/326 files byte-identical to `7cdde36`, at `f51e265` and at `a4cf172`. The WASM 65-case output digest is unchanged (`68723671…`). Old Print is unchanged |
| Topology preservation | **PARTIAL** | Every hole, ring and component is kept, including 1 px holes and blobs that spline drops. Exception: one extra speck of a lower stacked layer's colour (≥ 1 px² at 4×) on 2 of 32 fixtures (spline: 3) |
| Performance regression | **PASS** | PERFORMANCE-REGRESSION: default modes unchanged within noise (−11 % to +3 %), equal peak heap. Precision: 1.0–2.4× time, equal heap, +4 % on the geometry corpus |
| SVG/PDF regression | **PASS** (automated); GUI **OWNER TEST PENDING** | EXPORT-REGRESSION: 105 native and 36 bundle-v2 PDFs, all vector-only, correct size, renderer agreement ≤ 0.93/255. Spline export report byte-identical to P0-R. Native = WASM precision SVG 26/26 |
| Offline/privacy regression | **PASS** | Full Playwright suite: **54 passed, 9 skipped** (opt-in benchmark and bundle generators), **0 failed**, in Chromium 159, Firefox 159 and Playwright WebKit 27.2. Covers CSP negative control, privacy interception (no artwork, filename or settings transmitted), offline workflow and cancellation recovery, service-worker update, and the new precision workbench test (`artifacts/browser/playwright-full-run.txt`) |
| MIT license and notices | **PASS** | `LICENSE` (Copyright (c) 2026 Stephane Pericat). THIRD-PARTY-NOTICES reproduces it and ships in `dist/`. The build `--check` passes. Decisions recorded |
| Owner visual acceptance | **OWNER TEST PENDING** | OWNER-ACCEPTANCE-CHECKLIST §A: bundle v2 (18 geometric cases, before/after SVG and PDF, contact sheet, 16× overlays, manifest with hashes) |

## Regression suite (executed)
- Rust: `cargo fmt --check` and `cargo clippy --workspace --all-targets --locked -D warnings` clean. `cargo test --workspace --locked` passes: 14 lib + 15 engine + 3 metric + 4 precision tests.
- TypeScript: `vp check` (format, lint, types) clean; `vp test` passes (14).
- Build: `pnpm run build` (WASM, bundle, notices `--check`, service worker, dist check) passes.
- Byte-level regression corpus: 326/326 identical. Native export verification: 105/105. Bundle v2 verification: 36/36. WASM fingerprint: default digest unchanged, precision 26/26 native = WASM.
- Browser: full Playwright suite 54 passed / 9 skipped / 0 failed (3 engines).
  - The workbench's "Fit: precision" reproduces bundle-v2 bytes: 04 in all 3 engines, 05 in Chromium.
  - Bundle v1, re-generated through the workbench (Chromium) with the final build, is **14/14 files byte-identical** (Talbot B&W, Hokusai limited, both Old Print cases included; `artifacts/browser/bundle-v1-workbench-recheck.txt`).

## Changes in P0-R-GEO
- **Commits** (focused, in the order the brief requires; full list in PR #3):
  1. MIT license and recorded decisions.
  2. Reproduction.
  3. Corpus, metrics and thresholds.
  4. Experiments.
  5. Selected implementation.
  6. Regression tests and evidence.
  7. Bundle v2 and docs.
- **Engine.**
  - `precision.rs`: about 1,000 lines plus tests, no new dependencies.
  - Precision path in `trace.rs`; `FitMode::Precision` with validation; `metrics.precisionFitVersion`.
  - The `#[doc(hidden)]` diagnostics `segment_layers` and `vectorize_with_precision_options`.
- **Workbench.** "Fit: precision", with simplify disabled and compositing coupled to stacked.
- **Tools.** `geo_reproduce`, `geo_corpus`, `geo_eval`, `geo_inspect`, `geo_bundle`, `geo_perf`, `regression_corpus`. Export samples and the WASM fingerprint gain precision cases.
- **Tests.** `tests/precision.rs`, `tests/geometry_metrics.rs`, `tests/browser/precision.spec.ts`. `[profile.test] opt-level = 2` keeps metric tests at about 15 s.
- **Docs.** All 11 required documents and `owner-acceptance-bundle-v2/`. README, VALIDATION, RFC-001 and the P0-R checklist and licensing documents are updated. All P0 and P0-R evidence is preserved, bundle v1 included.

## Not done or not run
- **Platforms.** The Linux container, Linux amd64, real Safari, mobile devices and a Cloudflare deployment were not repeated or run. This is deferred per the brief. Cross-host equality of the *precision* WASM output (macOS-built vs Linux-built) was therefore not measured in this phase; native vs WASM on macOS is identical.
- **GUI inspection.** No Inkscape or Preview inspection by engineering: Inkscape is absent, and this is the owner's test.
- **Out of scope.** No centreline tracing, no editor, no shared junction graph.

## Recommendation
**CONDITIONALLY READY — LIST REMAINING DECISIONS**

Both reported examples are corrected. The brief's numerical targets are met with large margins, and the approved photographic behaviour is provably unchanged. Remaining owner decisions (OWNER-ACCEPTANCE-CHECKLIST):
1. Visual acceptance of bundle v2 in Inkscape and macOS Preview, with 04 and 05 first.
2. Accept precision as an explicit opt-in fit mode with this name.
3. Accept or reject for P0 the remaining deviations:
   - curvature near three-colour junctions and the two lower-layer specks (P1: shared junction graph or label-level blend correction);
   - binary-edge (tier C) behaviour;
   - thin-bar and acute-corner positions;
   - straight-edge curvature next to rebuilt corners.
4. Approve the metric amendments and the tier B/C and acute-corner allowances.
5. Confirm the revisited P0-R items: 1-px diagonals deferred to P1 Line Art; partial-alpha and browser-decode limits unchanged; the transparency leak resolved down to pixel rounding.
