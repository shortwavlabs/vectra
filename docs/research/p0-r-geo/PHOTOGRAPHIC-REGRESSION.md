# P0-R-GEO Stage F: photographic regression

**Result: PASS.** The approved photographic behaviour is byte-identical. Precision is a new, opt-in fit mode, and every existing configuration produces exactly the same scene, SVG and PDF as before P0-R-GEO.

## Byte-level comparison against the frozen baseline
- **Baseline.** Produced from clean commit `7cdde36` (P0-R head plus the LICENSE commit, before any engine change) in a separate git worktree, with its own build directory.
- **Compared at:**
  - `f51e265` (experiments commit);
  - `a4cf172` (selected implementation, final engine code).
- **Tool.** `crates/vector-engine/examples/regression_corpus.rs` uses only the public API, so the same file runs on both revisions.

| Corpus | Cases | Settings |
|---|---|---|
| 13 procedural fixtures | 78 | B&W, colour, colour + mosaic, limited (6), Old Print, Old Print without paper |
| P0 photographs: Talbot (CC0), Hokusai (public domain), 640 px | 8 | Approved defaults of B&W, colour, limited, Old Print |
| P0-R native-resolution CC0/public-domain photos (12–24 MP): portrait, small-venue concert, stage-light concert, bark texture, street architecture, large portrait; plus the 1280 px derived copy | 28 | Same four defaults, `maxPixels` 50 M |
| **Total** | **114 cases, 326 files** (scene JSON, SVG, PDF 200 mm, or the error text) | |

| Comparison | Identical files |
|---|---|
| `f51e265` vs `7cdde36` | **326 / 326** |
| `a4cf172` vs `7cdde36` | **326 / 326** |

Evidence:
- `artifacts/regression/baseline-7cdde36.sha256` and `a4cf172.sha256` (identical);
- `artifacts/regression/inputs.sha256` (the PNG inputs, converted once from the committed or fetched JPEGs with `sips`).

The eight cases that end in `too_many_primitives` at the baseline end in the identical error now.

The maintainer's private concert photograph was **not** used: the concert images are the CC0 Wikimedia files from P0-R's `tests/fixtures/native-corpus.json`.

## Browser path
- **WASM fingerprint.** The 65-case output digest (13 fixtures × 5 modes, through the WASM build in Node) is `68723671…`. That is unchanged from P0-R, although the WASM binary itself changed (`40b43967…` → `be101bca…`) because it now contains the precision module.
- **Workbench re-run.** Owner bundle v1 re-generated through the workbench (Chromium) with the final build: **14/14 files byte-identical**, including B&W Talbot, limited Hokusai and both Old Print cases (EXPORT-REGRESSION).

## What the approved behaviour is protected against
| Risk named in the brief | Status |
|---|---|
| Rounding off deliberate sharp corners | No change to spline output (byte-identical) |
| Removing small details; regularising distressed shapes | No change to spline output. Precision keeps negative controls within 0.21 px of their irregular truth, with 0 recognised substitutions |
| Artificial circular features in photographs | Spline: none possible (no recognition). Precision on photographs: recognition only fires on sections that fit a circle within 0.08 px RMS |
| Destroying thin rings or holes | Spline unchanged. Precision keeps every ring and hole in the corpus, plus 1 px holes |
| Changing colours | Colour clustering and palette fitting are VTracer's in both modes; spline output is byte-identical |
| Gaps or overlaps at shared boundaries | Spline unchanged. Precision: shared visible edges get bit-identical crossings; 2 of 32 fixtures show a lower-layer speck (spline: 3) |
| Disproportionate complexity; excessive processing overhead | Spline unchanged (PERFORMANCE-REGRESSION). Precision on photographs: 1.4–2× anchors, 1.0–2.4× time, equal peak heap |

Old Print (vector halftone) is untouched: `halftone.rs` is unchanged, and its corpus cases are byte-identical.
