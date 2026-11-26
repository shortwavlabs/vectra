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
| [TD-PERF-007](#td-perf-007) | Structural transactions cost O(nodes) | Limitation (measured) | **High** | OPEN (authorised: G-DOC-R) | G-DOC-R | G-DOC-R |
| [TD-PERF-008](#td-perf-008) | WASM copy-out at 1M anchors above 2 ms | Limitation (measured; accepted exception) | Low | OPEN | quiet re-run | performance follow-up |
| [TD-PERF-009](#td-perf-009) | Document v1 open above 1 s at 250k paths | Limitation (measured; accepted exception) | Medium | OPEN | before G-PRJ and public Document v1 | compact Document v1 follow-up |
| [TD-PERF-010](#td-perf-010) | Job handling blocks the main thread above 50 ms | Defect (budget not met, measured; accepted temporary exception) | **High** | OPEN | G-R1, G-TRACE, G-EXP, G-PRJ | G-TRACE/G-EXP/G-PRJ |
| [TD-PERF-011](#td-perf-011) | History retains a full node-map table per entry | Limitation (measured) | **High** | OPEN (authorised: G-DOC-R) | G-DOC-R | G-DOC-R |
| [TD-ARCH-001](#td-arch-001) | VTracer alpha dependency | Limitation (dependency risk) | Medium | ACCEPTED FOR P0 (provisional) | Ongoing; RFC-002 | ongoing/G-ENG |
| [TD-ARCH-002](#td-arch-002) | Worker lifecycle and persistent editor state | Limitation | **High** | OPEN | **RFC-002** | G-DOC/G-JOB |
| [TD-ARCH-003](#td-arch-003) | Scene v1 expressiveness and JSON transport | Limitation | **High** | OPEN | **RFC-002** | G-ENG/G-DOC |
| [TD-ARCH-004](#td-arch-004) | Engineering-only engine entry points | Enhancement | Low | OPEN | P1-A | G-ENG |
| [TD-PLATFORM-001](#td-platform-001) | Linux amd64 | Untested | Low | NOT RUN | Before public release | release |
| [TD-PLATFORM-002](#td-platform-002) | Safari and mobile | Untested | **High** | PARTIALLY RUN | P1-B and before public release | G-JOB/G-UI/G-R1 |
| [TD-PLATFORM-003](#td-platform-003) | Lower-end desktop hardware | Untested | **High** | NOT RUN | Before any public performance claim; RFC-002 budget | G-R1 |
| [TD-PLATFORM-004](#td-platform-004) | Real deployment | Untested | Medium | DEFERRED | When a suitable UI exists | later |
| [TD-PLATFORM-005](#td-platform-005) | Cross-host precision reproducibility | Untested | Low | NOT RUN | Next Linux run | next Linux run |
| [TD-PROCESS-001](#td-process-001) | No automated required checks | Enhancement | Low | OPEN | Maintainer decision | P-CI |
| [TD-ARCH-005](#td-arch-005) | Typed-array immutability is a convention | Limitation | **High** | OPEN | G-DOC | G-DOC |
| [TD-ARCH-006](#td-arch-006) | WebKit offline worker start-up under churn | Defect (prototype-reproduced) | **High** | OPEN | G-JOB | G-JOB |
| [TD-REN-001](#td-ren-001) | Chromium quadratic incremental Path2D | Defect (browser) | **High** | **CLOSED** (maintainer, 2026-11-25) | G-R0 | G-R0 |
| [TD-REN-002](#td-ren-002) | Worker-canvas presentation (WebKit) and raster (Firefox) | Untested / limitation | Medium | OPEN | G-R0/G-R1 | G-R0/G-R1 |
| [TD-REN-003](#td-ren-003) | Layered drag-cache correctness and cost | Limitation (unqualified) | **High** | OPEN | G-R1 | G-R1 |
| [TD-REN-004](#td-ren-004) | Large compound paths as single objects | Limitation | Medium | OPEN | G-R0 | G-R0 |
| [TD-UI-001](#td-ui-001) | Base UI inline style vs strict CSP | Limitation (mitigated in the production shell) | Medium | OPEN | G-UI | G-UI |
| [TD-UI-002](#td-ui-002) | Colour picker and slider accessibility | Defect (upstream) | **High** | OPEN | G-UI | G-UI |
| [TD-UI-003](#td-ui-003) | Border, track and focus-ring contrast | Defect (tokens) | Medium | OPEN | G-UI | G-UI |
| [TD-UI-004](#td-ui-004) | Notices do not cover copied sources and CSS | Limitation (licence compliance) | Medium | OPEN | G-UI | G-UI |
| [TD-UI-005](#td-ui-005) | Palette display names: custom vs generated names are not recorded | Limitation (document model) | Medium | OPEN | before user-facing palette renaming | G-UI-R |
| [TD-UI-006](#td-ui-006) | No "commit without history" confirmation in the shell (RFC §7) | Limitation (UI) | Medium | OPEN | before documents above ~450k paths per subtree are supported | G-DOC-R |
| [TD-GEO-010](#td-geo-010) | Sliver metric and junction criterion restatement | Limitation (measurement) | Medium | OPEN | G-SB | G-SB |
| [TD-PLATFORM-006](#td-platform-006) | Service-worker version skew (network-first navigation) | Defect (source inspection) | Medium | OPEN | G-JOB | G-JOB |
| [TD-PLATFORM-007](#td-platform-007) | Native and WASM Artistic output differ on some inputs (found at G-ENG) | Defect (determinism) | Medium | OPEN | before cross-target reproducibility claims | — |

Counts:
- **37 open items** after G-0: the original 25 (4 confirmed defects, 12 limitations, 5 untested environments, 4 enhancements) plus 12 added at G-0 (11 proposed by the independent review, plus TD-PLATFORM-006 found during reconciliation).
- **G-ENG (2026-11-25):** one item added, TD-PLATFORM-007 (pre-existing, measured by G-ENG), so there are 38 open items. None is closed by G-ENG.
- **12 High** (7 original + 5 added).
- **No item is resolved by G-0.** Choosing an architecture moves an item to ARCHITECTURE ACCEPTED at most.
- **RFC-002 inputs:** TD-GEO-001, TD-GEO-007, TD-GEO-009, TD-PERF-001, TD-PERF-003, TD-ARCH-001, TD-ARCH-002, TD-ARCH-003.
- **G-DOC (2026-11-25):** one item added, TD-PERF-007 (High, gate G-EDIT): 38 open items and 13 High on this branch; 39 open and 13 High once G-ENG's TD-PLATFORM-007 (Medium) is also merged. None is closed by G-DOC.
- **P1-A foundation acceptance and G-JOB (2026-11-25):** three items added. TD-PERF-008 (Low) and TD-PERF-009 (Medium) register the accepted P1-A performance exceptions ([decision register §7](research/g0/G0-DECISION-REGISTER.md)); TD-PERF-010 (High) is measured by G-JOB. **42 open items, 14 High.** None is closed by G-JOB: every G-JOB item still needs real Safari (TD-PLATFORM-002) or a later gate.
- **G-R0/G-UI acceptance (2026-11-25):** TD-REN-001 **closed** by maintainer approval. **41 open items, 13 High.** No item added. Accessibility debt (TD-UI-002, TD-UI-003) stays open until VoiceOver and keyboard path selection are qualified.
- **G-R1 (2026-11-25):** one item added, TD-PERF-011 (High, measured by the TD-PERF-007 investigation). **42 open items, 14 High.** None is closed by G-R1. TD-REN-003 has met its closure criteria on the reference machine and TD-REN-004 in substance; both are proposed for closure, maintainer to confirm.
- **G-R1/G-UI-R maintainer review (2026-11-25):**
  - No item is closed or added: **42 open items, 14 High**.
  - TD-PERF-001: the complete-preview miss is accepted temporarily for downstream engineering. The item and every target are retained.
  - TD-PERF-007 and TD-PERF-011 are authorised as the follow-up gate G-DOC-R (options B, C, D; [scope](research/g-doc-r/G-DOC-R-SCOPE.md)).
  - Accessibility debt (TD-UI-002, TD-UI-003) stays open until VoiceOver and the stock-Safari keyboard check are executed. The canvas focus ring is fixed at the canvas-host level (#19).
- **G-UI-R final acceptance (2026-11-25):** one item added, TD-UI-005 (Medium): the palette-name provenance limitation, recorded for resolution before user-facing palette renaming. **43 open items, 14 High.**
- **G-DOC-R (2026-11-26, not yet accepted):** one item added, TD-UI-006 (Medium): there is no shell confirmation to commit without history, and AM-2 makes it reachable for very large subtrees. **44 open items, 14 High.** TD-PERF-007 and TD-PERF-011 dispositions are updated in their entries.

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
  - **Corrected at AM-1 (2026-11-25):** the guarantee holds *per target*. Native and WASM Artistic tracing can differ for identical RGBA; this is measured by G-ENG and tracked as TD-PLATFORM-007. Packet encoding is deterministic across Rust, WASM and TS for identical scenes (C3 r2). `decodePolicy` is now a closed enum recorded in the document and in trace provenance (C10).
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
- **G-R0 disposition (2026-11-25), first part:** retained Canvas 2D in an OffscreenCanvas worker with the display cache. At 270k anchors / 16k paths the exact frame takes 96 / 181 / 103 ms (Chromium / Firefox / Playwright WebKit) and 116 ms in real Safari: the ≤ 100 ms preview target is met only in Chromium. Gestures p95 18–19 ms everywhere, main thread ≤ 21 ms during gestures. Closure stays with G-R1 and lower-end hardware. [G-R0 report](research/g-r0/G-R0-REPORT.md).
- **G-R1 disposition (2026-11-25):** measured on the registered interactive target (synthetic-many-250k: 250,000 anchors, 41,853 paths), validated document to exact frame: **146 / 270 / 147 ms** (Chromium / Firefox / Playwright WebKit). **NOT MET**; covered by the temporary exception accepted at G-R0. Per the G-R1 stop condition this needs an owner decision; no target is lowered. Path construction (137–657 ms summed) and progressive drawing dominate. Lower-end hardware NOT RUN. [G-R1 report](research/g-r1/G-R1-REPORT.md).
- **Maintainer review (2026-11-25):**
  - The miss is accepted temporarily for downstream engineering. This item and every numerical target are retained.
  - Grading distinguishes the interactive target (≤ 250k anchors and ~40k paths: preview ≤ 100 ms) from stress workloads (500k–1M anchors, RFC-002 §8.8). Stress workloads, the 977k halftone among them, stay measured, but no 100 ms preview threshold is applied to them.
  - Quiet-machine and lower-end-hardware qualifications are retained. **OPEN.**

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
- **G-ENG (2026-11-25), API part:** **PRODUCTION VERIFIED (API) / IMPLEMENTATION PENDING (forecast UI, FP/FN)**.
  - `segment → estimate → fit` exists, and `vectorize` is `fit(segment(..))`.
  - `estimate` returns a boundary-length range (R03 calibration) for B&W and colour at Artistic defaults, and an explicit `Unavailable` for limited, halftone and non-spline fitting.
  - FP/FN validation on a reserved corpus and the 2 s forecast remain G-TRACE work. [G-ENG-REPORT](research/g-eng/G-ENG-REPORT.md).
- **G-JOB disposition (2026-11-25):** the production worker traces through the staged API (`segment` → `estimate` → `fit`), reports each stage as it starts, and returns the estimate with the result. Nothing acts on the estimate: no rejection, no downsampling; the engine's own limits stay authoritative (`too_many_primitives` surfaces as a typed failure and nothing is committed). Held-out estimator qualification remains G-TRACE's. Not closed. [G-JOB report](research/g-job/G-JOB-REPORT.md).

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
- **G-JOB disposition (2026-11-25):** jobs reserve their input-copy bytes at submission and release them at settle (`src/jobs/controller.ts`; budget 1 GiB by default), a source over the request's pixel limit is refused before any worker starts, and the controller registers `job-copies` and `compute-worker` reporters with the ledger. Per-profile budgets, the worker-memory estimate and lower-end measurements are still pending (G-R1). Not closed. [G-JOB report](research/g-job/G-JOB-REPORT.md).

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
- **G-JOB disposition (2026-11-25), scheduler part:** implemented (`src/jobs/scheduler.ts`): priorities, preview and thumbnail supersession, a bounded explicit queue, no stale result shown (workbench and qualification specs, 3 engines). The workbench keeps its 200 ms debounce and full-resolution previews; preview resolution, the import debounce and the acceptance criteria above are G-TRACE's. Not closed. [G-JOB report](research/g-job/G-JOB-REPORT.md).

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
- **G-ENG (2026-11-25):** boundary check **PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING**. The staged API (`segment`/`estimate`/`fit`) uses an opaque `Segmentation`. A test asserts that only the private `trace` module references `vtracer::`/`visioncortex::` and that `trace` is neither public nor re-exported. The dependency risk itself is unchanged. [G-ENG-REPORT](research/g-eng/G-ENG-REPORT.md).

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
- **G-JOB disposition (2026-11-25):** the production scheduler and protocol v2 replace `src/vectorization/client.ts` (deleted). Production-build tests in Chromium, Firefox and Playwright WebKit, online, offline and across a service-worker update, show committed geometry, history and provenance byte-identical (canonical container digest) after repeated terminations, crashes, fatal aborts and recycling, and failed or cancelled jobs never mutate the document. Real Safari NOT RUN (TD-PLATFORM-002). Stage: **PRODUCTION-BUILD VERIFIED in 3 engines / Safari pending**. Not closed. [G-JOB report](research/g-job/G-JOB-REPORT.md).
- **Real Safari (2026-11-25):** in Safari 26.6.2 the committed document is byte-identical (canonical container digest) after repeated cancels and injected crashes offline, undo/redo restore it, and no ownership leaks. Not yet shown in Safari: document integrity across a service-worker update with a committed document. Not closed. [G-JOB report §18](research/g-job/G-JOB-REPORT.md).

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
- **G-ENG (2026-11-25), engine and validator half:** **PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING**.
  - GeometryPacket v1 in Rust and TS; 47 shared conformance cases, with matching codes.
  - Lossless Scene ↔ Packet over the regression corpus (106 scenes; the 8 over-budget cases fail identically in both routes).
  - Packet-route scene, SVG and PDF byte-identical to `a4cf172.sha256` (326/326).
  - The document half is G-DOC's; integration is pending. [G-ENG-REPORT](research/g-eng/G-ENG-REPORT.md).
- **G-DOC disposition (2026-11-25), document half:** separate editable Document v1 (C1 IDs, transforms, styles, rect clips) with packet-only geometry storage and `.vectra` container v1 implemented on `gate/g-doc-document-store`, against the packet port with the **test-only** C3 adapter (`src/document/testing`). It is not PRODUCTION VERIFIED: that needs G-ENG's production validator and codec wired in at the P1-A integration step and the shared conformance test passing. Stage: **IMPLEMENTATION PENDING** (document half implemented, integration pending). Not closed.
- **P1-A integration (2026-11-25), both halves on one path:** **PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING** on `p1a/integration`. G-DOC uses G-ENG's validator and codec as its only path (the test adapter is deleted). P0 scene → packet → document commit → `.vectra` (both codecs) → strict load → export draw list → Rust bake reproduces `a4cf172.sha256` for 636/636 corpus files. Closure needs PRs #13, #10, #11 and the integration PR merged. [P1A-INTEGRATION-REPORT](research/p1a-integration/P1A-INTEGRATION-REPORT.md).

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
- **G-ENG (2026-11-25):** **PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING**. `segment_layers` and `vectorize_with_precision_options` are compiled only with the `diagnostics` cargo feature. Tests and examples enable it through a self dev-dependency; the library and WASM builds do not. The review's standalone experiments need `--features vector-engine/diagnostics` to rebuild; they were not edited. [G-ENG-REPORT](research/g-eng/G-ENG-REPORT.md).

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
- **P-CI (2026-11-25):** partial evidence only. Native amd64 (GitHub `ubuntu-24.04`) passed fmt, clippy, the Rust tests, `vp check`, `vp test` and the production build on PR #8. Browser suites and the WASM output fingerprint did not run on amd64. Stage unchanged (**NOT RUN** for release qualification).

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
- **Real Safari, G-UI scope (2026-11-25):** Safari 26.6.2 on the G-UI workspace (`tests/safari/gui.mjs`): 14/14 scenarios covering strict CSP with negative and positive controls, the design-system components (tool rail, dialogs, slider, numeric field, colour picker, resizable panels, layers with keyboard reorder), tokens and focus ring, and import through the file input. Keyboard navigation under stock Safari settings is not shown, because automation sessions enable full keyboard access; VoiceOver, reduced-motion emulation and export download bytes were not run in Safari. [G-UI report §7](research/g-ui/G-UI-REPORT.md).
- **Real Safari, G-R1 scope (2026-11-25):** in the integrated workspace (`tests/safari/gr1.mjs`), 4 of 4 functional scenarios pass: rendering through the worker, RFC §8.4 drag frames equal exact frames (6 cases), keyboard path selection, and workspace offline reload with worker recovery. Timing (presentation, gestures) is **NOT RUN**: the automation window was hidden. Status unchanged: **PARTIALLY RUN**. [G-R1 report](research/g-r1/G-R1-REPORT.md).
- **G-JOB disposition (2026-11-25):** real Safari was NOT RUN for G-JOB (no `safaridriver` authorisation). The G-JOB owner part is open: a Safari run, or a documented Safari restriction until it runs. Every G-JOB browser result is Chromium 159, Firefox 159 or Playwright WebKit 27.2. [G-JOB report](research/g-job/G-JOB-REPORT.md).
- **Real Safari, G-JOB scope (2026-11-25):** run with `safaridriver` (maintainer-enabled) in **Safari 26.6.2 (21624.5.1.11.3)**, macOS 26.6.2: 10/10 G-JOB scenarios pass (worker start-up and handshake, start-up churn online and offline, cancellation, offline reload and recreation, single-build sessions across a deploy, template-only update, interrupted install, cache-eviction recovery, frozen exports, document integrity after termination, build-mismatch refusal). "Offline" was an unreachable origin (WebDriver has no network emulation). Still NOT RUN: G-R0 and G-UI in Safari (pending their gates), iOS/iPadOS Safari, Android Chrome, Safari performance. Status: **PARTIALLY RUN**; not closed. [G-JOB report §18](research/g-job/G-JOB-REPORT.md).
- **Real Safari, G-R0 and persistence (2026-11-25):** Safari 26.6.2: G-R0 7/7 (OffscreenCanvas worker host, 0 geometry-error pixels on 10 fixtures for worker and fallback, first-frame presentation, recovery online and offline, pan/zoom p95 18–19 ms, fallback disclosed) and `.vectra` interchange 23/23 (Safari ↔ Node ↔ 3 Playwright engines, both codecs; typed atomic failures). G-UI in Safari pending its gate. Status unchanged: **PARTIALLY RUN**. [G-R0 report](research/g-r0/G-R0-REPORT.md).

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
- **G-R1 (2026-11-25):** NOT RUN; still required for G-R1 qualification. G-R1 stays PARTIAL.

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
- **P-CI (2026-11-25):** stage **PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING**. `.github/workflows/ci.yml` (one `ci` job, fail-closed path filter) ran green on PR #8 (run 45535732214). Merging and making `ci` a required check are maintainer actions; branch protection is **not** configured. Not closed. [P-CI-REPORT](research/p-ci/P-CI-REPORT.md).
- **P1-A (2026-11-25):** PR #8 merged with a merge commit (`d6c1cbf`) after the hardened classifier passed. `main` had no protection and no rulesets; it now requires the `ci` status check (GitHub Actions), with `strict: false` and `enforce_admins: false` and no other rule. Stage **PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING**: the owner confirms or tightens these settings.


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
- **G-JOB disposition (2026-11-25):** the fix (no termination before the job is posted, R03 v2 rule; RFC §10.3 rule 4) is implemented in the production scheduler. Against the production build, offline, the churn pattern (terminate a running worker, then five previews while the next worker's module graph loads from the service worker) passed 4 of 4 runs in each of Chromium, Firefox and Playwright WebKit, with exactly one worker created per run and no start-up failure. It also passes in an old tab after a deploy, offline, and on the new build offline after the update (3 engines). A scheduler mutation that terminates starting workers fails the unit and property tests. Real Safari NOT RUN; closure needs it or a documented restriction. Stage: **FIX PRODUCTION-BUILD VERIFIED in 3 engines / Safari pending**. Not closed. [G-JOB report](research/g-job/G-JOB-REPORT.md).
- **Real Safari (2026-11-25):** the churn pattern passes in Safari 26.6.2 against the production build: online, 4 runs offline, in an old tab after a deploy (offline), on the new build offline after the update, and under build A during a failed template-only update. With 3 engines plus real Safari, the closure criteria (fix verified on the production build, offline and across a service-worker update) are **met; proposed for closure, maintainer to confirm**. [G-JOB report §18](research/g-job/G-JOB-REPORT.md).

<a id="td-ren-001"></a>
### TD-REN-001 — Chromium builds Path2D incrementally in quadratic time
- **Review ID:** RISK-R02-PATH2D.
- **Category / severity / status:** Defect (browser behaviour) · **High** · **CLOSED** (maintainer approval, 2026-11-25).
- **Description.** Chromium 159 builds one large Path2D with `moveTo`/`bezierCurveTo` in quadratic time: 16.9 s at 250k anchors, against 30 ms from path data and 8 ms via `addPath`. Firefox and WebKit are linear.
- **Evidence:** `docs/research/rfc-002-review/artifacts/renderer/path2d-scaling.json`.
- **Disposition:** stage **ARCHITECTURE ACCEPTED** (A7) / IMPLEMENTATION PENDING; gate **G-R0**.
- **Closure criteria:** linear construction in the production renderer, plus a scaling regression benchmark in 3 engines.
- **G-R0 disposition (2026-11-25):** the production renderer builds every Path2D in one pass from SVG path data (`src/renderer/path-data.ts`, unit-tested for linear construction). Scaling for one path of 25k / 125k / 250k anchors: Chromium 0.3 / 2 / 4 ms, Firefox 1 / 4 / 8 ms, Playwright WebKit 1 / 3 / 6 ms (`tests/browser/renderer-perf.spec.ts`). Closure criteria **met; proposed for closure, maintainer to confirm**. [G-R0 report](research/g-r0/G-R0-REPORT.md).
- **Maintainer disposition (2026-11-25):** closure approved ("Approve closure of TD-REN-001: linear Path2D construction"). **CLOSED.** The scaling benchmark stays in `tests/browser/renderer-perf.spec.ts` as the regression guard. [Decision register §9](research/g0/G0-DECISION-REGISTER.md).
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
- **G-R0 disposition (2026-11-25):** worker host and disclosed main-thread fallback implemented. Playwright WebKit worker canvases can be presented after their exact frame (the tests wait until the screen matches the resvg reference). **Real Safari 26.6.2:** first-frame presentation ≤ 47–58 ms after the exact frame (screenshot-bounded), worker host correct (0 geometry-error pixels on 10 fixtures), fallback correct and disclosed. Firefox worker raster: exact frame 117 ms (worker draw) at 270k anchors and 376 ms at 812k, off the main thread. Closure criteria **met; proposed for closure, maintainer to confirm**. [G-R0 report](research/g-r0/G-R0-REPORT.md).
- **Maintainer disposition (2026-11-25):** "Record real Safari worker-canvas feasibility as demonstrated under TD-REN-002, retaining end-to-end presentation-latency qualification in G-R1." Stage: **real Safari worker-canvas feasibility DEMONSTRATED**; **OPEN** for end-to-end presentation latency (G-R1). The G-R0 screenshot-bounded Safari figure (47–58 ms) shares the WebDriver capture lag found at G-UI, so G-R1 measures presentation explicitly. [Decision register §9](research/g0/G0-DECISION-REGISTER.md).
- **Dependencies:** TD-PLATFORM-002.
- **Owner action:** Safari authorisation.
- **G-R1 disposition (2026-11-25):** end-to-end presentation is measured in the integrated workspace by sampling the displayed canvas every frame. Where the sampler works, the visible frame follows the renderer's exact-frame message within one animation frame (Chromium, Firefox, Playwright WebKit). **Real Safari presentation: NOT RUN**: the automation window was hidden (0 animation frames), so the Safari timings are flagged invalid. Still **OPEN** for Safari presentation latency. [G-R1 report](research/g-r1/G-R1-REPORT.md).
- **Final closure (2026-11-25, `bed736d`; confirmed on the final head `01a3dab`):** **real Safari presentation measured** with the page visible (32 rAF in 500 ms). Interactive target: visible 189 ms after load (exact frame 157 ms, preview 178 ms). Gestures p95 17 / 18 ms. The worker host was qualified, including the crash fallback to the main thread. Closure needs lower-end hardware and a quiet-machine run; **OPEN**. [G-R1 report §13](research/g-r1/G-R1-REPORT.md).

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
- **G-R1 disposition (2026-11-25):** compositing-preserving layered caches implemented: static layers below, between and above the selection; moving layers per fixed clip; scale poses redrawn as vectors; a capped memory fallback. The RFC §8.4 matrix (12 cases, including an edit during a drag) matches exact frames with **0 geometry-error pixels** in Chromium, Firefox and Playwright WebKit, and 6 cases in real Safari. Mutation: flattening fails 5 of 12. Drag frame p95 ≤ 18.5 ms and drag start 11–230 ms on the four registered workloads (reference machine). Closure criteria **met on the reference machine**; the owner's hands-on review and lower-end hardware are pending. [G-R1 report](research/g-r1/G-R1-REPORT.md).

<a id="td-ren-004"></a>
### TD-REN-004 — Large compound paths as single objects
- **Review ID:** RISK-R02-COMPOUND.
- **Category / severity / status:** Limitation · Medium · OPEN.
- **Description.** One traced object can be a compound path with 195k subpaths (halftone). Hit testing needs a subpath index: without it, 12.8 ms warm p95. "Select a dot" needs an explicit split command.
- **Evidence:** `artifacts/renderer/index-bench.json`.
- **Disposition:** stage **PROTOTYPE DEMONSTRATED** (subpath and band index) / IMPLEMENTATION PENDING; gate **G-R0** (index); the split command is later.
- **Closure criteria:** warm hit-test p95 ≤ 8 ms on the stress halftone in production; cold queries addressed by idle pre-flattening.
- **G-R0 disposition (2026-11-25):** subpath index (paths with more than 8 subpaths) and band index (subpaths above 2,048 points) implemented in `src/hit-test`. Warm p95 ≤ 0.05 ms on the 270k and 812k workloads in 3 engines. Not closed: the 977k-anchor halftone stress case was not measured, and the index is built lazily on the first query, so a cold first click blocks the main thread 30–93 ms (above 50 ms at 812k anchors); idle pre-flattening remains to do (G-R1). [G-R0 report](research/g-r0/G-R0-REPORT.md).
- **Dependencies:** C2.
- **Owner action:** no.
- **G-R1 disposition (2026-11-25):** the index is prepared after each evaluation in bounded slices (≤ 4 ms of 512 units, pausing inside a path, entries added in units). A click before it is ready is answered only by the complete index. The 977k halftone is measured: ready in 71–896 ms, longest slice 4–7 ms, a click before ready answered 58–69 ms later, warm p95 ≤ 0.005 ms. Flattening for the winding test stays lazy per hit subpath (bounded by subpath size; band index above 2,048 points); that is a substitute for idle pre-flattening, recorded. Closure criteria **met in substance; proposed for closure, maintainer to confirm**. [G-R1 report](research/g-r1/G-R1-REPORT.md).

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
- **G-UI disposition (2026-11-25):** the workspace (`workspace.html`) wraps its root in `<CSPProvider disableStyleElements>` and owns the `.base-ui-disable-scrollbar` rule (`src/ui/styles.css`); the CSP in `public/_headers` is unchanged. `tests/browser/ui-shell.spec.ts`: the served header equals `_headers`, 0 violations and 0 inline `<style>` elements at load with a ScrollArea on screen; negative control (injected `<style>` reported) and positive control (`?csp=default` drops the provider: 1 `style-src-elem` violation at load) pass in Chromium 159, Firefox 159 and Playwright WebKit 27.2; every UI test asserts 0 violations and 0 off-host requests. Real Safari NOT RUN. Stage: **PRODUCTION VERIFIED (3 Playwright engines) / real Safari pending**. Not closed. [G-UI report](research/g-ui/G-UI-REPORT.md).
- **Real Safari (2026-11-25):** Safari 26.6.2 (21624.5.1.11.3), macOS 26.6.2, `tests/safari/gui.mjs` on `478d26a`, against the production build and the unchanged production CSP:
  - clean load: 0 violations, 0 errors, 0 inline `<style>`, ScrollArea on screen;
  - negative control: an injected `<style>` is blocked and reported (`style-src-elem`);
  - positive control (`?csp=default`): Base UI's `<style>` is blocked at load;
  - all 14 G-UI scenarios end with 0 violations.

  A same-origin probe script, allowed by the unchanged policy, records violations from the start of the load (disclosed in the G-UI report §7). Closure criteria **met; proposed for closure, maintainer to confirm**.
- **Maintainer disposition (2026-11-25):** "Approve the demonstrated strict-CSP and third-party-notice solutions, subject to regression verification on the combined application." Combined application (`main` `7f57dd7`, tree `36cb205`): `ui-shell` CSP tests with positive and negative controls pass in Chromium, Firefox and Playwright WebKit (225/225 browser tests), and the real Safari G-UI harness passes 14/14 on the same tree. Stage: **SOLUTION APPROVED; combined-application regression verified**. Closure is the maintainer's act. [Decision register §9](research/g0/G0-DECISION-REGISTER.md).

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
- **G-UI disposition (2026-11-25):** the Dice colour picker is replaced by an owned picker built from Base UI sliders (`src/ui/color-picker.tsx`): named thumbs (D3), a free-text hex draft committed on Enter or blur (D4), a keyboard-operable saturation/brightness area (D5) and one commit on Apply, none on Cancel, Escape, outside click or an unchanged colour (D6). The shadcn Slider keeps the D1 patch and is always given array values (D2). Keyboard steps carry a coalesce key and focus changes end the run (D7, RFC §7; session window 1000 ms, unchanged). dnd-kit announcements are name-based (D8). Qualified in `tests/browser/ui-document.spec.ts` in 3 Playwright engines (names, values, keyboard, commit/cancel, one undo entry per gesture or keyboard run). Screen-reader (VoiceOver) smoke test NOT RUN; Playwright aria snapshots are recorded as a proxy only. Stage: **PRODUCTION VERIFIED (automated) / screen-reader pass pending**. Not closed. [G-UI report](research/g-ui/G-UI-REPORT.md).
- **G-R1 note (2026-11-25):** keyboard selection of single paths on the canvas is implemented (it was G-UI §5.4's open gap), with announcements (`workspace-a11y`, 3 engines; real Safari keyboard scenario PASS). The VoiceOver smoke test is still **NOT RUN**: the owner checklist is [VOICEOVER-CHECKLIST.md](research/g-r1/VOICEOVER-CHECKLIST.md). Not closed.
- **Maintainer review (2026-11-25):** VoiceOver remains mandatory. It is not marked PASS until executed; the checklist gives the exact build to test. Not closed.

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
- **G-R1 correction (2026-11-25):**
  - The canvas's keyboard focus ring was invisible in Chromium: the host's outline was painted under its own canvas layers (WCAG 2.4.7).
  - The canvas host now draws the dual ring as its top layer. The ring follows `:focus-visible`, is an outline (so it survives forced-colours mode) and takes no pointer input.
  - It is verified from rendered pixels, not computed style, along all four edges over artwork and the selection overlay: `workspace-a11y` in Chromium, Firefox and Playwright WebKit, and `tests/safari/gr1.mjs` 'focus' in real Safari 26.6.2.
  - Mutations (no ring layer; ring under the layers) fail the test in all 3 engines. Not closed: owner visual review.
- **G-UI disposition (2026-11-25):** tokens shipped as in DESIGN-SYSTEM §4, including `control-border` #787a7e (input outlines, slider tracks, resize grips) and the dual focus ring (2 px lime outline, 2 px offset filled by a #191a1c ring), one unlayered `:focus-visible` rule. The contrast table is computed from the running production build (all pairs pass; control-border 3.02–4.05:1; dark inner ring 14.24:1 on paper, 12.35:1 on lime), and the computed colours of a real input border, slider track and resize grip are measured at 3.70, 3.70 and 4.05:1 in 3 engines; the rendered ring is asserted. Stage: **OWNER ACCEPTANCE PENDING** (visual review). Not closed. [G-UI report](research/g-ui/G-UI-REPORT.md).

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
- **G-UI disposition (2026-11-25):** `scripts/generate-notices.mjs` reads the copied-source manifest `src/ui/registry/PROVENANCE.json` (registry item, URL, upstream and current SHA-256, recorded patches), fails when a copied file differs from its recorded hash, and adds the shadcn/ui and Dice UI MIT texts (verbatim at the recorded upstream commits; git blob SHAs equal upstream's) and tailwindcss's licence when the built CSS carries its banner; lucide-react (ISC with the MIT Feather section) and class-variance-authority (Apache-2.0) come from the source-map pass. `pnpm run build` verifies the notices (55 components). Stage: **PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING** (closure criteria met; closes on G-UI acceptance). [G-UI report](research/g-ui/G-UI-REPORT.md).
- **Maintainer disposition (2026-11-25):** "Approve the demonstrated strict-CSP and third-party-notice solutions, subject to regression verification on the combined application." Combined application (`main` `7f57dd7`, tree `36cb205`): `pnpm run build` verifies the notices (55 components), and regenerating them produces no diff. Stage: **SOLUTION APPROVED; combined-application regression verified**. Closure is the maintainer's act. [Decision register §9](research/g0/G0-DECISION-REGISTER.md).

<a id="td-ui-005"></a>
### TD-UI-005 — Palette display names: custom vs generated names are not recorded
- **Category / severity / status:** Limitation (document model) · Medium · OPEN.
- **Description.** The workspace shows engine-generated palette names (`p2`, `c5`, `ink`…) as "Colour N". It decides a name is generated only from trace provenance: a path under a traced layer uses the entry, and that layer's `originalScene.palette` records the name. The document model records no flag saying whether a name was generated or set by a person. So:
  1. A custom name equal to an id of the entry's **own** trace cannot be told apart from a generated one, and is shown as "Colour N".
  2. An entry no path uses, or one left after every traced layer is deleted, has no provenable owner. It shows its stored name (strict rule, maintainer final acceptance), for example a raw `p2`.
- **Today.** No command renames a palette entry, so neither case arises through the UI. Case 1 needs a document authored elsewhere.
- **Evidence:** `src/shell/document.ts` `paletteLabels()` and its unit tests; G-UI-R report §16 and §18.
- **Closure criteria:** before user-facing palette renaming ships, record each entry's name origin, via a frozen-contract amendment (schema), so that display never infers it.
- **Owner action:** none until palette renaming is planned.

<a id="td-ui-006"></a>
### TD-UI-006 — No "commit without history" confirmation in the shell (RFC §7)
- **Category / severity / status:** Limitation (UI) · Medium · OPEN (found by G-DOC-R stage D).
- **Description.** RFC-002 §7: "A command that cannot fit is either rejected, or committed without history after explicit confirmation." `DocumentSession.dispatch` supports both: `history_budget`, and `withoutHistory: true` after confirmation. The shell implements only the rejection: `Workspace.tsx` `run` reports "Edit rejected: …", with no confirmation path.
- **Why it matters now.** AM-2 (C3.2 r3) adds document-structure bytes to the history budget. A single deleted or replaced subtree of roughly 450k paths or more can now exceed the standard 128 MiB on its own. The designated 996k-anchor workload's whole-layer delete is 114.9 MiB, which still fits. The constrained 64 MiB profile, which the shell does not configure today, would reject it.
- **Evidence:** [G-DOC-R report](research/g-doc-r/G-DOC-R-REPORT.md) §6.4; calibration record (§7).
- **Closure criteria:** a confirmation flow that commits without history, or a recorded maintainer decision to keep rejection, before documents of that size are supported, or before the constrained profile is enabled.
- **Owner action:** decide the UI path (no UI change was authorised in G-DOC-R).

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
- **G-JOB disposition (2026-11-25):** implemented in `scripts/generate-sw.mjs`: navigations come from the controlling version's cache; an interrupted install deletes its partial cache; activation claims pages only on a first install; lookups ignore `Vary`. The update-lifecycle spec uses a genuinely different second build (different build ID, page, worker and WASM names; build-1 files removed from the server): old tab after a deploy (update announced, not forced), worker recreation in the old tab online and offline, reload staying on build 1, activation after old tabs close, cache invalidation, offline after the update, interrupted install, and a refused worker from another build: all pass in Chromium, Firefox and Playwright WebKit. Mutations caught: network-first navigation (an old tab reloads into build 2) and no install cleanup. **Found and fixed:** the P0 worker never matched module scripts or stylesheets offline (`Vary: Origin` with CORS requests), so an offline reload of the page was blank. Real Safari NOT RUN. Stage: **PRODUCTION-BUILD VERIFIED in 3 engines / Safari pending**. Not closed. [G-JOB report](research/g-job/G-JOB-REPORT.md).
- **Corrections and real Safari (2026-11-25):** the controlling worker never serves another build's shell (repair from an identical build or a static recovery page), a template-only update installs into a new cache, and pages detect a controller of another build (G-JOB report §17; 3 engines, mutation-checked). Real Safari 26.6.2 passes the update-lifecycle scenarios (old tabs after a deploy, worker recreation, interrupted install, template-only update, cache invalidation, offline after update, cache-eviction recovery, mixed-version refusal). Closure criteria **met; proposed for closure, maintainer to confirm**. [G-JOB report §18](research/g-job/G-JOB-REPORT.md).

## Added at G-DOC

<a id="td-perf-007"></a>
### TD-PERF-007 — Structural transactions cost O(nodes)
- **Source:** G-DOC benchmarks; P1-A corrective review (production validator path).
- **Category / severity / status:** Limitation (measured) · **High** · OPEN TECHNICAL DEBT.
- **Description.** Every dispatched transaction copies the node map (`Draft`, `SealedMap`) and then runs the whole-state invariant pass (`validateState`). Both are linear in the node count, so a one-node edit costs as much as revalidating the document. Undo and redo stay below 0.03 ms because they reuse validated states.
- **Evidence** (Apple M5 Max, Node 24.22.1, production validator, medians of 30). Primary run with no `ngspice` (load average 9–12; not quiet: another project's CPU-bound jobs were running):

  | Workload | Nodes | Dispatch (median / p95, ms) | `validateState` | Node-map copy | Rest |
  |---|---|---|---|---|---|
  | Interactive target (§8.8): 41,666 paths × 6 anchors, 5 structural commands | 41,675 | 25.2–28.9 / 26.9–32.1 | — | — | — |
  | same, phase profile (`setTransform` on the layer) | 41,675 | 20.8 | 16.6 (80 %) | 2.2 | 2.1 |
  | 250,000 paths × 4 anchors, phase profile | 250,009 | 156 | 122 (79 %) | 17 | 16 |
  | 50,000 paths × 20 anchors, 5 structural commands | 50,009 | 33.9–41.1 / 34.9–44.1 | — | — | — |

  Under heavy `ngspice` load (load average 20–40), the same measurements were 1.1–2.7 times slower: 27–31 ms at the interactive target, and 418 ms in the 250k phase profile. Undo and redo stay ≤ 0.02 ms. Commands: `node docs/research/g-doc/bench/bench.mjs --reps 30` and `node docs/research/g-doc/bench/dispatch-profile.mjs [paths] [anchorsPerPath]` (P1-A integration branch; results in `docs/research/p1a-integration/bench/`). **Budgets.** RFC-002 §17 sets no dispatch target. The applicable budgets are attributable main-thread blocking ≤ 50 ms and interaction frame time p95 ≤ 33 ms (16.7 ms aspirational). Against them: at the interactive target a dispatch stays within the 50 ms blocking budget, but it uses most of a 33 ms gesture frame if an edit has to be applied within a frame. At 250,000 paths and 1M anchors (B, 172–253 ms), it exceeds the 50 ms blocking budget.
- **Disposition:** stage **ARCHITECTURE ACCEPTED** (immutable snapshots, validated transactions) / IMPLEMENTATION PENDING; gate **G-EDIT**. No store rewrite or new dependency is made in P1-A.
- **Upgrade path.**
  1. Incremental invariants: validate only the nodes a transaction touched, their parents and the derived indices they change, against invariants stated per node.
  2. Structural sharing for the node, style and palette maps (persistent maps, or copy-on-write chunks), so a draft no longer copies the whole map.
  3. The whole-state pass stays authoritative for load, import and recovery, and as a test oracle: a property test compares incremental and full validation on random command sequences.
- **Closure criteria** (**approved by the maintainer** at the P1-A foundation acceptance, 2026-11-25; investigate structural sharing and incremental validation during G-R1, qualify before G-EDIT acceptance):
  - a structural command (transform, rename, hide, recolour, delete group) dispatches in ≤ 16.7 ms median and ≤ 33 ms p95 at the interactive target (≈ 250k anchors, ≈ 40k paths), and in ≤ 50 ms at the 1M-anchor stress workloads, on the reference machine, quiet run, production build.
  - Incremental and full validation agree on every state of a randomized command-sequence suite (at least 10,000 transactions, including rejected ones).
  - Load still runs the full pass; no invariant is weakened.
- **Dependencies:** G-DOC store and invariants (C8 r2); TD-ARCH-005.
- **Owner action:** approve the structural-sharing approach (and any dependency) at G-EDIT. *Superseded on 2026-11-25: G-DOC-R is authorised, with no new dependency.*
- **G-R1 investigation (2026-11-25):** whole-state validation is 62–89 % of a structural transaction and copying 10–18 %. A one-node edit: 22 ms at 43k paths, 144 ms at 250k. A prototype incremental validator (not wired) agrees with the full validator on 62,124 randomized comparisons over 5 seeds, invalid transactions included, with 0 disagreements. Options B (wire it, with a comparison mode), C (Draft key tracking) and D (a chunked copy-on-write map, the only route found to ≤ 50 ms at 250k) are an owner decision. **OPEN.** [Investigation](research/g-r1/TD-PERF-007-INVESTIGATION.md).
- **Maintainer review (2026-11-25):** options **B, C and D are authorised, in that order**, as the dedicated gate **G-DOC-R**, with no new dependency. The frozen-contract amendment process applies. Retained targets: median ≤ 16.7 ms and p95 ≤ 33 ms at the interactive target, ≤ 50 ms at the stress workloads, and ≥ 10,000 randomized differential transactions. [Scope](research/g-doc-r/G-DOC-R-SCOPE.md). **OPEN.**
- **G-DOC-R stages B and C (2026-11-26, branch `gate/g-doc-r`; not merged, awaiting maintainer acceptance).**
  - **What changed.** `dispatch` validates with the incremental proof; the full pass runs as the fallback, in `compare` mode (development and test builds) and on load. Drafts record their written keys, `documentOrder` is gone, unchanged sealed maps are shared, and the subtree walk no longer allocates.
  - **Differential.** 74,325 comparisons over 6 seeds, plus 385,254 over 30 more seeds: 0 disagreements. 12,427 comparisons are enforced in `vp test`.
  - **Independent review.** It found one defect (an `undefined` map value accepted by the proof). Fixed and re-qualified; [report](research/g-doc-r/G-DOC-R-REPORT.md) §1.6.
  - **Integrated dispatch (Node, shared machine, not quiet), worst type, median / p95:**
    - interactive target (43k paths, 264k anchors): **6.9 / 7.3 ms** (was 29.4 / 32.2);
    - 250k paths (756k anchors): 44.7 / 45.7 ms (`ungroup`; borderline across runs, p95 up to 53.6 under heavier load);
    - 330k paths (**996k anchors**): 66.1 / 69.7 ms. **6 of 12 types exceed 50 ms**.
  - **Status: OPEN.**
    - The 1M-anchor stress criterion awaits stage D, which is stopped pending amendment AM-2 ([draft](research/g-doc-r/AM-2-DRAFT.md)).
    - The production-build browser measurement and the quiet-machine run are still needed for closure.
- **G-DOC-R stage D (2026-11-26, branch `gate/g-doc-r`, `6a23a92`; awaiting acceptance).**
  - **What changed:** a chunked copy-on-write node map ordered by node ID, a persistent parent index, and AM-2 history accounting.
  - **Integrated dispatch** (Node, low load, not a designated quiet run), worst type, median / p95:
    - interactive target: **6.9 / 7.5 ms**;
    - 250k paths: **26.2 / 26.5 ms**;
    - **996k anchors: 34.4 / 35.0 ms. All 12 types meet ≤ 50 ms.**
  - One-node edits take 0.06–0.17 ms.
  - **Differential:** 108,249 comparisons over 6 seeds and 558,472 over 30 more, 0 disagreements. Three independent reviews; every confirmed defect fixed and re-qualified.
  - **Closure criteria met in Node on the reference machine.** Still required by the approved criteria: a quiet-machine run, and the production build in a browser for dispatch timing. In-browser renderer stages were measured against the G-BRAND baseline (report §10), but not dispatch itself.
  - Lower-end hardware is NOT RUN.
  - **Status: OPEN, proposed for closure after those runs.**

<a id="td-perf-008"></a>
### TD-PERF-008 — WASM copy-out at 1M anchors above 2 ms
- **Source:** G-ENG / P1-A integration benchmarks; accepted exception at the P1-A foundation acceptance ([decision register §7](research/g0/G0-DECISION-REGISTER.md)).
- **Category / severity / status:** Limitation (measured) · Low · OPEN (accepted exception; target retained).
- **Evidence** ([P1A-INTEGRATION-REPORT §7.1](research/p1a-integration/P1A-INTEGRATION-REPORT.md)): 995,405 anchors, 42.6 MB, block `b318ecfc…`. Copy-out median: Node 0.97 ms, Chromium 2.2 ms, Firefox 2 ms, Playwright WebKit 1 ms; p95 above 2 ms in every runtime. Machine not quiet.
- **Disposition:** keep the single-copy implementation. Do not redesign GeometryPacket v1, reduce coordinate precision or weaken buffer ownership for this marginal miss.
- **Closure criteria:** the existing benchmark re-run on a quiet reference machine meets ≤ 2 ms, reporting median, p95, workload hashes, byte counts, runtime and timer resolution; or the maintainer re-decides on that evidence.
- **Owner action:** none (quiet machine time).

<a id="td-perf-009"></a>
### TD-PERF-009 — Document v1 open above 1 s at 250k paths
- **Source:** G-DOC / P1-A integration benchmarks; accepted exception at the P1-A foundation acceptance.
- **Category / severity / status:** Limitation (measured) · Medium · OPEN (accepted exception; target retained).
- **Evidence** ([P1A-INTEGRATION-REPORT §7.2](research/p1a-integration/P1A-INTEGRATION-REPORT.md)): open at 50k paths 179 ms (`none`) / 300 ms (`deflate-raw`); at 250k paths and 1M anchors **1,048 ms / 1,108 ms**. A single-pass phase profile totals 823 ms at 250k; the gap to the repeated end-to-end median is unexplained.
- **Approved follow-up (bounded compact Document v1 serialization, before G-PRJ qualification and public Document v1 release; independent of G-JOB):** omit canonical default-valued node properties without changing the in-memory model; pre-registered workloads with the original representation as a control; unambiguous canonical defaults; strict schema validation, deterministic canonical sections, integrity checks and decompression limits, project semantics, export hashes, provenance and ID high-water marks preserved; cross-browser interchange; explicit compatibility with development fixtures; frozen-contract amendment for an adopted schema change; no binary format or new dependency without approval. Explain the profile vs end-to-end gap (allocation, GC, warm-up, instrumentation boundaries). The earlier scratch experiment (−32 % bytes, −21 % parse) is preliminary only: its artefacts were not retained.
- **Closure criteria:** open ≤ 1 s at 50k and 250k paths at 1M anchors, measured as above, with every preservation requirement verified.

<a id="td-perf-010"></a>
### TD-PERF-010 — Job handling blocks the main thread above 50 ms
- **Source:** G-JOB performance qualification (`tests/browser/jobs-perf.spec.ts`, headed, production build).
- **Category / severity / status:** Defect (budget not met, measured) · **High** · OPEN.
- **Facts.** RFC-002 §17 allows ≤ 50 ms of attributable main-thread blocking; G-JOB requires no gap above 50 ms in job handling. Scheduling and posting are cheap (source copy at 23.5 MP: 5–7 ms; cancel acknowledgement ≤ 1 ms). The misses are the synchronous main-thread steps that touch whole geometry or whole documents:
  - **committing a trace result** (C2 store commit: move, validate and derive; then the document transaction, whose whole-state pass is TD-PERF-007);
  - **freezing an export snapshot** (`buildExport` over the whole document) and **copying it out** at post (`jobCopy`), which run in one task when the worker is idle;
  - the workbench preview path (preview session commit, SVG snapshot and copy).
- **Evidence** (G-JOB run C on the final code, `docs/research/g-job/bench/run-c/`; Apple M5 Max; no `ngspice`, but five unrelated CPU-bound processes, load average 8.7 → 10.7: **not quiet**; run B in `run-b/` agrees within about ±25 %). Ranges over the repetitions, ms:

  | Workload | Step | Chromium 159 | Firefox 159 | Playwright WebKit 27.2 |
  |---|---|---|---|---|
  | Interactive (270k anchors, bark 1224 px, colour) | final commit | 47.2–56.7 | 71–77 | 55–63 |
  | | of which store commit | 13.6–20.0 | 20–27 | 18–22 |
  | | export snapshot + post | 15.1 + 9.0 | 17 + 13 | 31 + 19 |
  | | workbench preview commit | 69.5 | 83 | 74 |
  | Stress (812k anchors, bark 2350 px, colour) | final commit | 129.5–135.5 | 174–238 | 146–151 |
  | | export snapshot + post | 33.8 + 22.4 | 55 + 32 | 89 + 59 |
  | 23.5 MP B&W source (33k anchors) | job copy and post | 5.1–5.2 | 5–6 | 7 |

- **Upgrade path** (no store rewrite in G-JOB; RFC-002 obligations for G-TRACE and G-PRJ):
  1. Commits: incremental invariants and structural sharing (TD-PERF-007); time-sliced or worker-prepared validation that keeps the commit atomic and the C2 trust boundary on owned bytes.
  2. Exports: post in a separate task from the snapshot; evaluate the draw list incrementally or chunk it; consider copying out per chunk across tasks.
  3. Measure real browser task durations (Long Tasks where available, rAF gaps elsewhere) at the interactive target and the stress workloads.
- **Closure criteria:** every job-handling step ≤ 50 ms of attributable main-thread blocking at the interactive target and at the designated 1M-anchor stress workloads, in Chromium, Firefox and Playwright WebKit (and Safari), on a quiet reference run.
- **Dependencies:** TD-PERF-007; G-TRACE (trace commit), G-EXP (export snapshot), G-PRJ (load).
- **Maintainer disposition (2026-11-25):** **accepted as a temporary, non-blocking performance exception for G-JOB**; the ≤ 50 ms target is unchanged and this item stays open until the closure criteria are met on a quiet run. Corrective ownership ([decision register §8](research/g0/G0-DECISION-REGISTER.md)): **G-R1** investigates TD-PERF-007 (structural sharing, incremental validation, efficient immutable state preparation, no unnecessary full traversals; thresholds and the full-state oracle kept); **G-TRACE** qualifies responsive trace-result preparation with an atomic, revision-checked, provenance-preserving commit that rejects stale prepared results and leaves artwork unchanged on failure or cancel; **G-EXP** qualifies responsive snapshot construction and copy-out without weakening snapshot ownership; **G-PRJ** qualifies responsive project opening (≤ 1 s open and ≤ 50 ms blocking are separate requirements). Not closed by merging any implementation.

---

## Added at G-ENG


<a id="td-perf-011"></a>
### TD-PERF-011 — History retains a full node-map table per entry
- **Category / severity / status:** Limitation (measured) · **High** · OPEN.
- **Description.** Each history state keeps its own complete node map: about 7 MiB per state at 251k nodes, 1.75 MiB at 44k. One hundred entries would hold about 700 MiB. The 128 MiB history budget counts chunks and sources only, not this.
- **Evidence:** [TD-PERF-007 investigation](research/g-r1/TD-PERF-007-INVESTIGATION.md) (G-R1, 2026-11-25).
- **Disposition:** stage **MEASURED**; gate **G-EDIT**. Option D of the investigation (a chunked copy-on-write node map) measured about 0.02 MiB per state; it needs approval.
- **Closure criteria:** history memory bounded and counted in the budget, with the full validator still the oracle.
- **Owner action:** a decision on the TD-PERF-007 options. *Decided on 2026-11-25: option D is authorised within G-DOC-R, after B and C. History accounting covers retained node maps, node objects, indexes, geometry and source assets, counting shared allocations once ([scope](research/g-doc-r/G-DOC-R-SCOPE.md)).*
- **G-DOC-R (2026-11-26).**
  - Stages B and C do not change history memory.
  - Stage C removed one retention found during review: published node maps briefly kept their transaction's written-key set.
  - Counting node maps and indexes in the history budget changes C3.2 (C3 r2) and RFC-002 §7, so **amendment AM-2 is raised** ([draft](research/g-doc-r/AM-2-DRAFT.md)). It asks the maintainer to decide the cost model, the attribution of shared allocations, earlier eviction and node-map iteration order.
  - Stage D is not started. **OPEN.**
- **G-DOC-R stage D (2026-11-26; awaiting acceptance).**
  - **What changed:** history states share node-map and parent-index chunks. A one-node edit retains about 7 KB of accounted structure per step at 43k paths and about 20 KB at 330k; measured retention is within the calibration below. Before stage D it was about 7 MiB per state at 251k.
  - **Counted in the budget:** AM-2 (C3.2 r3) adds document-structure bytes to the RFC §7 history budget.
  - **Calibration:** the model against measured V8 retained heap (Node) gives 0.987–1.074 on the calibration set. On validation and fresh validation it gives 1.001–1.163 above the noise floor. A 10-entry eviction case sits at the noise floor and is inconclusive (0.69, range to 0.97); the larger eviction case is 1.001. Disposal returns the heap within 4 KB. Chromium heap evidence is 1.06–2.46, conservative (report §7).
  - **Closure criteria met** ("history memory bounded and counted in the budget, with the full validator still the oracle"). **Proposed for closure**; the maintainer to confirm. Browser-engine heap evidence is not available (report §7, limits).

<a id="td-platform-007"></a>
### TD-PLATFORM-007 — Native and WASM Artistic output differ on some inputs
- **Category / severity / status:** Defect (determinism) · Medium · OPEN TECHNICAL DEBT (found by G-ENG; pre-existing).
- **Facts.**
  - For 3 of the 65 procedural default-mode cases, the WASM build traces different coordinates from the native build of the same commit: `sharp_corners`/mosaic, `nested_rings`/color and `nested_rings`/mosaic. The maximum differences are 2.0, 1.4 and 0.96 px.
  - The difference is reproduced with `main`'s own WASM build (`be101bca…`), so G-ENG did not introduce it. The WASM output digest (`68723671…`) is unchanged since P0.
  - The inputs are identical: for all 13 fixtures, the Rust in-memory fixture pixels and the Node-decoded committed PNGs have the same checksum, and the committed PNGs equal freshly generated ones byte for byte.
  - Earlier checks compared WASM with WASM across hosts (65/65) and precision native with WASM (26/26). Default-mode native vs WASM had not been compared.
  - The C3 requirement "native and WASM builds produce byte-identical packets" therefore holds only where the scenes agree (62/65). The packet encoding adds no difference.
  - TD-GEO-007's "Current guarantee" sentence ("identical RGBA gives identical scene … in native and WASM") overstates the guarantee for Artistic mode.
- **Confirmed on the frozen G-0 baseline (AM-1 corrective review).** The native side is the G-0 regression output (byte-identical to `a4cf172.sha256`). The WASM side is a fresh build of `main` at `29432da` (`be101bca…`). The first divergent values:

  | Fixture | Paths (native/WASM) | Differing paths | Differing coords | Max \|Δ\| (px) | First divergence (path, coord index, verb) | Native | WASM |
  |---|---|---|---|---|---|---|---|
  | `nested_rings`/color | 6/6 | 1 | 4 | 1.40 | path 1, coord 94 (x), verb 18 `C` | 169.54 | 169.07 |
  | `nested_rings`/mosaic | 6/6 | 4 | 16 | 0.96 | path 2, coord 868 (x), verb 147 `C` | 68.74 | 68.48 |
  | `sharp_corners`/mosaic | 2/2 | 2 | 8 | 2.00 | path 0, coord 592 (x), verb 101 `C` | 31.67 | 32.33 |

  The path structure (verb strings) is identical; only cubic coordinates differ. Packets are unaffected: from identical scene input, native, WASM and TS give identical blocks (C3 r2; 106/106 corpus scenes).
- **Likely cause** (not yet isolated): floating-point library differences between the native and wasm32 targets (for example `atan2`/`powf` in VTracer's spline and corner logic), changing discrete fitting decisions.
- **Reproduction:**
  1. run `cargo run --release -p vector-engine --example packet_regression -- <dir>`;
  2. then run `NATIVE_PACKETS_DIR=<dir> node scripts/wasm-fingerprint.mjs`.
- **Target phase:** before any claim of cross-target reproducibility (recipes, shared presets).
- **Acceptance criteria:**
  - the root cause is isolated;
  - the default-mode native and WASM fingerprints are identical, or the documented determinism guarantee is narrowed with the maintainer's approval.
- **References:** [G-ENG-REPORT](research/g-eng/G-ENG-REPORT.md).

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
