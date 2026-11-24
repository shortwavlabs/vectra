# P0-R-GEO: root cause analysis

**Result: root cause established.** The distortion comes from VTracer's spline stage, which fits curves through the lattice corners of a binary mask. DEF-GEO-002 adds a smaller colour-segmentation component. The two defects share the fitting cause but are not identical.

Evidence: `artifacts/reproduction/reproduction.json` (per-stage statistics, Stage A tool `geo_reproduce`), the overlays, and the VTracer 1.0.0-alpha.4 / visioncortex 0.9.3 sources:
- `fitter.rs` (`trace_region`);
- `clusters.rs` (`image_to_splines`, `OUTSET_RATIO = 8`);
- `spline.rs` (`from_path_f64`, `fit_points_with_beziers(…, 10.0)`);
- `smooth.rs` (`find_splice_points`, `subdivide_keep_corners`).

The replay of these stages equals the engine's output exactly (max coordinate difference 0.0000), so each stage's numbers below describe the real pipeline.

## Stage-by-stage error (visible boundary, source px)
| Stage | 05 hole: RMS / max / bias | 04 discs: RMS / max / bias |
|---|---|---|
| 1. Pixel lattice (binary mask crack walk) | 0.288 / 0.616 / −0.06 | 0.303 / **0.828** / +0.05 |
| 2. Polygon (staircase removed, lattice vertices kept) | 0.313 / 0.616 / −0.25 | 0.416 / **1.000** / +0.11 |
| 3. Smoothed (4-point subdivision, outset ratio 8) | 0.412 / 0.637 / **−0.38** | 0.506 / **1.096** / **+0.31** |
| 4. Fitted cubics (splice ≤ 45°, tolerance 10 px) | 0.318 / 0.637 / −0.28 | 0.415 / 1.047 / +0.18 |
| Serialization (0.01 px quantisation, SVG, PDF) | ≤ 0.005 | ≤ 0.005 |

The sign is relative to the true region: negative means the blue field shrank, i.e. the hole grew.

## Classification against the candidate causes
| Candidate cause | Finding | 05 | 04 |
|---|---|---|---|
| **Pixel-grid quantisation** | **Contributes; the starting error.** Thresholding at alpha 128, or into colour clusters, discards the antialiasing. A binary crack contour of a circle deviates up to √2/2 ≈ 0.71 px, at 0.29–0.30 px RMS. Every later stage starts from it, and nothing downstream reads the antialiased values again. | yes | yes |
| **Segmentation boundary error** | **Contributes to 04 only.** 62 of 1,062 antialiased pixels (5.8 %) are clustered with a layer whose colour belongs to the other side of the true edge. The lattice error exceeds the pure-quantisation bound (0.83 > 0.71 px), and the blue/yellow centres shift by about 0.6 px. 05 has one layer and no misassigned pixels. | no | yes |
| **Outward contour bias** | **Contributes.** Smoothing (`OUTSET_RATIO = 8`) pushes the subdivided polygon outward from the traced cluster. Measured bias: −0.38 px on the hole (the hole is traced as its own cluster and grows) and +0.31 px on the discs. The final shapes are +0.27 px (hole) and +0.44 px (red disc) too large. | yes | yes |
| **Inadequate corner classification** | **Minor, 04 only.** No spurious corners on the hole. On the discs, 6 polygon vertices are classified as corners against 4 true junctions. All 4 true junctions do get an anchor within 0.24 px. | no | minor |
| **Inappropriate control-point placement** | **Contributes.** Anchors are pinned to the smoothed polygon. 3 of 7 hole anchors and 22 of 63 disc anchors are exactly on integer lattice coordinates, i.e. on staircase corners rather than the curve. Handles are fitted per slice with no knowledge of the neighbours. | yes | yes |
| **Excessive or uneven spline fitting** | **Contributes; the main visible symptom.** Slices end wherever the accumulated turn reaches 45° *or* the polygon direction changes sign (an "inflection"). On a staircase polygon, the sign flips come from pixel noise. Slice lengths are 16–21 px on the hole and **1.9–61 px** on the discs. Each slice is fitted with an error tolerance of **10 px**, so one cubic is accepted even where it flattens the arc. Local curvature departs from the circle's by up to 67 % on the hole (|κ|·r − 1 max 0.67) and reaches 7.8× on the discs (max 6.8). | yes | yes |
| **Discontinuities between Bézier segments** | **Contributes; the "irregularity between curve segments".** Slices are fitted independently, with end tangents estimated separately on each side, so no join is G1. On the hole **all 7 joins** break, by 4–12.7°. On the discs, 28 of 63 do (max 10.9°). | yes | yes |
| **Occlusion and colour-layer reconstruction** | **Present, not itself a distortion.** Stacked layers come from colour clusters, not from the source paint order. Red, painted first in the source, is the *top* output layer, and its outline follows the blue circle where they meet. Visible boundaries are right in topology, and the four junctions are found. The shape error near overlaps comes from the misassigned blend pixels and the uneven slices above. | n/a | yes |
| **Serialization or coordinate quantisation** | **Ruled out.** At most 0.005 px. SVG and PDF operands equal the scene. | no | no |

## Root cause
1. **Primary (both defects): VTracer's spline construction for stacked regions.**
   - The curve is built from the outer corners of a binary pixel mask, smoothed outward.
   - It is cut into turn-bounded slices that also cut at noise "inflections".
   - Each slice gets one independently fitted cubic at a 10 px tolerance, with no tangent continuity.

   The result is outward-biased arcs, alternately flattened and tightened, with a visible kink at every join. That is what the owner saw.
2. **Secondary (DEF-GEO-002 only): colour segmentation of antialiased blend pixels.** About 6 % of edge pixels are clustered on the wrong side. That adds up to about 0.3 px of extra boundary error and the 0.6 px centre shifts near the overlaps.
3. **Not causes:** PDF or SVG serialization, the 0.01 px quantisation, and the browser decode model (it changes 05's bytes, not its geometry).

## Implications for the correction
- Re-tuning the existing parameters cannot remove a 10 px fit tolerance, the outward outset or the missing tangent continuity. Those are inside visioncortex, not parameters. ALGORITHM-EVALUATION tests this (candidate D1).
- The binary mask has already lost the sub-pixel position of the edge. The antialiased source still has it (cause 1, cause 2).
- A correction that reads the edge position from the source near the mask boundary, without changing the segmentation's topology, addresses both causes at their origin.
- Fitting with shared tangents addresses the joins.
- Photographic tracing, which the owner approved, uses the same VTracer spline path. Any correction must therefore be **opt-in or proven byte-neutral** for it.
