# P0 engineering postmortem (P0, P0-R, P0-R-GEO)

**Scope.** One engineering retrospective for the three feasibility phases on `p0/technical-feasibility` (PR #3):

| Phase | Purpose | Reviewed head | Final report |
|---|---|---|---|
| P0 | Technical feasibility | `37b6c02` | [P0 final report](p0/FINAL-REPORT.md) |
| P0-R | Engineering closure | `f5b7768` | [P0-R final report](p0-r/FINAL-REPORT.md) |
| P0-R-GEO | Geometric fidelity | `4a119b9` | [P0-R-GEO final report](p0-r-geo/FINAL-REPORT.md) |

**How to read it.**
- Detailed measurements live in the phase reports and are linked, not repeated.
- §3.1 and §3.2 are **measured findings** with their evidence.
- §3.3 holds **retrospective recommendations**: judgement, not measurement.
- Outstanding items are tracked in the [technical debt register](../TECHNICAL-DEBT.md), and the formal decision record is [P0-ACCEPTANCE](P0-ACCEPTANCE.md).

## 3.1 What worked
| Area | What was shown | Evidence |
|---|---|---|
| **Browser Rust/WASM architecture** | Pure-Rust engine (VTracer 1.0.0-alpha.4 behind `trace.rs`, visioncortex, pdf-writer) compiled with wasm-bindgen 0.2.130, running in Chromium, Firefox and WebKit under a strict CSP. Native and WASM output byte-identical for identical RGBA | [P0-G1](p0/P0-G1-VECTORIZATION.md), [P0-G4](p0/P0-G4-CLOUDFLARE-PAGES.md) (CSP negative control: `'wasm-unsafe-eval'` required) |
| **Web Worker isolation** | Module worker with a typed protocol. Processing never blocked the main thread: worst frame gap 19 ms, zero Chromium long tasks even at 24 MP | [P0-G2](p0/P0-G2-WORKER-ARCHITECTURE.md), [P0-R PERFORMANCE-BASELINE](p0-r/PERFORMANCE-BASELINE.md) finding 4 |
| **Local-first processing** | Zero network requests during sessions in 3 engines, re-verified on macOS and Linux arm64 and in every later suite run | [P0-G5](p0/P0-G5-PRIVACY-PERFORMANCE.md), `tests/browser/privacy.spec.ts` |
| **Canonical vector scene** | One validated, versioned scene (absolute M/L/C/Z, explicit fill rules, rect clips) feeds preview, SVG and PDF. It absorbed a whole new fitting mode in P0-R-GEO without a schema change | [P0-G3](p0/P0-G3-VECTOR-EXPORT.md), [SELECTED-CORRECTION](p0-r-geo/SELECTED-CORRECTION.md) |
| **Direct SVG and PDF generation** | Rust exporters from the scene. 79 + 12 PDFs (P0), then 105 + 36 (P0-R-GEO), pass qpdf, pdfimages (0 images, fonts or XObjects), MediaBox ±0.1 pt and poppler vs resvg. The jsPDF + svg2pdf.js alternative was larger, needed the DOM and was non-deterministic | [P0-G3](p0/P0-G3-VECTOR-EXPORT.md), [EXPORT-REGRESSION](p0-r-geo/EXPORT-REGRESSION.md). Translucency leak found and fixed in `25e7867` |
| **Deterministic serialisation** | Identical scene, SVG and PDF bytes across runs, across macOS- and Linux-built WASM (65/65 cases), and native vs WASM for precision (26/26). Enabled byte-level regression protection (326/326 files) | [LINUX-REPRODUCIBILITY](p0-r/LINUX-REPRODUCIBILITY.md), [PHOTOGRAPHIC-REGRESSION](p0-r-geo/PHOTOGRAPHIC-REGRESSION.md) |
| **Vite+ toolchain** | Vite+ 1.7.0 (Vite 8, Vitest, Oxlint, Oxfmt) plus pnpm 12; clean-clone `vp check`, `vp test`, `vp build`; lockfiles pinned | [P0-G0](p0/P0-G0-TOOLCHAIN.md) |
| **Offline operation** | The full workflow works offline once loaded | [P0-G5](p0/P0-G5-PRIVACY-PERFORMANCE.md) |
| **Service-worker recovery** | A content-versioned service worker precaches the build, so a terminated worker can be recreated offline under the unchanged CSP. Fixed the WebKit offline-cancel defect. Verified in 3 engines on 2 OSes, with deployment update tests | [OFFLINE-WORKER-RECOVERY](p0-r/OFFLINE-WORKER-RECOVERY.md), `566e5bf` |
| **Linux arm64 reproducibility** | Pinned Ubuntu 24.04 container; clean-clone script runs every check and the browser suites; no paid CI | [LINUX-REPRODUCIBILITY](p0-r/LINUX-REPRODUCIBILITY.md), `scripts/linux-verify.sh` |
| **Photographic tracing quality** | Approved by the maintainer (P0-R-GEO brief §2). Kept byte-identical through P0-R-GEO | [P0-ACCEPTANCE](P0-ACCEPTANCE.md) |
| **Precision fitting** | Opt-in `fit.mode = "precision"`. On the rejected hole: radial RMS 0.315 → 0.016 px, 0 tangent breaks, a 4-cubic circle. On the discs: centre error 0.60 → ≤ 0.05 px. 34/44 corpus fixtures pass every pre-registered target (spline: 0). Approved | [GEOMETRY-VALIDATION](p0-r-geo/GEOMETRY-VALIDATION.md), `a4cf172` |
| **Old Print halftone feasibility** | Vector dots; tone-to-area error ≤ 2.5 %; overlap-correct nonzero fill; raster-free exports | [OLD-PRINT-FEASIBILITY](p0/OLD-PRINT-FEASIBILITY.md) |
| **Licensing and notices** | MIT `LICENSE` (Copyright (c) 2026 Stephane Pericat). `THIRD-PARTY-NOTICES.txt` is generated from each dependency's own license files (35 components), shipped in `dist/` and checked by the build | [LICENSING-AND-DISTRIBUTION](p0-r/LICENSING-AND-DISTRIBUTION.md), `130e394`, `7cdde36` |

## 3.2 What we learned
### Photographs can look excellent while simple shapes look wrong
**Finding.** The same VTracer spline fitter produced outputs the owner approved for photographs and rejected for clean circles.
- On photographs, edges are irregular, and a 0.3–0.6 px wobble or a slightly flattened arc is invisible against image texture.
- On a circle, the eye expects constant curvature, and the same errors read as "hand-drawn".

The defect class is invisible on the content the tracer was tuned for.

**Evidence:** [DEFECT-REPRODUCTION](p0-r-geo/DEFECT-REPRODUCTION.md); bundle v1 cases 04 and 05 reproduced byte-for-byte (`d2f96de`).

### Aggregate IoU does not characterise geometric fidelity
**Finding.** In P0, the circle passed with IoU 0.994 while the star and rings (0.977 / 0.975) "only just" missed 0.98. In P0-R-GEO's metric validation, a deliberately flattened arc kept **IoU > 0.99** while its curvature error exceeded 0.3 and its radial deviation 0.3 px. IoU averages error over area; the eye sees boundary shape.

**What replaced it:**
- radial deviation and centre/radius fits against analytic truth;
- curvature uniformity (|κ|·r − 1);
- tangent breaks at joins;
- corner position and angle;
- topology per colour;
- complexity.

**Evidence:** [GEOMETRIC-FIDELITY-METRICS](p0-r-geo/GEOMETRIC-FIDELITY-METRICS.md); `tests/geometry_metrics.rs`; `0018ee4`.

### VTracer's outward contour bias
**Finding.** visioncortex's subdivision smoothing (`OUTSET_RATIO = 8`) pushes outlines outward:
- measured bias −0.38 px on the hole (it grows) and +0.31 px on the discs;
- the hole radius came out +0.27 px and the red disc +0.44 px too large.

The P0-R residual transparency leak (≤ 0.81 px from the edge) had the same origin.

**Evidence:** [ROOT-CAUSE-ANALYSIS](p0-r-geo/ROOT-CAUSE-ANALYSIS.md), stage table; [GEOMETRY-QUALITY-DISPOSITION](p0-r/GEOMETRY-QUALITY-DISPOSITION.md) §1, §4.

### The binary pixel staircase sets a floor
**Finding.**
- **Lost information.** Once an antialiased edge is thresholded, its sub-pixel position is gone. A crack contour of a circle deviates up to √2/2 ≈ 0.71 px (0.29–0.30 px RMS), and no downstream fitting recovers that.
- **Confirmation.** A G1 refit of lattice data alone ("D1g") passed only 4/32 fixtures, with thousands of tangent breaks.
- **Hard-edged sources.** Without any antialiasing, even the precision fitter reaches only the tier C position limits (RMS 0.22, max 0.49 px).

**Evidence:** [ALGORITHM-EVALUATION](p0-r-geo/ALGORITHM-EVALUATION.md); [TD-GEO-002](../TECHNICAL-DEBT.md#td-geo-002).

### Loose spline fitting and tangent discontinuities
**Finding.** VTracer slices outlines wherever the accumulated turn reaches 45° or the polygon direction "inflects" (often pixel noise). It then fits each slice independently at a **10 px** tolerance with no shared tangents:
- slice lengths 1.9–61 px;
- all 7 hole joins broken (up to 12.7°);
- curvature varying up to 7.8× the circle's.

Nine VTracer parameter settings could not fix this: at best 1/32 fixtures. These are internal constants, not settings.

**Evidence:** [ROOT-CAUSE-ANALYSIS](p0-r-geo/ROOT-CAUSE-ANALYSIS.md); [ALGORITHM-EVALUATION](p0-r-geo/ALGORITHM-EVALUATION.md) (D1 rows).

### Antialiased colour-boundary pixels get misclassified
**Finding.** Colour clustering assigns blend pixels by colour similarity, not geometry:
- 62 of 1,062 antialiased pixels (5.8 %) on the discs went to the wrong side;
- the lattice error rose to 0.83 px (above the 0.71 px quantisation bound);
- the blue and yellow centres moved by 0.6 px.

Saturated sub-pixel crossings (the edge lies beyond a pixel centre) are the symptom precision mode detects and drops.

**Evidence:** [ROOT-CAUSE-ANALYSIS](p0-r-geo/ROOT-CAUSE-ANALYSIS.md); `geo_inspect curvature` classification.

### Sub-pixel boundary recovery: what it can and cannot do
**Finding.**
- **What it does.** Placing each mask crack at the source's coverage crossing (the area estimator, exact for axis-aligned edges) recovers edge position to 0.005–0.08 px radial RMS on antialiased circles (r = 3–100). It cuts mean contour RMS from 0.42 to 0.046 px.
- **Guardrails.** It must be computed from *visible* labels, and kept between pixel centres to preserve topology.
- **Rejected alternatives:**
  - a variant that let crossings move past centres created kinks up to 147°;
  - a 4-pixel coverage window was worse on curves.
- **Limits.** It cannot help binary art, and it cannot fix a pixel assigned to the wrong colour region beyond one centre.

**Evidence:** [ALGORITHM-EVALUATION](p0-r-geo/ALGORITHM-EVALUATION.md); `f51e265`, which reproduces the rejected variants.

### Conservative primitive recognition
**Finding.**
- **What it adds.** Exact circular arcs, accepted only when residuals are at sampling-noise level (RMS ≤ 0.08 px, max ≤ 0.3 px, sagitta ≥ 1 px). This lifted the pass rate from 22 to 24 of 32 and made full circles 4-cubic.
- **No false positives.** **0 substitutions** across all 7 negative controls (hand-drawn, rough-ink, organic, egg, hand-drawn hole, held-out hand-drawn).
- **On lattice data** it never fires, which is correct.

Recognition is safe only on top of accurate sub-pixel data.

**Evidence:** [ALGORITHM-EVALUATION](p0-r-geo/ALGORITHM-EVALUATION.md); `artifacts/selection/recognition-substitutions.md`.

### Independent colour-region fitting creates shared-boundary artifacts
**Finding.** Stacked compositing traces each colour layer separately. A lower layer often redraws an edge a higher layer owns (396 of 554 flagged curvature samples on 04), and the two fits differ slightly, so:
- hairline slivers of the lower colour appear: on corrected 04, two yellow hairlines of 1.25–1.5 px² at the red disc's left and top edges;
- curvature becomes irregular within 2–6 px of three-colour junctions.

Fitter-level remedies did not remove them. The fix needs shared boundaries (a junction graph) or label-level blend correction.

**Evidence:** [GEOMETRY-VALIDATION](p0-r-geo/GEOMETRY-VALIDATION.md); `artifacts/selection/specks.txt`, `poppler-04-corrected-sliver-*.png`; [TD-GEO-001](../TECHNICAL-DEBT.md#td-geo-001).

### Native-resolution photographs are far more expensive than upscaled fixtures
**Finding.** P0's upscaled photographs understated cost.
- At genuine 12–24 MP, colour and limited colour took **5–12 s**, with 340 k–664 k anchors (12–24 MB SVG).
- 8 of 28 runs exceeded the 1 M-anchor budget.
- P0 had measured 24 MP limited at 5.9 s, against 12 s and 664 k anchors at 18 MP natively.

Upscaling adds pixels but not detail, and detail drives clustering cost and anchor count.

**Evidence:** [PERFORMANCE-BASELINE](p0-r/PERFORMANCE-BASELINE.md) findings 1–2.

### Preview rendering can become the main-thread bottleneck
**Finding.** Tracing in a worker never blocked the UI (≤ 19 ms gaps), but displaying the result did:
- painting 12–37 MB SVGs via `<img>` caused 83–183 ms frame gaps in Chromium;
- Firefox reached 1.35 s with an **850 ms** gap.

Worker isolation protects processing, not rendering.

**Evidence:** [PERFORMANCE-BASELINE](p0-r/PERFORMANCE-BASELINE.md) finding 4; [TD-PERF-001](../TECHNICAL-DEBT.md#td-perf-001).

### Terminate-and-recreate cancellation: trade-offs
**Finding.** A synchronous WASM call cannot observe a cancel message.
- **What termination gives:** immediate cancel (acknowledged ≤ 1 ms, visible ≤ 53 ms), memory reclamation and crash recovery.
- **What it costs:** all in-instance state (WASM heap, caches, VTracer's segmentation cache), and offline recreation needed the service worker.

Cooperative cancellation would need `SharedArrayBuffer` and cross-origin isolation, which was not adopted.

**Evidence:** [P0-G2](p0/P0-G2-WORKER-ARCHITECTURE.md); [OFFLINE-WORKER-RECOVERY](p0-r/OFFLINE-WORKER-RECOVERY.md); [TD-ARCH-002](../TECHNICAL-DEBT.md#td-arch-002).

### Editable document state must be separate from evaluated geometry
**Finding.**
- **What scene v1 is.** It is an *evaluation result*: absolute coordinates, no object identity, transforms baked in, quantised to 0.01 px. That is exactly what made exports trivial and deterministic.
- **Why it cannot be the document.** Re-tracing changes topology. Precision vs spline produce different geometry from the same intent. Worker termination destroys anything held in WASM.
- **What follows.** An editor needs a document of intent (objects, recipes, transforms, ids) from which scenes are derived.

**Evidence:** [P1-ARCHITECTURAL-INPUTS](p0-r/P1-ARCHITECTURAL-INPUTS.md); [ARCHITECTURE-RECONCILIATION](p0-r/ARCHITECTURE-RECONCILIATION.md).

## 3.3 What we would do differently (retrospective recommendations)
These are judgements drawn from the findings above, not measured results.
1. **Use realistic native-resolution photographs from the first benchmark.** Upscaled fixtures hid a 2× cost and the anchor-budget failures until P0-R.
2. **Include analytic geometry fixtures from the beginning,** with ground truth defined independently of the tracer. The circle defect would have been visible in P0 rather than at owner review.
3. **Combine overlap metrics with contour and curvature measurements.** Treat IoU as a sanity check only; use radial, curvature, join and topology metrics as gates.
4. **Establish held-out validation fixtures before algorithm selection.** P0-R-GEO did this, but a prototype had already been run on one disc before the thresholds were written (disclosed in ALGORITHM-EVALUATION). Write the thresholds and the held-out set first.
5. **Measure complete user-action-to-visible-result latency,** not just engine time. The 200 ms settings debounce inflated import→visible, and preview paint dominated main-thread blocking.
6. **Distinguish tracing performance from rendering performance** in every benchmark table and budget.
7. **Evaluate lower-end hardware before any public performance claim.** Chromium's 4× CPU throttling does not throttle dedicated workers, so it is not a proxy for engine speed. A real mainstream laptop is needed.
8. **Pair numerical validation with owner visual inspection at every phase.** The owner caught the circle defect that the P0 gates passed. Bundles with before/after files, contact sheets and overlays made review effective.
9. **Freeze a byte-level regression baseline before changing the engine,** in a separate worktree. P0-R-GEO's 326-file corpus is what let a new fitting mode ship with a provable no-change guarantee for photographs.
