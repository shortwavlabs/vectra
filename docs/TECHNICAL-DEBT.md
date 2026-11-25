# Technical debt register

A living engineering register: outstanding limitations, their evidence and their intended disposition.

**Rules.**
- Identifiers are stable and never reused.
- When an item changes, update its status and add the evidence. Do not delete history.
- An item accepted for P0 is **not fixed**: acceptance means the P0 baseline may ship to the next phase with this behaviour documented.

Created at P0 closure (2026-11-24) from the P0, P0-R and P0-R-GEO reports. Updated at G-0 (2026-11-25) from the independent RFC-002 review: dispositions per item, lifecycle stages, and 12 added items. The consolidated narrative is in the [P0 postmortem](research/P0-POSTMORTEM.md); decisions are in [P0-ACCEPTANCE](research/P0-ACCEPTANCE.md).

## Conventions
**Category:**
- **Defect:** confirmed incorrect behaviour, measured.
- **Limitation:** an architectural or information-theoretic limit of the current design.
- **Untested:** an environment or path not validated.
- **Enhancement:** optional improvement.

**Severity:**
- **High:** affects a core product promise or constrains RFC-002.
- **Medium:** visible on specific content or environments, with a workaround.
- **Low:** minor, rare, or invisible at normal zoom.

**Status:**
- RESOLVED.
- ACCEPTED FOR P0 / OPEN TECHNICAL DEBT: accepted for the baseline, still to be addressed.
- DEFERRED: intentionally postponed to a named phase.
- NOT RUN: never measured.

**Lifecycle stage** (added at G-0, 2026-11-25). This is orthogonal to status; an item can be OPEN at any stage before the last:
- **ARCHITECTURE ACCEPTED:** the solution is chosen in RFC-002; nothing is implemented.
- **IMPLEMENTATION PENDING:** gate work has not started or is in progress.
- **PROTOTYPE DEMONSTRATED:** a disposable experiment showed feasibility. This is evidence, not proof.
- **PRODUCTION VERIFIED:** the production implementation passes its gate's automated criteria.
- **OWNER ACCEPTANCE PENDING:** verified, and awaiting maintainer sign-off.
- **QUALIFIED AND CLOSED:** accepted by the maintainer. Only this stage resolves an item.

Gates (`G-ENG`, `G-DOC`, `G-JOB`, `G-R0`, `G-UI`, `G-R1`, `G-TRACE`, `G-EDIT`, `G-EXP`, `G-PRJ`, `G-GEO`, `G-SB`, plus the `P-CI` prerequisite) are defined in [G0-P1-IMPLEMENTATION-PLAN](research/g0/G0-P1-IMPLEMENTATION-PLAN.md).

**Target phase:**
- RFC-002 (architecture input);
- P1-A (document, layers, selection, transforms, history);
- P1-B (workspace and rendering);
- P1-C (editing and tracing tools);
- P1 Line Art;
- P2 (effects and printmaking);
- Later.

All paths are relative to the repository root. Unless stated otherwise, fixtures come from `crates/vector-engine/tests/common/corpus.rs` (generate PNGs with `cargo run --release -p vector-engine --example geo_corpus`) or `tests/fixtures/`.

## Summary
| ID | Title | Category | Severity | Status | Target | G-0 gate |
|---|---|---|---|---|---|---|
| [TD-GEO-001](#td-geo-001) | Shared colour boundaries and lower-layer slivers | Limitation (with measured defects) | **High** | ACCEPTED FOR P0 / OPEN | **RFC-002**, P1-C | G-SB |
| [TD-GEO-002](#td-geo-002) | Non-antialiased geometric shapes | Limitation | Medium | ACCEPTED FOR P0 / OPEN | P1-C or later | G-GEO |
| [TD-GEO-003](#td-geo-003) | Thin bars and acute corners | Defect | Medium | ACCEPTED FOR P0 / OPEN | P1-C | G-GEO |
| [TD-GEO-004](#td-geo-004) | Straight-edge curvature near rebuilt corners | Defect | Low | ACCEPTED FOR P0 / OPEN | P1-C | G-GEO |
| [TD-GEO-005](#td-geo-005) | One-pixel diagonal strokes | Limitation | Medium | DEFERRED | P1 Line Art | P2-A |
| [TD-GEO-006](#td-geo-006) | Partial source transparency | Limitation | Medium | ACCEPTED FOR P0 / OPEN | Later (preset-driven) | Later |
| [TD-GEO-007](#td-geo-007) | Browser-dependent image decoding | Limitation | Medium | DEFERRED | RFC-002 decision, P1 | P2-C |
| [TD-GEO-008](#td-geo-008) | Residual transparency approximation | Limitation | Low | ACCEPTED FOR P0 | Later | Later |
| [TD-GEO-009](#td-geo-009) | Precision compositing limitations | Limitation | Medium | ACCEPTED FOR P0 / OPEN | RFC-002, P1-C | G-SB |
| [TD-PERF-001](#td-perf-001) | Large-scene preview rendering | Defect (budget not met) | **High** | OPEN | **RFC-002**, P1-B | G-R0/G-R1 |
| [TD-PERF-002](#td-perf-002) | Late geometry budget enforcement | Defect | Medium | OPEN | P1-A/B | G-ENG/G-TRACE |
| [TD-PERF-003](#td-perf-003) | High-resolution image memory usage | Limitation | **High** | OPEN | **RFC-002**, P1 | G-DOC/G-R1 |
| [TD-PERF-004](#td-perf-004) | Interactive preview responsiveness | Enhancement (with one measured defect) | Medium | OPEN | P1-B | G-JOB/G-TRACE |
| [TD-PERF-005](#td-perf-005) | Halftone pitch at native resolution | Enhancement | Low | DEFERRED | P2 | P2-C |
| [TD-PERF-006](#td-perf-006) | Precision mode cost on photographs | Limitation | Low | ACCEPTED FOR P0 | Later | Later |
| [TD-ARCH-001](#td-arch-001) | VTracer alpha dependency | Limitation (dependency risk) | Medium | ACCEPTED FOR P0 (provisional) | Ongoing; RFC-002 | ongoing/G-ENG |
| [TD-ARCH-002](#td-arch-002) | Worker lifecycle and persistent editor state | Limitation | **High** | OPEN | **RFC-002** | G-DOC/G-JOB |
| [TD-ARCH-003](#td-arch-003) | Scene v1 expressiveness and JSON transport | Limitation | **High** | OPEN | **RFC-002** | G-ENG/G-DOC |
| [TD-ARCH-004](#td-arch-004) | Engineering-only engine entry points | Enhancement | Low | OPEN | P1-A | G-ENG |
| [TD-PLATFORM-001](#td-platform-001) | Linux amd64 | Untested | Low | NOT RUN | Before public release | release |
| [TD-PLATFORM-002](#td-platform-002) | Safari and mobile | Untested | **High** | NOT RUN | P1-B and before public release | G-JOB/G-UI/G-R1 |
| [TD-PLATFORM-003](#td-platform-003) | Lower-end desktop hardware | Untested | **High** | NOT RUN | Before any public performance claim; RFC-002 budget | G-R1 |
| [TD-PLATFORM-004](#td-platform-004) | Real deployment | Untested | Medium | DEFERRED | When a suitable UI exists | later |
| [TD-PLATFORM-005](#td-platform-005) | Cross-host precision reproducibility | Untested | Low | NOT RUN | Next Linux run | next Linux run |
| [TD-PROCESS-001](#td-process-001) | No automated required checks | Enhancement | Low | OPEN | Maintainer decision | P-CI |
| [TD-ARCH-005](#td-arch-005) | Typed-array immutability is a convention | Limitation | **High** | OPEN | G-DOC | G-DOC |
| [TD-ARCH-006](#td-arch-006) | WebKit offline worker start-up under churn | Defect (prototype-reproduced) | **High** | OPEN | G-JOB | G-JOB |
| [TD-REN-001](#td-ren-001) | Chromium quadratic incremental Path2D | Defect (browser) | **High** | OPEN | G-R0 | G-R0 |
| [TD-REN-002](#td-ren-002) | Worker-canvas presentation (WebKit) and raster (Firefox) | Untested / limitation | Medium | OPEN | G-R0/G-R1 | G-R0/G-R1 |
| [TD-REN-003](#td-ren-003) | Layered drag-cache correctness and cost | Limitation (unqualified) | **High** | OPEN | G-R1 | G-R1 |
| [TD-REN-004](#td-ren-004) | Large compound paths as single objects | Limitation | Medium | OPEN | G-R0 | G-R0 |
| [TD-UI-001](#td-ui-001) | Base UI inline style vs strict CSP | Limitation (mitigated in harness) | Medium | OPEN | G-UI | G-UI |
| [TD-UI-002](#td-ui-002) | Colour picker and slider accessibility | Defect (upstream) | **High** | OPEN | G-UI | G-UI |
| [TD-UI-003](#td-ui-003) | Border, track and focus-ring contrast | Defect (tokens) | Medium | OPEN | G-UI | G-UI |
| [TD-UI-004](#td-ui-004) | Notices do not cover copied sources and CSS | Limitation (licence compliance) | Medium | OPEN | G-UI | G-UI |
| [TD-GEO-010](#td-geo-010) | Sliver metric and junction criterion restatement | Limitation (measurement) | Medium | OPEN | G-SB | G-SB |
| [TD-PLATFORM-006](#td-platform-006) | Service-worker version skew (network-first navigation) | Defect (source inspection) | Medium | OPEN | G-JOB | G-JOB |

Counts:
- **37 open items** after G-0: the original 25 (4 confirmed defects, 12 limitations, 5 untested environments, 4 enhancements) plus 12 added at G-0 (11 proposed by the independent review, plus TD-PLATFORM-006 found during reconciliation).
- **12 High** (7 original + 5 added).
- **No item is resolved by G-0.** Choosing an architecture moves an item to ARCHITECTURE ACCEPTED at most.
- **RFC-002 inputs:** TD-GEO-001, TD-GEO-007, TD-GEO-009, TD-PERF-001, TD-PERF-003, TD-ARCH-001, TD-ARCH-002, TD-ARCH-003.

---

## Geometry

<a id="td-geo-001"></a>
### TD-GEO-001 — Shared colour boundaries and lower-layer slivers
- **Category / severity / status:** Limitation with measured defects · **High** · ACCEPTED FOR P0 / OPEN TECHNICAL DEBT (priority RFC-002 input).
- **Subsystem:** stacked colour compositing (`crates/vector-engine/src/trace.rs` `precision_compose`, VTracer stacked compose); precision fitter `crates/vector-engine/src/precision.rs`.
- **User-visible impact:**
  - Hairline slivers of a lower stacked layer's colour along edges owned by a higher layer.
  - Slightly uneven curvature, or a small notch, within about 2–6 px of points where three colours meet.
  - Closely spaced nodes from different layers at junctions.
  - Invisible or nearly invisible at normal zoom; noticeable when zoomed in, editing or printing large.
- **Root cause (established).**
  1. Stacked compositing traces every colour layer independently. A lower layer (e.g. the yellow "union" layer of the discs) often redraws an edge that a higher layer owns, and its independent fit can sit slightly outside the owner's.
  2. Colour clustering assigns antialiased blend pixels by colour similarity: 62 of 1,062 (5.8 %) on the discs went to the wrong side.
  3. At three-colour junctions, blend pixels mix three colours, so two-colour sub-pixel estimation is unreliable.
  4. Each layer rebuilds its junction corner independently.
- **Reproduction:**
  - `cargo run --release -p vector-engine --example geo_inspect -- specks 04-color-discs 2` lists the slivers.
  - `… -- curvature 04-color-discs <dir> arcs` classifies the curvature flags and renders the worst three.
  - Bundle file: `docs/research/p0-r-geo/owner-acceptance-bundle-v2/04-color-discs-corrected-precision.pdf`.
- **Numerical evidence** (`docs/research/p0-r-geo/artifacts/selection/specks.txt`, `curvature-classification.txt`):
  - **04, corrected:** yellow hairlines of **1.50 px²** at x 36.0–36.5, y 102.5–105.5, and **1.25 px²** at x 88.5–91.0, y 50.0–50.5 (2× sampling, source px). Each is about 0.5 × 3 px, at the red disc's extreme left and top. Confirmed with poppler: `poppler-04-corrected-sliver-{left,top}.png`.
  - **`discs-two-deep`:** blue, 2.19 px² at (63.0–63.2, 123.8–132.5) and 1.12 px² at (113.0–117.5, 78.0–78.2) (4×).
  - **`discs-x2`:** yellow, 1.19 px² at (72.2–72.8, 206.0–210.2) (4×), plus 5 more of 1.0–2.25 px² at 2×.
  - **Curvature flags (|κ|·r − 1 > 0.5, away from corners):** 554 on 04, of which 396 are lower-layer duplicates within 0.5 px of a higher outline, 28 near saturated runs and 130 on top paths. 258 on `discs-two-deep`; 453 on `discs-x2`.
  - **Worst curvature:** 04 RMS 1.10 / max 16.1; `discs-two-deep` 2.63 / 29.6, plus one 16.5° tangent break.
  - **Position targets are met** on all of these (04 worst circle: centre 0.050, RMS 0.057, max 0.257 px).
  - **Spline baseline:** specks on 3 fixtures (`concentric`, `discs-two-wide`, `discs-x2`).
- **Fixtures and files:**
  - `04-color-discs`, `discs-two-deep`, `discs-x2`, `concentric`, `adjacent-overlap`, `h-discs-three` (corpus);
  - `tests/fixtures/procedural/antialiased_discs.png`;
  - `crates/vector-engine/src/precision.rs`, `trace.rs`.
- **Workaround.** None in-engine. Hairlines are below 1 px² at 4× sampling. Users can delete or merge the offending lower-layer path in an editor.
- **Proposed approach (investigation, not a decision).**
  - (a) A **shared-boundary or junction graph**: fit each visible boundary segment once and assemble every region from shared segments, mosaic-style, with junction points shared by all incident regions.
  - (b) **Label-level blend correction:** reassign antialiased blend pixels to the geometrically correct region before contour extraction, using coverage estimates.
  - (c) Lower layers kept strictly underneath edges they do not own. One bounded attempt combined with a three-region test failed on nested same-colour layers (ALGORITHM-EVALUATION).
- **Dependencies and implications.**
  - Shared boundaries change how regions are represented: as a graph of boundary segments, not independent loops. That affects stable object ids, boolean operations, arbitrary clipping, ink-plate separation (plates must not gap or overlap) and printmaking trapping and overprint.
  - **This must be decided in RFC-002.**
- **Target phase:** RFC-002 (representation); P1-C (implementation).
- **Acceptance criteria:**
  - No component of a lower layer's colour ≥ 0.25 source px² visible at 4× on the disc and overlap fixtures. *(G-0: measured with the crisp-sampled metric; the antialiased metric is still reported, TD-GEO-010.)*
  - |κ|·r − 1 RMS ≤ 0.15 and max ≤ 0.5 beyond 2 px from true junctions.
  - Every junction shared by all incident paths within 0.1 px. *(G-0: restated as bit-identical mosaic junctions, and consistent shared-edge geometry for stacked output, RFC-002 §12.4.)*
  - No regression of the brief's targets or of spline outputs.
- **References:** [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md), [ALGORITHM-EVALUATION](research/p0-r-geo/ALGORITHM-EVALUATION.md) ("Curvature near junctions"), [ROOT-CAUSE-ANALYSIS](research/p0-r-geo/ROOT-CAUSE-ANALYSIS.md).
- **G-0 disposition (2026-11-25):** stage **PROTOTYPE DEMONSTRATED (R04: graph prototype, 6 synthetic fixtures) / IMPLEMENTATION PENDING**; gate G-SB (may defer to P2, visibly); closure: RFC-002 §12.4 metrics on the existing corpus plus a pre-registered fresh holdout; visual owner bundle; Precision version allocated; owner action: Yes: version allocation; G-SB deferral decision if needed. Representation decided (RFC §12.3). The sliver metric is restated as crisp-sampled (TD-GEO-010); the antialiased metric is still reported.

<a id="td-geo-002"></a>
### TD-GEO-002 — Non-antialiased geometric shapes
- **Category / severity / status:** Limitation (information-theoretic) · Medium · ACCEPTED FOR P0 / OPEN TECHNICAL DEBT.
- **Subsystem:** precision fitter (sub-pixel crossings, smoothing, corner detection).
- **User-visible impact:** hard-edged (aliased) geometric art traced in precision mode follows the pixel staircase midpoints:
  - extra anchors;
  - some tangent breaks;
  - position accurate only to about half a pixel.
- **Root cause.** A binary pixel says only which side of the edge its centre lies on. With no partial coverage, the crossing is the crack midpoint, and the staircase's 45° chamfers can be detected as corners.
- **Reproduction:** `cargo run --release -p vector-engine --example geo_eval -- tests/output/geo-eval validation selected`, fixture `circle-hard-r40` (disc r = 40 rendered with 1 sample per pixel).
- **Numerical evidence.** `circle-hard-r40`, precision:
  - radial RMS 0.219, max 0.488 px (tier C limits: ≤ 0.35 / 0.85 met);
  - centre error 0.011 px;
  - **10 tangent breaks (max 54.7°)**;
  - **81 anchors**, against spline's 8.
  
  Tier C rationale: GEOMETRIC-FIDELITY-METRICS, "Mathematical limits".
- **Fixtures and files:** `circle-hard-r40`; `precision.rs` (`crossing`, `corners`, `smooth`).
- **Workaround.** Use spline (artistic) or pixel fit for hard-edged art, or supply antialiased artwork.
- **Proposed approach.** Detect loops with no sub-pixel evidence (every crossing at the crack midpoint), then:
  - apply stronger smoothing and a larger corner scale there;
  - fit with a tolerance matched to the ±0.5 px lattice uncertainty;
  - optionally use model-based fitting (circle or line) where residuals are consistent with lattice noise.
  
  **Exact reconstruction from binary rasters is not possible and will not be promised:** many analytic shapes map to the same staircase.
- **Dependencies:** none architectural.
- **Target phase:** P1-C or later, driven by real hard-edged logo samples.
- **Acceptance criteria:** on hard-thresholded circles r ≥ 20, 0 tangent breaks > 2° and ≤ 12 anchors per full circle, with the tier C position limits kept and the negative controls unaffected.
- **References:** [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md), [GEOMETRIC-FIDELITY-METRICS](research/p0-r-geo/GEOMETRIC-FIDELITY-METRICS.md).
- **G-0 disposition (2026-11-25):** stage **IMPLEMENTATION PENDING**; gate G-GEO (partial); closure: per the acceptance criteria above, on `circle-hard-r40` and real hard-edged logos, behind a provisional precision identifier; owner action: Yes: visual review, version allocation. Curve-fitting defect class, qualified separately from shared boundaries (RFC §12.1).

<a id="td-geo-003"></a>
### TD-GEO-003 — Thin bars and acute corners
- **Category / severity / status:** Defect · Medium · ACCEPTED FOR P0 / OPEN TECHNICAL DEBT.
- **Subsystem:** precision corner rebuild (trim, tangent intersection, refit).
- **User-visible impact.**
  - The ends of 2–3 px wide bars come out with corners up to 2.3 px from the true corners.
  - Sharp star tips are rebuilt within tolerance, but nearby straight edges may carry slight curvature (see TD-GEO-004).
- **Root cause.**
  - The antialiasing-rounded zone trimmed at a corner (1.5 px + 0.5/tan(interior/2)) spans most of a 2–3 px bar end, leaving too little straight evidence for a reliable tangent intersection.
  - At acute tips, the 50 % contour retracts by about 0.25/tan(θ/2) px (0.77 px at 36°).
  - This is the tension between smoothing noise and preserving sharp features.
- **Reproduction.** `geo_eval … validation selected`, fixtures `strokes` (bars 2, 3 and 5 px wide at 0/30/45/60°) and `star`; held-out `h-star-rot17`.
- **Numerical evidence.**
  - `strokes`: corner 2.32 px (target ≤ 1.0); two 3.2° tangent breaks; straight-edge curvature 0.087 /px.
  - Spline on `strokes`: corner 2.5 px, 2 breaks, 64 anchors (precision: 30).
  - Acute-corner tier allowance: ≤ 1.5 px. Star tips pass it.
- **Fixtures and files:** `strokes`, `star`, `h-star-rot17`, `thin_strokes`; `precision.rs` (`fit_contour`, `corner_point`).
- **Workaround.** Use pixel or polygon fit for thin, technical line art.
- **Proposed approach.**
  - Resolution-aware trimming that scales with the local feature width, measured from the opposite boundary.
  - Fit straight sections as constrained lines that meet at the corner (a joint line fit over both sides).
  - Detect bar ends as two close corners.
- **Dependencies:** none architectural; interacts with TD-GEO-004 and TD-GEO-005.
- **Target phase:** P1-C.
- **Acceptance criteria:**
  - Corners of bars ≥ 3 px wide within 1.0 px, and acute corners within 1.5 px.
  - 0 tangent breaks on straight edges.
  - No regression on rectangles and triangles.
- **References:** [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md) ("What is still missed").
- **G-0 disposition (2026-11-25):** stage **IMPLEMENTATION PENDING**; gate G-GEO; closure: per the acceptance criteria above; owner action: Yes: visual review, version allocation. Starts after the byte-neutral fitter refactor (C6).

<a id="td-geo-004"></a>
### TD-GEO-004 — Straight-edge curvature near rebuilt corners
- **Category / severity / status:** Defect · Low · ACCEPTED FOR P0 / OPEN TECHNICAL DEBT.
- **Subsystem:** precision section fitting after the corner rebuild.
- **User-visible impact.** Straight edges next to some rebuilt corners carry a slight bend over 2–4 px. Visible only at ≥ 16× zoom, or as an extra node when editing.
- **Root cause.** A section refitted to end exactly at a rebuilt corner is sometimes fitted as a cubic instead of a line: the trimmed body plus the extrapolated corner exceeds the 0.2 px straightness test, or the corner's adjacent arc must transition into a line.
- **Reproduction:** `geo_eval … validation selected` and `… heldout spline,selected`. Fixtures `star`, `roundrect`, `h-star-rot17`, `h-roundrect-rot12`, `adjacent-overlap`.
- **Numerical evidence.**
  - Max |κ| on straight-truth samples (target ≤ 0.005 /px): star 0.219, h-star 0.317, roundrect 0.018, h-roundrect 0.0145.
  - `adjacent-overlap`: curvature max 1.0 on an r = 55 arc (one short straight piece at a junction).
  - Positions, corners and IoU pass on all of these.
- **Fixtures and files:** as above; `precision.rs` (`fit_section`, corner refit).
- **Workaround:** none needed for normal use; delete the extra node in an editor.
- **Proposed approach.** Classify sections as straight from the trimmed body, before refitting. Constrain the refit to a line when it is straight, or to a G1 line-plus-arc transition.
- **Dependencies:** none.
- **Target phase:** P1-C.
- **Acceptance criteria:** max |κ| ≤ 0.005 /px on straight truth beyond 2 px from corners, on all corpus fixtures.
- **References:** [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md).
- **G-0 disposition (2026-11-25):** stage **IMPLEMENTATION PENDING**; gate G-GEO; closure: per the acceptance criteria above; owner action: Yes: visual review, version allocation. Same machinery as the end-constrained open-section fitter needed by G-SB.

<a id="td-geo-005"></a>
### TD-GEO-005 — One-pixel diagonal strokes
- **Category / severity / status:** Limitation · Medium · DEFERRED (proposed for P1 Line Art).
- **Subsystem:** B&W segmentation connectivity (`trace.rs` `bw_segmentation`, 4-connected ink); speckle filter.
- **User-visible impact.** Hairline diagonal strokes disappear in default B&W tracing. With speckle 0 they survive only as separate tiny shapes, not a connected line.
- **Root cause.** Pixels of a 1-px diagonal touch only at corners, so in a 4-connected segmentation each is its own 1-px component. The default speckle filter (16 px²) removes them, and spline drops them even at speckle 0.
- **Reproduction:** `cargo run --release -p vector-engine --example geo_inspect -- diagonals` (fixture `thin_strokes`; 56 true diagonal pixels).
- **Numerical evidence** (`docs/research/p0-r-geo/artifacts/selection/diagonals.txt`):

  | Settings | Paths | Diagonal pixels rendered |
  |---|---|---|
  | spline, default speckle | 8 | 0/56 |
  | spline, speckle 0 | 8 | 0/56 |
  | pixel fit, speckle 0 | 64 | 56/56 |
  | precision, default speckle | 8 | 0/56 |
  | precision, speckle 0 | 64 | 56/56 (separate shapes) |
- **Fixtures and files:** `tests/fixtures/procedural/thin_strokes.png`; `trace.rs`, `precision.rs`.
- **Workaround.** `fit.mode = "pixel"` (or precision) with speckle 0.
- **Proposed approach:**
  - 8-connected ink, with dual 4-connected background, for line-art presets;
  - or centreline / thin-feature tracing that emits strokes or thin closed shapes.
- **Dependencies.** Centreline output needs stroke semantics in the evaluated scene (scene v1 supports strokes; the exporters handle them).
- **Target phase:** P1 Line Art *(superseded at G-0: P2-A Line Art)*.
- **Acceptance criteria:** 1-px diagonal strokes at 30–60° are preserved as one connected stroke or shape, with their position within 0.5 px.
- **References:** [GEOMETRY-QUALITY-DISPOSITION §2](research/p0-r/GEOMETRY-QUALITY-DISPOSITION.md), [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md).
- **G-0 disposition (2026-11-25):** stage **DEFERRED**; gate P2-A Line Art; closure: per the acceptance criteria above; owner action: No (decided at G-0: Line Art moves to P2-A). Moves with Line Art (RFC §18).

<a id="td-geo-006"></a>
### TD-GEO-006 — Partial source transparency
- **Category / severity / status:** Limitation · Medium · ACCEPTED FOR P0 / OPEN TECHNICAL DEBT.
- **Subsystem:** pre-processing (`keyed_image`, `bw_mask`); alpha threshold.
- **User-visible impact.** Soft-edged logos, drop shadows and feathered artwork lose their softness: each pixel becomes opaque or transparent at `alphaThreshold` (default 128). Hard-edged transparency is exact.
- **Root cause.** Tracing produces flat-colour regions, and there is no vector geometry for a gradual edge.
- **Existing warning.** `alpha_binarized` reports the number of partially transparent pixels affected.
- **Reproduction.** Trace `tests/fixtures/procedural/transparent_ring.png` in colour; the `alpha_binarized` warning appears. Engine tests cover it.
- **Numerical evidence.** The behaviour is documented in P0 and P0-R; the fixtures exercise antialiased alpha edges. No soft-shadow corpus has been measured.
- **Workaround.** Choose the alpha threshold. Old Print (halftone) already folds alpha into dot coverage.
- **Proposed approach** (vector only; **no raster fallback**):
  - feathered vector bands (several concentric paths with stepped alpha);
  - SVG/PDF gradient fills, if the scene contract adds them;
  - per-region opacity, where appropriate.
  
  Each needs a scene contract change and export verification.
- **Dependencies:** scene v2 (RFC-002) for gradients or opacity stacks.
- **Target phase:** later, driven by a preset that needs soft edges.
- **Acceptance criteria:** soft-shadow fixtures reproduced within a defined alpha-profile error, using only vector constructs, verified in SVG and PDF.
- **References:** [GEOMETRY-QUALITY-DISPOSITION §3](research/p0-r/GEOMETRY-QUALITY-DISPOSITION.md).
- **G-0 disposition (2026-11-25):** stage **DEFERRED**; gate Later (preset-driven); closure: per the acceptance criteria above; owner action: No. Needs scene v2 opacity or gradient constructs.

<a id="td-geo-007"></a>
### TD-GEO-007 — Browser-dependent image decoding
- **Category / severity / status:** Limitation · Medium · DEFERRED.
- **Subsystem:** image intake (`src/vectorization/intake.ts`: `createImageBitmap` and canvas `getImageData`).
- **User-visible impact.** The same JPEG, or a PNG with semi-transparent pixels, can trace slightly differently in Chromium, Firefox and Safari. Recipes and presets shared across browsers may not reproduce byte-for-byte.
- **Root cause.**
  - Engines use different JPEG decoders.
  - Canvas storage is premultiplied, so `getImageData` returns RGB = round(round(c·a/255)·255/a) for partial alpha. Bundle v1 case 05 reproduces only with that model.
- **Current guarantee.** Determinism is per decoded RGBA input: identical RGBA gives identical scene, SVG and PDF bytes on any host, in native and WASM.
- **Reproduction:**
  - decode tests in the P0 reports;
  - `crates/vector-engine/tests/common/corpus.rs` `browser_decode`;
  - `tests/browser/precision.spec.ts` (05 is checked structurally outside Chromium).
- **Numerical evidence.**
  - WebKit JPEG decoding differs from Chromium/Firefox in 17.9 % of bytes (max Δ 25).
  - Partial-alpha RGB: Firefox max Δ 8; WebKit max Δ 223 at near-zero alpha.
  - Opaque PNGs are identical everywhere.
- **Workaround:** use opaque PNG sources when cross-browser reproducibility matters.
- **Proposed approach.** Deterministic in-WASM PNG/JPEG decoding. To evaluate:
  - dependency choice and licences (notices);
  - WASM size (currently 528 KB with the precision module; 484 KB at P0-R);
  - decode speed versus native browser decoding;
  - memory for 24 MP sources;
  - EXIF orientation and colour-profile handling.
- **Dependencies.** The recipe determinism promise (VS-10, CL-02); multiple source images (decode once, share).
- **Target phase:** RFC-002 decides the reproducibility promise; P1 implements.
- **Acceptance criteria:** identical decoded RGBA for the corpus in Chromium, Firefox and Safari; decode time within an agreed budget.
- **References:** [GEOMETRY-QUALITY-DISPOSITION §5](research/p0-r/GEOMETRY-QUALITY-DISPOSITION.md), [DEFECT-REPRODUCTION](research/p0-r-geo/DEFECT-REPRODUCTION.md).
- **G-0 disposition (2026-11-25):** stage **ARCHITECTURE ACCEPTED (promise wording)**; gate P2-C (in-WASM decoding, before shared recipes claim cross-browser reproducibility); closure: per the acceptance criteria above; owner action: No. Promise: identical decoded RGBA, versions and seed, and the same WASM build (RFC §13).

<a id="td-geo-008"></a>
### TD-GEO-008 — Residual transparency approximation
- **Category / severity / status:** Limitation · Low · ACCEPTED FOR P0.
- **Subsystem:** boundary placement at alpha edges.
- **Status of the original defect.**
  - **RESOLVED:** VTracer's sampled-row transparency keying filled transparent holes (leak 1.0). Vectra-owned alpha keying removed it in P0.
  - **RESOLVED for precision:** the P0-R residual leak from the outward bias (ring 0.62 %, up to 0.81 px from the edge).
- **What remains.** Pixel-centre rounding at an exact boundary.
  - In precision mode, `logo_transparent_hole` shows 11 boundary pixels (0.87 % of the hole) whose centre is transparent in truth but rendered opaque, all within **0.12 px** of the true edge.
  - `transparent_ring`: 0 px.
  - Spline is unchanged: 0.62 % / 0.81 px (ring) and 0.08 % / 0.06 px (hole).
- **User-visible impact:** none at normal zoom; it is the rounding floor of an exact boundary.
- **Reproduction:** `cargo run --release -p vector-engine --example geo_inspect -- leak` (`artifacts/selection/transparency-leak.txt`).
- **Workaround:** none needed.
- **Proposed approach:** none planned. Report leak area together with distance in future metrics.
- **Target phase:** later (monitor only).
- **Acceptance criteria:** leaked pixels, if any, lie within 0.25 px of the true edge.
- **References:** [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md), [GEOMETRY-QUALITY-DISPOSITION §4](research/p0-r/GEOMETRY-QUALITY-DISPOSITION.md).
- **G-0 disposition (2026-11-25):** stage **ACCEPTED FOR P0 (monitor)**; gate Later; closure: per the acceptance criteria above; owner action: No. Unchanged.

<a id="td-geo-009"></a>
### TD-GEO-009 — Precision compositing limitations
- **Category / severity / status:** Limitation · Medium · ACCEPTED FOR P0 / OPEN TECHNICAL DEBT.
- **Subsystem:** `params.rs` validation; `trace.rs` `precision_compose`.
- **User-visible impact.**
  - Precision works only with stacked compositing. Limited colour defaults to mosaic, so the workbench switches compositing to stacked when precision is chosen.
  - `fit.simplify` must be 0.
  - `lengthThreshold` and `spliceThreshold` are ignored.
- **Root cause.**
  - Precision replaces VTracer's per-region fitter. Mosaic fits shared boundary segments with its own segment fitter, which precision does not implement.
  - VTracer's simplification pass does not apply to precision output.
- **Current validation:** `fit.mode precision requires compositing stacked`; `fit.simplify is not used by precision fitting; it must be 0` (InvalidParams).
- **Reproduction:** `TraceRequest::from_json` with `{"mode":"limited","fit":{"mode":"precision"}}` returns an error (unit test in `params.rs`).
- **Numerical evidence:** none needed; behaviour is specified and tested.
- **Workaround:** use stacked compositing with precision.
- **Proposed approach.** Implement precision for shared boundaries. This is the same work as TD-GEO-001 option (a), which would also give seam-free precision mosaics.
- **Dependencies:** TD-GEO-001, RFC-002 boundary representation.
- **Target phase:** RFC-002 / P1-C.
- **Acceptance criteria:** precision with mosaic compositing passes the geometry targets with no seams between neighbouring regions.
- **References:** [SELECTED-CORRECTION](research/p0-r-geo/SELECTED-CORRECTION.md).
- **G-0 disposition (2026-11-25):** stage **PROTOTYPE DEMONSTRATED (R04: stacked and mosaic from one edge set) / IMPLEMENTATION PENDING**; gate G-SB; closure: Precision with mosaic passes the RFC §12.4 metrics; the validation error is lifted only after the gate; owner action: Yes: version allocation. Route is the shared-boundary graph.

## Performance and resources

<a id="td-perf-001"></a>
### TD-PERF-001 — Large-scene preview rendering
- **Category / severity / status:** Defect (proposed budget not met) · **High** · OPEN TECHNICAL DEBT (priority RFC-002 input).
- **Subsystem:** workbench preview (an `<img>` of the exported SVG blob on the main thread).
- **User-visible impact.** After a large trace, the page freezes while the preview paints: UI interactions stall for tenths of a second, or longer in Firefox.
- **Root cause.** Worker-based tracing keeps processing off the main thread, but the result is shown by rasterising a 12–37 MB SVG on the main thread.
- **Reproduction:** `node scripts/fetch-native-corpus.mjs`, then `BENCH_NATIVE=1 pnpm exec playwright test tests/browser/native-benchmark.spec.ts`. Instrumentation records preview paint and max frame gap.
- **Numerical evidence** (P0-R PERFORMANCE-BASELINE, Apple M5 Max):
  - Chromium paints 12–37 MB SVGs in 125–238 ms, with **83–183 ms frame gaps**.
  - Firefox, 18 MP limited: **1.35 s with an 850 ms gap**.
  - Processing itself: worst gap 19 ms, no long tasks.
  - Proposed budget: no gap > 50 ms; preview ≤ 100 ms for ≤ 250 k anchors.
- **Fixtures:** native corpus (`tests/fixtures/native-corpus.json`).
- **Workaround:** smaller images or B&W.
- **Proposed research for RFC-002** (no architecture chosen here):
  - Canvas 2D versus WebGL versus SVG DOM;
  - cached display rasters (display only; never in exports);
  - spatial indexing for hit testing;
  - progressive rendering;
  - level of detail;
  - typed geometry buffers instead of SVG text.
- **Dependencies:** TD-ARCH-003 (transport format); selection and hit-testing design.
- **Target phase:** RFC-002 (decision), P1-B (implementation).
- **Acceptance criteria:** on the reference machine and on the lower-end target (TD-PLATFORM-003), no frame gap > 50 ms while displaying, panning or zooming scenes up to 250 k anchors; scenes up to 1 M anchors displayable.
- **References:** [PERFORMANCE-BASELINE](research/p0-r/PERFORMANCE-BASELINE.md) finding 4, [P1-ARCHITECTURAL-INPUTS](research/p0-r/P1-ARCHITECTURAL-INPUTS.md).
- **G-0 disposition (2026-11-25):** stage **PROTOTYPE DEMONSTRATED (R02: Canvas 2D + cache + worker host) / IMPLEMENTATION PENDING**; gate G-R0 (architecture), G-R1 (closure candidate); closure: RFC §17 budgets on the reference machine **and** lower-end devices; real Safari or a documented restriction; owner action: Yes: lower-end hardware access; Safari authorisation. Renderer decided (D04).

<a id="td-perf-002"></a>
### TD-PERF-002 — Late geometry budget enforcement
- **Category / severity / status:** Defect · Medium · OPEN TECHNICAL DEBT.
- **Subsystem:** engine resource limits (`Scene::validate` max anchors; halftone early abort).
- **User-visible impact.** A detailed photo in colour or limited mode can process for several seconds and then fail with `too_many_primitives`.
- **Root cause.** For traced modes, the 1,000,000-anchor limit is checked only after the full trace. Halftone aborts early.
- **Reproduction:** native benchmark as for TD-PERF-001 (bark colour, portrait-face colour).
- **Numerical evidence:** 8 of 28 Chromium native runs exceeded the limit:
  - colour: portrait-face 1.15 M, stage-light 1.52 M, bark 3.65 M;
  - limited: bark 2.14 M;
  - 4 halftone runs at pitch 8.
  
  The same 8 errors are reproduced in the P0-R-GEO regression corpus.
- **Workaround:** reduce image size, colour precision or detail; increase halftone pitch. The error message says so.
- **Proposed approach:**
  - estimate cost after segmentation (cluster count, boundary length) and fail or warn before fitting;
  - warn at about 250 k anchors;
  - offer explicit "reduce to N MP" and "increase pitch" actions.
- **Dependencies:** none architectural.
- **Target phase:** P1-A/B.
- **Acceptance criteria (P0 wording, superseded at G-0; see the disposition below):** over-budget traced jobs report within 2 s on the reference machine, with a recoverable, actionable error; no silent downscaling.
- **References:** [PERFORMANCE-BASELINE](research/p0-r/PERFORMANCE-BASELINE.md) ("Resource limits review").
- **G-0 disposition (2026-11-25):** stage **ARCHITECTURE ACCEPTED (two-stage) / IMPLEMENTATION PENDING**; gate G-ENG (staged API), G-TRACE (closure candidate); closure: **Revised acceptance wording (approved at G-0):** provide a complexity forecast within two seconds on qualified workloads, followed by a definitive resource-budget decision after segmentation and before expensive fitting. The forecast is approximate, shows a range, offers choices, never auto-rejects and never downsamples. False-positive and false-negative rates are validated on a separately reserved corpus; owner action: No. Evidence (R03): post-segmentation predictor 0 FP / 0 FN; preview forecast 2 FP / 1 FN; segmentation is 66–99 % of colour trace time. The two-second forecast is a qualification requirement, not a guarantee.

<a id="td-perf-003"></a>
### TD-PERF-003 — High-resolution image memory usage
- **Category / severity / status:** Limitation · **High** · OPEN TECHNICAL DEBT (RFC-002 input).
- **Subsystem:** worker WASM memory; clustering; worker recycling.
- **User-visible impact.** Colour and limited tracing of 18–24 MP images needs about 1 GiB of WASM memory, which ordinary laptops and mobile browsers may not provide. A WASM instance's memory never shrinks.
- **Root cause.** Hierarchical colour clustering and stacked layers at full resolution. Linear memory grows and is not returned until the worker is recycled (above 1 GiB).
- **Reproduction:** native benchmark (TD-PERF-001); `geo_perf` (peak heap).
- **Numerical evidence:**
  - up to **972 MiB** WASM (portrait-large colour), 910 MiB (portrait-face limited);
  - B&W 12 MP: 357 MiB.
  - Precision adds no peak heap (identical in PERFORMANCE-REGRESSION).
- **Workaround:** worker recycling above 1 GiB; the 12 MP default pixel cap.
- **Proposed approach:**
  - adaptive budgets per device (memory probing, user-visible limits);
  - downscaled working resolution with explicit consent;
  - tiled or streaming clustering;
  - aggregate accounting across multiple sources and future effects.
- **Dependencies:** multiple source images, effect caches, worker pool size (RFC-002).
- **Target phase:** RFC-002 (budget model); P1.
- **Acceptance criteria:** documented per-device budgets; ≤ 512 MiB WASM on the lower-end target for its supported image sizes; recoverable errors, never silent degradation.
- **References:** [PERFORMANCE-BASELINE](research/p0-r/PERFORMANCE-BASELINE.md) finding 5.
- **G-0 disposition (2026-11-25):** stage **ARCHITECTURE ACCEPTED (resource ledger, profiles) / IMPLEMENTATION PENDING**; gate G-DOC (ledger), G-R1 (lower-end budget); closure: Documented per-profile budgets measured on lower-end hardware; reserve-before-allocate; recoverable errors; owner action: Yes: lower-end hardware access. Constrained profile is provisional: ≤ 8 MP colour, ≤ 512 MiB recycle, 64 MiB history, ~2 GiB envelope. The 8 MP WASM figure is extrapolated, not measured.
- **G-DOC disposition (2026-11-25):** ledger skeleton implemented on review branch `gate/g-doc-document-store` (`src/document/ledger.ts`): GeometryStore bytes by owner kind with the exact C3.2 chunk cost, history-only bytes, source bytes (document vs history) and registration hooks for worker, renderer and cache reporters (interfaces only). Covered by Node 24.22.1 unit tests. Per-profile budgets, reserve-before-allocate and lower-end measurements are not part of G-DOC; stage stays **IMPLEMENTATION PENDING** (G-JOB, G-R1). Not closed.

<a id="td-perf-004"></a>
### TD-PERF-004 — Interactive preview responsiveness
- **Category / severity / status:** Enhancement, with one measured defect · Medium · OPEN TECHNICAL DEBT.
- **Subsystem:** workbench re-trace loop (`src/workspace/useWorkbench.ts`); worker client.
- **User-visible impact.** Slider changes re-trace at full resolution.
  - An import waits for the 200 ms settings debounce it does not need.
  - Future Variation Lab thumbnails will multiply the load.
- **Current behaviour (working).**
  - Latest-wins jobs: cancel acknowledged in under 1 ms, visible ≤ 53 ms.
  - Stale results rejected by job id and revision.
  - No stale result shown under rapid setting changes (`workbench.spec.ts`).
- **Numerical evidence.** Import→visible on 1280×960 B&W was 363 ms, of which 200 ms was the debounce.
- **Workaround:** none needed for the workbench.
- **Proposed approach:**
  - remove the debounce on import;
  - preview-resolution tracing while dragging, with a full-resolution final pass;
  - progressive results;
  - prioritised job queue with bounded concurrency for variations.
- **Dependencies:** TD-ARCH-002 (worker scheduling), Creative Lab requirements.
- **Target phase:** P1-B.
- **Acceptance criteria:** import→visible ≤ 0.5 s at about 1 MP (B&W); slider feedback ≤ 100 ms at preview resolution; no stale results.
- **References:** [PERFORMANCE-BASELINE](research/p0-r/PERFORMANCE-BASELINE.md), [P0-G2](research/p0/P0-G2-WORKER-ARCHITECTURE.md).
- **G-0 disposition (2026-11-25):** stage **ARCHITECTURE ACCEPTED / IMPLEMENTATION PENDING**; gate G-JOB (scheduler), G-TRACE (preview resolution, no import debounce); closure: per the acceptance criteria above; owner action: No. Scheduler contract in RFC §10.3.

<a id="td-perf-005"></a>
### TD-PERF-005 — Halftone pitch at native resolution
- **Category / severity / status:** Enhancement · Low · DEFERRED.
- **Subsystem:** Old Print halftone parameters.
- **Impact.** The default 8 px pitch gives about 1 M anchors (36 MB SVG) at 12 MP, so large images hit the anchor budget.
- **Evidence:** PERFORMANCE-BASELINE finding 3: architecture 12.5 MP gives 977,400 anchors; 4 runs over budget.
- **Workaround:** increase the pitch.
- **Proposed approach:** derive the pitch from the physical print size and lines-per-inch, not source pixels.
- **Target phase:** P2.
- **Acceptance criteria:** the default pitch stays under the interactive anchor warning for supported sizes, at a fixed physical screen ruling.
- **References:** [PERFORMANCE-BASELINE](research/p0-r/PERFORMANCE-BASELINE.md), [OLD-PRINT-FEASIBILITY](research/p0/OLD-PRINT-FEASIBILITY.md).
- **G-0 disposition (2026-11-25):** stage **DEFERRED**; gate P2-C (before Old Print becomes a product preset); closure: per the acceptance criteria above; owner action: No. The 977k-anchor halftone remains the renderer and hit-test stress case.

<a id="td-perf-006"></a>
### TD-PERF-006 — Precision mode cost on photographs
- **Category / severity / status:** Limitation · Low · ACCEPTED FOR P0.
- **Impact.** Precision is meant for geometric art. On photographs it produces 1.4–2× the anchors and takes 1.0–2.4× the time of the corresponding default mode, with equal peak heap.
- **Evidence.** PERFORMANCE-REGRESSION: 12.5 MP street colour 389,717 → 595,810 anchors; limited 7.1 → 11.9 s.
- **Workaround.** Use artistic (spline), the default, for photographs.
- **Proposed approach.** Product guidance (Artistic vs Precision naming); optional per-region mode choice later.
- **Target phase:** later.
- **References:** [PERFORMANCE-REGRESSION](research/p0-r-geo/PERFORMANCE-REGRESSION.md).
- **G-0 disposition (2026-11-25):** stage **ACCEPTED FOR P0**; gate Later (product guidance); closure: Artistic vs Precision guidance shipped in the trace UI (G-TRACE), with measured anchor and time ratios disclosed; this item has no other acceptance criteria; owner action: No. Unchanged.

## Architecture

<a id="td-arch-001"></a>
### TD-ARCH-001 — VTracer alpha dependency
- **Category / severity / status:** Limitation (dependency risk) · Medium · ACCEPTED FOR P0 (provisionally approved).
- **Subsystem:** `crates/vector-engine/src/trace.rs` (the only module that uses VTracer or visioncortex types).
- **Facts.**
  - `vtracer =1.0.0-alpha.4` and `visioncortex =0.9.3`, pinned exactly, with Cargo.lock committed.
  - Pre-release API from a single upstream maintainer.
  - The crate has no license file; the upstream LICENSE is supplied with provenance (notices).
  - Since P0-R-GEO, VTracer provides segmentation, colour fitting and spline/mosaic compositing; Vectra owns pre-processing (alpha, luminance, palette) and the precision fitter.
- **Fallback.** Use visioncortex directly, or replace segmentation behind the adapter. That would be a reported substitution.
- **Reconsider when:**
  - VTracer 1.0 stable ships, or a newer alpha changes the stage API;
  - a defect affects supported modes;
  - there is no upstream release or commit for more than six months;
  - the licence changes;
  - the adapter surface grows beyond frontends, colour fitters and compositing.
- **Proposed approach:** keep the adapter boundary; track upstream; for any upgrade, re-run the byte-level regression corpus.
- **Target phase:** ongoing; RFC-002 restates the boundary.
- **Acceptance criteria for an upgrade:** regression corpus byte-identical or explained; geometry corpus not worse.
- **References:** [RFC-001](RFC-001.md), [P0-G1](research/p0/P0-G1-VECTORIZATION.md), [LICENSING-AND-DISTRIBUTION](research/p0-r/LICENSING-AND-DISTRIBUTION.md).
- **G-0 disposition (2026-11-25):** stage **ARCHITECTURE ACCEPTED (boundary restated)**; gate Ongoing; G-ENG checks the public API; closure: per the acceptance criteria above, plus no VTracer or visioncortex type in any public engine API; owner action: No. RFC §6, C4.

<a id="td-arch-002"></a>
### TD-ARCH-002 — Worker lifecycle and persistent editor state
- **Category / severity / status:** Limitation · **High** · OPEN TECHNICAL DEBT (priority RFC-002 input).
- **Subsystem:** worker client (`src/vectorization/client.ts`), worker, WASM instance.
- **Impact on the editor.** Cancellation and crash recovery terminate the worker and destroy all in-memory WASM state. Any editor geometry, effect cache or undo data held in WASM would be lost on every cancel, crash or memory recycle.
- **Root cause.** Synchronous WASM cannot observe a cancel message. Cooperative cancellation would need `SharedArrayBuffer`, i.e. cross-origin isolation, which was not adopted.
- **Evidence.**
  - Cancel acknowledged < 1 ms, visible ≤ 53 ms.
  - Offline recreation verified in 3 engines.
  - Recycling above 1 GiB tested (`offline-recovery.spec.ts`).
- **Requirements for RFC-002.**
  - The document of record must live outside the worker (main thread, persisted storage, or replayable commands).
  - Workers hold only derivable caches.
  - Recovery must replay from the document.
  - Undo/redo and effect caches must survive worker replacement.
  - Geometry ownership must be explicit.
- **Options to evaluate:**
  - chunked or cooperative cancellation;
  - a worker pool;
  - state snapshots;
  - cross-origin isolation (with its CSP and deployment consequences).
- **Target phase:** RFC-002.
- **Acceptance criteria:** RFC-002 defines geometry ownership, the recovery path and cache invalidation, and every editor state survives a worker termination test.
- **References:** [P0-G2](research/p0/P0-G2-WORKER-ARCHITECTURE.md), [OFFLINE-WORKER-RECOVERY](research/p0-r/OFFLINE-WORKER-RECOVERY.md), [P1-ARCHITECTURAL-INPUTS](research/p0-r/P1-ARCHITECTURAL-INPUTS.md).
- **G-0 disposition (2026-11-25):** stage **PROTOTYPE DEMONSTRATED (R03: 16/16 in 3 engines, online and offline) / IMPLEMENTATION PENDING**; gate G-DOC, G-JOB; closure: Every editor state survives worker termination in production-build tests (3 engines, online, offline, service-worker update); owner action: Safari authorisation (owner part of G-JOB). Design answered (D01/D05); not closed.
- **G-DOC disposition (2026-11-25), document side:** the document of record, history and GeometryStore now live on the main thread outside any worker (`src/document`); workers can only receive fresh `jobCopy`/`renderCopy` buffers, and undo/redo restore immutable states by reference. Node 24.22.1 unit tests show committed state unaffected by simulated job transfers and terminations. The closure criterion (every editor state survives real worker termination in production-build tests, 3 engines, online, offline, service-worker update) is G-JOB's and was NOT RUN here; item stage unchanged: **PROTOTYPE DEMONSTRATED / IMPLEMENTATION PENDING**. Not closed.

<a id="td-arch-003"></a>
### TD-ARCH-003 — Scene v1 expressiveness and JSON transport
- **Category / severity / status:** Limitation · **High** · OPEN TECHNICAL DEBT (RFC-002 input).
- **Subsystem:** `crates/vector-engine/src/scene.rs`; WASM boundary (`packages/vector-engine-wasm`); preview.
- **Facts.**
  - Scene v1 is an evaluated export scene: absolute M/L/C/Z, rectangle clips only, no object identity, no transforms, 0.01 px quantisation.
  - It crosses the JS/WASM boundary as JSON, plus SVG text.
- **Impact.** No stable ids for selection or undo; no arbitrary path clips (halftone-in-shape, ink plates); JSON parse and memory cost on 300 k–1 M-anchor scenes.
- **Evidence.**
  - Transfer and parse overhead 1–28 ms measured, but SVG strings of 12–37 MB.
  - Scene v1 absorbed precision mode without change, which shows the M/L/C/Z contract is adequate for the evaluated scene.
- **Proposed approach (RFC-002):**
  - a separate editable document;
  - scene v2 (ids, path clips, strokes, possibly plates);
  - typed-array geometry transport or worker-held handles;
  - the evaluated scene remains the only export input.
- **Target phase:** RFC-002.
- **Acceptance criteria:** RFC-002 specifies document and scene versions, migration, and a transport that meets TD-PERF-001's budget.
- **References:** [P1-ARCHITECTURAL-INPUTS](research/p0-r/P1-ARCHITECTURAL-INPUTS.md), [RFC-001](RFC-001.md).
- **G-0 disposition (2026-11-25):** stage **ARCHITECTURE ACCEPTED (packet-only transport; document v1) / IMPLEMENTATION PENDING**; gate G-ENG, G-DOC; closure: C3 conformance in TS and Rust; lossless Scene ↔ Packet; scene v1 exports byte-identical via the packet route; owner action: No. R01: same size as JSON; parse 97–198 ms vs validate 8–20 ms at ~1M anchors.
- **G-DOC disposition (2026-11-25), document half:** separate editable Document v1 (C1 IDs, transforms, styles, rect clips) with packet-only geometry storage and `.vectra` container v1 implemented on `gate/g-doc-document-store`, against the packet port with the **test-only** C3 adapter (`src/document/testing`). It is not PRODUCTION VERIFIED: that needs G-ENG's production validator and codec wired in at the P1-A integration step and the shared conformance test passing. Stage: **IMPLEMENTATION PENDING** (document half implemented, integration pending). Not closed.

<a id="td-arch-004"></a>
### TD-ARCH-004 — Engineering-only engine entry points
- **Category / severity / status:** Enhancement · Low · OPEN TECHNICAL DEBT.
- **Facts.** The engine crate exposes `#[doc(hidden)]` diagnostics for evaluation tools: `segment_layers`, `vectorize_with_precision_options`, the `Subpixel` / `Smoothing` / `arcs` options. These are unused by the app and outside the WASM API.
- **Impact:** a larger public surface in the Rust crate. No runtime effect.
- **Proposed approach:** move behind a `diagnostics` cargo feature (examples opt in), or a separate dev crate, once the engine API is formalised.
- **Target phase:** P1-A.
- **Acceptance criteria:** production builds expose only the documented API; evaluation tools still build.
- **References:** [SELECTED-CORRECTION](research/p0-r-geo/SELECTED-CORRECTION.md).
- **G-0 disposition (2026-11-25):** stage **IMPLEMENTATION PENDING**; gate G-ENG; closure: per the acceptance criteria above; the staged API replaces `segment_layers` for production use; owner action: No. Unchanged target.

## Platforms and environments

<a id="td-platform-001"></a>
### TD-PLATFORM-001 — Linux amd64
- **Category / severity / status:** Untested · Low · NOT RUN.
- **Facts.**
  - Linux **arm64** passes the full suite from a clean clone in a pinned Ubuntu 24.04 container, with WASM output identical to macOS (65/65).
  - **amd64** under Docker Desktop's QEMU emulation fails because `rustc -vV` segfaults during the image build. No amd64 result exists.
- **Reproduction:** `scripts/linux-verify.sh --platform linux/amd64` on a native amd64 host.
- **Target phase:** before any public release or published build hashes.
- **Acceptance criteria:** all steps pass on native amd64, with an identical WASM output fingerprint.
- **References:** [LINUX-REPRODUCIBILITY](research/p0-r/LINUX-REPRODUCIBILITY.md).
- **G-0 disposition (2026-11-25):** stage **NOT RUN**; gate Before published hashes (canonical Linux build approved at G-0); closure: per the acceptance criteria above, on native amd64 (P-CI runs are build evidence, not release qualification); owner action: No (approved). Prefer native amd64 over QEMU.

<a id="td-platform-002"></a>
### TD-PLATFORM-002 — Safari and mobile
- **Category / severity / status:** Untested · **High** · NOT RUN.
- **Facts.**
  - Every browser result is from Playwright WebKit 27.2, Chromium 159 and Firefox 159 on macOS and Linux arm64.
  - **Playwright WebKit is not Safari.** Real Safari 26.6.2 is installed but was never automated, because that needs the owner's authorisation via `safaridriver --enable`.
  - iOS Safari and Android Chrome are untested, including service-worker behaviour, memory limits and touch.
- **Reproduction.** Manual Safari steps in the P0-R owner checklist §C. Automated runs need safaridriver.
- **Target phase:** P1-B (workspace), and before any public release.
- **Acceptance criteria:** the workflow, offline recovery and exports verified in real Safari (macOS and iOS) and Android Chrome, with performance measured.
- **References:** [OFFLINE-WORKER-RECOVERY](research/p0-r/OFFLINE-WORKER-RECOVERY.md), [OWNER-ACCEPTANCE-CHECKLIST (P0-R) §C](research/p0-r/OWNER-ACCEPTANCE-CHECKLIST.md).
- **G-0 disposition (2026-11-25):** stage **NOT RUN**; gate G-JOB, G-UI, G-R1 (owner parts); closure: Real Safari coverage per G0-P1-IMPLEMENTATION-PLAN; iOS and Android are separate future gates; owner action: **Yes:** the maintainer runs `sudo safaridriver --enable` locally (approved in principle; never run by an agent). Raised by R03 and R02 WebKit-only findings.

<a id="td-platform-003"></a>
### TD-PLATFORM-003 — Lower-end desktop hardware
- **Category / severity / status:** Untested · **High** · NOT RUN.
- **Facts.**
  - Every performance number comes from an Apple M5 Max with 128 GiB RAM.
  - 4× CPU-throttled Chromium does **not** throttle dedicated workers (12 MP colour WASM call 6,395 → 6,530 ms), so it is not a proxy for engine speed.
- **Proposed reference target:** a 2020–2021 mainstream laptop: 4 cores / 8 threads (Intel Core i5-1135G7 or AMD Ryzen 5 5500U class), or an Apple M1 with 8 GB; integrated graphics; 1080p.
  - Estimated engine time there is 2–4× the reference machine. That is **estimated, not measured**.
- **Target phase:** before any public performance claim; feeds the RFC-002 budget.
- **Acceptance criteria:** the native and geometry benchmarks run on the target device; the P1 budget is ratified or revised from those measurements.
- **References:** [PERFORMANCE-BASELINE](research/p0-r/PERFORMANCE-BASELINE.md) ("Device support").
- **G-0 disposition (2026-11-25):** stage **NOT RUN**; gate G-R1 sign-off; closure: Benchmarks on an M1 8 GB and a 4c/8t ~8 GB laptop; until then no broad performance-compatibility claims; owner action: **Yes:** obtain or borrow hardware (does not block G-ENG or G-DOC). CPU throttling is not a substitute.

<a id="td-platform-004"></a>
### TD-PLATFORM-004 — Real deployment
- **Category / severity / status:** Untested · Medium · DEFERRED (until a suitable application UI exists).
- **Facts.**
  - **Decided:** Cloudflare Workers Static Assets, assets-only, approved. `wrangler.jsonc` contains no account id, routes or secrets.
  - **Verified locally:** `wrangler dev` passed 16/16 header and MIME checks and 21/21 browser tests via `scripts/verify-deployment.sh`.
  - **Not run:** a real HTTPS deployment. Local emulation is not a deployment PASS.
  - **Domains:** tentative only, `vectrapress.ink` and `vectrapress.com`. None is registered, and no DNS is configured.
- **Reproduction:** the owner checklist in DEPLOYMENT-READINESS (`pnpm dlx wrangler@4.166.0 deploy`, then `scripts/verify-deployment.sh <url>`).
- **Target phase:** when a suitable UI exists; the maintainer approves deployment.
- **Acceptance criteria:** `verify-deployment.sh` passes against a real HTTPS preview, including offline cancellation recovery.
- **References:** [DEPLOYMENT-READINESS](research/p0-r/DEPLOYMENT-READINESS.md), [DEPLOYMENT](DEPLOYMENT.md).
- **G-0 disposition (2026-11-25):** stage **DEFERRED**; gate When a suitable UI exists; closure: per the acceptance criteria above; owner action: Yes: deployment approval. No deployment, domain or DNS changes in G-0 or P1.

<a id="td-platform-005"></a>
### TD-PLATFORM-005 — Cross-host precision reproducibility
- **Category / severity / status:** Untested · Low · NOT RUN.
- **Facts.**
  - **Default modes:** identical output from macOS- and Linux-built WASM (65/65 cases).
  - **Precision:** native and WASM on macOS are identical (26/26, digest `07fdd00d…`). Precision uses `atan2`, `sin`, `cos` and `tan` in arc construction.
  - **Not run:** a Linux-built precision WASM comparison.
- **Reproduction:** `scripts/linux-verify.sh`. The fingerprint step prints the precision digest; compare it with macOS.
- **Target phase:** at the next Linux verification run.
- **Acceptance criteria:** identical precision digest from macOS- and Linux-built WASM.
- **References:** [EXPORT-REGRESSION](research/p0-r-geo/EXPORT-REGRESSION.md), [LINUX-REPRODUCIBILITY](research/p0-r/LINUX-REPRODUCIBILITY.md).
- **G-0 disposition (2026-11-25):** stage **NOT RUN**; gate Next Linux verification run; closure: per the acceptance criteria above; owner action: No. Unchanged.

## Process

<a id="td-process-001"></a>
### TD-PROCESS-001 — No automated required checks
- **Category / severity / status:** Enhancement · Low · OPEN TECHNICAL DEBT.
- **Facts.**
  - PR #3 reports no CI checks. All verification ran locally (macOS) or in the pinned Linux container, per the instruction to avoid unnecessary CI.
  - Byte-level regression baselines are committed as hashes; their inputs are not committed.
- **Impact.** Regressions are caught only when someone runs the suites.
- **Proposed approach.** The maintainer decides whether one cheap pinned CI job (fmt, clippy, cargo test, vp check, vp test, build) should become a required check. Browser and benchmark suites stay local.
- **Target phase:** maintainer decision, before P1 work accelerates.
- **Acceptance criteria:** documented decision; if adopted, a required check on `main`.
- **G-0 disposition (2026-11-25):** stage **ARCHITECTURE ACCEPTED (policy decided at G-0) / IMPLEMENTATION PENDING**; gate P-CI (before P1-A PRs merge); closure: One required lightweight Linux job per the P-CI specification, fail-closed; owner action: No (decided); configuring it is engineering work after G-0 approval. Specification only at G-0; no workflow created.


## Added at G-0 (from the independent review and reconciliation)
These map the review's proposed risks (`docs/research/rfc-002-review/TECHNICAL-DEBT-DISPOSITION.md`) to stable register IDs. The review document is unchanged.

<a id="td-arch-005"></a>
### TD-ARCH-005 — Typed-array immutability is a convention
- **Review ID:** RISK-R01-IMMUTABLE.
- **Category / severity / status:** Limitation · **High** · OPEN.
- **Description.** Committed geometry buffers cannot be frozen. Placing one in a transfer list silently detaches it (`byteLength` 0) and destroys committed artwork.
- **Evidence:** `docs/research/rfc-002-review/artifacts/transport/adversarial.json` (detachment demonstration).
- **Disposition:** stage **ARCHITECTURE ACCEPTED** (A2: copy-out-only GeometryStore, C2) / IMPLEMENTATION PENDING; gate **G-DOC**.
- **Closure criteria:** no API exposes committed buffers; tests assert no committed buffer is detached after any sequence of jobs and terminations.
- **Dependencies:** C2, C3.
- **Owner action:** no.
- **G-DOC disposition (2026-11-25):** stage **PRODUCTION VERIFIED** for both closure criteria, in Node 24.22.1 unit tests only (`src/document/geometry-store.test.ts`, `property.test.ts`): (1) no API exposes committed buffers — frozen `ChunkView` and `DerivedView` close over private arrays, and a runtime walk of every own and inherited property of views, derived views, method results and the store finds no `ArrayBuffer`, typed array or `DataView`; (2) no committed buffer is detached after 25 job/render copies transferred through `structuredClone` and `MessageChannel` with simulated terminations, nor across 30 seeded random command/undo/redo sequences. Browser runs NOT RUN. Next stage: **OWNER ACCEPTANCE PENDING**. Not closed.

<a id="td-arch-006"></a>
### TD-ARCH-006 — WebKit offline worker start-up under termination churn
- **Review ID:** RISK-R03-WKCHURN.
- **Category / severity / status:** Defect (reproduced in a prototype) · **High** · OPEN.
- **Description.** In Playwright WebKit 27.2, terminating module workers while their service-worker-served module graph is still loading made the next worker fail with "Importing a module script failed". It happened offline only, deterministically (4 of 4 runs). The P0 client has the same pattern.
- **Evidence:** `docs/research/rfc-002-review/artifacts/lifecycle/lifecycle-v1-*.json` (14/16) and `lifecycle-v2-*.json` (16/16 after the fix).
- **Disposition:** stage **PROTOTYPE DEMONSTRATED** (fix) / IMPLEMENTATION PENDING; gate **G-JOB**.
- **Closure criteria:** reproduction and fix verified against the **production build**, offline and across a service-worker update, in 3 engines plus real Safari (or a documented restriction).
- **Dependencies:** RFC §10.3 rules 4–5; TD-PLATFORM-002.
- **Owner action:** Safari authorisation.

<a id="td-ren-001"></a>
### TD-REN-001 — Chromium builds Path2D incrementally in quadratic time
- **Review ID:** RISK-R02-PATH2D.
- **Category / severity / status:** Defect (browser behaviour) · **High** · OPEN.
- **Description.** Chromium 159 builds one large Path2D with `moveTo`/`bezierCurveTo` in quadratic time: 16.9 s at 250k anchors, against 30 ms from path data and 8 ms via `addPath`. Firefox and WebKit are linear.
- **Evidence:** `docs/research/rfc-002-review/artifacts/renderer/path2d-scaling.json`.
- **Disposition:** stage **ARCHITECTURE ACCEPTED** (A7) / IMPLEMENTATION PENDING; gate **G-R0**.
- **Closure criteria:** linear construction in the production renderer, plus a scaling regression benchmark in 3 engines.
- **Dependencies:** none.
- **Owner action:** no.

<a id="td-ren-002"></a>
### TD-REN-002 — Worker-canvas presentation (WebKit) and worker raster (Firefox)
- **Review ID:** RISK-R02-WKOFFSCREEN.
- **Category / severity / status:** Untested / limitation · Medium · OPEN.
- **Description.**
  - In Playwright WebKit 27.2, the first worker-hosted OffscreenCanvas frame appeared in screenshots only after a delay: blank captures at 0–1 s for some sizes, visible at every size after 1.5 s.
  - Firefox rasters the 977k-anchor single path slowly in a worker (594 ms draw; first draw 1.1 s vs 0.78 s on the main thread).
- **Evidence:** `artifacts/renderer/offscreen-visibility.json`, `offscreen.json`, `offscreen-cache.json`.
- **Disposition:** stage **PROTOTYPE DEMONSTRATED** (worker plus cache: gestures 17–23 ms, main thread 17–19 ms) / IMPLEMENTATION PENDING; gates **G-R0** (measure) and **G-R1** (real Safari).
- **Closure criteria:** first-meaningful-frame latency qualified on real Safari; when it fails, the disclosed main-thread fallback is used and measured.
- **Dependencies:** TD-PLATFORM-002.
- **Owner action:** Safari authorisation.

<a id="td-ren-003"></a>
### TD-REN-003 — Layered drag-cache correctness and cost
- **Review ID:** RISK-R02-DRAG.
- **Category / severity / status:** Limitation (unqualified) · **High** · OPEN.
- **Description.** Object drags with exact redraw cost one exact frame per frame (Firefox 467–917 ms on halftones). A naive two-layer cache (background plus selection) breaks paint order when the selection sits within the paint order.
- **Evidence:** the R02 editing table (`artifacts/renderer/bench-*.json`).
- **Disposition:** stage **ARCHITECTURE ACCEPTED** (compositing-preserving segmentation, RFC §8.4) / IMPLEMENTATION PENDING; gate **G-R1**.
- **Closure criteria:** the RFC §8.4 qualification matrix matches exact frames, with drag performance within budget.
- **Dependencies:** G-R0.
- **Owner action:** hands-on review.

<a id="td-ren-004"></a>
### TD-REN-004 — Large compound paths as single objects
- **Review ID:** RISK-R02-COMPOUND.
- **Category / severity / status:** Limitation · Medium · OPEN.
- **Description.** One traced object can be a compound path with 195k subpaths (halftone). Hit testing needs a subpath index: without it, 12.8 ms warm p95. "Select a dot" needs an explicit split command.
- **Evidence:** `artifacts/renderer/index-bench.json`.
- **Disposition:** stage **PROTOTYPE DEMONSTRATED** (subpath and band index) / IMPLEMENTATION PENDING; gate **G-R0** (index); the split command is later.
- **Closure criteria:** warm hit-test p95 ≤ 8 ms on the stress halftone in production; cold queries addressed by idle pre-flattening.
- **Dependencies:** C2.
- **Owner action:** no.

<a id="td-ui-001"></a>
### TD-UI-001 — Base UI inline `<style>` vs strict CSP
- **Review ID:** RISK-R05-CSP.
- **Category / severity / status:** Limitation (mitigated in the harness) · Medium · OPEN.
- **Description.** Base UI's ScrollArea injects a `<style>` that violates `style-src 'self'`. Playwright's WebKit screenshot also injects one.
- **Evidence:** `artifacts/design-system/csp-violations.json`.
- **Disposition:** stage **PROTOTYPE DEMONSTRATED** (`CSPProvider disableStyleElements` plus an owned rule: 0 violations in 3 engines) / IMPLEMENTATION PENDING; gate **G-UI**.
- **Closure criteria:** a production CSP regression test with positive and negative controls passes in 3 engines and real Safari.
- **Dependencies:** none.
- **Owner action:** no.

<a id="td-ui-002"></a>
### TD-UI-002 — Colour picker and slider accessibility
- **Review ID:** RISK-R05-A11Y.
- **Category / severity / status:** Defect (upstream sources) · **High** · OPEN.
- **Description.** Dice colour picker defects D3–D6: unnamed thumbs; hex typing reverts; saturation/value area pointer-only; no commit/cancel. The shadcn Slider drops `aria-label` (D1) and renders two thumbs for scalar values (D2). Keyboard commits are per key (D7).
- **Evidence:** `docs/research/rfc-002-review/DESIGN-SYSTEM-FEASIBILITY.md` §8.
- **Disposition:** stage **ARCHITECTURE ACCEPTED** (owned patches or an owned picker; keyboard coalescing) / IMPLEMENTATION PENDING; gate **G-UI**.
- **Closure criteria:** explicit qualification of the repaired controls (keyboard, names, values, commit/cancel, coalesced history) plus a screen-reader smoke test. The review's 42/42 result does not close this item.
- **Dependencies:** RFC §7.
- **Owner action:** no.

<a id="td-ui-003"></a>
### TD-UI-003 — Border, slider-track and focus-ring contrast
- **Review ID:** RISK-R05-TOKENS.
- **Category / severity / status:** Defect (tokens) · Medium · OPEN.
- **Description.** `border` #414347 reaches 1.31–1.76:1 and the slider track 1.11:1, against a 3:1 requirement. The lime ring fails on paper (1.15:1) and on lime fills (1.00:1).
- **Evidence:** `artifacts/design-system/contrast.json`.
- **Disposition:** stage **ARCHITECTURE ACCEPTED** (control-border #787a7e, dual focus ring, destructive and warning tokens) / IMPLEMENTATION PENDING; gate **G-UI**.
- **Closure criteria:** the contrast table passes in the production shell, plus an owner visual review.
- **Dependencies:** none.
- **Owner action:** visual review.

<a id="td-ui-004"></a>
### TD-UI-004 — Notices do not cover copied sources and emitted CSS
- **Review ID:** RISK-R05-NOTICES.
- **Category / severity / status:** Limitation (licence compliance) · Medium · OPEN.
- **Description.** The notice generator relies on JS source maps. Copied shadcn and Dice sources and Tailwind's emitted CSS are not covered.
- **Evidence:** R05-A §10.
- **Disposition:** stage **IMPLEMENTATION PENDING**; gate **G-UI**, before any distributed build that includes the design system.
- **Closure criteria:** notices include copied sources (via the manifest with hashes), Tailwind CSS, lucide ISC and MIT, and cva Apache-2.0; the build fails if they are stale.
- **Dependencies:** DESIGN-SYSTEM §6.
- **Owner action:** no.

<a id="td-geo-010"></a>
### TD-GEO-010 — Sliver metric and junction criterion restatement
- **Review ID:** RISK-R04-METRIC.
- **Category / severity / status:** Limitation (measurement) · Medium · OPEN.
- **Description.** The registered antialiased sliver metric flags exact analytic shapes (4 on `discs-x2`). The "junction within 0.1 px" criterion assumes a partition.
- **Evidence:** `docs/research/rfc-002-review/SHARED-BOUNDARY-STRATEGY.md` §3.
- **Disposition:** stage **ARCHITECTURE ACCEPTED**, decided at G-0: the crisp-sampled metric at 4× with the 0.25 px² threshold is accepted; the antialiased metric continues to be reported; junction criteria are restated per mosaic and stacked output (RFC §12.4). Implementation is PENDING in the evaluation tooling; gate **G-SB**.
- **Closure criteria:** both metrics implemented and reported for every geometry gate. Visible artifacts are never suppressed.
- **Dependencies:** TD-GEO-001.
- **Owner action:** no (decided).

<a id="td-platform-006"></a>
### TD-PLATFORM-006 — Service-worker version skew under network-first navigation
- **Source:** G-0 reconciliation (source inspection of `scripts/generate-sw.mjs`).
- **Category / severity / status:** Defect (source inspection; not reproduced) · Medium · OPEN.
- **Description.** Navigations are network-first while an older service worker controls the page. A tab can load a newer shell whose hashed assets are absent from the old cache, and offline worker recreation can then fail: a mixed-version session.
- **Evidence:** source inspection only. NOT RUN as a reproduction.
- **Disposition:** stage **ARCHITECTURE ACCEPTED** (single-build sessions, RFC §15.3) / IMPLEMENTATION PENDING; gate **G-JOB**.
- **Closure criteria:** update-lifecycle tests (old tabs, worker recreation after deploy, interrupted install, offline after update, mixed-version refusal) pass on the production build in 3 engines and real Safari.
- **Dependencies:** C5 handshake (`buildId`).
- **Owner action:** Safari authorisation.

---

## Resolved during P0 (kept for traceability)
| Item | Resolution | Evidence |
|---|---|---|
| VTracer's sampled-row transparency keying filled transparent holes (leak 1.0) | **RESOLVED** in P0: Vectra-owned alpha keying | [P0-G1](research/p0/P0-G1-VECTORIZATION.md) |
| Translucent PDF background alpha leaked into later paths | **RESOLVED** in P0 (`25e7867`); regression-tested | [P0-G3](research/p0/P0-G3-VECTOR-EXPORT.md) |
| WebKit could not recreate the worker after an offline cancel | **RESOLVED** in P0-R: versioned service worker | [OFFLINE-WORKER-RECOVERY](research/p0-r/OFFLINE-WORKER-RECOVERY.md) |
| Linux build not run | **RESOLVED** for arm64 in P0-R (amd64: TD-PLATFORM-001) | [LINUX-REPRODUCIBILITY](research/p0-r/LINUX-REPRODUCIBILITY.md) |
| No LICENSE file; third-party notices missing | **RESOLVED**: MIT, Copyright (c) 2026 Stephane Pericat; generated notices | [LICENSING-AND-DISTRIBUTION](research/p0-r/LICENSING-AND-DISTRIBUTION.md) |
| DEF-GEO-001 distorted transparent circular hole (05) | **RESOLVED** in precision mode (radial RMS 0.315 → 0.016 px, 0 breaks); approved | [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md) |
| DEF-GEO-002 distorted overlapping discs (04) | **RESOLVED for the brief's targets** in precision mode (centre ≤ 0.05, RMS ≤ 0.057 px, 0 breaks); approved. Residual junction effects: TD-GEO-001 | same |
| Star/ring IoU below 0.98 (0.977 / 0.975) | **RESOLVED in precision mode** (0.996 / 0.996). The spline (artistic) default is unchanged by design | same |
| Outward contour bias and slice-wise spline fitting | **RESOLVED in precision mode.** Spline keeps VTracer's behaviour, which the owner approved for photographs | [ROOT-CAUSE-ANALYSIS](research/p0-r-geo/ROOT-CAUSE-ANALYSIS.md) |
