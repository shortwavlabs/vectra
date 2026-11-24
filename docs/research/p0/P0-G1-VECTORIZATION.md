# P0-G1: Browser-based vectorization engine

**Gate status: PASS** for the feasibility scope: Black & White, Full Color, the Limited Color experiment, real-browser execution in three engines, and the fixture corpus.

Open items do not block the gate but are tracked: the IoU target is missed on two synthetic shapes, thin diagonal strokes are lost, and output determinism holds per browser but not across browsers when input comes through browser decoding.

## Objective
Build an isolated Rust vectorization core and a browser-target WASM adapter with an explicit input/output contract, and prove that it works in real browsers on synthetic and licensed fixtures.

## VTracer candidates: research and experiment

**Sources.**
- VTracer repository: https://github.com/visioncortex/vtracer.
- crates.io API (`/api/v1/crates/vtracer`, `/visioncortex`).
- Unpacked published crates: `vtracer-0.6.5.crate`, `visioncortex-0.9.3.crate`.
- The git tag `1.0.0-alpha.4` (commit `2500df7`, 2026-08-29). Master (`82fedd1`, 2026-11-23) has **no** changes under `crates/vtracer/src` relative to that tag.

| Criterion | 0.6.5 (stable, 2025-10-17) | 1.0.0-alpha.4 (2026-08-29) |
|---|---|---|
| Library dependencies | clap 2 and image 0.23 are **non-optional**, plus fastrand and visioncortex 0.8.8 | visioncortex 0.9.3 and flo_curves 0.8 only. No I/O or image decoding; documented as wasm-safe. |
| wasm32 build (our probe crate, wasm-bindgen 0.2.130, `opt-level=s`, LTO) | ✅ 121,967 B; 57 resolved crates | ✅ 138,650 B; 34 resolved crates |
| Binary mode threshold | Hard-coded `x.r < 128`: **red channel only**, fixed | Configurable fixed threshold or Bradley–Roth adaptive, on `(r+g+b)/3` |
| Transparency | Keys `a == 0` pixels only if ≥20 % of pixels on five sampled rows are transparent. Key-colour fallback uses an **unseeded RNG**. | Same keying heuristic, with a deterministic key search |
| Output | `SvgFile` with visioncortex `CompoundPath` plus `translate()` offsets | `VectorDoc` IR: shapes of absolute `MoveTo / LineTo / CubicTo / Close`, in paint order |
| Extensibility | Monolithic `convert()` | Pluggable `Frontend`, `ColorFitter`, `CurveFitter`, `CurvePass`, `Compositing` (stacked or seam-free mosaic), `OptimizerPass`. Fixed palettes; curve simplification. |
| Cancellation and progress | None | `CancelToken` plus progress callback. **Not usable** from a single-threaded worker blocked in WASM (see G2). |
| License | MIT OR Apache-2.0 | MIT OR Apache-2.0. Transitive `flo_curves` is **Apache-2.0 only**; `roots` is BSD-2-Clause. |
| Maturity | Stable, but the 0.6 line is superseded: `cmdapp` and the web demo were removed in 1.0. | **Alpha.** Four alphas between July and August 2026, single maintainer, very active master. The API may change. |

Experiment `experiments/vtracer-compare` (`cargo run --release --locked -- 7`): identical procedural fixtures, each candidate's own SVG rendered by resvg 0.50 and scored against ground truth. Raw data: `artifacts/vtracer-compare.tsv`.

| Fixture | Candidate | Median ms | IoU | Transparent leak | SVG bytes |
|---|---|---|---|---|---|
| circle (bw) | 0.6.5 / 1.0-α4 | 1.03 / 1.17 | 0.9936 / 0.9936 | – | 524 / 463 |
| nested_rings (bw) | 0.6.5 / 1.0-α4 | 1.57 / 1.87 | 0.9753 / 0.9752 | – | 2095 / 1759 |
| thin_strokes (bw) | 0.6.5 / 1.0-α4 | 0.39 / 0.41 | 0.7911 / 0.7911 | – | 481 / 399 |
| transparent_ring (color) | 0.6.5 / 1.0-α4 | 1.44 / 1.26 | 0.9689 / 0.9689 | 0.0142 / 0.0142 | 1219 / 1037 |
| **logo with off-row transparent hole** | 0.6.5 / 1.0-α4 | 1.66 / 1.47 | 0.9807 / 0.9807 | **1.0000 / 1.0000** | 665 / 557 |
| color_blocks | 0.6.5 / 1.0-α4 | 2.50 / 2.38 | 1.0 / 1.0 | 0 / 0 | 831 / 675 |
| noise_speckle (bw) | 0.6.5 / 1.0-α4 | 0.52 / 0.66 | 0.9770 / 0.9770 | – | 1130 / 842 |

What the experiment shows:
- Geometry and speed are equivalent on these inputs.
- Both candidates were byte-deterministic across two processes.
- **Both fill a transparent hole** whenever it does not intersect the sampled keying rows (leak 1.0). That confirmed the pre-implementation finding that alpha policy has to be owned by Vectra.

**Decision.** Use `vtracer =1.0.0-alpha.4` and `visioncortex =0.9.3`, pinned exactly, behind a thin adapter (`crates/vector-engine/src/trace.rs`). No VTracer or visioncortex type crosses that module's boundary.

**Rationale.**
- Its public stage API lets Vectra supply its own segmentation and alpha/luminance policy.
- The IR maps one-to-one onto the canonical scene.
- It has no CLI or decoder dependencies.
- It has deterministic keying, plus mosaic compositing for seam-free limited palettes.

**This is a deliberate deviation from the RESEARCH baseline**, which named "stable release" as candidate A. It is not an automatic "latest" choice.

**Risk and mitigation.** The alpha API may change. The pin is exact, and the adapter is about 200 lines. Fallback: 0.6.5 is not viable as-is (red-channel threshold, alpha keying), but visioncortex 0.8.x/0.9.x alone, plus our frontends and a curve fitter, would be. Under ROADMAP rules that would be a reported substitution.

Not done in P0: candidate C (an independent contour extractor), and Potrace as an external comparator (GPL, not bundled). Both are recommended for P1 quality work on line art.

## Implementation (crates/vector-engine)
- **Input contract.** `RgbaImage::new(&[u8], w, h, max_pixels)`:
  - Straight RGBA8, row-major.
  - Width and height between 1 and 16,384.
  - Pixel count ≤ min(request, hard ceiling of 50 MP).
  - Buffer length checked with checked u64 arithmetic.
  - Typed `EngineError` with stable codes: `invalid_dimensions`, `buffer_length_mismatch`, `image_too_large`, `invalid_params`, `too_many_primitives`, `tracer_failure`, `invalid_scene`, `invalid_export_options`.
- **Request.** `TraceRequest { presetVersion: 1, seed: u32, maxPixels, maxAnchors, settings }`, deserialised with `deny_unknown_fields` and validated range by range. There is no silent clamping.
- **Output.** `{ scene, metrics, warnings }`:
  - Metrics: per-stage timings from a caller-supplied clock (`performance.now` in WASM), paths, subpaths, anchors, lines, cubics, palette size and dot count.
  - Warnings: `alpha_binarized`, `palette_reduced`, `empty_result`.
- **Luminance (all presets).** Linearise sRGB, take Rec.709 Y, re-encode with the sRGB curve to 0–255.
  - Neutral greys map to themselves, so 128 is mid-grey (unit-tested for all 256 greys).
  - Integer-only after a 256-entry LUT, so the result is independent of platform `powf`.
- **Black & White.**
  - A pixel is ink iff `alpha ≥ alphaThreshold` and `(luma < threshold) XOR invert`.
  - Speckle removal works both ways: enclosed background holes smaller than the area are filled (8-connected background), and ink components smaller than it are dropped (4-connected ink).
  - Then VTracer stacked compositing and spline fitting.
  - Paths are emitted with an **even-odd** fill. A connected component's holes never contain islands, so even-odd is always correct here.
- **Full Color.**
  - Pixels below the alpha threshold are re-keyed to a colour that provably does not occur among the opaque pixels (24-bit occupancy bitset, deterministic permutation order).
  - All other pixels become opaque.
  - visioncortex hierarchical clustering discards the key. Compositing is VTracer stacked (default) or mosaic.
- **Limited Color.**
  - Seeded k-means++ in OKLab over at most 65,536 stride-sampled opaque pixels, up to 24 Lloyd iterations, sorted dark→light. An explicit palette of 2–32 colours can be used instead.
  - Pixels are mapped to the nearest palette colour (24-bit memo table, 16 MiB), clustered at full precision, then snapped with VTracer's `FixedPalette` and merged with `MergeAdjacent`.
  - The engine **errors** if any output colour falls outside the palette.
- **Path simplification.** `fit.simplify` (Schneider re-fit tolerance in px), VTracer's `CleanupPass`, and 2-decimal coordinate quantisation.

## Tests and results
`cargo test --workspace --locked`: **26 passed** (11 unit, 15 integration; the 15th test covers translucent paint export, see G3). Raw metrics: `artifacts/engine-test-metrics.txt`.

| Fixture | Result |
|---|---|
| circle | IoU 0.9936; 1 path, 1 subpath, 8 anchors |
| rectangles (sharp corners) | IoU 0.9930; 2 subpaths |
| sharp_corners (36° star tips) | IoU **0.9771**, below the 0.98 target. Tips are rounded by spline fitting. |
| nested_rings | IoU **0.9752**, below 0.98. Topology is exact: 3 paths, 5 subpaths, 2 holes, with probe points in both holes unpainted. |
| checkerboard | IoU 1.0000; 128 paths |
| thin_strokes | IoU 0.9834. Every horizontal and vertical stroke of 1, 2, 3 and 4 px survives. **The ~1.4 px 45° diagonal is lost.** It is only 8-connected, so 4-connected ink splits it into single pixels the fitter drops. This happens even with speckle 0, and in polygon mode. |
| noise | speckle 16 → 1 path, 1 subpath; IoU 0.987. Specks and pin-holes are removed except where they touch the square. Speckle 0 → 52 paths and 61 subpaths: VTracer's fitters also drop isolated ~1 px components. |
| transparent_ring, logo_transparent_hole (bw, color, mosaic, limited) | Transparent leak ≤ 0.0087 (it was 1.0 with stock VTracer keying); IoU ≥ 0.9823 |
| adjacent_colors (color stacked, mosaic, limited k=5) | 5 paths; exact colours; 0.00 % mismatched pixels |
| color_gradient (limited k=6 and an explicit 3-colour palette) | Palette respected; every fill references a palette id |
| Determinism | All 13 fixtures × 5 modes, run twice: identical scene JSON and SVG |
| Malformed input | Typed errors; no panic |

**Real browsers** (`tests/browser/workbench.spec.ts`, production build, Playwright 1.65.1: Chromium 159 headless shell, Firefox 159.0, WebKit 27.2):
- All 13 fixture/mode cases trace.
- The SVG parses with the browser's DOMParser, and its elements and attributes stay inside the allowlist.
- Raw data: `artifacts/browser/*-fixtures.json`.

Selected wasm-call times in ms (Chromium / Firefox / WebKit):

| Case | Chromium | Firefox | WebKit |
|---|---|---|---|
| circle (bw) | 13 | 7 | 12 |
| hokusai 640×430 (limited k=8) | 180 | 213 | 187 |
| talbot 640×526 (color) | 262 | 246 | 221 |

**Cross-browser determinism finding.**
- PNG fixtures give **identical** path, anchor and byte counts in all three engines.
- JPEG fixtures differ in WebKit. For example, Hokusai limited gives 1,458 paths in WebKit versus 1,613 in Chromium and Firefox.
- Hashing the decoded RGBA (`artifacts/browser-decode-hashes.txt`) shows why:
  - WebKit's JPEG decode differs from Chromium/Firefox in 18 % of bytes (max Δ 25).
  - Semi-transparent PNG pixels lose RGB precision through the canvas's premultiplied storage: Firefox max Δ 8, WebKit max Δ 223 at near-zero alpha.
- The engine is deterministic for identical RGBA; the browser's decoding is not.
- **Recommendation:** evaluate in-WASM PNG/JPEG decoding in P1 (VTracer's own Node package does this with `image`) if cross-browser reproducibility or alpha fidelity matters.

## Known limitations
- The IoU target of 0.98 is missed on the star and the rings (0.977 and 0.975). Thin 20 px rings and acute tips are perimeter-dominated. Edge-deviation metrics are recommended over IoU for P1.
- The 4-connected ink model loses 1-px diagonal strokes. Options: an 8-connected ink mode, or the deferred centerline/line-art preset.
- Partial transparency is binarised at the alpha threshold, and a warning is emitted. Gradients in alpha are not preserved.
- Full Color on photographs produces many paths. For example, the 640×526 Talbot photograph gives 2,241 paths, 33k anchors and 1.2 MB of SVG.
- Phase timings inside the vectorize call exclude JSON/SVG work, which is reported separately.
- No progress percentages. The UI shows an explicit indeterminate status (see G2).

**Native vs browser WASM.** Using the same PNG input decoded identically, the browser-built WASM and the native build produce **byte-identical SVG and PDF**: `nested_rings` in all three engines, and `transparent_ring` in Firefox. Chromium and WebKit decode the semi-transparent pixels differently (above), so their `transparent_ring` output differs.

## Exact versions
vtracer 1.0.0-alpha.4, visioncortex 0.9.3, flo_curves 0.8.1 and 0.3.1, serde 1.0.229, serde_json 1.0.154. Dev: resvg 0.50.0, png 0.18.1. Comparison experiment: vtracer 0.6.5 (visioncortex 0.8.8) in its own lockfile.

## Environment
As in P0-G0: Apple M5 Max, macOS 26.6.2, Rust 1.96.0, wasm-bindgen 0.2.130. Browsers: Playwright 1.65.1 Chromium 159.0.8154.6 (headless shell), Firefox 159.0, WebKit 27.2.

## Commands executed
`cargo test --workspace --locked`; `cargo test --release -p vector-engine --test engine -- --nocapture`; `cargo run --release --locked -- 7` in `experiments/vtracer-compare` (twice, for cross-process determinism); `cargo build --release --target wasm32-unknown-unknown` plus `wasm-bindgen --target web` for both probe crates; `pnpm exec playwright test tests/browser/workbench.spec.ts`; the decode-hash probe recorded in `artifacts/browser-decode-hashes.txt`.

## Relevant artifacts
`artifacts/vtracer-compare.tsv`, `artifacts/engine-test-metrics.txt`, `artifacts/browser/*-fixtures.json`, `artifacts/browser-decode-hashes.txt`, `tests/fixtures/MANIFEST.json`.

## Unresolved questions
- Is an alpha dependency acceptable to the maintainer until VTracer 1.0 is stable?
- Should cross-browser byte-identical output be a product requirement? If so, decoding has to move into WASM.
- What quality metric should gate P1: edge deviation, or IoU with perimeter normalisation?

## Reproduction
```text
cargo test --workspace --locked
cargo test --release -p vector-engine --test engine -- --nocapture   # prints the metrics above
cargo run --release --locked --manifest-path experiments/vtracer-compare/Cargo.toml -- 7
pnpm run build && pnpm exec playwright test tests/browser/workbench.spec.ts
```
