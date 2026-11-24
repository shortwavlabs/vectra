# P0-R-GEO Stage E: selected correction

**Selected:** an explicit **precision** fit mode (`fit.mode = "precision"`, `PRECISION_FIT_VERSION` 1), the D4 hybrid from ALGORITHM-EVALUATION. The approved **artistic** behaviour (`fit.mode = "spline"`, the default) is unchanged and byte-identical.

## Artistic and precision tracing
| | Artistic (`spline`, default, unchanged) | Precision (`precision`, new, opt-in) |
|---|---|---|
| For | Photographs, engravings, distressed and organic artwork | Logos, geometric artwork, clean illustrations |
| Boundary | VTracer: binary-mask lattice, outset smoothing, slice-wise cubics | Sub-pixel boundary from the antialiased source |
| Curves | Independent cubic per ≤ 45° slice (10 px tolerance) | G1-continuous cubics (0.2 px tolerance), rebuilt corners, straight edges as lines |
| Primitives | none | A circle or circular arc only where residuals prove it (RMS ≤ 0.08 px, max ≤ 0.3 px) |
| Compositing | Stacked or mosaic | Stacked only (`fit.mode precision requires compositing stacked`) |
| Parameters used | corner, length and splice thresholds, simplify | corner threshold; `simplify` must be 0 (rejected otherwise); length and splice thresholds unused |

The modes are named in the settings and the workbench ("Fit: precision"). No preset changes meaning. The workbench switches compositing to stacked when precision is chosen, and back to spline if mosaic is chosen.

## Algorithm (`crates/vector-engine/src/precision.rs`)
VTracer still clusters colours, builds the stacked layer hierarchy and snaps palettes. For `fit.mode = precision`, only its per-region curve fitting is replaced (`trace.rs::precision_compose`). For each layer, in paint order:
1. **Crack contours.**
   - Pixel-boundary loops of the layer mask: inside pixels 4-connected, as VTracer's region tracing, with holes as their own loops.
   - Image-border runs are pinned to the lattice.
2. **Sub-pixel crossings.** Each crack between an inside pixel *i* and an outside pixel *o* becomes one point on the segment joining their centres, at the coverage estimate `0.5 + (cᵢ − 1) + cₒ` (exact for axis-aligned straight edges). The coverages come from:
   - alpha, for transparent edges;
   - luminance against local ink and paper levels, shifted by the threshold level (B&W);
   - projection of the premultiplied colour between the two regions' local mean colours (colour).
   
   Further rules:
   - Crossings use the **visible** labels, the topmost layer at each pixel, so layers that share a visible edge get bit-identical points.
   - A crossing never leaves the segment between the two pixel centres (clamped to 2–98 %), so topology and thin features survive.
3. **Reliability.**
   - **Saturated.** A crossing whose estimate falls outside the segment means segmentation put a blend pixel on the wrong side. It is dropped when it lies in a run of at most 3 between reliable neighbours.
   - **Hidden.** A crack under the same higher layer on both sides carries no edge information.
4. **Corners.**
   - The chord turn at ±2 px arc length is compared with `cornerThreshold`, keeping local maxima only.
   - Corners are found on the raw contour, before smoothing.
5. **Sections.**
   - Between corners, Taubin λ|μ smoothing (2 pairs) runs with the corners fixed; it does not shrink.
   - At each visible corner, the antialiasing-rounded zone is trimmed (`1.5 px + 0.5/tan(interior/2)`, at most 6 px).
   - The corner is rebuilt where the adjacent end tangents meet (within 4 px).
   - Each section is then refitted to end exactly at its rebuilt corners.
   - Hidden corners are never rebuilt; that would let a lower layer poke out.
6. **Fitting.**
   - Straight sections (every point within 0.2 px of the chord) become lines.
   - Sections whose circle fit passes the recognition test become exact circular arcs, in ≤ 90° cubic pieces.
   - Everything else is fitted by Schneider least squares with Newton reparameterisation. Each internal split shares one tangent (G1).
   - Closed loops without corners start from four equal arcs with shared tangents.
7. **Output.**
   - Absolute M/L/C/Z subpaths, even-odd fill.
   - Then VTracer's own 0.01 px quantisation and cleanup passes, as for every mode.

Determinism: the algorithm has no randomness and no data-dependent iteration order. Native and WASM output are byte-identical on all 26 fingerprinted precision cases (EXPORT-REGRESSION). Floating point includes `atan2`, `sin`, `cos` and `tan` in arc construction; cross-host equality is verified by fingerprint, not assumed.

## Versioning and compatibility
- **Preset version.** `presetVersion` stays 1. Existing requests and their outputs are unchanged (byte-identical regression corpus), and `precision` is a new value of an existing field, not a change of meaning.
- **Algorithm version.**
  - `PRECISION_FIT_VERSION = 1` is reported as `metrics.precisionFitVersion` whenever precision produced the geometry.
  - Any change to precision geometry must bump it.
  - The scene's `metadata.params` records `fit.mode = "precision"` and every setting.
- **Scene contract.** Scene version 1 is unchanged: no new primitives, transforms or fields. SVG and PDF export the same validated scene.
- **Resource limits.**
  - `maxPixels` and the anchor budget apply as before.
  - Scratch memory is one label map (4 B/px) plus one layer mask at a time, while VTracer's segmentation memory is unchanged. Measured: corpus peak heap equal to spline. Photographs: PERFORMANCE-REGRESSION.
- **Privacy, CSP, offline.** The new module is engine code (no I/O, no network, no dependencies), and the service worker and CSP are unchanged. Verified in the regression suites.

## Settings, workbench and engineering hooks
- Engine: `FitMode::Precision` in `params.rs`, with validation (stacked only, `simplify` must be 0) and unit tests.
- TypeScript: `FitMode` includes `"precision"`, and `EngineMetrics.precisionFitVersion` is optional.
- Workbench: "Fit: precision" option; `simplify` is disabled for precision; compositing is coupled as above.
- Evaluation only, not used by the app:
  - `vectorize_with_precision_options` and `segment_layers` are `#[doc(hidden)]`.
  - The `Subpixel` / `Smoothing` / `arcs` options exist to reproduce the evaluation. Production always uses `Options::production`.

## Known limits of version 1
These are reported, not hidden; see GEOMETRY-VALIDATION.
- **Curvature uniformity near three-colour junctions** (04, overlapping discs). Lower stacked layers redraw edges owned by higher layers, and blend pixels mix three colours. The target is missed within about 2–6 px of junctions, while the brief's own targets are met. The clean fix (shared junction graph or label-level blend correction) is architectural, for P1.
- **Binary (non-antialiased) edges.** There is no sub-pixel information to recover. The fitter follows the staircase midpoints, giving extra anchors and some tangent breaks. Tier C targets are partly missed.
- **Acute corners and thin bars.** The rebuilt corners of 2–3 px bars and of acute star tips can sit 1.5–2.3 px off, and nearby straight edges can carry slight curvature. Spline fails these fixtures worse.
- **Lower-layer specks.** A speck (≥ 1 source px² at 4× sampling) of a lower stacked layer's colour can show at a junction. This happens on 2 of 32 fixtures, against 3 for spline.
