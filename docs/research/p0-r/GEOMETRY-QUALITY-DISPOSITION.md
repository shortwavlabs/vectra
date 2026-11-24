# P0-R-G1: Geometry quality dispositions

> **Superseded in part by P0-R-GEO (2026-11-24).** The maintainer rejected the circular geometry of bundle cases 04 and 05; the items below are revisited in [`../p0-r-geo/`](../p0-r-geo/FINAL-REPORT.md). The new opt-in `precision` fit mode meets the star/ring IoU ≥ 0.98 target (0.996/0.996). The spline (artistic) mode is unchanged.

**Gate status: PARTIAL.** Every issue was reproduced and its cause identified. One residual item is fixed elsewhere: the PDF translucent-paint leak was fixed in P0 and is regression-tested in P0-R-G3. No tracing deviation has been accepted by the maintainer. The items below are **PROPOSED FOR ACCEPTANCE** or **DEFERRED** and await a maintainer decision. No threshold was lowered.

Evidence:
- `crates/vector-engine/examples/quality_probe.rs`, output in `artifacts/quality-probe-baseline.txt`.
- `artifacts/quality-probe-8-connected-experiment.txt`.
- P0 engine tests (`cargo test`).
- P0 decode hashes (`docs/research/p0/artifacts/browser-decode-hashes.txt`).

## 1. Star and ring IoU below the 0.98 target
**Reproduced** with default spline fitting (P0 metric: 1× render vs pixel mask): star 0.9771, rings 0.9752; circle 0.9936 and rectangles 0.9930 pass.

**Cause.**
1. Scoring against the *analytic* shapes at 4× supersampling gives lower values: star 0.9739, rings 0.9695. The error is therefore real geometry, not a metric artefact.
2. The error is a **systematic outward bias**. Excess ink outnumbers missing ink 7:1 on the circle and 73:1 on the star (rings 1.5:1, because hole boundaries bias the other way). Maximum deviation is 0.69 px on the circle, 0.94 px on the rings and 1.12 px on the star tips.
3. Pixel-exact fitting is balanced (over/under 0.7–0.9) and reaches IoU 0.993–0.998 on the 1× metric. The bias is therefore introduced when VTracer fits polygons or splines through the **outer corners of the binary pixel staircase**. Acute tips add rounding.

**Parameter sweep (no code change).**

| Fit | Star | Rings |
|---|---|---|
| Corner threshold 30° | 0.9777 | 0.9752 |
| Length threshold 2 | 0.9775 | 0.9672 |
| Polygon | 0.9781 | **0.9808** |

No setting meets 0.98 for both shapes.

**Narrow correction?** Not appropriate in P0-R. A correct fix extracts sub-pixel iso-contours from the anti-aliased luminance field (marching-squares-style at the threshold) before fitting. That is a new contour-extraction stage, which counts as architectural expansion. An ad hoc inward offset after fitting would risk topology (thin rings, holes) and is rejected.

**Impact on supported modes.**
- Sub-pixel to about 1 px boundary error on 256-px synthetic shapes.
- On real photographs this is below the visual threshold. The maintainer approved B&W on a 1280×720 concert photograph.
- It matters for logos and small text.

**Disposition: PROPOSED FOR ACCEPTANCE** for the P0 baseline, with two follow-ups for the maintainer to decide:
- (a) Revise VALIDATION to measure edge deviation (max and mean, in px) against analytic shapes, not 1× IoU against a binarised mask. PRD-002 already asks for "node counts and deviation".
- (b) Add a P1 sub-pixel contour stage as the corrective. Until then, document polygon or pixel fit for logo work.

The 0.98 target remains **missed** for default settings.

## 2. Loss of 1-px diagonal strokes
**Reproduced.** All horizontal and vertical strokes of 1–4 px survive. The ~1.4-px 45° diagonal produces **0 of 56** rendered pixels with default settings and with speckle 0.

**Cause.**
1. The diagonal's pixels touch only at corners (verified). The 4-connected ink model therefore splits it into 56 single pixels, and VTracer's fitters drop components of about one pixel.
2. **Experiment (reverted):** 8-connected ink with 4-connected background merges the diagonal into one component. Spline fitting still collapses the zero-width pixel chain: 0/56 rendered. Only pixel fit keeps it (56/56), at the cost of staircase output.

**Narrow correction?** No. Retaining 1-px lines as filled regions needs centerline tracing or thin-feature thickening, which is out of P0-R scope.

**Impact.** Black & White on line art and engravings with hairlines. Photographic B&W is largely unaffected.

**Disposition: DEFERRED to P1** (Line Art preset: centerline or thin-feature strategy). Workaround: `fit.mode = "pixel"`. Consequence of deferral: hairline art loses diagonal strokes in default B&W.

## 3. Partial source transparency binarised
**Reproduced.** Pixels with 0 < alpha < 255 are opaque or transparent at `alphaThreshold` (default 128), and the `alpha_binarized` warning is emitted (P0 tests).

**Cause.** Tracing produces flat-colour regions. The scene supports alpha colour, but there is no geometry that represents a gradual edge.

**Narrow correction?** No. Options would be feathered vector bands (new geometry) or per-region average alpha (wrong for edges).

**Impact.** Soft-edged logos and drop shadows lose their softness; hard-edged transparency is exact (leak ≤ 0.87 %, see 4). Halftone mode already folds alpha into coverage.

**Disposition: PROPOSED FOR ACCEPTANCE** (documented, warned behaviour). Revisit only if a preset requires soft edges.

## 4. Residual transparency leakage
**Reproduced.** Fraction of truly transparent pixels painted:

| Fixture | Stacked | Mosaic |
|---|---|---|
| transparent_ring | 0.62 % | 0.19 % |
| logo_transparent_hole | 0.08 % | 0.87 % |

**Cause.**
- Every leaked pixel lies within **0.81 px** of the true alpha edge (maximum 0.06–0.81 px across fixtures and modes).
- It is the same boundary approximation as item 1, not a region fill. The P0 fix for VTracer's sampled-row keying (leak 1.0 before) holds.

**Disposition: PROPOSED FOR ACCEPTANCE** as sub-pixel boundary approximation, with the leak metric reported together with the leak distance. It shares item 1's P1 corrective.

## 5. Browser-specific image decoding
**Reproduced in P0.** Decoded RGBA differs by engine:
- WebKit JPEG decoding differs from Chromium/Firefox in 17.9 % of bytes (max Δ 25).
- Semi-transparent PNG pixels lose RGB through canvas premultiplication (Firefox max Δ 8, WebKit max Δ 223 at near-zero alpha).

**New in P0-R.** The engine itself is host-independent: identical SVG/PDF/scene hashes for 65 cases from macOS- and Linux-built WASM.

**Narrow correction?** No. A WASM PNG/JPEG decoder is explicitly out of P0-R scope.

**Impact.** Results are reproducible per browser, not across browsers, for JPEG and for semi-transparent PNG edges. Opaque PNG inputs are identical everywhere.

**Disposition: DEFERRED to P1.** Evaluate in-WASM decoding (size and licences) for recipe reproducibility (VS-10, CL-02). Consequence of deferral: presets and variations shared between users on different browsers may differ slightly for JPEG sources.

## Summary
| Issue | Disposition | Maintainer decision needed |
|---|---|---|
| Star/ring IoU < 0.98 | PROPOSED FOR ACCEPTANCE (target still missed) + P1 sub-pixel contours | Accept for baseline? Adopt the deviation-based metric? |
| 1-px diagonals | DEFERRED (P1 Line Art) | Confirm deferral |
| Partial alpha binarised | PROPOSED FOR ACCEPTANCE | Accept |
| Residual leak ≤ 0.87 % within 0.81 px | PROPOSED FOR ACCEPTANCE | Accept |
| Browser decoding | DEFERRED (P1 WASM decode evaluation) | Confirm deferral |
