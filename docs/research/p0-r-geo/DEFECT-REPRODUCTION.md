# P0-R-GEO Stage A: defect reproduction

**Result: both owner-rejected exports are reproduced byte-for-byte, and the defect is localised.** The distortion exists identically in the canonical scene, the SVG, the PDF and the workbench preview, which renders the same SVG. It is a tracing defect, not a serialization defect.

## Inputs and settings
| Case | Source fixture | Settings (from `owner-acceptance-bundle/MANIFEST.json`) |
|---|---|---|
| DEF-GEO-001 `05-color-transparent-hole` | `tests/fixtures/procedural/logo_transparent_hole.png`: opaque blue field (30,60,200) with an antialiased transparent hole, centre (128,100), r = 20 | Full Color; colour precision 6; layer difference 16; speckle 16; alpha threshold 128; stacked; spline fit, corner 60°, length 4, splice 45°, simplify 0; seed 1; preset version 1 |
| DEF-GEO-002 `04-color-discs` | `tests/fixtures/procedural/antialiased_discs.png`: three r = 60 discs at (96,110) red, (160,110) blue, (128,165) yellow, painted in that order on white | Same |

The fixtures were not modified. The tool reads the settings directly from the bundle manifest.

## Reproduction
`cargo run --release -p vector-engine --example geo_reproduce -- docs/research/p0-r-geo/artifacts/reproduction`

| Check | 05 hole | 04 discs |
|---|---|---|
| Native trace = bundle SVG, byte-identical | **yes** | **yes** |
| Native trace = bundle PDF, byte-identical | **yes** | **yes** |
| VTracer stage replay (visioncortex public API) = scene coordinates | yes (max diff 0.0000) | yes (max diff 0.0000) |
| SVG path numbers = scene coordinates | yes | yes |
| PDF content-stream operands (decompressed) = scene coordinates (f32) | yes | yes |

**Browser decode note.** The bundle was made in Chromium, where canvas storage is premultiplied. For partially transparent pixels, `getImageData` therefore returns `round(round(c·a/255)·255/a)`. With that decode model applied to the fixture, 05 reproduces exactly. The model changes nothing for 04, which is fully opaque. This is the known P0 browser-decoding limitation, and it is not a cause of the geometry defect: the same distortion appears with the raw fixture RGBA (radial RMS 0.315 px, 7/7 broken joins).

**Scene, SVG, PDF and preview.** The SVG and PDF carry exactly the scene's coordinates. The only change is the scene's own 0.01 px quantisation, at most 0.005 px. The workbench preview is that SVG rendered by the browser. The defect is therefore **not** in PDF serialization, and it is visible everywhere the scene is.

## Measured error (source pixels, visible boundaries only)
Ground truth is the analytic circles, sampled every 0.05 px. Only boundaries a viewer can see are scored; occluded arcs are ignored. Definitions are in [GEOMETRIC-FIDELITY-METRICS](GEOMETRIC-FIDELITY-METRICS.md).

| Measure | 05 hole (r = 20) | 04 red (r = 60, 51 % visible) | 04 blue (68 % visible) | 04 yellow (100 % visible) |
|---|---|---|---|---|
| Centre error | 0.034 | 0.031 | **0.595** | **0.598** |
| Radius error | **+0.273** (hole too large) | **+0.444** | +0.027 | +0.013 |
| RMS radial deviation | **0.315** | **0.470** | **0.488** | **0.530** |
| Max radial deviation | 0.640 | 0.712 | **0.875** | **1.048** |
| Curvature uniformity, κ·r − 1: RMS / max | 0.269 / **0.669** | 0.276 / **2.95** | 0.492 / **6.32** | 0.445 / **6.81** |
| Major / minor axis error (moments) | +0.307 / +0.248 (eccentricity 0.077, true 0) | n/a | n/a | n/a |
| Area error | +2.8 % | n/a | n/a | n/a |

| Structure | 05 hole | 04 discs |
|---|---|---|
| Visible anchors | 7 | 63 |
| Anchors exactly on the integer pixel lattice | 3 | 22 |
| Joins between cubics with a tangent break > 2° (away from true corners) | **7 of 7** (max 12.7°) | **28 of 63** (max 10.9°) |
| Visible segment arc length | 16.0–21.0 px | **1.9–61.0 px** |
| Polygon-stage corners on visible contours | 0 | 6 (4 true junctions) |
| True junction corners matched by an anchor within 1 px | n/a | 4/4 (mean 0.13 px) |

How the owner's observations map to the measurements:
- **Flattened sections and inconsistent curvature:** local curvature departs from the circle's by up to 67 % on the hole, and reaches 7.8× on the discs.
- **Irregularity between curve segments:** every join on the hole has a tangent break, and 28 joins on the discs do.
- **Asymmetrical hole:** it is larger by 0.27 px, with unequal axes and an angular error pattern (`radial_by_angle` in `reproduction.json`).
- **Distortion near overlaps:** the blue and yellow centres are displaced by 0.6 px, with 1.0 px maximum deviation and curvature spikes at the junctions.

## Annotated diagnostic renders
In `artifacts/reproduction/`:
- `05-color-transparent-hole-hole-16x.png`;
- `04-color-discs-full-4x.png`, `-junction-top-16x.png`, `-red-left-16x.png` and `-lower-junctions-16x.png`.

Legend:
- **Source:** source pixels at 16×, transparency shown as a checkerboard, with the pixel grid.
- **Green:** the analytic boundary.
- **Grey:** VTracer's pixel-lattice walk.
- **Cyan:** the smoothed polygon (after subdivision).
- **Magenta dots:** splice points.
- **Red:** the fitted cubic path.
- **Blue squares:** anchors.
- **Orange:** control handles.

Raw numbers: `reproduction.json` and `reproduction.txt`.

## Frozen baseline for before/after comparison
The regression baseline was produced from clean commit `7cdde36`, the head before any P0-R-GEO engine change, in a separate git worktree.

`cargo run --release -p vector-engine --example regression_corpus -- <dir> tests/output/regression-inputs/*.png`

It traces 114 cases:
- 13 procedural fixtures × 6 modes;
- 9 photographic PNGs × 4 approved default modes:
  - Talbot and Hokusai (the P0 corpus);
  - the six native-resolution CC0/public-domain photos from P0-R, plus the 1280 px derived copy.

Each case is written as scene JSON, SVG and PDF (200 mm). The photographic inputs were converted once from the committed or fetched JPEGs with `sips -s format png`. Their hashes are in `artifacts/regression/inputs.sha256`.

The 326 output hashes are in `artifacts/regression/baseline-7cdde36.sha256`. The 599 MB of outputs and the inputs are in `tests/output/` and are not committed. Eight photographic cases end in the documented `too_many_primitives` budget error at the baseline; those error texts are hashed too. The maintainer's private concert photograph was not used.
