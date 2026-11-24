# Old Print feasibility spike (P0)

**Status: PASS (feasibility).** The canonical scene represents procedural vector halftones, and tone maps to dot area as designed. Exports are raster-free.

This is **not** the P2 preset: there is no distressed edge, contour ink, registration or multi-ink separation yet.

## Question
Can the canonical scene carry Old Print-style artwork as real vector geometry, deterministically, at usable sizes? The pieces:
- variable dot size on a rotated grid;
- ink and paper colours;
- tone mapping;
- transparency;
- clipping.

## Implementation (`crates/vector-engine/src/halftone.rs`)
- **Tone.**
  - Darkness d = 1 − L/255, where L is the shared sRGB-encoded Rec.709 luminance.
  - Contrast around 0.5, then the gamma curve d^γ. γ > 1 lightens mid-tones.
  - Multiplied by alpha/255, so transparent areas get no ink.
  - Implemented as a 256-entry LUT.
- **Grid.**
  - Square lattice of pitch *p* (px), rotated by the screen angle about the image centre.
  - Each lattice point samples mean coverage over its p×p footprint (at most 9×9 samples, in-image only).
- **Area mapping.**
  - Coverage c is the fraction of the cell that should be inked.
  - For c ≤ π/4, the radius is r = p·√(c/π).
  - Above π/4, circles must overlap their neighbours. r is then found by inverting the exact circle-in-square intersection area (bisection-tabulated, 1,025 entries), reaching full coverage at r = p/√2.
  - This removes the **π/4 ≈ 78.5 % density ceiling** that non-overlapping dots would impose.
- **Geometry.**
  - Each dot is a circle made of 4 cubic Béziers (κ = 0.5523), rounded to 0.01 px.
  - Every dot has the same winding, so the **nonzero** fill rule unions overlaps.
  - Options: one compound path per ink (`compound`), or one path per dot (`perDot`).
  - The group has a clip rectangle at the artwork bounds, so edge dots are clipped, not dropped.
- **Paper.** Optional opaque `background` rect. `null` keeps the output transparent. Default ink is `#1d1d1b`, default paper `#f3ead8` (warm ivory).
- **Determinism.** Pure function of input and settings; the seed is recorded but unused. Identical output across runs is tested.
- **Guard.** If dots × 5 anchors would exceed `maxAnchors`, the engine returns `too_many_primitives` instead of degrading.

## Results
| Check | Result |
|---|---|
| Tone → area on a 512×128 grey ramp (pitch 8, 45°), rendered with resvg | Max band error **0.025** (2.5 % coverage) across 14 bands; target < 0.05 |
| Overlap handling | Darkest band coverage: nonzero 730,297 vs **even-odd 613,800** (−16 %). Even-odd punches holes where dots overlap. The fill rule matters, and the scene expresses it. |
| Transparent input (red ring on alpha), paper off | Painted outside the opaque truth: 2.1 %. Dots straddle the alpha edge; clipping to the alpha shape is not implemented. |
| Paper on / off | Background `#f3ead8` present / absent in the scene, SVG and PDF |
| Primitive guard | 2000×2000 black image at pitch 2 → `too_many_primitives` |
| SVG/PDF vector-only | All halftone PDFs: 0 images, no XObjects or fonts (qpdf/pdfimages). Poppler vs resvg block diff ≤ 0.93/255 at 300 dpi. |
| Licensed photo (Talbot 640×526, pitch 8) in browsers | 5,463 dots, 27k anchors, 956 KB SVG, about 25 ms in WASM. Identical in Chromium and Firefox; +43 bytes in WebKit (JPEG decode). |

**Size and performance.**

Native samples, 256×256 and 512×128 fixtures, pitch 8, with paper: SVG 41–187 KB; PDF 12.6–56 KB (Flate).

Browser benchmark, constant dot count of about 16k (BENCHMARKS.md):

| | |
|---|---|
| Anchors | 79–80k |
| SVG | 2.8–3.2 MB |
| PDF | 0.83–0.96 MB |
| Synthesis time | 64–244 ms |

**Size, compound vs per-dot** (measured on the 512×128 ramp, pitch 8, 1,112 dots):

| Variant | SVG | Bytes per dot | PDF |
|---|---|---|---|
| Compound (default) | 185,495 B | 166.8 | 55,972 B |
| Per-dot | 252,155 B (+36 %) | 226.8 | 56,470 B (+0.9 %; Flate absorbs the repeated operators) |

Per-dot also multiplies DOM and editor objects by the dot count. Both remain vector; compound is the default.

## Architectural implications for P2/P3 presets
- **Old Print, Vintage Newspaper.** Need contour ink (traced bw paths) layered over dots. The scene already supports multiple groups and paths with clip rects.
  - Clipping dots to an arbitrary ink or alpha **shape** needs either general clip paths in the scene, or boolean geometry (dot ∩ region) in the engine.
  - Recommendation: add `clip: Path` (nonzero) to the scene in P2. It maps to SVG `<clipPath><path/>` and PDF `W n` with path operators, both already used for rects.
- **Screen Print.**
  - Several inks = several groups, each with its own palette entry and angle.
  - A registration offset is a per-group translation. Keep coordinates absolute, so bake it in rather than adding transforms.
  - Overprint or multiply blending is out of scope for RGB PDF.
- **Woodcut, Engraving.**
  - Need direction-aware strokes or variable-width filled ribbons clipped to tonal bands.
  - Fills of offset curves stay within M/L/C/Z.
  - Stroke support already exists in the scene and both serializers, but strokes do not scale like fills in all print workflows. Prefer filled outlines.
- **Distress.** Seeded perturbation of contour vertices must preserve winding and minimum feature size. The SplitMix64 PRNG and `seed` plumbing are in place.
- **Scale.** At 300 dpi on A3, a pitch-equivalent halftone is about 10⁵–10⁶ dots. That calls for:
  - lower SVG precision (2 → 1 decimal; savings not measured);
  - possibly SVG `<use>` of a unit dot. That is not allowed by the current allowlist, would need allowlist and PDF Form XObject reconsideration, and would trade editability.
  - an explicit primitive-budget UI.
- **Partial transparency.** Coverage already folds in alpha, so semi-transparent sources work for halftone, unlike tracing modes.

## Known limitations
- Circle dots only: no line, ellipse or custom dot shapes; no stochastic or FM screens.
- Coverage sampling is axis-aligned over the footprint, not over the rotated cell.
- No contour ink layer, edge distress, multiple inks or registration.
- Not tested on photographs at print resolution beyond the benchmark.

## Reproduction
`cargo test --release -p vector-engine --test engine halftone -- --nocapture`; workbench mode "Old Print halftone (experiment)".
