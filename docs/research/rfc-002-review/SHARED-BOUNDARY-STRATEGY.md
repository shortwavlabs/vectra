# RFC-002 review R04: shared colour boundary strategy (TD-GEO-001 / TD-GEO-009)

Status: **DRAFT reviewer spike. Gate result PARTIAL** (evidence on 6 synthetic fixtures; the corpus, held-out and photographic runs listed in §9 were NOT RUN).
Head `0e32fdabdbfa9aae5f7613be46c60dee375ca788`, branch `review/rfc-002-architecture`, 2026-11-24.
Host: Apple M5 Max, 128 GiB, macOS (Darwin 25.6.0). Toolchain: rustc 1.96.0 (ac68faa20 2026-05-25), cargo 1.96.0.
Engine, app, root config and lockfiles: unchanged.
Spike code: `experiments/rfc-002-review/shared-boundary/`. It is a standalone workspace with its own `Cargo.lock`. It depends on the engine through a read-only path dependency, and it `#[path]`-includes the P0 test helpers, so the metrics are the P0 metrics.
Raw outputs: `artifacts/shared-boundary/`.

Labels in this document:
- **[executed]**: a measured result from a command given here.
- **[reasoning]**: argument, not measurement.

## 0. Findings at a glance

1. **[executed] Reproduction.** TD-GEO-001 reproduces exactly at this head: the sliver list, the curvature classification and the worst-curvature numbers. 04 has 62 blend pixels relabelled by the oracle, the RCA's 62 / 1,062.
2. **[executed] Hashes.** The Artistic (spline) and Precision outputs are byte-identical to the committed evidence:
   - bundle v2: 72 / 72 SVG + PDF files, and 72 / 72 MANIFEST hashes;
   - regression corpus: 326 / 326 hashes, against both `a4cf172` and `7cdde36`.
3. **[executed] The registered sliver metric has a floor above zero.**
   - It renders the output antialiased and assigns each sample the nearest RGB palette colour.
   - The exact analytic shapes score 4 "slivers" on `discs-x2` and 3 on `concentric`.
   - Cause: a 50 % red/white antialiased pixel is closer to yellow `#fabe1e` than to red or white.
   - So the TD-GEO-001 criterion, measured that way, cannot be met on `discs-x2`, even by perfect geometry.
   - A crisp-sampled geometric metric, defined here, scores 0 on the truth and 0 on an exactly coincident stacked copy. It is **proposed for owner ratification, not adopted**.
4. **[executed] Option A, bounded with an oracle.** Perfect labels (A1), and also exact analytic crossings (A2), still fitted per layer independently:
   - remove 76–81 % of the geometric slivers ≥ 0.25 px² on 04, `discs-two-deep` and `discs-x2` (21 → 5 / 4);
   - leave curvature failing on all three (worst max 4.4–22.0 against ≤ 0.5);
   - do not share junctions.

   **A alone cannot meet TD-GEO-001.**
5. **[executed] Option B: shared boundary graph.**
   - **Prototype:** about 450 lines (cargo fmt). Every edge is fitted once with the engine's own fitter and crossings.
   - **Partition and topology:** closed, exact partitions, 0 uncovered and 0 double-covered samples at 4× on all 6 fixtures. Every interior edge is used exactly once in each direction, re-derived from the emitted scene. Junctions are shared exactly. 0 geometric slivers.
   - **Curvature:** passes on 5 of 6 fixtures with engine labels.
   - **Caveat:** on the disc fixtures this rests on the engine's arc recognition firing on the shared edges (6 / 6, 4 / 4 and 3 / 3 interior edges recognised). The generic open-chain cubic path is exercised only on `adjacent-overlap` and on the failing `discs-two-deep` row.
   - **Failure:** `discs-two-deep`, curvature 0.267 / 2.47. Engine-label errors displace the estimated junction by 1.48 px.
   - **Same edges, both compositings:** both a mosaic (partition) and a stacked output (lower layers as unions of faces) are emitted from the same fitted edges.
6. **[executed] Option C.** B plus oracle labels only within 3 px of junctions.
   - **TD-specific criteria (geometric slivers, curvature, shared junctions):** met on all 6 fixtures (`discs-two-deep` 0.004 / 0.01).
   - **Criterion 4 (no regression of the brief's targets).** Scored with geo_eval's tier A checks, minus its topology and IoU checks:
     - no misses on 5 of 6 fixtures;
     - **`adjacent-overlap` misses straight-edge curvature** (0.162 /px against ≤ 0.005). P0 misses circle curvature max (1.000) there instead, so this is a trade, not a pass;
     - it also regresses within thresholds: contour max away from corners 0.312 against 0.076, corner 0.76 against 0.25 px.
   - **Unproven:**
     - a non-oracle junction-local correction;
     - a junction-position estimator: the 0.60 px error on `adjacent-overlap` is the same under engine, junction-local and global oracle labels, and only analytic junctions remove it;
     - a proper open-section fitter: the prototype's chord workaround is the suspected cause of the `adjacent-overlap` corner and line misses.
7. **Recommendation.** Accept D06 with amendments:
   - trace-local shared boundary graph;
   - one fit per edge;
   - stacked and mosaic both derived from it;
   - materialize independent paths at commit, with optional provenance that is never a live constraint.

   Gate P1-C on the proof list in §8. Do not invest in Option A alone.

## 1. Reproduction of TD-GEO-001 [executed]

**Fixtures and settings.** All are corpus fixtures with analytic truth (`crates/vector-engine/tests/common/corpus.rs`).

| Bundle v2 case | Corpus fixture | Source |
|---|---|---|
| 04-color-discs | `04-color-discs` | `fixtures::antialiased_discs()` through `browser_decode`; discs r = 60 at (96,110) red, (160,110) blue, (128,165) yellow on white, 256² |
| 22-discs-deep | `discs-two-deep` | discs r = 50 at (113,128) red, (143,128) blue, 256², 8×8 supersampled |
| 21-discs-three | `h-discs-three` (held-out) | discs r = 45 / 52 / 38, 300 × 260 |
| 20-overlap-rect-disc-square | `adjacent-overlap` | rectangle, disc r = 55, square rotated 15° |
| — | `discs-x2`, `concentric` | 04 geometry at 2×; concentric discs r = 90 / 70 / 50 / 30 |

Settings: `{"mode":"color","fit":{"mode":"precision"}}`, i.e. the defaults:
- colorPrecision 6, layerDifference 16, speckle 16, alphaThreshold 128;
- stacked compositing, cornerThreshold 60;
- `PRECISION_FIT_VERSION` 1, `Options::production(60)`.

**Commands.**

```bash
cargo build --release --locked -p vector-engine --examples
for f in 04-color-discs discs-two-deep discs-x2 h-discs-three adjacent-overlap concentric; do
  for s in 2 4; do ./target/release/examples/geo_inspect specks $f $s; done; done
for f in 04-color-discs discs-two-deep discs-x2; do
  ./target/release/examples/geo_inspect curvature $f tests/output/rfc002-r04/curv arcs; done
```

**Specks, ≥ 1 px², matching the register** (`artifacts/shared-boundary/reproduction-specks.txt`). Identical, line for line, to `p0-r-geo/artifacts/selection/specks.txt`:

| Fixture | Sampling | Lower colour | Area (source px²) | Position |
|---|---|---|---|---|
| 04 | 2× | yellow | 1.50 | (36.0–36.5, 102.5–105.5) |
| 04 | 2× | yellow | 1.25 | (88.5–91.0, 50.0–50.5) |
| `discs-two-deep` | 4× | blue | 2.19 | (63.0–63.2, 123.8–132.5) |
| `discs-two-deep` | 4× | blue | 1.12 | (113.0–117.5, 78.0–78.2) |
| `discs-x2` | 4× | yellow | 1.19 | (72.2–72.8, 206.0–210.2) |
| `discs-x2` | 2× | yellow | 1.00–2.25 | five more |

One addition: `concentric` prints an "extra component" of 5,022 px². That is the tool's one-component-per-colour assumption meeting a fixture with two true rings of one colour. It is a false positive, not a sliver.

**At the acceptance threshold** (4×, ≥ 0.25 px²): the registered metric finds:
- 7 components on 04 (0.25–0.56 px²);
- 14 on `discs-two-deep`;
- 14 on `discs-x2`;
- 7 on `concentric`;
- 0 on `h-discs-three` and `adjacent-overlap`.

**Curvature classification** (`reproduction-curvature.txt`) is identical to `curvature-classification.txt`:

| Fixture | Flagged | Lower-layer duplicates | Saturated runs > 3 | Runs 1–3 | Other top-path flags |
|---|---|---|---|---|---|
| 04 | 554 | 396 | 28 | — | 130 |
| `discs-two-deep` | 258 | 105 | — | — | 153 |
| `discs-x2` | 453 | 309 | 29 | 6 | 109 |

**Worst-circle curvature** (row "P0" in the spike). These equal the register; position targets are met:

| Fixture | Curvature RMS / max | Notes |
|---|---|---|
| 04 | 1.096 / 16.12 | radial max 0.257, centre error 0.050 |
| `discs-two-deep` | 2.626 / 29.64 | 1 tangent break |
| `discs-x2` | 1.126 / 30.56 | |

## 2. Hash confirmation [executed]

Commands and output: `artifacts/shared-boundary/hash-check.txt`.

**Bundle v2.** `geo_bundle` regenerated bundle v2 into `tests/output/rfc002-r04/bundle-v2`:
- 72 / 72 SVG and PDF files are byte-identical to `owner-acceptance-bundle-v2/` (18 cases × spline and precision × SVG and PDF);
- all 72 MANIFEST `svgSha256` / `pdfSha256` values match.

**Regression corpus.** `regression_corpus` regenerated 114 cases × scene, SVG and PDF from the 9 photo inputs, whose hashes match `inputs.sha256`. It took 7 min 03 s. All 326 / 326 hashes are identical to `a4cf172.sha256` and to `baseline-7cdde36.sha256`.

**Spike cross-checks.**
- The production precision SVG computed inside the spike is byte-identical to the bundle's 04, 22, 21 and 20 corrected-precision files.
- The spike's replica of `trace.rs::precision_compose` through the public API (row A0) differs from production by a maximum of 0.0 in coordinates on all 6 fixtures. Every Option A number below is therefore attributable to the label or crossing change alone.

## 3. Metric calibration and definitions [executed; the new definitions need owner ratification]

**Protocol, as it actually happened.** This is disclosed in the P0 style, not a blind protocol.
- **Defined before the first run:** the AA and geometric specks, coverage multiplicity, edge usage, the shape metrics and the shared-vertex check.
- **Added after reading the first run's rows:**
  - the T negative control and the exact-copy calibration;
  - the junction-error statistic and the worst-deviation location;
  - the 3 px junction-local oracle variant (Option C);
  - tier A scoring, replicated from `geo_eval::misses`;
  - the arc-recognition counts.
- **The "not meaningful for stacked" reading** of the shared-vertex check was made after T failed it.
- **Single values, not swept:** `TRIM` 1.5 px, the junction tangent window 1.5–4 px, the 2.5 px analytic-junction snap radius, the 3 px junction-local radius and the 0.9 nesting fraction. No parameter was tuned on these fixtures, and no frozen engine option was changed.

**Metrics used.** "Defined here" marks the new ones.

- **AA specks (registered).**
  - Method: the `geo_inspect specks` algorithm. Render with resvg at 4× over the fixture background, assign each sample the nearest palette colour, take 4-connected components, and count the extra components of each colour.
  - One correction: the expected component count per colour comes from the truth raster, so `concentric`'s second ring is not counted.
  - It reproduces the register on P0 (7 / 14 / 14).
- **Geometric specks (defined here).** The same component count, but on crisp samples: each 4× sample takes the colour of the topmost output path whose crisp (non-antialiased) fill contains it.
- **Coverage multiplicity (defined here, mosaic outputs).** The number of output paths covering each crisp 4× sample. A partition requires exactly 1 everywhere.
- **Edge usage (defined here).** Re-derived from the emitted, quantised scene, not from the graph's own bookkeeping. For every segment, count uses keyed by an orientation-independent key: lines by end points, cubics by end points plus swapped controls.
- **Shape metrics.** The P0 harness `geometry::evaluate`, unchanged:
  - contour RMS and max;
  - worst-circle centre error, radial max and curvature RMS / max, excluding 2 px around true corners and junctions;
  - tangent breaks.
- **Shared-vertex check (defined here).** At each true junction, take the nearest anchor of every path whose outline passes within 1.5 px. Spread is the largest pairwise distance between those anchors.
- **Tier A misses (added after the first run).** `geo_eval::misses` with the tier A thresholds of GEOMETRIC-FIDELITY-METRICS, unchanged, minus its topology and P0-IoU checks. Topology is the specks here, and IoU does not apply to these fixtures. It covers:
  - contour away from corners;
  - per-circle centre, radius, radial and curvature;
  - loops;
  - straight edges;
  - corners;
  - the anchor cap against the spline anchors.

**Calibration results.**

| Control (all numbers at 4×, ≥ 0.25 px²) | AA specks | Geometric specks |
|---|---|---|
| **T**: the fixture's exact analytic shapes in source paint order, as a scene (8 cubic arcs per circle, error < 1e-5·r) | 04: 0, `discs-two-deep`: 0, **`discs-x2`: 4 (0.38 px²)**, **`concentric`: 3**, others 0 | 0 on all 6 |
| White frame, then yellow = exact copy of red's path, then red (04) | **2** (0.25 px² at x = 36, y ≈ 106 and 114) | 0 |

What this shows:
- **The AA metric's false positives.** They come from colour classification:
  - a ≈50 % red (230, 60, 50) / white antialiased pixel is (242, 157, 152);
  - its squared RGB distance to yellow (250, 190, 30) is 16,037, smaller than to red (19,957) or white (20,382);
  - long, near-axis-aligned edges (the disc extremes at x = 72 on `discs-x2`, x = 36 on 04) therefore show "yellow" runs that are not geometry.
- **The registered metric cannot certify TD-GEO-001 on `discs-x2`.** Even perfect geometry fails it there.
- **Proposal:** keep reporting it, and add the geometric metric as the acceptance measurement. **This is an owner decision.** No threshold is changed by this review.
- **The geometric metric is not uniformly more lenient.** On P0 `h-discs-three` it finds 1 component (0.38 px²) that the registered metric scores 0. Adopting it is a change of measurement, not a relaxation.
- **The shared-vertex check is not meaningful for intentionally overlapping (stacked) geometry.**
  - T fails it: 4 / 4 junctions on 04, spread 20.9 px, because full circles carry no anchor at the junctions.
  - For the same reason, T scores a tier A "corner 4.00 px" miss on the disc fixtures.
  - **Junction coincidence for P0 and Option A was therefore not validly measured.** Their spreads (P0 04: 22.7 px, 4 / 4) are reported in `results.json` but must not be read as a failure count.
  - TD-GEO-001's "every junction shared by all incident paths within 0.1 px" therefore presupposes a partition.
- **Proposed restatement:**
  - partition (mosaic) outputs: incident faces carry the identical junction vertex;
  - stacked outputs: every visible boundary meeting at the junction is drawn from those same shared edges.

  This needs owner ratification.

## 4. Option A: label and blend correction without new topology [executed, oracle upper bound]

**Design.** Engine segmentation, hierarchy, `Field`, the contour tracer and `fit_contour` are all kept, and each layer is fitted independently exactly as in P0. Only the input changes:
- **A1, oracle labels.**
  - Each pixel's visible label is the truth region containing its centre, mapped to engine layers by majority vote; a bijection is asserted.
  - Stacked masks are rebuilt with the engine's own nesting: k ∈ S(l) iff ≥ 90 % of k's visible pixels lie in l's mask. On 04, for example, the yellow layer = yellow ∪ red.
  - The oracle changes 62 pixels on 04, 51 on `discs-two-deep` and 119 on `discs-x2`.
- **A2.** A1 plus analytic crossings: every visible crack's point is placed exactly on the analytic edge between the two pixel centres, by bisection. This bounds any blend or label correction, because no crossing can be better.

**Results** (4×, ≥ 0.25 px²; curvature is the worst circle):

| Fixture | Variant | Geometric specks | AA specks | Curvature RMS / max | Contour max | Breaks |
|---|---|---|---|---|---|---|
| 04 | P0 | 4 | 7 | 1.096 / 16.12 | 0.260 | 0 |
| 04 | A1 | **0** | 3 | 0.239 / 9.43 | 0.244 | 0 |
| 04 | A2 | 2 | 3 | 0.428 / 14.07 | 0.266 | 0 |
| `discs-two-deep` | P0 | 9 | 14 | 2.626 / 29.64 | 0.399 | 1 |
| `discs-two-deep` | A1 | **0** | **0** | 0.250 / 4.36 | 0.185 | 0 |
| `discs-two-deep` | A2 | 0 | 0 | 0.275 / 5.63 | 0.178 | 0 |
| `discs-x2` | P0 | 8 | 14 | 1.126 / 30.56 | 0.284 | 0 |
| `discs-x2` | A1 | 5 | 10 | 0.423 / 20.58 | 0.284 | 0 |
| `discs-x2` | A2 | 2 | 5 | 0.543 / 22.01 | 0.254 | 0 |
| `adjacent-overlap` | P0 / A1 / A2 | 0 | 0 | 0.137 / 1.00, unchanged | 0.150–0.155 | 0 |
| `h-discs-three` | P0 / A1 / A2 | 1 | 0 | 0.005 / 0.01 | 0.08–0.10 | 0 |

**Fraction of the defect A can remove at best** (04 + `discs-two-deep` + `discs-x2`):
- Geometric slivers: 21 → 5 (A1) or 4 (A2), i.e. **76–81 % removed**.
- AA specks: 35 → 13 / 8 (63–77 %). The truth floor is 4.
- Curvature criterion (RMS ≤ 0.15, max ≤ 0.5): **0 of 3 fixtures pass**, before and after.
- Junction sharing: unchanged. Independent fits give every layer its own corner or none.
- `adjacent-overlap`: the curvature max of 1.00 is untouched.
- Tier A misses under A1 and A2: only circle curvature, on 04, `discs-two-deep` and `discs-x2`. The 16.5° break on `discs-two-deep` disappears.
- Exact crossings (A2) are not better than perfect labels (A1).
- **[reasoning]** The residual is structural: lower union layers redraw higher layers' edges with different section breaks and corner decisions, so they still poke out or round the junction (`04-crops-32x.png`, column 2). This mechanism is inferred from the renders and the P0 classification, not isolated by an experiment.

**Verdict.** Label and blend correction is necessary near junctions (see §6) but is **not sufficient** without shared edges.

## 5. Option B: trace-local shared boundary graph [executed, minimal prototype]

**Pipeline** (`src/main.rs`, section "Option B"):
1. **Faces.** Faces are the 4-connected components of the visible label map (engine or oracle).
2. **Crack edges.** A crack is the lattice edge between two pixels of different faces; the image outside counts as a face.
3. **Junctions.** A junction is a lattice vertex with ≥ 3 boundary cracks. This covers two-label checkerboards.
4. **Edges.** Each face's boundary loops (inside 4-connected, right turn first, as the engine) are split at junctions into crack chains. Each chain is registered once, with its orientation.
5. **Crossings.** Crossings are the engine's own: `precision::contours` is run on each face's mask, with the production `Field` built from the stacked layer masks, and mapped back to cracks. The two sides agree to ≤ 2.8e-14 px.
6. **Junction position**, one of two modes:
   - **estimated:** least-squares intersection of the incident edges' end tangent lines, taken from crossings 1.5–4 px from the vertex;
   - **analytic:** the nearest true junction.
7. **Fitting.** Each edge is fitted **once** with the frozen production options (G1 cubics, lines, recognised arcs).
   - Crossings within 1.5 px of a junction are replaced by the junction point.
   - **Workaround:** the engine exposes only the closed-loop `fit_contour`, so an open chain is closed with a chord, its two junction ends are pinned (forced corners, never moved), and the chord is dropped after fitting. The spike asserts that each fit starts and ends exactly on its junctions and that only the chord is dropped.
   - Closed edges with no junction use `fit_contour` directly. Image-border edges stay lattice polylines, as in the engine.
8. **Assembly.**
   - Any set of faces is assembled by walking its boundary, looking up each piece's edge and appending it forward or reversed. A reversed cubic swaps its control points.
   - Coordinates are quantised to 0.01 px once per edge, so neighbours stay bit-identical after serialisation.
   - **Mosaic:** for each colour, the faces of that colour.
   - **Stacked:** for each engine layer, the union of the faces in S(l), in the engine's paint order.

**Validation**, computed from the emitted scenes, engine labels and estimated junctions, all 6 fixtures:
- **Topology.**
  - 04: 4 faces, 4 junctions, 7 edges (6 interior plus the frame).
  - `discs-two-deep`: 3 faces, 2 junctions, 4 edges.
  - `discs-x2`, `h-discs-three`, `adjacent-overlap`: 4 / 4 / 7 each.
  - `concentric`: 5 faces, 0 junctions, 5 closed edges.

  These equal the analytic counts. No extra faces or tiny edges appear with engine labels. **[reasoning]** Speckle 16 has probably already removed islands; that was not isolated.
- **Closed cycles and edge use.**
  - 0 open subpaths.
  - 100 % of interior segments are used exactly once forward and once reversed: 13 / 13 on 04, 14 / 14, 13 / 13, 18 / 18, 13 / 13 and 16 / 16.
  - 0 unpaired.
- **Coverage.** Mosaic, crisp at 4×: **0 uncovered and 0 double-covered samples** on all 6 fixtures and every label variant.
- **Junctions.** Every face incident to a graph junction carries that exact quantised anchor (0 missing). Shared-vertex spread is 0.000.
- **Scene compatibility.** Every output passes `Scene::validate`, `svg::to_svg` and `pdf::to_pdf`.
- **Not stacked.** The stacked outputs reuse coincident edges in the same direction, 3–8 per fixture; they are unions, not a partition.

**Quality.** Geometric specks are 0 in every B row. Contour values exclude 2 px around true corners (tier A uses the same exclusion; the all-sample max is in `results.json`).

| Fixture | Variant | Curvature RMS / max | Contour RMS / max away from corners | Centre / radial max | Junction error | Arc-recognised interior edges | Tier A misses (P0's misses) |
|---|---|---|---|---|---|---|---|
| 04 | B, engine labels, estimated junctions | **0.004 / 0.01** | 0.042 / 0.126 | 0.081 / 0.124 | 0.126 px | 6 / 6 | none (curvature ×4) |
| `discs-two-deep` | B, engine labels, estimated junctions | **0.267 / 2.47** | 0.080 / 0.460 | 0.203 / 0.460 | **1.478 px** | 1 / 3 | curvature RMS and max, corner 1.48 px (break, curvature ×4) |
| `discs-two-deep` | B, engine labels, analytic junctions | 0.003 / 0.01 | 0.017 / 0.034 | 0.004 / 0.023 | 0 | 3 / 3 | none |
| `discs-two-deep` | B, oracle labels, estimated junctions | 0.004 / 0.01 | 0.041 / 0.089 | 0.076 / 0.085 | 0.091 | 3 / 3 | none |
| `discs-x2` | B, engine labels, estimated junctions | 0.002 / 0.01 | 0.028 / 0.064 | 0.020 / 0.059 | 0.064 | 6 / 6 | none (curvature ×4) |
| `h-discs-three` | B, engine labels, estimated junctions | 0.005 / 0.01 | 0.050 / 0.194 (P0 0.103) | 0.068 / 0.192 | 0.211 | 6 / 6 | none (none) |
| `adjacent-overlap` | B, engine labels, estimated junctions | **0.043 / 0.38** | 0.060 / **0.312** (P0 0.076) | 0.089 / 0.312 (P0 0.013 / 0.073) | 0.602 | 2 / 6 | **line curvature 0.162** (curvature max 1.000) |
| `concentric` | B, engine labels | 0.007 / 0.02 | 0.031 / 0.093 (P0 0.064) | 0.025 / 0.090 | — | 4 / 4 | none (none) |

AA specks (mosaic / stacked): 04 0 / 3; `discs-x2` 4 / 5, against a truth floor of 4; `concentric` 0 / 9, against truth 3 and P0 7; the rest 0 / 0. All rows have 0 tangent breaks and are within the anchor cap.

**Where B is still short:**
- **The cubic path is barely exercised.**
  - On the disc fixtures the curvature pass rests on the engine's arc recognition firing on the shared edges.
  - The only B rows with generic G1-cubic interior edges are `adjacent-overlap` (2 edges) and the failing `discs-two-deep` engine-label row (2 edges).
  - Curvature uniformity of cubic-fitted shared edges is therefore largely untested.
- **`discs-two-deep` junctions.** Engine blend-pixel errors near the junction displace the estimated junction by 1.48 px; analytic junctions or oracle labels fix it.
- **`adjacent-overlap` junction error.** The estimate is 0.60 px off under engine, junction-local oracle *and* global oracle labels; only analytic junctions remove it (radial max 0.312 → 0.047). This is an estimator limitation, not a label one.
- **`adjacent-overlap` corner and straight edge.**
  - Measured: the worst deviation, at (153.96, 90.86), is the green square's corner, about 6 px from a junction along the same edge. Tier A straight-edge curvature fails: 0.162 /px (engine labels), 0.051 (oracle), 0.028 (analytic), against ≤ 0.005; P0 has 0.000.
  - **[reasoning, not verified]** The suspected cause is the prototype's chord workaround. The fitter's corner rebuild needs a section of at least 2 × (trim at both ends), and the pinned junction is charged a trim it does not need, so the corner is not rebuilt and the edge curves.
- **`h-discs-three` near the junctions.** Estimated junctions are coarser than P0's local fits there: contour max 0.194 against 0.103 px, within threshold.
- **AA specks on stacked outputs from the graph.** These are the exactly-coincident-edge artefacts of §3, not geometry. The geometric metric is 0.

**Cost.** Release build on the M5 Max, single thread. Peak extra heap is from the counting allocator.

| Image | Faces, cracks, chains | Junctions and fit | Mosaic and stacked assembly | Peak extra heap |
|---|---|---|---|---|
| 256² | 1.3–2.2 ms | 0.15–0.24 ms | 1.9–2.8 ms | 0.66–0.77 MB |
| 512² (`discs-x2`) | 5.3 ms | 0.37 ms | 9.2 ms | 1.97 MB |

- Assembly walks the full image once per layer and output: O(layers × pixels), a prototype choice.
- Code: the whole binary is 1,631 lines after `cargo fmt` (repository rustfmt.toml). The graph is about 450, Option A 40 (a replica of `precision_compose`) and the metrics, validators and tier A replica about 470. The rest is the experiment driver.

**Not a production topology engine.** It does not handle:
- transparent (unlabelled) faces: their crossing must come from the labelled side;
- junctions on the image border;
- the corner-trim workaround;
- edge-count or memory budgets.

## 6. Option C: hybrid [executed for the oracle bound; otherwise reasoning]

Variant: "B junction-local (3 px) oracle labels". Engine labels everywhere except within 3 px of a true junction.

| Fixture | Curvature RMS / max | Contour max away from corners | Junction error | Tier A misses |
|---|---|---|---|---|
| `discs-two-deep` | 0.004 / 0.01 | 0.108 | 0.22 px | none |
| `h-discs-three` | 0.005 / 0.01 | 0.102 (engine labels 0.194) | 0.11 | none |
| `adjacent-overlap` | 0.043 / 0.38 | 0.312 | 0.60 | line curvature 0.162 |
| 04, `discs-x2`, `concentric` | identical to B with engine labels | | | none |

**What C meets:**
- The **three TD-GEO-001-specific criteria** on all 6 fixtures:
  - 0 geometric slivers ≥ 0.25 px²;
  - curvature RMS ≤ 0.15 and max ≤ 0.5 (worst 0.043 / 0.38);
  - exact shared junctions (mosaic).
- **Criterion 4 (no regression of the brief's targets)**, scored with the tier A checks: met on 5 / 6.
- **`adjacent-overlap` misses straight-edge curvature**, and regresses within thresholds on contour, radial and corner position. P0 misses circle curvature there, so this is not a pass.
- **The AA-metric floor** on `discs-x2` (§3) still applies.

**Smallest combination indicated by the evidence:**
1. **Shared boundary graph (B), with one fit per edge.** This removes the slivers and junction irregularities that A cannot.
2. **Junction-local blend correction.**
   - It is what fixes the curvature criterion: junction-local and global oracle labels both pass.
   - Global label correction gives smaller further position gains elsewhere: contour max away from corners improves on `concentric` (0.093 → 0.035) and `h-discs-three`. It is not needed for the TD criteria on these fixtures.
3. **A robust junction-position estimator.** It is a separate ingredient: label correction does not fix `adjacent-overlap`'s 0.60 px junction error; only analytic placement does.
4. **An end-constrained open-section fitter in `precision.rs`.** No trim at pinned junction ends; this replaces the workaround.

**Unproven:**
- A **non-oracle** junction-local correction. Candidates:
  - three-colour unmixing of the 2–3 px around a lattice junction;
  - a robust junction estimate from edge fits 3–8 px out.

  Neither was run.
- A junction-position estimator reaching about 0.1 px without the oracle. It is needed on `adjacent-overlap` (0.60 px) and `h-discs-three` (0.21 px).
- That an end-constrained fitter actually removes the `adjacent-overlap` straight-edge and corner misses. This is a hypothesis.
- Curvature uniformity of generic cubic shared edges. The disc results rest on arc recognition.
- Label maps from real artwork and photographs: face and junction counts, tiny edges and checkerboard junctions at scale.
- Transparent faces and holes (05, 10, `h-ring-thin-alpha`) and border junctions.
- The full validation, held-out and negative-control corpus under a new precision fit version.
- WASM determinism and browser performance.

## 7. Editor integration: critique of the RFC-002 §9 contract

**[executed] evidence**, from the 04 mosaic with engine labels and estimated junctions, in `extra.editorDemo04` of `results.json`:
- **Moving one face.** Translating the red face's materialised path by (+2, 0) leaves every other path **byte-identical** (serialised comparison). The coverage validator then reports 3,601 uncovered and 3,601 double-covered 4× samples (225 px² each).
- **Editing one side of a shared edge.** Nudging one control point of a shared cubic in the red path only turns 2 previously paired segment keys into unpaired ones (13 paired becomes 12 paired + 2 unpaired). The neighbour does not follow: **after materialisation, re-fitting or editing a shared edge no longer updates both sides**, by design.

**[reasoning] Four different things RFC-002 should name separately.**

1. **Regions sharing an initial separation boundary** (faces of one trace).
   - Topology exists only while evaluating that trace.
   - At commit, each face or colour layer becomes an independent `PathObject` whose boundary coordinates are bit-identical to its neighbours'. This is a partition at commit time only.
   - "Merge regions", "select neighbours" and "re-fit this shared boundary" are explicit commands that may consult provenance. Editing never propagates implicitly.
2. **Independent vector objects.** There is no topology. Coincidence is accidental, and booleans or offsets create new geometry.
3. **Independent ink plates.**
   - A plate is a union of the faces of one ink, materialised from the same edges, so plates start exactly registered.
   - Misregistration is a per-plate transform (the registration operation), and it legitimately creates gaps and overlaps.
   - Plates must never be constrained to share boundaries.
   - Trapping (spread or choke) and overprint are explicit geometry or style operations on plate boundaries. A trap can use provenance (edge → the two inks) to decide which side spreads, or it can recompute adjacency from geometry.
4. **Intentionally overlapping stacked geometry** (the P0 default).
   - Lower layers deliberately extend under higher ones; they are unions, not a partition.
   - In the prototype, a stacked layer is the union of its nested faces, assembled from the same fitted edges. Where its outline meets a higher layer's, it is exactly coincident in the same direction (3–8 coincident same-direction edges per fixture). That removes the lower-layer slivers geometrically.
   - The remaining antialiased colour fringe is a renderer artefact, at most a(1 − a) per pixel. Mosaic has the mirror-image artefact: the background bleeds into its seams.
   - Neither should be "fixed" by erosion or snapping. RFC §9's "no blanket snapping/erosion/offset" stands.

**[reasoning] Implications.**
- **Booleans.** While the graph exists, merging adjacent faces is exact and trivial: drop the shared edges. After materialisation, a general boolean library meets exactly coincident edges, a classic robustness hazard. Do region merges in the evaluation stage, or keep provenance; boolean qualification must include coincident-edge cases.
- **Scene and export.**
  - Scene v1 M/L/C/Z **suffices** for materialised mosaic and stacked outputs [executed: `validate`, SVG and PDF pass on all prototype outputs].
  - Topology does not need to enter scene v1, SVG or PDF.
  - Exact reversal plus once-per-edge 0.01 px quantisation keeps neighbours identical through serialisation.
  - A future scene v2 or GeometryPacket should not add shared-edge references to export formats.
- **Document provenance** (optional, never authoritative):
  - on `PathObject.traceProvenance`: `{traceId, sourceDigest, settingsDigest, engineVersion, precisionFitVersion, faceIds | layerIndex, edgeRefs: [(edgeId, reversed)], edgesDigest}`;
  - per trace: an edge table `{edgeId, faceA, faceB, geometryDigest}` kept with the trace record, not in the scene.

  Any geometry edit invalidates it by digest mismatch. Commands that use it must fall back gracefully when it is stale. Undo restores it with the geometry.
- **Plates and printing.** Plate derivation (D07 InkPlates domain) should consume the trace-local graph, or the materialised paths plus provenance, never live linked edges. Plate misregistration then needs no topology changes.

## 8. Recommendation, contract and future gate

**Strategy.** Amend D06: **ACCEPT WITH REVISIONS**.
1. **Where the graph lives.** A trace-local shared boundary graph in the Rust engine's evaluation stage, owned by Vectra, not by VTracer types. Its parts: faces, oriented edges, junctions, one fit per edge, holes as separate face cycles.
2. **What derives from it.** Both compositing outputs: stacked (default, unions of nested faces) and mosaic (partition). This makes precision available for mosaic, the route to TD-GEO-009.
3. **Junctions.** A junction-local blend correction plus a robust junction-position estimator, two separate ingredients (§6). Global label correction is optional for the TD criteria on this evidence.
4. **Commit.** Materialise independent `PathObject`s at commit, with optional digest-checked provenance. No global linked-edge constraints, no automatic neighbour updates, and no plate coupling.
5. **Option A alone.** Do not pursue it as the fix; the oracle bound in §4 excludes it.

**Architectural contract.**
- Topology is evaluation-local and immutable per trace job.
- The output is validated scene geometry.
- Mosaic output is a partition: every interior edge is used once in each direction, and crisp coverage multiplicity is 1.
- Stacked output reuses the same edge geometry for coincident boundaries.
- Junction vertices are bit-identical across incident outputs.
- Artistic (spline) output stays byte-identical, and the existing precision v1 output stays reproducible: any geometry change is `PRECISION_FIT_VERSION` 2, opt-in until it passes the gate.

**Proposed gate P1-C "G-SB"** (proof requirements; no threshold lowering):
1. **Preserve the frozen evidence.** Spline and precision v1 stay byte-identical: the 326 regression hashes and the 72 bundle v2 hashes.
2. **Engine API first.** Add an end-constrained open-section fitter, with pinned ends and no trim at pinned ends, as a byte-neutral refactor of v1, proven by the hashes. Only then build the graph on top.
3. **Corpus.** Full `geo_eval` validation (24), rejected (2) and negative (6) under the existing pre-registered tier A–C thresholds and IoU; then the held-out set (12) **once**, after a freeze. TD-GEO-001 fixtures must show:
   - 0 lower-colour components ≥ 0.25 px² under the metric the owner ratifies (§3);
   - curvature RMS ≤ 0.15 and max ≤ 0.5 beyond 2 px of true junctions;
   - mosaic junctions bit-identical, and the stacked equivalent per the ratified restatement;
   - 0 tangent breaks;
   - no tier A regression, including `adjacent-overlap` and `h-discs-three` contour max.
4. **Topology validators** on every output, emitted-geometry based as in §5:
   - closed cycles and opposite-orientation pairing;
   - crisp coverage multiplicity 1 (mosaic);
   - no duplicate or dangling edges, and no self-intersections;
   - holes and transparent faces (05, 10, ring and compound-hole fixtures);
   - border junctions.
5. **Negative controls.** The organic controls stay un-idealised: 0 recognised substitutions.
6. **Photographic and real-artwork cost.** Edge, junction and face counts, time and peak memory against the precision v1 PERFORMANCE-REGRESSION baseline, with explicit budget rejection before fitting (TD-PERF-002).
7. **Native vs WASM.** Byte-identical fingerprints for the new version.
8. **Editor.** The independent-move and stale-provenance tests from §7 as automated tests.

**Staged migration.**
1. Byte-neutral fitter API refactor.
2. Graph evaluator behind `fit.mode = "precision"` version 2, opt-in, with stacked output.
3. Mosaic plus precision (lift the TD-GEO-009 validation error only after the gate).
4. Default decision by the owner.
5. Editor materialisation and provenance in P1-C, plates later.

## 9. NOT RUN, and why

- **The prototype under the full P0 scoring.** Not run on the full corpus (32 + 12 held-out), the negative controls or the photographs. Reasons: time box, and the prototype fitter workaround would confound the results. The 6 fixtures include held-out `h-discs-three`; nothing was tuned on it.
- **Transparent faces and border junctions.** Not run. The prototype's crack map takes the first side's crossing, which is wrong for an unlabelled transparent face.
- **A non-oracle blend correction.** Not run. Options A1, A2 and C here are oracle bounds.
- **A sensitivity sweep of junction estimation.** Not run (trim radius, window). It was not tuned, so as not to fit the evaluation fixtures.
- **Independent renderer cross-check of prototype outputs.** poppler or Inkscape were not run. Only resvg and the engine's own validation and PDF export were.
- **Browser, WASM, Safari, lower-end hardware.** Not run.
- **Real ink plates, misregistration, trapping and booleans.** Reasoning only.

## Reproduce

```bash
cargo build --release --locked -p vector-engine --examples            # repo root
./target/release/examples/geo_bundle tests/output/rfc002-r04/bundle-v2
./target/release/examples/regression_corpus tests/output/rfc002-r04/regression tests/output/regression-inputs/*.png
cd experiments/rfc-002-review/shared-boundary
cargo run --release --locked            # writes tests/output/rfc002-r04/shared-boundary/{results.json,summary.md,04-crops-32x.png}
```

Artifacts in `artifacts/shared-boundary/`:
- `results.json`: every row, the per-fixture oracle and nesting data, graph statistics, edge usage, speck lists and the editor demo;
- `summary.md`: all rows as a table;
- `hash-check.txt`;
- `reproduction-specks.txt`;
- `reproduction-curvature.txt`;
- `04-crops-32x.png`: 04 at 32×. Columns: P0 production, A2, B stacked, B mosaic. Rows: red disc's left extreme (P0 sliver site) and the red / yellow / white junction (68.0, 163.1).
