# Technical debt register

A living engineering register: outstanding limitations, their evidence and their intended disposition.

**Rules.**
- Identifiers are stable and never reused.
- When an item changes, update its status and add the evidence. Do not delete history.
- An item accepted for P0 is **not fixed**: acceptance means the P0 baseline may ship to the next phase with this behaviour documented.

Created at P0 closure (2026-11-24) from the P0, P0-R and P0-R-GEO reports. The consolidated narrative is in the [P0 postmortem](research/P0-POSTMORTEM.md); decisions are in [P0-ACCEPTANCE](research/P0-ACCEPTANCE.md).

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
| ID | Title | Category | Severity | Status | Target |
|---|---|---|---|---|---|
| [TD-GEO-001](#td-geo-001) | Shared colour boundaries and lower-layer slivers | Limitation (with measured defects) | **High** | ACCEPTED FOR P0 / OPEN | **RFC-002**, P1-C |
| [TD-GEO-002](#td-geo-002) | Non-antialiased geometric shapes | Limitation | Medium | ACCEPTED FOR P0 / OPEN | P1-C or later |
| [TD-GEO-003](#td-geo-003) | Thin bars and acute corners | Defect | Medium | ACCEPTED FOR P0 / OPEN | P1-C |
| [TD-GEO-004](#td-geo-004) | Straight-edge curvature near rebuilt corners | Defect | Low | ACCEPTED FOR P0 / OPEN | P1-C |
| [TD-GEO-005](#td-geo-005) | One-pixel diagonal strokes | Limitation | Medium | DEFERRED | P1 Line Art |
| [TD-GEO-006](#td-geo-006) | Partial source transparency | Limitation | Medium | ACCEPTED FOR P0 / OPEN | Later (preset-driven) |
| [TD-GEO-007](#td-geo-007) | Browser-dependent image decoding | Limitation | Medium | DEFERRED | RFC-002 decision, P1 |
| [TD-GEO-008](#td-geo-008) | Residual transparency approximation | Limitation | Low | ACCEPTED FOR P0 | Later |
| [TD-GEO-009](#td-geo-009) | Precision compositing limitations | Limitation | Medium | ACCEPTED FOR P0 / OPEN | RFC-002, P1-C |
| [TD-PERF-001](#td-perf-001) | Large-scene preview rendering | Defect (budget not met) | **High** | OPEN | **RFC-002**, P1-B |
| [TD-PERF-002](#td-perf-002) | Late geometry budget enforcement | Defect | Medium | OPEN | P1-A/B |
| [TD-PERF-003](#td-perf-003) | High-resolution image memory usage | Limitation | **High** | OPEN | **RFC-002**, P1 |
| [TD-PERF-004](#td-perf-004) | Interactive preview responsiveness | Enhancement (with one measured defect) | Medium | OPEN | P1-B |
| [TD-PERF-005](#td-perf-005) | Halftone pitch at native resolution | Enhancement | Low | DEFERRED | P2 |
| [TD-PERF-006](#td-perf-006) | Precision mode cost on photographs | Limitation | Low | ACCEPTED FOR P0 | Later |
| [TD-ARCH-001](#td-arch-001) | VTracer alpha dependency | Limitation (dependency risk) | Medium | ACCEPTED FOR P0 (provisional) | Ongoing; RFC-002 |
| [TD-ARCH-002](#td-arch-002) | Worker lifecycle and persistent editor state | Limitation | **High** | OPEN | **RFC-002** |
| [TD-ARCH-003](#td-arch-003) | Scene v1 expressiveness and JSON transport | Limitation | **High** | OPEN | **RFC-002** |
| [TD-ARCH-004](#td-arch-004) | Engineering-only engine entry points | Enhancement | Low | OPEN | P1-A |
| [TD-PLATFORM-001](#td-platform-001) | Linux amd64 | Untested | Low | NOT RUN | Before public release |
| [TD-PLATFORM-002](#td-platform-002) | Safari and mobile | Untested | **High** | NOT RUN | P1-B and before public release |
| [TD-PLATFORM-003](#td-platform-003) | Lower-end desktop hardware | Untested | **High** | NOT RUN | Before any public performance claim; RFC-002 budget |
| [TD-PLATFORM-004](#td-platform-004) | Real deployment | Untested | Medium | DEFERRED | When a suitable UI exists |
| [TD-PLATFORM-005](#td-platform-005) | Cross-host precision reproducibility | Untested | Low | NOT RUN | Next Linux run |
| [TD-PROCESS-001](#td-process-001) | No automated required checks | Enhancement | Low | OPEN | Maintainer decision |

Counts:
- **25 open items:** 4 confirmed defects, 12 limitations, 5 untested environments, 4 enhancements.
- **7 High.**
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
  - No component of a lower layer's colour ≥ 0.25 source px² visible at 4× on the disc and overlap fixtures.
  - |κ|·r − 1 RMS ≤ 0.15 and max ≤ 0.5 beyond 2 px from true junctions.
  - Every junction shared by all incident paths within 0.1 px.
  - No regression of the brief's targets or of spline outputs.
- **References:** [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md), [ALGORITHM-EVALUATION](research/p0-r-geo/ALGORITHM-EVALUATION.md) ("Curvature near junctions"), [ROOT-CAUSE-ANALYSIS](research/p0-r-geo/ROOT-CAUSE-ANALYSIS.md).

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
- **Target phase:** P1 Line Art.
- **Acceptance criteria:** 1-px diagonal strokes at 30–60° are preserved as one connected stroke or shape, with their position within 0.5 px.
- **References:** [GEOMETRY-QUALITY-DISPOSITION §2](research/p0-r/GEOMETRY-QUALITY-DISPOSITION.md), [GEOMETRY-VALIDATION](research/p0-r-geo/GEOMETRY-VALIDATION.md).

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
- **Acceptance criteria:** over-budget traced jobs report within 2 s on the reference machine, with a recoverable, actionable error; no silent downscaling.
- **References:** [PERFORMANCE-BASELINE](research/p0-r/PERFORMANCE-BASELINE.md) ("Resource limits review").

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

<a id="td-perf-006"></a>
### TD-PERF-006 — Precision mode cost on photographs
- **Category / severity / status:** Limitation · Low · ACCEPTED FOR P0.
- **Impact.** Precision is meant for geometric art. On photographs it produces 1.4–2× the anchors and takes 1.0–2.4× the time of the corresponding default mode, with equal peak heap.
- **Evidence.** PERFORMANCE-REGRESSION: 12.5 MP street colour 389,717 → 595,810 anchors; limited 7.1 → 11.9 s.
- **Workaround.** Use artistic (spline), the default, for photographs.
- **Proposed approach.** Product guidance (Artistic vs Precision naming); optional per-region mode choice later.
- **Target phase:** later.
- **References:** [PERFORMANCE-REGRESSION](research/p0-r-geo/PERFORMANCE-REGRESSION.md).

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

<a id="td-arch-004"></a>
### TD-ARCH-004 — Engineering-only engine entry points
- **Category / severity / status:** Enhancement · Low · OPEN TECHNICAL DEBT.
- **Facts.** The engine crate exposes `#[doc(hidden)]` diagnostics for evaluation tools: `segment_layers`, `vectorize_with_precision_options`, the `Subpixel` / `Smoothing` / `arcs` options. These are unused by the app and outside the WASM API.
- **Impact:** a larger public surface in the Rust crate. No runtime effect.
- **Proposed approach:** move behind a `diagnostics` cargo feature (examples opt in), or a separate dev crate, once the engine API is formalised.
- **Target phase:** P1-A.
- **Acceptance criteria:** production builds expose only the documented API; evaluation tools still build.
- **References:** [SELECTED-CORRECTION](research/p0-r-geo/SELECTED-CORRECTION.md).

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
