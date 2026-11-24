# P0-R-GEO Stage D: evaluation of corrective approaches

**Result:** a hybrid of sub-pixel contour extraction, G1 fitting with corner rebuild, and conservative circle/arc recognition (D2 + D4) is the only family that meets the brief's numerical targets on both owner-rejected cases. It also leaves every negative control un-idealised. VTracer parameter tuning (D1) cannot reach the targets.

## Method
`cargo run --release -p vector-engine --example geo_eval -- docs/research/p0-r-geo/artifacts/evaluation rejected,validation,negative all`

- 28 variants × 32 fixtures (2 rejected, 24 validation, 6 negative), scored against the pre-registered thresholds in GEOMETRIC-FIDELITY-METRICS.
- Native release build; times are the median of 3 runs; peak heap is measured with a counting allocator.
- Outputs:
  - per-fixture pass/fail lines: `artifacts/evaluation/run-validation.log`;
  - summary table: `artifacts/evaluation/summary-rejected+validation+negative.md`;
  - full JSON: regenerated into `tests/output/geo-eval/` (4 MB, not committed).
- The held-out set was run once, after the configuration was frozen (GEOMETRY-VALIDATION).

**How the variants were developed.** They were iterated on the validation set: diagnostic renders, then a fix, then a re-run. Every iteration used the same thresholds.
- **Thresholds and prototype.** The thresholds were committed (`0018ee4`) before this harness existed. However, a first prototype of the sub-pixel fitter had already been run on one disc fixture while the approach was being designed, and its starting defaults (0.2 px tolerance, 2 px corner scale) were chosen then. This document says so rather than claiming a fully blind protocol.
- **Rejected variant.** The guarded "reach" variant appears in the `f51e265` evaluation, which reproduces it, but its code was removed from the selected implementation.

## Candidates
| Family | What it changes | Code |
|---|---|---|
| **D1** VTracer fitting parameters | Corner, length and splice thresholds and the polygon fit mode, through the existing settings | none |
| **D1g** better fitting on lattice data | Vectra's G1 Schneider fitter on the binary-mask crack contour (no sub-pixel information) | `precision.rs`, `Subpixel::Off` |
| **D2** sub-pixel contours | Each mask crack becomes a point where the antialiased source crosses the boundary: linear interpolation, or the coverage (area) estimate. Then the G1 fit | `Subpixel::Linear` / `Area` |
| D2 refinements | Corner rebuild (trim the antialiasing-rounded zone, intersect the end tangents, refit to the corner); Taubin or binomial smoothing within sections; dropping saturated crossings in runs of at most 3 | `sharpen`, `smoothing` |
| **D3** primitive recognition on lattice data | Circle / circular-arc recognition (Kåsa fit plus Gauss–Newton; accept only if RMS ≤ 0.08 px, max ≤ 0.3 px, r ≥ 2.5 px, and an open arc's sagitta ≥ 1 px) | `arcs` on `Off` |
| **D4** hybrid | D2 (refined) plus D3 recognition; generic G1 fitting wherever recognition does not prove a circle | `Options::production` |

## Results (validation, negative and rejected sets)
| Variant | Passing all thresholds | Rejected cases | Negative controls | Mean contour RMS | Worst contour max | Unintended tangent breaks | Anchors |
|---|---|---|---|---|---|---|---|
| spline (baseline) | 0/32 | 0/2 | 0/6 | 0.420 | 2.318 | 277 | 868 |
| D1 best (length 8) | 1/32 | 0/2 | 1/6 | 0.361 | 2.486 | 323 | 717 |
| D1 other 8 settings | 0/32 | 0/2 | 0/6 | 0.33–0.58 | 1.24–4.00 | 148–1003 | 545–1548 |
| D1g lattice + G1 | 4/32 | 0/2 | 4/6 | 0.243 | 0.814 | 4277 | 8659 |
| D3 lattice + recognition | 4/32 (no circle ever accepted on lattice data) | 0/2 | 4/6 | 0.243 | 0.814 | 4277 | 8659 |
| D2 linear | 13/32 | 1/2 | 6/6 | 0.075 | 0.569 | 79 | 1342 |
| D2 area | 18/32 | 1/2 | 6/6 | 0.066 | 0.569 | 107 | 929 |
| D2 area + "reach" (rejected) | 18/32 | 1/2 | 6/6 | 0.066 | 0.569 | 201 | 1056 |
| D2 area + corner rebuild | 22/32 | 1/2 | 6/6 | 0.064 | 0.569 | 109 | 798 |
| D2 area + Taubin(2) + corner rebuild | 22/32 | 1/2 | 6/6 | 0.066 | 0.489 | 13 | 720 |
| **D4 = selected** (`Options::production(60)`) | **24/32** | **1/2*** | **6/6** | **0.046** | **0.489** | **13** | **611** |
| Sensitivity: tolerance 0.1 / 0.3 | 17 / 18 | 1/2 | 6/6 | 0.048 / 0.095 | 0.569 | 183 / 84 | 1458 / 741 |
| Sensitivity: corner scale 1.5 / 3 px | 18 / 18 | 1/2 | 6/6 | 0.069 / 0.066 | 0.569 | 93 / 101 | 945 / 941 |

\* `04-color-discs` meets every target the brief states (centre, radius, RMS, max, tangent continuity, topology). It misses only the curvature-uniformity target this study added. See "Curvature near junctions" below.

**P0 IoU metric** (target ≥ 0.98):
- spline: star 0.977, rings 0.975;
- D2 area: star 0.994, rings 0.990;
- selected: star 0.996, rings 0.996, circle 0.999.

### Comparison against the brief's criteria
| Criterion | D1 | D1g / D3 | D2 | **D4 (selected)** |
|---|---|---|---|---|
| Fixes 05 (hole) | no | no | yes | **yes** |
| Fixes 04 (discs) | no | no | brief targets met; curvature target missed | **brief targets met; curvature target missed near junctions** |
| Geometric accuracy | ≥ 0.33 px RMS | 0.24 px RMS; 0.8 px max | 0.066 px RMS | **0.046 px RMS, 0.49 px max** |
| False-positive recognition | n/a | 0 (never fires) | n/a | **0 substitutions on all 7 negative controls** (`artifacts/selection/recognition-substitutions.md`) |
| Photographic impact | changes the approved output | n/a | none: opt-in mode | **none: opt-in; defaults byte-identical** (PHOTOGRAPHIC-REGRESSION) |
| Topology | as spline (specks of a lower layer's colour at junctions on 3 fixtures) | breaks on staircases | preserved except 1–2 specks | **preserved except specks on `discs-x2` and `discs-two-deep`** |
| Performance (corpus) | equal | +12 % | +3 % | **+4 % (125 vs 120 ms for 32 fixtures)** |
| Peak heap (corpus) | equal | equal | equal | **equal (max 4.7 MiB, median 1.1 MiB)** |
| Dependencies | none | none | none | **none added** |
| Architectural complexity | none | one module | one module | **one Vectra module (`precision.rs`) behind the existing trace adapter; VTracer keeps segmentation** |
| Scene / exporter compatibility | yes | yes | yes | **yes: absolute M/L/C/Z only; no new primitives** |

### Why each rejected candidate fails
- **D1:**
  - The 10 px slice tolerance, the outward outset and the missing tangent continuity are inside visioncortex, not parameters.
  - Shorter slices add kinks: splice 20° gives 553 breaks.
  - Longer slices flatten arcs: splice 90° gives a 4 px max error.
- **D1g / D3:**
  - Without the antialiasing information the binary staircase has ±0.35–0.7 px of noise.
  - A tight G1 fit follows that noise, giving thousands of tangent breaks.
  - The recognition thresholds correctly never accept such data.
  - This confirms the root cause: the information lost at thresholding must be recovered from the source.
- **Area "reach"** (crossings allowed past pixel centres): it improves the contour max to 0.24 px, but points from perpendicular cracks of the same pixel can swap order. That produces kinks up to 147° and cusps, so it was rejected.
- **4-pixel coverage window:** evaluated during development; worse on curves (rounded-rectangle radius off by 0.53 px). Reverted.
- **Lower-layer retreat plus a three-region crossing test:** one bounded attempt, made after classifying the curvature flags. It made curvature worse: the hierarchical stack contains nested same-colour layers, which trip the three-region test everywhere. Reverted.

## Curvature near junctions (open item)
Curvature-uniformity flags are classified by `geo_inspect curvature` under the frozen configuration (`artifacts/selection/curvature-classification.txt`, renders `*-curvature-*.png`):

| Fixture | Flagged samples | Lower-layer duplicate under a higher outline | Top path, saturated run > 3 | Top path, unsaturated |
|---|---|---|---|---|
| 04-color-discs | 554 | 396 | 28 | 130 |
| discs-two-deep | 258 | 105 | 0 | 153 |
| discs-x2 | 453 | 309 | 29 | 115 |
| concentric | 0 | 0 | 0 | 0 |

- **Lower-layer duplicates.** A stacked lower layer redraws, within 0.5 px, an edge that a higher path owns.
  - It is covered except for slivers below 1 source px², except for the specks on `discs-x2` and `discs-two-deep`.
  - The visible edge is the higher path's, and it meets the targets.
- **Top-path flags.** These are 2–6 px from three-colour junctions, where blend pixels mix three colours.
  - The worst renders show deviations of about 0.1–0.3 px, invisible at normal size and visible as a small notch at 24×.
- **Further remedies.** Three fitter-level remedies did not move these flags. A clean fix needs a shared junction graph (mosaic-style shared boundaries) or label-level correction of blend pixels. Both are architectural, deferred to P1 and not attempted here.
