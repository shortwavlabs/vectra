# P0-R-GEO: geometry validation (selected configuration)

**Configuration.** `fit.mode = "precision"`, `PRECISION_FIT_VERSION` 1, `Options::production(60)`, frozen at commit `a4cf172`.

**Command.**
- Validation sets: `cargo run --release -p vector-engine --example geo_eval -- <dir> rejected,validation,negative spline,selected`.
- Held-out set: `… heldout spline,selected`, run **once**, after the freeze.
- Per-fixture pass/fail lines: `artifacts/evaluation/run-validation.txt` and `artifacts/validation/run-heldout.txt`. Full JSON is regenerated into `tests/output/geo-eval/`.
- **Held-out history.**
  - The held-out log was produced at the frozen configuration before two code-only changes: removal of the rejected `AreaReach` variant, and lint refactors.
  - Re-run at the final head as a reproduction check: identical per-fixture results.
  - Recognition-substitution *counts* for the held-out fixtures (not their metrics) were printed once before recognition was switched on in the frozen configuration. They showed no substitution on the held-out negative control and did not influence any parameter.

Thresholds are those pre-registered in GEOMETRIC-FIDELITY-METRICS. A "fail" names every threshold missed. Nothing was re-tiered or relaxed.

## Summary
| Set | Spline (P0) passes | Selected passes | Selected: mean contour RMS / worst max (px) | Unintended tangent breaks, spline → selected | Anchors, spline → selected |
|---|---|---|---|---|---|
| Rejected (2) | 0 | 1 (05); 04 meets the brief's targets, misses the added curvature target | 0.036 / 0.258 | 26 → 0 | 86 → 56 |
| Validation (24) | 0 | 17 | 0.046 / 0.489 | 175 → 13 | 650 → 446 |
| Negative controls (6) | 0 | **6**; 0 recognised substitutions | organic 0.064 / 0.207 | 76 → 0 | 132 → 109 |
| Held-out (12) | 0 | **10** | 0.033 / 0.194 | 101 → 0 | 292 → 158 |

**P0 IoU target (≥ 0.98):**
- spline: circle 0.994, star **0.977**, rings **0.975**;
- selected: circle 0.999, star 0.996, rings 0.996.

The star/ring IoU deviation from P0-R is **closed** for the precision mode. The spline mode is unchanged, by design.

## Per-fixture results
"Worst circle" is the worst value over every visible circle or circular arc of the fixture. Curvature is \|κ\|·r − 1.

#### rejected

| Fixture | Tier | Spline | Selected | Contour RMS / max (spline → selected) | Worst circle: centre / radius / RMS / max | Curvature RMS / max | Breaks | Anchors | Selected misses |
|---|---|---|---|---|---|---|---|---|---|
| 05-color-transparent-hole | A | fail | **PASS** | 0.315/0.640 → 0.022/0.051 | 0.014 / -0.009 / 0.016 / 0.045 | 0.007 / 0.02 | 7 → 0 | 13 → 10 | — |
| 04-color-discs | A | fail | fail | 0.502/1.048 → 0.051/0.258 | 0.050 / +0.063 / 0.057 / 0.257 | 1.096 / 16.12 | 19 → 0 | 73 → 46 | circle r=60 curvature RMS 1.096; circle r=60 curvature max 16.116; circle r=60 curvature RMS 0.686; circle r=60 curvature max 14.541 |

#### validation

| Fixture | Tier | Spline | Selected | Contour RMS / max (spline → selected) | Worst circle: centre / radius / RMS / max | Curvature RMS / max | Breaks | Anchors | Selected misses |
|---|---|---|---|---|---|---|---|---|---|
| circle-r40-frac | A | fail | **PASS** | 0.325/0.573 → 0.016/0.028 | 0.003 / +0.004 / 0.006 / 0.013 | 0.007 / 0.02 | 6 → 0 | 8 → 5 | — |
| circle-r100 | A | fail | **PASS** | 0.330/0.788 → 0.026/0.046 | 0.004 / +0.019 / 0.021 / 0.039 | 0.007 / 0.02 | 4 → 0 | 8 → 5 | — |
| circle-r8 | A | fail | **PASS** | 0.300/0.633 → 0.017/0.028 | 0.006 / -0.008 / 0.009 / 0.015 | 0.007 / 0.02 | 6 → 0 | 7 → 5 | — |
| circle-r3 | B | fail | **PASS** | 0.414/0.803 → 0.079/0.180 | 0.064 / -0.057 / 0.078 / 0.179 | 0.048 / 0.11 | 5 → 0 | 6 → 5 | — |
| circle-hard-r40 | C | fail | fail | 0.343/0.666 → 0.219/0.489 | 0.011 / +0.067 / 0.219 / 0.488 | 127.152 / 5771.85 | 7 → 10 | 8 → 81 | 10 tangent breaks (max 54.7°); anchors 81 > 16 |
| hole-alpha-r30 | A | fail | **PASS** | 0.352/0.710 → 0.019/0.041 | 0.013 / -0.004 / 0.012 / 0.032 | 0.007 / 0.02 | 9 → 0 | 15 → 10 | — |
| hole-x0.5 | A | fail | **PASS** | 0.361/0.659 → 0.017/0.028 | 0.002 / -0.008 / 0.008 / 0.012 | 0.007 / 0.02 | 6 → 0 | 12 → 10 | — |
| hole-x2 | A | fail | **PASS** | 0.285/0.498 → 0.017/0.033 | 0.008 / -0.002 / 0.009 / 0.023 | 0.007 / 0.02 | 7 → 0 | 13 → 10 | — |
| ring-bw | A | fail | **PASS** | 0.365/0.766 → 0.019/0.033 | 0.004 / +0.014 / 0.015 / 0.023 | 0.007 / 0.02 | 15 → 0 | 21 → 10 | — |
| ring-alpha | A | fail | **PASS** | 0.388/0.756 → 0.021/0.046 | 0.009 / +0.016 / 0.019 / 0.039 | 0.007 / 0.02 | 12 → 0 | 20 → 10 | — |
| concentric | A | fail | **PASS** | 0.407/0.815 → 0.025/0.064 | 0.012 / +0.025 / 0.029 / 0.059 | 0.007 / 0.02 | 29 → 0 | 70 → 35 | — |
| discs-two-wide | A | fail | **PASS** | 0.353/1.148 → 0.025/0.057 | 0.020 / +0.026 / 0.023 / 0.052 | 0.006 / 0.02 | 15 → 0 | 33 → 18 | — |
| discs-two-deep | A | fail | fail | 0.490/1.256 → 0.072/0.399 | 0.066 / +0.024 / 0.077 / 0.399 | 2.626 / 29.64 | 12 → 1 | 28 → 33 | topology; 1 tangent breaks (max 16.5°); circle r=50 curvature RMS 2.626; circle r=50 curvature max 29.638; circle r=50 curvature RMS 0.333; circle r=50 curvatur |
| discs-x2 | A | fail | fail | 0.572/1.251 → 0.040/0.277 | 0.032 / +0.022 / 0.049 / 0.276 | 1.126 / 30.56 | 4 → 0 | 67 → 47 | topology; circle r=120 curvature RMS 1.010; circle r=120 curvature max 30.559; circle r=120 curvature RMS 1.126; circle r=120 curvature max 30.559 |
| ellipse-2to1 | A | fail | **PASS** | 0.833/1.684 → 0.078/0.175 | — | — | 6 → 0 | 8 → 13 | — |
| ellipse-4to1-rot30 | A | fail | **PASS** | 1.094/2.318 → 0.094/0.189 | — | — | 5 → 0 | 10 → 9 | — |
| square | A | fail | **PASS** | 0.300/0.300 → 0.054/0.073 | — | — | 0 → 0 | 5 → 5 | — |
| rect-rot20 | A | fail | **PASS** | 0.473/0.625 → 0.018/0.027 | — | — | 0 → 0 | 13 → 5 | — |
| roundrect | A | fail | fail | 0.276/0.616 → 0.049/0.193 | 0.048 / -0.061 / 0.033 / 0.070 | 0.122 / 0.54 | 6 → 0 | 49 → 21 | circle r=20 curvature max 0.542; circle r=20 curvature max 0.542; line curvature 0.0180 |
| triangle | A | fail | **PASS** | 0.397/0.644 → 0.044/0.097 | — | — | 0 → 0 | 36 → 4 | — |
| star | A | fail | fail | 0.474/0.742 → 0.065/0.165 | — | — | 5 → 0 | 73 → 31 | line curvature 0.2192 |
| strokes | A | fail | fail | 0.341/0.712 → 0.057/0.200 | — | — | 2 → 2 | 64 → 30 | 2 tangent breaks (max 3.2°); line curvature 0.0867; corner 2.32 px |
| compound-holes | A | fail | **PASS** | 0.211/0.611 → 0.024/0.094 | 0.007 / -0.005 / 0.009 / 0.026 | 0.007 / 0.02 | 7 → 0 | 28 → 14 | — |
| adjacent-overlap | A | fail | fail | 0.411/1.081 → 0.022/0.076 | 0.013 / +0.005 / 0.019 / 0.073 | 0.137 / 1.00 | 7 → 0 | 48 → 30 | circle r=55 curvature max 1.000 |

#### negative

| Fixture | Tier | Spline | Selected | Contour RMS / max (spline → selected) | Worst circle: centre / radius / RMS / max | Curvature RMS / max | Breaks | Anchors | Selected misses |
|---|---|---|---|---|---|---|---|---|---|
| hand-drawn-circle | A | fail | **PASS** | organic 0.310/0.636 → 0.064/0.167 | — | — | 4 → 0 | 10 → 9 | — |
| irregular-ellipse | A | fail | **PASS** | organic 0.430/1.158 → 0.063/0.187 | — | — | 10 → 0 | 19 → 13 | — |
| organic-blob | A | fail | **PASS** | organic 0.440/1.207 → 0.076/0.190 | — | — | 7 → 0 | 18 → 16 | — |
| rough-ink | A | fail | **PASS** | organic 0.543/1.242 → 0.064/0.207 | — | — | 44 → 0 | 59 → 56 | — |
| asymmetric-egg | A | fail | **PASS** | organic 0.379/0.595 → 0.050/0.119 | — | — | 3 → 0 | 11 → 5 | — |
| hand-drawn-hole | A | fail | **PASS** | organic 0.382/0.767 → 0.068/0.156 | — | — | 8 → 0 | 15 → 10 | — |

#### heldout

| Fixture | Tier | Spline | Selected | Contour RMS / max (spline → selected) | Worst circle: centre / radius / RMS / max | Curvature RMS / max | Breaks | Anchors | Selected misses |
|---|---|---|---|---|---|---|---|---|---|
| h-circle-r15.7 | A | fail | **PASS** | 0.331/0.647 → 0.015/0.026 | 0.006 / -0.002 / 0.005 / 0.009 | 0.007 / 0.02 | 7 → 0 | 8 → 5 | — |
| h-circle-r55-coarse | A | fail | **PASS** | 0.305/0.729 → 0.037/0.056 | 0.010 / -0.033 / 0.034 / 0.051 | 0.007 / 0.02 | 6 → 0 | 9 → 5 | — |
| h-circle-r5 | B | fail | **PASS** | 0.222/0.661 → 0.019/0.031 | 0.013 / -0.005 / 0.012 / 0.019 | 0.008 / 0.02 | 6 → 0 | 7 → 5 | — |
| h-hole-r33 | A | fail | **PASS** | 0.328/0.688 → 0.015/0.027 | 0.003 / +0.002 / 0.005 / 0.012 | 0.007 / 0.02 | 7 → 0 | 15 → 10 | — |
| h-ellipse-3to1-rot63 | A | fail | **PASS** | 0.692/1.509 → 0.092/0.176 | — | — | 5 → 0 | 12 → 9 | — |
| h-roundrect-rot12 | A | fail | fail | 0.632/1.053 → 0.058/0.194 | 0.252 / +0.220 / 0.038 / 0.062 | 0.090 / 0.45 | 4 → 0 | 25 → 21 | line curvature 0.0145 |
| h-star-rot17 | A | fail | fail | 0.498/0.875 → 0.033/0.185 | — | — | 4 → 0 | 66 → 31 | line curvature 0.3168 |
| h-discs-three | A | fail | **PASS** | 0.481/0.809 → 0.033/0.103 | 0.035 / +0.035 / 0.036 / 0.100 | 0.005 / 0.01 | 18 → 0 | 54 → 28 | — |
| h-ring-thin-alpha | A | fail | **PASS** | 0.336/0.749 → 0.016/0.028 | 0.002 / +0.006 / 0.007 / 0.014 | 0.007 / 0.02 | 13 → 0 | 17 → 10 | — |
| h-compound-two-holes | A | fail | **PASS** | 0.431/0.812 → 0.021/0.045 | 0.007 / +0.016 / 0.018 / 0.038 | 0.007 / 0.02 | 21 → 0 | 35 → 20 | — |
| h-rect-rot37 | A | fail | **PASS** | 0.348/0.758 → 0.025/0.043 | — | — | 2 → 0 | 33 → 5 | — |
| h-hand-drawn | A | fail | **PASS** | organic 0.388/0.704 → 0.070/0.137 | — | — | 8 → 0 | 11 → 9 | — |

## The brief's targets on the two owner-rejected cases
| | 05 hole: P0 → corrected | 04 discs, worst of 3: P0 → corrected | Target |
|---|---|---|---|
| Centre error | 0.034 → **0.014** | 0.598 → **0.050** | ≤ 0.5 |
| Radius error | +0.273 → **−0.009** | +0.453 → **+0.063** | ≤ 0.5 |
| RMS radial deviation | 0.315 → **0.016** | 0.530 → **0.057** | ≤ 0.25 |
| Max radial deviation | 0.640 → **0.045** | 1.048 → **0.257** | ≤ 0.75 |
| Unintended tangent breaks | 7 → **0** | 19 → **0** | 0 |
| Holes and components | kept → **kept** | kept → **kept** | preserved |
| Hole shape (moments) | axes +0.31/+0.25, area +2.8 % → axes +0.001/−0.019, area −0.09 % | n/a | |
| Path | 11 cubics on integer-lattice anchors → **4 cubics** (a circle), plus the 4 frame lines | 69 cubics → 38 cubics + 4 lines | |
| Added target: curvature uniformity | 0.27 / 0.67 → **0.007 / 0.025** | 0.49 / 6.8 → **1.10 / 16.1** near junctions (blue arc 0.005 / 0.015) | RMS ≤ 0.15, max ≤ 0.5 |

## What is still missed, and why
| Fixture(s) | Missed threshold | Cause | Disposition |
|---|---|---|---|
| 04, `discs-two-deep`, `discs-x2` | Curvature uniformity near three-colour junctions; `discs-two-deep` also has 1 break of 16.5° and 33 vs 28 anchors | Classified in ALGORITHM-EVALUATION: mostly lower stacked layers redrawing an edge a higher path owns, plus blend pixels mixing three colours within 2–6 px of a junction. Position targets are met | Proposed for acceptance for P0. The fix (shared junction graph or label-level blend correction) is architectural, for P1 |
| `discs-two-deep`, `discs-x2`, and 04 at 2× sampling | Topology: slivers of a lower layer's colour (`artifacts/selection/specks.txt`).<br>– `discs-two-deep`: blue, 2.2 and 1.1 px² at (63, 124–132) and (113–117, 78).<br>– `discs-x2`: yellow, 1.2 px² at (72, 206–210).<br>– **04**: yellow hairlines of 1.5 and 1.25 px² at the red disc's left (x ≈ 36, y 102.5–105.5) and top (x 88.5–91, y ≈ 50). These fall below the 1 px² floor at the pre-registered 4× sampling, so 04's topology check passes, but they exist. Confirmed with poppler on the committed PDF: `artifacts/selection/poppler-04-corrected-sliver-{left,top}.png`. 05: none (`poppler-05-corrected-hole.png`) | Same stacked-layer cause: the yellow union layer's outline coincides with the red top layer's where the disc is axis-tangent, and the two are fitted independently. Spline has such specks on 3 fixtures | Same |
| `circle-hard-r40` (tier C) | 10 tangent breaks, 81 anchors | No antialiasing, so no sub-pixel information. The fitter follows the staircase midpoints. Position is within tier C (RMS 0.22, max 0.49) | Use spline or pixel fit for binary art. Request approval of tier C as "position only" |
| `star`, `h-star-rot17`, `roundrect`, `h-roundrect-rot12` | Max curvature on straight edges (0.014–0.32 /px, target ≤ 0.005) | Short curved transitions next to rebuilt corners, within 2–4 px of a corner. Positions, corners and IoU pass | Missed by margin; visible only at ≥ 16× |
| `strokes` | Corner within 1 px (2.32 px); two 3.2° breaks; straight-edge curvature | 2–3 px bars: the corner-rounding trim spans most of the bar end | Missed; spline is worse here (corners 2.5 px, 2 breaks, 64 vs 30 anchors) |
| `adjacent-overlap` | Curvature max 1.0 on the r = 55 arc (one short straight piece at a junction) | Corner rebuild at the disc/rectangle junction | Missed by margin |
| `ellipse-2to1` | none, but 13 anchors vs spline's 8 | 4-arc start plus splits on a 2:1 ellipse | Within the complexity cap |

## Resolution-aware notes
- **Tier B.** `circle-r3` and `h-circle-r5` pass the tier B targets, at RMS 0.078 and 0.012 px.
- **Coarse antialiasing.** `h-circle-r55-coarse`, with 2×2 antialiasing, i.e. 5 levels, passes tier A at RMS 0.034 px.
- **Tier C.** The hard-thresholded circle reaches the position limits derived in GEOMETRIC-FIDELITY-METRICS (RMS 0.22 px, max 0.49 px), not better. This is the mathematical limit of binary edges.

## Topology, holes and small components
- **Corpus holes and components.** Kept on every fixture except the two specks above:
  - rings, compound shapes with circular and triangular holes;
  - transparent holes at r = 10–40;
  - the held-out two-hole disc and thin 4 px alpha ring.
- **Small components** (`artifacts/selection/small-components.txt`, test `holes_rings_and_small_components_survive`). A 1 px hole in an 8×8 square and a 1 px blob with speckle 0 are all kept. Spline drops both the 1 px hole and the B&W blob.

## One-pixel diagonal strokes (P0-R item, measured with `geo_inspect diagonals`)
`thin_strokes`: diagonal pixels (x, x + 10), x in 180–235, rendered as ink at 1×; 56 true. Output: `artifacts/selection/diagonals.txt`.

| Settings | Paths | Diagonal pixels rendered |
|---|---|---|
| B&W spline (default speckle 16) | 8 | 0 / 56 |
| B&W spline, speckle 0 | 8 | 0 / 56 |
| B&W pixel fit, speckle 0 (P0-R workaround) | 64 | 56 / 56 |
| B&W precision (default speckle 16) | 8 | 0 / 56 |
| B&W precision, speckle 0 | 64 | **56 / 56** |

- **What improved.** With speckle 0, precision keeps the diagonal, like the pixel workaround, as 56 separate tiny shapes. These are 8-connected pixels in a 4-connected segmentation, not a connected stroke.
- **Disposition.** A connected stroke needs a thin-feature or centreline strategy: deferral to P1 Line Art is proposed.

## Residual transparency leak (P0-R item)
`geo_inspect leak` uses the P0-R definition: transparent truth pixels (coverage < 0.5) rendered with alpha ≥ 128 at 1×, and their distance from the true alpha edge. Raw fixture RGBA. Output: `artifacts/selection/transparency-leak.txt`.

| Fixture | Spline (P0-R) | Precision |
|---|---|---|
| `transparent_ring` | 0.62 % (281 px), up to 0.81 px from the edge | **0 px** |
| `logo_transparent_hole` | 0.08 % (1 px), 0.06 px | 0.87 % (11 px), up to **0.12 px** from the edge |

- **Ring.** The P0-R leak, which came from the outward bias, is gone.
- **Hole.** The precision boundary sits on the true circle (max deviation 0.05 px). Pixels whose centres lie within about 0.1 px of it then fall on either side, so a few more boundary pixels flip, all within 0.12 px.
- **Disposition.** This is the pixel-rounding floor of an exact boundary, not a leak. It is proposed for acceptance, reported with both area and distance as requested.
