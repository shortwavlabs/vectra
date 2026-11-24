# P0-R-GEO Stages B and C: geometry corpus, metrics and acceptance thresholds

**This document was committed before any corrective candidate was evaluated.** The thresholds below are pre-registered engineering targets for maintainer review, not established P0 capabilities. The existing IoU ≥ 0.98 target is retained and not lowered.

## Corpus (Stage B)
Code: `crates/vector-engine/tests/common/corpus.rs` (analytic definitions) and `geometry.rs` (rasteriser, ground truth, metrics).
- `cargo run --release -p vector-engine --example geo_corpus` writes the PNGs to `tests/output/geo-corpus/`; they are not committed.
- It also writes every fixture's analytic parameters, set and settings to `artifacts/corpus/corpus.json`.

**Rasterisation.** Exact box filtering. Every sub-sample (8×8 per pixel by default; 1×1, 2×2 and 16×16 for the antialiasing variants) composites the analytic shapes in paint order.

**Ground truth: the visible boundary only.**
- A shape's edge counts only where no later shape covers it and the colours on its two sides differ.
- Occluded arcs are never scored.
- Junctions, where visibility switches, and visible polygon vertices are the true corners.
- Polygon vertices carry their true turning angle.

| Set | Fixtures | Purpose |
|---|---|---|
| `rejected` | `05-color-transparent-hole`, `04-color-discs` (P0 fixture pixels, analytic truth) | The owner-rejected cases |
| `validation` (24) | Circles r = 3, 8, 40 (fractional centre), 100; hard-thresholded r = 40; transparent holes r = 10/20 scale ×0.5, r = 30, r = 40 scale ×2; B&W and alpha rings; concentric discs; two-disc overlaps (wide, deep); the 04 discs at ×2; ellipses 2:1 and 4:1 rotated 30°; square; rectangle rotated 20°; rounded rectangle; triangle; five-point star; 2/3/5 px bars at 0/30/45/60°; compound shape with circular and triangular holes; adjacent and overlapping colour regions | Development |
| `negative` (6) | Hand-drawn circle; irregular ellipse; organic blob; rough ink edge (≈1 px bumps); asymmetric egg; hand-drawn transparent hole | Must **not** be idealised |
| `heldout` (12) | r = 15.7 (16×16 AA), r = 55 with coarse 2×2 AA, r = 5; hole r = 33 at (90.3,70.9); ellipse 3:1 rotated 63°; rounded rectangle rotated 12°; star rotated 17°; three discs with other radii and angles; thin alpha ring (4 px); disc with two holes; rectangle rotated 37°; a held-out hand-drawn negative control | Final verdict only; never used for tuning |

Photographic contours are covered by the photographic regression corpus (PHOTOGRAPHIC-REGRESSION), not by synthetic fixtures.

## Metrics (Stage C)
All distances are in source pixels.
- The output scene is sampled every 0.1 px along its cubics and lines.
- An output sample is **visible** if no later path covers it (fill rule respected) and it is more than 0.5 px from the image frame.
- Truth is sampled every 0.05 px.

| Group | Metric | Definition |
|---|---|---|
| **Circle / ellipse** | Centre, radius error | Least-squares circle (Kåsa, then Gauss–Newton) fitted to the visible output samples attributed to that circle; partially occluded circles use only their visible arcs |
| | Mean / RMS / max radial deviation, bias | `|p − c_true| − r_true` over those samples, excluding 2 px around true corners |
| | Angular distribution | Max \|radial deviation\| per 10° sector (`radial_by_angle`) |
| | Curvature uniformity | `|κ|·r − 1` from the cubic derivatives: RMS and max |
| | Axis errors, eccentricity, orientation, area, bounding box | Area moments of the output loop matched to a fully visible circle or ellipse; exact for ellipses |
| **General contour** | Contour deviation | Output → nearest truth, signed by the truth's outward normal: mean, RMS, max, bias. `contour_smooth` excludes 2 px around corners |
| | Missing boundary | Truth → nearest visible output. The symmetric (Hausdorff) distance is the larger of the two |
| | Straight segments | Deviation on line primitives, and the max \|κ\| of output on them |
| | Corners | Anchor within 1 px of each true corner; position error; turning-angle error at polygon vertices; acute corners (interior < 60°) reported separately |
| | Tangent continuity | Joins between output segments on visible smooth truth (≥ 2 px from any true corner) whose tangents differ by more than 2° |
| | Topology | Components and enclosed holes per colour label at 4× sampling (output rendered by resvg over the source background), plus label IoU |
| **Complexity** | Paths, anchors, cubics, lines, SVG and PDF bytes, time | From the engine's scene statistics and native timings |

### The metrics are validated (`crates/vector-engine/tests/geometry_metrics.rs`, 3 tests pass)
- **An ideal 8-arc circle scores near zero:**
  - radial max < 0.002 px;
  - centre and radius error < 0.001 px;
  - \|κ·r − 1\| < 0.01;
  - 0 tangent breaks;
  - area error < 0.1 %.
- **A 10° handle rotation is detected** as a tangent break (> 9°).
- **A flattened arc** (handles at 60 %) is detected by curvature (max > 0.3) and radial deviation (> 0.3 px) while its **label IoU stays above 0.99**. This is why IoU alone is insufficient.
- **More nodes are not rewarded.** Pixel fitting has more than 4× the anchors of spline fitting, yet scores worse: radial RMS > 0.2 px and more than 10 tangent breaks.
- **Occluded arcs are excluded.** For two r = 50 discs with centres 70 apart, the measured visible fraction of the lower disc matches the analytic value 1 − 2·acos(35/50)/2π within 1 %, with exactly 2 junctions.
- **A ring traced without its hole fails topology.** With the hole it passes.

## Acceptance thresholds (pre-registered)
**Sampling tiers** (r is the radius, minor semi-axis or corner radius):
- **A:** antialiased source (≥ 2×2 sub-samples) and r ≥ 8 px.
- **B:** antialiased and 3 ≤ r < 8 px.
- **C:** binary edges (no antialiasing).

| Metric | Tier A (brief's starting targets, plus additions) | Tier B (small) | Tier C (binary) |
|---|---|---|---|
| Centre error | ≤ 0.5 | ≤ 0.5 | ≤ 0.5 |
| Radius error | ≤ 0.5 | ≤ 0.5 | ≤ 0.5 |
| RMS radial deviation | ≤ 0.25 | ≤ 0.30 | ≤ 0.35 |
| Max radial deviation | ≤ 0.75 | ≤ 0.90 | ≤ 0.85 |
| Unintended tangent breaks (> 2°) | 0 | 0 | 0 |
| Curvature uniformity \|κ·r − 1\| | RMS ≤ 0.15, max ≤ 0.5 *(added)* | reported | reported |
| Ellipse axes / centre / area / orientation | ≤ 0.5 / ≤ 0.5 / ≤ 1 % / ≤ 1° when a/b ≥ 1.5 *(added)* | reported | reported |
| Contour away from corners (all ideal fixtures) | RMS ≤ 0.25, max ≤ 0.75 | RMS ≤ 0.30, max ≤ 0.90 | RMS ≤ 0.35, max ≤ 0.85 |
| Straight edges | RMS ≤ 0.15, max ≤ 0.5, max \|κ\| ≤ 0.005 /px *(added)* | n/a | reported |
| Corners, interior ≥ 60° | anchor within 1.0 px | n/a | within 1.0 px |
| Acute corners, interior < 60° | within 1.5 px *(see below)* | n/a | within 1.5 px |
| Holes and components | preserved | preserved | preserved |
| IoU | ≥ 0.98 where applicable *(see below)* | reported | reported |
| Complexity | anchors ≤ max(1.5 × spline anchors, spline + 8) per fixture; ≤ 12 anchors per full circle | same | same |

**Negative controls.**
- The output must follow the irregular truth: RMS ≤ 0.25 px and max ≤ 0.75 px against the hand-drawn outline.
- Every irregularity of at least 1 px must therefore survive.
- No recognised primitive may replace an outline whose own deviation from its best-fitting circle or ellipse exceeds 0.5 px.

**Photographic regression.**
- **Unchanged configurations** (every existing mode and fit setting): byte-identical scene, SVG and PDF against the frozen `7cdde36` baseline.
- **A new opt-in configuration:** no requirement on photographs beyond determinism and resource limits; behaviour is reported.

**Performance.** Precision fitting on the 256 px corpus must take ≤ 3× spline time (native release). Default photographic tracing must stay within measurement noise, because its code is unchanged.

**Where IoU applies.**
- The P0 metric (render at 1×, compare with the coverage ≥ 0.5 pixel mask) on the P0 fixtures `circle`, `sharp_corners` and `nested_rings`, which is where the target was defined.
- Label IoU at 4× for corpus shapes whose smallest dimension is ≥ 20 px.

### Mathematical limits behind the tier B/C and acute-corner allowances
These are proposals for maintainer approval, not silent adjustments.
- **Tier C (binary edges).**
  - A pixel that is 100 % in or out says only which side of the edge its centre lies on.
  - Along a circle, the unknown sub-pixel position is uniform over up to ±0.5 px (axis-aligned) to ±√2/2 px (diagonal).
  - The minimum-variance estimate is the crack midpoint, with an RMS of about 0.2–0.3 px and a max of about 0.5–0.7 px before any smoothing.
  - Averaging along the curve, which fitting does, reduces the RMS but cannot remove the error at the worst phase.
- **Tier B (r < 8 px).**
  - The boundary turns by 1/r rad within one pixel.
  - The straight-edge coverage model then has a sagitta error of about 1/(8r) px (0.04 px at r = 3).
  - A 2 px corner-detection scale also spans a turn of 2/r rad (38° at r = 3).
  - Fitted cubics on such short arcs carry a larger relative error.
- **Acute corners.**
  - Near the tip of a wedge with interior angle θ, pixels on the bisector at distance d from the tip are covered by about 2d·tan(θ/2).
  - The 50 % boundary (the alpha threshold or the luminance mid-point) therefore retracts from the true tip by about 0.25/tan(θ/2) px: 0.77 px for the star's 36° tips, before fitting.
  - A threshold-defined contour cannot reach the analytic tip, hence 1.5 px rather than 1.0 px.

Every threshold reports a margin per fixture in GEOMETRY-VALIDATION. If a Tier A target is missed for a reason that cannot be fixed, it is reported as missed, with the reason. It is not re-tiered.
