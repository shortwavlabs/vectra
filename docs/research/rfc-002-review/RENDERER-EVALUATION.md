# RFC-002 review R02 — renderer bake-off

**Gate result: PASS.** The rendering direction is decided with evidence. Lower-end hardware and real Safari are NOT RUN, and are recorded as conditions.

**Recommendation: one production renderer, retained Canvas 2D** (the RFC's first candidate, confirmed), **with four mandatory parts** that the RFC does not yet specify:
1. **Linear path construction.** Build Path2D from SVG path data, or from chunked `addPath`. Incremental `moveTo`/`bezierCurveTo` is **quadratic in Chromium 159**: 16.9 s for one 250k-anchor path.
2. **A display-only raster cache for camera gestures.** It blits the last exact frame during pan and zoom; an exact redraw follows when the gesture ends.
   - With it, Canvas pans and zooms at **p50 17 ms / p95 17–22 ms in all three engines on all five cached workloads (97k–1M anchors)**, with 0–3.7 % of frames over 50 ms.
   - Without it, Firefox reached 783 ms per frame at 1M anchors.
   - The cache is never authoritative: hit testing, editing and export use the vector data.
3. **An OffscreenCanvas render worker as the host.** Path construction and exact redraws run off the main thread.
   - Measured main-thread maximum gaps of **17–24 ms during load and pan for all four tested workloads (304k–1M anchors) in all three engines**, against 82–1,313 ms for the same loads on the main thread.
   - Time slicing cannot do this, because a single compound-path `fill()` costs 174–251 ms (WebKit, 977k-anchor halftone).
4. **A renderer-independent CPU hit-test service.** Uniform grid, plus subpath-level indexing for compound paths, plus a band index for huge subpaths: warm p95 ≤ 0.01 ms everywhere, including inside holes. The subpath index is required: without it the 977k halftone takes 12.8 ms warm p95. No R-tree dependency: a packed STR tree is no faster and builds 2–8× slower.

**Rejected**, with revisit conditions in §9:
- **SVG DOM.** Degrades with path count in every engine, zooms slowly in Firefox, and has the largest DOM.
- **The P0 SVG image.** Slowest load (0.45–1.9 s in Firefox; the 977k halftone timed out after 15 min), and no editing path.
- **WebGL (narrow stencil-then-cover).** Correct (0 geometry errors) and the fastest first visible everywhere, but draw-call-bound: 233–480 ms per frame at 167k paths. Making it competitive needs a real tessellator plus batching, strokes, clips and context-loss handling: a second engine-sized subsystem, which the display cache makes unnecessary for P1.


## 1. Method
**Candidates.** One file each in `experiments/rfc-002-review/bench/renderers.mjs`, behind one minimal port (load, draw, camera, select, object transform, visibility, style colour, invalidate, resize, release):
- **SVG image (P0 baseline).** The engine's SVG text as a Blob `<img>`, panned and zoomed with CSS transforms.
- **SVG DOM.** One `<path>` per path in `<g>` groups with `clipPath`, and a camera `transform` on the root group.
- **Canvas 2D (retained).** One `Path2D` per path built from **SVG path data** (see §3), viewport culling by path bounds, group clip rects, and a selection outline overlay.
- **WebGL2 stencil-then-cover (narrow experiment).** Cubics flattened at 0.05 document px, triangle fans into the stencil (INVERT for evenodd; INCR/DECR_WRAP for nonzero), cover by bounding quad, MSAA (`antialias: true`), scissor for rect clips. Two draw calls per path; strokes are out of scope.

**Shared services.**
- **Hit testing.** The renderer-independent hit-test service (`hit.mjs`) is used by all candidates:
  - a uniform grid or packed STR tree over path bounds, or over **subpath** bounds for paths with more than 8 subpaths;
  - a horizontal band index over flattened edges for subpaths above 2,048 points;
  - exact nonzero/evenodd winding on cubics flattened at 0.05 document px;
  - clip-aware and visibility-aware.
- **Native hit test (SVG DOM only).** `elementFromPoint`, measured for comparison.

**Input.** Every candidate receives the validated GeometryPacket already on the main thread (post-transport); the P0 baseline receives the engine's SVG text. Validation, preparation, index build and the first draw all fall inside the measured windows; nothing is precomputed.

**Workloads.**
- Real P0 scenes (hashes as in R01):
  - B&W concert: `concert-small-venue-bw`, 17k anchors;
  - dense halftones as single compound paths: `concert-small-venue-1280-halftone` (97k anchors, 19k subpaths) and `architecture-street-halftone` (977k anchors, 195k subpaths);
  - B&W architecture: `architecture-street-bw`, 129k;
  - one huge subpath: `texture-bark-bw`, 140k anchors, with one 129k-anchor path;
  - limited colour: `architecture-street-limited` (304k) and `portrait-face-limited` (670k);
  - full colour with many paths and overlapping stacked regions: `portrait-large-color`, 430k anchors, 30k paths.
- Synthetic: many independent paths with ring holes and translucent overlaps, at 250k, 500k and 1M anchors (42k, 83k and 167k paths).
- Correctness:
  - a synthetic fixture: nonzero vs evenodd self-intersection, compound holes in all three winding configurations, translucent overlaps in paint order, a rect clip, cubics, a 1 px bar, tiny dots;
  - four precision scenes (circles, rings, a transparent hole) from `export_samples`.

**Environment.**
- Apple M5 Max (18 cores, 128 GB), macOS 26.6.2.
- Playwright 1.65.1, **headed**. Chromium 159.0.8154.6 runs ANGLE on Metal (M5 Max). Headless Chromium uses SwiftShader, so it was not used for timings (`artifacts/renderer/environment-probe.json`). Firefox 159.0; WebKit 27.2 (Playwright WebKit is **not Safari**).
- Viewport 1280×800 CSS at **DPR 2** (2560×1600 device px); rAF at 60 Hz.
- **Unrelated background load** of 12–14 `ngspice` processes, load average 12.9–16.4 on 18 cores, recorded per step (`timing-environment.txt`).
- The lower-end device was not available: **NOT RUN**.

**Protocol.**
- **Repetitions.** For each (engine, renderer, scene), a fresh browser context: rep 0 is **cold** (fresh page, first build), and reps 1–5 are **warm**. Each warm rep releases the previous scene and rebuilds from a fresh packet copy, so it also measures **scene replacement**.
- **Interaction suite per warm rep:**
  - 30-frame series for pan, zoom (×1.04 per frame), object translation and object scaling, each capped at 5 s, with redraw every frame;
  - 300 random hit tests;
  - discrete actions: selection with highlight, layer visibility toggle, palette change on the most-used style, resize, and cache invalidation (rebuild one path).
- **Frame metric.** The interval between consecutive requestAnimationFrame callbacks while every frame redraws, reported as p50, p95 and max, with the count of frames over 50 ms.
  - Limit: browsers may raster asynchronously after the frame (Chromium raster runs in the GPU process).
  - Two cross-checks cover that limit. **Sync redraw:** one full redraw plus a 1-pixel readback, which blocks until raster completes (Canvas, WebGL). **Traced presentation:** compositor `DrawFrame` events counted against rAF callbacks during a 120-frame pan (Chromium, §6).
- **First visible.** From "packet on the main thread" to two animation frames after the first draw, which is the same proxy P0 used for `previewMs`. The main-thread maximum frame gap in the same window is reported as load blocking.
- **Discrete latency.** Aligned to a frame start: the JS work, then two frames. This is vsync-quantized, so ≈ 33 ms means "next frame".
- **Hit-test timing.** Per query: the first call (cold; includes lazy flattening of that path) and a repeated loop of at least 2 ms (warm). This compensates for the 1 ms clocks of Firefox and WebKit.
- **Memory.** Chromium `performance.memory.usedJSHeapSize` (JS heap only; Path2D and DOM internals are not included), canvas backing-store bytes, and WebGL vertex and index bytes plus a framebuffer estimate. GPU memory is not observable from the page.
- **Correctness.** Screenshots of the stage at DPR 1 and zooms 1×, 2× and 4×, compared against an **independent rasterizer**: resvg/tiny-skia through the existing `render_compare` example, with no browser involved.
  - Differences are split into an antialiasing band (reference 3×3 neighbourhood range > 24, dilated 1 px) and **geometry errors** (interior pixels differing by more than 48).
  - Fixed hit-test checks include points inside holes and evenodd centres, and one inside a disc but outside its clip.

Raw data:
- `artifacts/renderer/bench-{chromium,firefox,webkit}.json`;
- `correctness-runs.json`, `correctness-compare.json`;
- `path2d-scaling.json`, `rastercheck.json`, `framecheck.json`, `index-bench.json`;
- `environment-probe.json`, `timing-environment.txt`.

Tables are generated by `summarize.py`, not transcribed.


## 2. Correctness
All 72 renders (3 engines × 4 renderers × 6 scene/zoom cases) have **0 geometry-error pixels** against the independent resvg reference. Differences sit in the antialiasing band, at most 0.27 % of pixels differing by more than 32.
- Fixed hit checks pass in all engines and renderers: evenodd centre empty; ring holes for evenodd, nonzero same-direction (filled) and nonzero reversed (empty); topmost of three translucent discs; inside disc but outside clip → miss.
- The JS exact hit test agreed with the browser's `isPointInPath` on 300/300 random points in every Canvas run.
- The narrow WebGL flattening (0.05 document px) showed no geometry error at 4× zoom. A production WebGL renderer would still need zoom-dependent tessellation.

### Correctness against the independent resvg reference

| Scene @ zoom | Renders (engines × renderers) | Geometry-error px (max over renders) | Max % px > 32 (AA band) |
|---|---|---|---|
| antialiased_discs-color-precision @ 4× | 12 | 0 | 0.096 |
| logo_transparent_hole-color-precision @ 4× | 12 | 0 | 0.01 |
| nested_rings-color-precision @ 4× | 12 | 0 | 0.274 |
| synthetic-correctness @ 1× | 12 | 0 | 0.179 |
| synthetic-correctness @ 2× | 12 | 0 | 0.101 |
| transparent_ring-color-precision @ 4× | 12 | 0 | 0.123 |



## 3. Path construction
`artifacts/renderer/path2d-scaling.json`. Single compound path with N cubic rings, built via incremental API, via `new Path2D(pathData)`, or via `addPath`:

| Anchors in one path | Chromium incremental | Chromium path data | Chromium addPath | Firefox incremental | WebKit incremental |
|---|---|---|---|---|---|
| 25k | 170 ms | 2.9 ms | 0.9 ms | 1 ms | 1 ms |
| 125k | 4,235 ms | 14.8 ms | 4.1 ms | 4 ms | 5 ms |
| 250k | **16,936 ms** | 30.5 ms | 8.0 ms | 7 ms | 9 ms |

## 4. Full matrix: load, interaction, hit test, latency
Viewport 1280×800 CSS, DPR 2 (2560×1600 device px), headed. Load = cold (rep 0) and warm median (reps 1–5); interactions = median over 5 warm reps of each rep's p50/p95/max frame interval (30 frames, capped at 5 s); hit = warm per-query p95 (ms) from 300 random points per rep.

| Engine | Renderer | Scene | First visible cold / warm ms | Load max gap ms | Prepare ms | Index ms | Pan p50/p95/max | Zoom p50/p95/max | Translate p95 | >50 ms frames (pan+zoom) | Sync redraw p50 ms | Hit p95 ms | Select / palette / visibility visible ms | JS heap MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chromium | canvas | concert-small-venue-bw | 18 / 33 | 17 | 5 | 1 | 16.7/18.6/18.6 | 16.7/17.4/18.5 | 18.6 | 0/300 | 6.1 | 0.0025 | 20 / 33 / 33 | 20 |
| chromium | svgdom | concert-small-venue-bw | 27 / 33 | 18 | 4 | 1 | 16.7/18.5/18.6 | 16.7/18.5/18.6 | 18.6 | 0/300 | — | 0.0025 | 30 / 33 / 33 | 18 |
| chromium | svgimg | concert-small-venue-bw | 25 / 33 | 17 | 6 | 1 | 16.7/16.7/16.8 | 16.7/16.8/16.8 | — | 0/300 | — | 0.0025 | — / — / — | 12 |
| chromium | webgl | concert-small-venue-bw | 26 / 33 | 17 | 3 | 1 | 16.7/17.8/18.5 | 16.7/18.5/18.5 | 18.5 | 0/300 | 2.7 | 0.0025 | 25 / 33 / 33 | 17 |
| chromium | canvas | concert-small-venue-1280-halftone | 44 / 33 | 19 | 22 | 5 | 16.7/16.8/18.6 | 16.7/16.7/16.8 | 18.7 | 0/300 | 79.6 | 0.0005 | 19 / 33 / 33 | 46 |
| chromium | svgdom | concert-small-venue-1280-halftone | 45 / 33 | 19 | 16 | 8 | 16.7/18.6/18.7 | 16.7/18.6/18.7 | 16.8 | 0/300 | — | 0.0005 | 28 / 33 / 33 | 44 |
| chromium | svgimg | concert-small-venue-1280-halftone | 42 / 33 | 17 | 26 | 4 | 16.7/16.7/16.8 | 16.7/16.8/16.8 | — | 0/300 | — | 0.0005 | — / — / — | 47 |
| chromium | webgl | concert-small-venue-1280-halftone | 40 / 50 | 33 | 24 | 5 | 16.7/16.8/16.8 | 16.7/17.2/18.7 | 16.8 | 0/300 | 2.4 | 0.0005 | 30 / 33 / 33 | 128 |
| chromium | canvas | architecture-street-bw | 59 / 49 | 33 | 36 | 4 | 16.7/16.8/17 | 16.7/16.8/16.8 | 18.6 | 0/300 | 37.6 | 0.0021 | 22 / 33 / 33 | 32 |
| chromium | svgdom | architecture-street-bw | 69 / 49 | 32 | 28 | 7 | 16.7/16.8/18.6 | 16.7/16.8/18.7 | 17.7 | 0/300 | — | 0.0020 | 24 / 33 / 33 | 34 |
| chromium | svgimg | architecture-street-bw | 75 / 56 | 33 | 48 | 8 | 16.7/16.7/16.8 | 16.7/16.8/16.8 | — | 0/300 | — | 0.0021 | — / — / — | 42 |
| chromium | webgl | architecture-street-bw | 40 / 33 | 17 | 16 | 4 | 16.7/17/18.6 | 16.7/16.8/18.6 | 16.8 | 0/300 | 15.1 | 0.0021 | 23 / 33 / 33 | 94 |
| chromium | canvas | texture-bark-bw | 69 / 64 | 47 | 44 | 5 | 16.7/16.8/17.2 | 16.7/16.8/16.8 | 18.7 | 0/300 | 39.4 | 0.0015 | 29 / 33 / 33 | 49 |
| chromium | svgdom | texture-bark-bw | 66 / 49 | 33 | 34 | 5 | 16.7/16.8/17.7 | 16.7/16.8/18.7 | 33.4 | 0/300 | — | 0.0015 | 26 / 33 / 33 | 37 |
| chromium | svgimg | texture-bark-bw | 71 / 42 | 17 | 38 | 4 | 16.7/16.8/18.3 | 16.7/16.8/18.6 | — | 0/300 | — | 0.0015 | — / — / — | 44 |
| chromium | webgl | texture-bark-bw | 40 / 33 | 19 | 16 | 5 | 16.7/18.5/18.7 | 16.7/17.9/18.6 | 18.6 | 0/300 | 4.5 | 0.0015 | 19 / 33 / 33 | 106 |
| chromium | canvas | architecture-street-limited | 109 / 99 | 82 | 77 | 4 | 16.7/16.8/16.8 | 16.7/16.7/16.8 | 16.8 | 0/300 | 70.9 | 0.0042 | 25 / 35 / 33 | 79 |
| chromium | svgdom | architecture-street-limited | 145 / 99 | 82 | 63 | 5 | 16.7/16.8/18.6 | 16.7/16.8/18.6 | 18.6 | 0/300 | — | 0.0045 | 24 / 33 / 33 | 68 |
| chromium | svgimg | architecture-street-limited | 168 / 117 | 67 | 98 | 6 | 16.7/33.4/33.4 | 16.7/33.4/33.4 | — | 0/300 | — | 0.0046 | — / — / — | 70 |
| chromium | webgl | architecture-street-limited | 71 / 81 | 64 | 36 | 7 | 16.7/16.8/16.8 | 16.7/16.8/17 | 16.8 | 0/300 | 29.1 | 0.0049 | 29 / 33 / 33 | 190 |
| chromium | canvas | synthetic-many-250k | 113 / 100 | 82 | 66 | 6 | 16.7/33.3/33.4 | 16.7/16.7/16.8 | 33.4 | 0/300 | 82.8 | 0.0007 | 21 / 32 / 33 | 50 |
| chromium | svgdom | synthetic-many-250k | 202 / 149 | 132 | 73 | 7 | 33.3/66.6/66.7 | 16.7/33.4/50 | 16.8 | 14/300 | — | 0.0007 | 30 / 32 / 33 | 52 |
| chromium | svgimg | synthetic-many-250k | 291 / 235 | 200 | 164 | 5 | 66.6/83.3/83.4 | 64.6/66.7/66.8 | — | 176/300 | — | 0.0007 | — / — / — | 61 |
| chromium | webgl | synthetic-many-250k | 172 / 166 | 149 | 86 | 7 | 50.1/66.7/66.7 | 33.2/50.1/66.7 | 66.8 | 97/300 | 74.8 | 0.0007 | 49 / 67 / 67 | 281 |
| chromium | canvas | portrait-large-color | 191 / 182 | 165 | 129 | 6 | 33.3/33.4/49.9 | 16.7/33.3/33.4 | 33.5 | 0/300 | 91.9 | 0.0014 | 33 / 39 / 33 | 79 |
| chromium | svgdom | portrait-large-color | 252 / 200 | 181 | 118 | 6 | 35/50.1/51.5 | 16.7/33.4/50 | 50.1 | 16/300 | — | 0.0013 | 22 / 30 / 33 | 82 |
| chromium | svgimg | portrait-large-color | 320 / 270 | 218 | 210 | 5 | 66.7/100/100 | 50/83.3/83.3 | — | 192/300 | — | 0.0013 | — / — / — | 93 |
| chromium | webgl | portrait-large-color | 122 / 115 | 98 | 56 | 8 | 50/50.1/50.7 | 16.7/33.4/33.4 | 50.1 | 23/300 | 53.6 | 0.0016 | 36 / 54 / 33 | 252 |
| chromium | canvas | synthetic-many-500k | 212 / 231 | 214 | 128 | 11 | 66.5/66.7/66.8 | 16.7/66.7/66.7 | 66.8 | 92/300 | 156 | 0.0008 | 77 / 67 / 67 | 101 |
| chromium | svgdom | synthetic-many-500k | 361 / 265 | 248 | 138 | 8 | 100/100.1/116.6 | 33.4/100/100.1 | 33.3 | 201/300 | — | 0.0009 | 34 / 109 / 83 | 175 |
| chromium | svgimg | synthetic-many-500k | 590 / 515 | 467 | 386 | 10 | 200/200.1/200.1 | 183.3/200.1/200.1 | — | 265/265 (truncated) | — | 0.0009 | — / — / — | 122 |
| chromium | webgl | synthetic-many-500k | 306 / 315 | 299 | 178 | 13 | 116.7/133.3/133.4 | 50/116.7/116.7 | 133.4 | 218/300 | 148 | 0.0009 | 96 / 130 / 117 | 420 |
| chromium | canvas | portrait-face-limited | 247 / 230 | 214 | 174 | 14 | 33.3/33.4/50 | 16.7/33.4/50 | 49.9 | 0/300 | 159.9 | 0.0040 | 40 / 49 / 33 | 152 |
| chromium | svgdom | portrait-face-limited | 300 / 213 | 196 | 136 | 15 | 50/66.7/66.7 | 33.3/50.1/66.6 | 66.7 | 52/300 | — | 0.0041 | 19 / 37 / 50 | 151 |
| chromium | svgimg | portrait-face-limited | 350 / 274 | 200 | 229 | 15 | 83.3/83.5/100 | 67.5/100/100.1 | — | 286/300 | — | 0.0039 | — / — / — | 153 |
| chromium | webgl | portrait-face-limited | 145 / 130 | 113 | 78 | 19 | 33.3/33.4/33.4 | 16.7/33.4/33.4 | 33.4 | 0/300 | 45.3 | 0.0041 | 20 / 33 / 33 | 281 |
| chromium | canvas | architecture-street-halftone | 377 / 346 | 329 | 310 | 36 | 16.7/16.7/16.8 | 16.7/16.7/16.8 | 16.8 | 0/300 | 612 | 0.0004 | 22 / 33 / 33 | 678 |
| chromium | svgdom | architecture-street-halftone | 398 / 296 | 279 | 260 | 41 | 16.7/16.7/16.8 | 16.7/16.8/16.8 | 18.5 | 0/300 | — | 0.0004 | 32 / 33 / 33 | 397 |
| chromium | svgimg | architecture-street-halftone | 388 / 297 | 217 | 276 | 31 | 16.7/16.8/16.8 | 16.7/16.8/18.5 | — | 0/300 | — | 0.0004 | — / — / — | 296 |
| chromium | webgl | architecture-street-halftone | 219 / 229 | 212 | 187 | 42 | 16.7/16.8/17.8 | 16.7/16.7/16.8 | 150.1 | 0/300 | 2.8 | 0.0004 | 534 / 33 / 77 | 731 |
| chromium | canvas | synthetic-many-1m | 439 / 418 | 396 | 248 | 22 | 116.5/118.7/133.4 | 33.4/116.7/116.7 | 133.3 | 214/300 | 290.2 | 0.0010 | 116 / 127 / 117 | 194 |
| chromium | svgdom | synthetic-many-1m | 650 / 563 | 546 | 297 | 22 | 166.7/200/216.7 | 83.4/200/200.1 | 50 | 247/296 (truncated) | — | 0.0011 | 46 / 183 / 150 | 219 |
| chromium | svgimg | synthetic-many-1m | 1,008 / 958 | 867 | 683 | 21 | 433.3/450/450 | 416.7/433.3/433.3 | — | 121/121 (truncated) | — | 0.0011 | — / — / — | 240 |
| chromium | webgl | synthetic-many-1m | 605 / 559 | 529 | 291 | 33 | 233.3/250/250.1 | 100/216.7/233.3 | 250.1 | 223/265 (truncated) | 262.8 | 0.0011 | 176 / 241 / 217 | 572 |
| firefox | canvas | concert-small-venue-bw | 32 / 34 | 17 | 11 | 1 | 16.7/16.7/16.7 | 16.7/16.7/16.7 | 33.3 | 1/300 | 6 | 0.0045 | 32 / 33 / 33 | — |
| firefox | svgdom | concert-small-venue-bw | 23 / 33 | 17 | 10 | 1 | 16.7/16.7/16.7 | 16.7/16.7/16.7 | 150 | 0/300 | — | 0.0043 | 34 / 33 / 33 | — |
| firefox | svgimg | concert-small-venue-bw | 82 / 83 | 50 | 55 | 1 | 16.7/16.7/18.4 | 16.7/16.7/50 | — | 1/300 | — | 0.0045 | — / — / — | — |
| firefox | webgl | concert-small-venue-bw | 31 / 34 | 17 | 4 | 0 | 16.7/16.7/16.7 | 16.7/16.7/16.7 | 16.7 | 0/300 | 3 | 0.0040 | 30 / 33 / 34 | — |
| firefox | canvas | concert-small-venue-1280-halftone | 79 / 84 | 67 | 68 | 4 | 66.7/83.3/83.3 | 50/83.3/83.3 | 466.7 | 131/300 | 6 | 0.0010 | 22 / 33 / 367 | — |
| firefox | svgdom | concert-small-venue-1280-halftone | 91 / 103 | 83 | 76 | 7 | 16.7/33.3/33.3 | 16.7/150/166.7 | 733.3 | 11/300 | — | 0.0010 | 29 / 50 / 466 | — |
| firefox | svgimg | concert-small-venue-1280-halftone | 1,912 / 1,878 | 1,783 | 1,795 | 5 | 16.7/16.7/16.7 | 16.7/100/166.7 | — | 15/300 | — | 0.0010 | — / — / — | — |
| firefox | webgl | concert-small-venue-1280-halftone | 57 / 67 | 50 | 38 | 5 | 16.7/16.7/16.7 | 16.7/16.7/16.7 | 16.7 | 0/300 | 3 | 0.0010 | 22 / 34 / 33 | — |
| firefox | canvas | architecture-street-limited | 176 / 166 | 149 | 143 | 3 | 66.7/100/100.0 | 33.3/68.1/83.3 | 83.3 | 187/300 | 74 | 0.0077 | 91 / 77 / 33 | — |
| firefox | svgdom | architecture-street-limited | 210 / 220 | 199 | 143 | 7 | 16.7/16.7/66.7 | 33.3/66.7/66.7 | 66.7 | 13/300 | — | 0.0077 | 28 / 67 / 45 | — |
| firefox | svgimg | architecture-street-limited | 455 / 449 | 150 | 347 | 3 | 16.7/16.7/16.7 | 16.7/83.3/166.7 | — | 10/300 | — | 0.0072 | — / — / — | — |
| firefox | webgl | architecture-street-limited | 123 / 116 | 99 | 59 | 4 | 16.7/33.3/33.3 | 16.7/33.3/33.3 | 33.3 | 0/300 | 24 | 0.0076 | 28 / 27 / 34 | — |
| firefox | canvas | portrait-large-color | 288 / 282 | 266 | 217 | 6 | 100/150/166.7 | 33.3/83.3/100 | 100 | 186/300 | 96 | 0.0030 | 102 / 101 / 33 | — |
| firefox | svgdom | portrait-large-color | 382 / 382 | 365 | 234 | 13 | 16.7/50/83.3 | 16.7/100.0/166.7 | 100 | 27/300 | — | 0.0033 | 66 / 91 / 64 | — |
| firefox | svgimg | portrait-large-color | 442 / 433 | 133 | 318 | 5 | 16.7/16.7/16.7 | 16.7/100/150 | — | 10/300 | — | 0.0029 | — / — / — | — |
| firefox | webgl | portrait-large-color | 201 / 198 | 182 | 95 | 6 | 66.7/83.3/83.3 | 16.7/66.7/83.3 | 66.7 | 148/300 | 69 | 0.0028 | 61 / 64 / 33 | — |
| firefox | canvas | architecture-street-halftone | 836 / 779 | 763 | 737 | 35 | 16.7/16.7/383.3 | 16.7/16.7/33.3 | 900 | 47/266 (truncated) | 20 | 0.0010 | 22 / 33 / 900 | — |
| firefox | svgdom | architecture-street-halftone | 816 / 867 | 847 | 778 | 57 | 400/416.7/416.7 | 433.3/1,133.3/1,133.3 | 3,000 | 111/112 (truncated) | — | 0.0010 | 202 / 450 / 2,950 | — |
| firefox | svgimg | architecture-street-halftone | FAILED: harness timeout/failure: TimeoutError: page.waitForFunction: Timeout 900000ms ex |||||||||||||
| firefox | webgl | architecture-street-halftone | 378 / 381 | 364 | 336 | 32 | 16.7/16.7/16.7 | 16.7/16.7/16.7 | 233.3 | 0/300 | 6 | 0.0010 | 223 / 33 / 33 | — |
| firefox | canvas | synthetic-many-1m | 1,308 / 1,330 | 1,313 | 611 | 33 | 783.3/783.3/783.3 | 283.3/783.3/783.3 | 333.3 | 105/105 (truncated) | 326 | 0.0030 | 331 / 337 / 299 | — |
| firefox | svgdom | synthetic-many-1m | 1,415 / 1,462 | 1,446 | 762 | 33 | 100/233.3/300 | 133.3/450/450 | 250 | 269/272 (truncated) | — | 0.0030 | 134 / 326 / 218 | — |
| firefox | svgimg | synthetic-many-1m | 1,558 / 1,527 | 483 | 1,078 | 34 | 16.7/16.7/16.7 | 16.7/666.7/1,516.7 | — | 12/300 | — | 0.0029 | — / — / — | — |
| firefox | webgl | synthetic-many-1m | 1,088 / 1,047 | 1,030 | 597 | 31 | 366.7/383.3/383.3 | 150.0/350/366.7 | 383.3 | 201/206 (truncated) | 378 | 0.0030 | 383 / 380 / 334 | — |
| webkit | canvas | concert-small-venue-bw | 88 / 33 | 17 | 5 | 1 | 17/18/19 | 17/17/19 | 17 | 0/300 | 6 | 0.0035 | 27 / 33 / 33 | — |
| webkit | svgdom | concert-small-venue-bw | 52 / 33 | 17 | 6 | 1 | 17/18/19 | 17/17/18 | 18 | 0/300 | — | 0.0039 | 28 / 34 / 33 | — |
| webkit | svgimg | concert-small-venue-bw | 57 / 34 | 18 | 7 | 1 | 17/18/19 | 17/19/19 | — | 0/300 | — | 0.0037 | — / — / — | — |
| webkit | webgl | concert-small-venue-bw | 49 / 34 | 19 | 3 | 1 | 17/18/19 | 17/18/18 | 18 | 0/300 | 3 | 0.0034 | 31 / 33 / 34 | — |
| webkit | canvas | concert-small-venue-1280-halftone | 58 / 50 | 31 | 21 | 5 | 17/19/19 | 17/18/18 | 27 | 0/300 | 30 | 0.0010 | 33 / 33 / 33 | — |
| webkit | svgdom | concert-small-venue-1280-halftone | 80 / 60 | 35 | 23 | 5 | 17/20/20 | 17/18/19 | 102 | 0/300 | — | 0.0010 | 110 / 33 / 34 | — |
| webkit | svgimg | concert-small-venue-1280-halftone | 78 / 60 | 30 | 29 | 5 | 17/30/32 | 17/18/19 | — | 0/300 | — | 0.0010 | — / — / — | — |
| webkit | webgl | concert-small-venue-1280-halftone | 54 / 33 | 30 | 16 | 4 | 17/18/19 | 17/18/19 | 18 | 0/300 | 2 | 0.0010 | 81 / 33 / 34 | — |
| webkit | canvas | architecture-street-limited | 161 / 140 | 102 | 82 | 4 | 51/56/57 | 33/53/55 | 57 | 100/300 | 54 | 0.0073 | 54 / 88 / 33 | — |
| webkit | svgdom | architecture-street-limited | 250 / 223 | 184 | 106 | 4 | 60/73/74 | 42/71/72 | 73 | 199/300 | — | 0.0072 | 76 / 141 / 29 | — |
| webkit | svgimg | architecture-street-limited | 226 / 236 | 145 | 138 | 4 | 59/74/74 | 40/71/72 | — | 195/300 | — | 0.0074 | — / — / — | — |
| webkit | webgl | architecture-street-limited | 98 / 88 | 66 | 29 | 3 | 22/30/30 | 17/30/32 | 29 | 0/300 | 40 | 0.0073 | 37 / 46 / 34 | — |
| webkit | canvas | portrait-large-color | 210 / 221 | 200 | 136 | 6 | 70/75/77 | 19/63/67 | 75 | 170/300 | 73 | 0.0031 | 72 / 89 / 33 | — |
| webkit | svgdom | portrait-large-color | 402 / 393 | 378 | 202 | 6 | 67/80/83 | 22/66/69 | 81 | 175/300 | — | 0.0025 | 70 / 123 / 81 | — |
| webkit | svgimg | portrait-large-color | 413 / 432 | 323 | 297 | 6 | 68/79/81 | 22/63/68 | — | 173/300 | — | 0.0031 | — / — / — | — |
| webkit | webgl | portrait-large-color | 198 / 172 | 158 | 50 | 5 | 74/76/77 | 18/64/69 | 76 | 170/300 | 90 | 0.0024 | 85 / 84 / 26 | — |
| webkit | canvas | architecture-street-halftone | 574 / 465 | 298 | 227 | 36 | 161/167/169 | 112/160/166 | 244 | 300/300 | 268 | 0.0010 | 296 / 334 / 28 | — |
| webkit | svgdom | architecture-street-halftone | 680 / 584 | 358 | 242 | 32 | 122/164/165 | 108/153/156 | 992 | 295/300 | — | 0.0010 | 1,064 / 315 / 31 | — |
| webkit | svgimg | architecture-street-halftone | 569 / 563 | 255 | 287 | 27 | 111/147/148 | 96/138/139 | — | 295/300 | — | 0.0010 | — / — / — | — |
| webkit | webgl | architecture-street-halftone | 181 / 210 | 206 | 163 | 32 | 17/18/19 | 17/18/19 | 132 | 0/300 | 2 | 0.0010 | 2,470 / 33 / 22 | — |
| webkit | canvas | synthetic-many-1m | 432 / 434 | 414 | 264 | 36 | 139/161/162 | 67/139/150 | 165 | 247/300 | 151 | 0.0010 | 148 / 163 / 130 | — |
| webkit | svgdom | synthetic-many-1m | 1,150 / 1,223 | 1,212 | 525 | 36 | 151/168/170 | 79/151/154 | 157 | 300/300 | — | 0.0010 | 170 / 215 / 195 | — |
| webkit | svgimg | synthetic-many-1m | 1,414 / 1,615 | 1,085 | 1,126 | 36 | 147/164/165 | 96/152/156 | — | 300/300 | — | 0.0010 | — / — / — | — |
| webkit | webgl | synthetic-many-1m | 982 / 863 | 829 | 235 | 39 | 466/480/480 | 285/460/460 | 475 | 141/141 (truncated) | 507 | 0.0010 | 500 / 501 / 436 | — |


Reading the matrix:
- **Real P0 scenes up to ~300k anchors.** In Chromium every candidate is smooth. In Firefox and WebKit only WebGL is smooth on exact redraws at 300k+ (Canvas and SVG pan p95 53–100 ms).
- **Path count, not anchor count, drives exact-redraw cost.**
  - Chromium Canvas stays at p95 ≤ 33 ms up to 30k paths (portrait colour) and 18.6k paths (670k limited), then fails at 83k–167k paths (synthetic).
  - SVG DOM degrades earlier: Chromium 5–17 % slow frames at 30k paths; WebKit 66 % already on the 304k scene.
  - WebGL issues 2 draw calls per path and fails from about 30k paths.
- **First visible (warm)** at 304k anchors: Chromium 81–117 ms, Firefox 116–449 ms, WebKit 88–236 ms. The RFC preview budget (≤ 100 ms at ≤ 250k) is met only in Chromium, and with WebGL in WebKit (88 ms). See §8.
- **Discrete edits** (select, palette, visibility, resize) are ≤ 2 frames up to ~300k in Chromium for all editable candidates, but grow with exact-redraw cost elsewhere. The display cache does not help non-camera edits; the worker host keeps them off the main thread (§6).

## 5. Is the frame metric honest? (raster cross-checks)
### Canvas raster cross-check (2560×1600; ms per draw)

| Engine | Scene | A: 10 draws + 1 readback | B: readback every draw | C: `willReadFrequently` (CPU) |
|---|---|---|---|---|
| chromium | concert-small-venue-1280-halftone | 0.5 | 65.5 | 75.5 |
| chromium | architecture-street-halftone | 0.1 | 474.2 | 585.9 |
| chromium | portrait-large-color | 13.9 | 72.6 | 78.6 |
| chromium | synthetic-many-1m | 90.8 | 259.6 | 293.6 |
| firefox | concert-small-venue-1280-halftone | 2.4 | 5.6 | 76.4 |
| firefox | architecture-street-halftone | 17.4 | 20.0 | 610.1 |
| firefox | portrait-large-color | 149.3 | 152.5 | 92.9 |
| firefox | synthetic-many-1m | 774.6 | 780.1 | 320.5 |
| webkit | concert-small-venue-1280-halftone | 19.6 | 29.6 | 1838.4 |
| webkit | architecture-street-halftone | 173.9 | 250.9 | 1505.9 |
| webkit | portrait-large-color | 68.7 | 73.7 | 200.1 |
| webkit | synthetic-many-1m | 514.6 | 205.3 | 821.9 |

### Chromium traced presentation (120-frame pan)

| Renderer | Scene | rAF frames | rAF p50/p95 ms | DrawFrame | Dropped BeginFrames | Window ms |
|---|---|---|---|---|---|---|
| canvas | portrait-large-color | 120 | 33.3/33.4 | 120 | 75 | 3249 |
| svgdom | portrait-large-color | 120 | 33.3/50.1 | 119 | 123 | 4032 |
| svgimg | portrait-large-color | 120 | 66.7/100.0 | 119 | 354 | 7988 |
| webgl | portrait-large-color | 120 | 33.4/50.1 | 120 | 166 | 4766 |
| canvas | architecture-street-halftone | 120 | 16.7/16.7 | 120 | 0 | 2016 |
| svgdom | architecture-street-halftone | 120 | 16.7/17.0 | 120 | 0 | 2016 |
| svgimg | architecture-street-halftone | 120 | 16.7/18.5 | 120 | 0 | 2017 |
| webgl | architecture-street-halftone | 120 | 16.7/17.9 | 120 | 0 | 2016 |
| canvas | synthetic-many-1m | 120 | 83.4/133.4 | 120 | 573 | 11578 |
| svgdom | synthetic-many-1m | 120 | 181.4/233.3 | 118 | 1049 | 19637 |
| svgimg | synthetic-many-1m | 42 | 483.4/516.6 | 41 | 1111 | 20141 |
| webgl | synthetic-many-1m | 99 | 200.0/250.0 | 99 | 1097 | 20070 |


- **Chromium.** A readback switches the canvas to CPU raster: B ≈ C, while A is small. "Sync redraw" values in the Chromium rows therefore measure CPU raster, not the GPU path. The trace settles the question: compositor `DrawFrame` events equal rAF callbacks in every case, and slow frames show up as dropped BeginFrames. **The rAF frame metric is faithful in Chromium.**
- **Canvas cost model.** Per-frame Canvas cost ≈ per-`fill()` overhead × visible paths + raster per anchor:
  - Chromium: ~0.5 µs per call, GPU raster cheap;
  - Firefox: ~5 µs per call (portrait colour, 30k paths: ~150 ms per draw);
  - WebKit: ~2.3 µs per call plus ~0.18 µs per anchor of raster (977k halftone: ~174 ms per draw).
  - This is why exact per-frame redraw cannot meet budgets on large scenes in Firefox and WebKit, and why a cache that makes gestures O(1) is decisive.

## 6. Mitigations measured
### Display-only raster cache (Canvas 2D + cache; 5 warm reps, medians)

| Engine | Scene | Pan p50/p95 | Zoom p50/p95 | >50 ms frames | Settle after pan / zoom: visible ms (JS ms) | Without cache: pan p95 / zoom p95 |
|---|---|---|---|---|---|---|
| chromium | concert-small-venue-1280-halftone | 17/17 | 17/17 | 0/300 | 33 / 33 (0) | 17 / 17 |
| chromium | architecture-street-limited | 17/17 | 17/18 | 0/300 | 33 / 33 (4) | 17 / 17 |
| chromium | portrait-large-color | 17/17 | 17/17 | 0/300 | 33 / 33 (24) | 33 / 33 |
| chromium | architecture-street-halftone | 17/18 | 17/17 | 0/300 | 33 / 33 (0) | 17 / 17 |
| chromium | synthetic-many-1m | 17/17 | 17/17 | 0/300 | 83 / 33 (81) | 119 / 117 |
| firefox | concert-small-venue-1280-halftone | 17/17 | 17/17 | 0/300 | 33 / 33 (0) | 83 / 83 |
| firefox | architecture-street-limited | 17/17 | 17/17 | 7/300 | 34 / 35 (2) | 100 / 68 |
| firefox | portrait-large-color | 17/17 | 17/17 | 10/300 | 31 / 33 (19) | 150 / 83 |
| firefox | architecture-street-halftone | 17/17 | 17/17 | 0/300 | 34 / 36 (0) | 17 / 17 |
| firefox | synthetic-many-1m | 17/18 | 17/17 | 11/300 | 49 / 36 (39) | 783 / 783 |
| webkit | concert-small-venue-1280-halftone | 17/17 | 17/17 | 1/300 | 33 / 33 (6) | 19 / 18 |
| webkit | architecture-street-limited | 17/18 | 17/18 | 0/300 | 50 / 33 (12) | 56 / 53 |
| webkit | portrait-large-color | 17/19 | 17/19 | 0/300 | 72 / 33 (48) | 75 / 63 |
| webkit | architecture-street-halftone | 17/18 | 17/22 | 4/300 | 213 / 151 (57) | 167 / 160 |
| webkit | synthetic-many-1m | 17/18 | 17/19 | 0/300 | 119 / 34 (94) | 161 / 139 |

### OffscreenCanvas render worker (same Canvas 2D code in a worker; 6 reps, warm median)

| Engine | Scene | Worker rAF | Worker build ms | Worker draw ms | Main-thread max gap during load ms | Worker pan p50/p95 | Main-thread max gap during pan ms |
|---|---|---|---|---|---|---|---|
| chromium | architecture-street-limited | yes | 89 | 7 | 17 | 17/17 | 17 |
| chromium | portrait-large-color | yes | 134 | 25 | 17 | 33/33 | 19 |
| chromium | architecture-street-halftone | yes | 398 | 7 | 19 | 17/17 | 18 |
| chromium | synthetic-many-1m | yes | 273 | 80 | 17 | 100/133 | 19 |
| firefox | architecture-street-limited | yes | 144 | 80 | 17 | 67/83 | 17 |
| firefox | portrait-large-color | yes | 220 | 111 | 17 | 83/100 | 17 |
| firefox | architecture-street-halftone | yes | 783 | 594 | 17 | 517/600 | 18 |
| firefox | synthetic-many-1m | yes | 632 | 341 | 17 | 300/317 | 17 |
| webkit | architecture-street-limited | yes | 95 | 15 | 18 | 55/58 | 19 |
| webkit | portrait-large-color | yes | 152 | 51 | 19 | 72/73 | 19 |
| webkit | architecture-street-halftone | yes | 263 | 56 | 19 | 212/220 | 20 |
| webkit | synthetic-many-1m | yes | 284 | 127 | 20 | 138/148 | 24 |


- **Display cache.** Gestures become independent of scene size in every engine. The exact settle redraw then costs what one exact frame costs: Chromium 33–83 ms; WebKit 50–213 ms; Firefox 31–49 ms by the rAF proxy. Firefox may raster after that proxy: its synchronized readback, which Firefox does not penalise, gives 6–326 ms.
- **OffscreenCanvas.** The main thread never exceeds 24 ms during load or pan in any engine, while the worker builds Path2D (89–783 ms) and redraws.
  - Firefox's worker canvas rasters the 977k single path slowly (594 ms draw), so gestures in the worker must also use the display cache. Cache-in-worker is NOT RUN; it is a G-R0 test.
  - Memory cost: one extra geometry copy in the worker (≈ 45–52 MB per 1M anchors) plus its Path2D objects.

## 7. Spatial indexing
### Spatial index comparison (Node v24.22.1; 2,000 random points; ms)

| Scene | Index | Subpath index | Items | MB | Build | Cold p95 / max | Warm p95 / max | Agreement |
|---|---|---|---|---|---|---|---|---|
| concert-small-venue-bw | grid | yes | 1,150 | 0.06 | 2.5 | 0.0048 / 5.53 | 0.0029 / 0.022 | 2000/2000 |
| concert-small-venue-bw | str | yes | 1,150 | 0.10 | 1.72 | 0.0054 / 2.43 | 0.0031 / 0.033 | 2000/2000 |
| concert-small-venue-bw | grid | no | 184 | 0.01 | 0.18 | 0.1078 / 2.01 | 0.1078 / 0.121 | 2000/2000 |
| concert-small-venue-bw | str | no | 184 | 0.02 | 0.28 | 0.1083 / 1.51 | 0.1086 / 0.137 | 2000/2000 |
| architecture-street-bw | grid | yes | 11,603 | 0.58 | 7.51 | 0.0031 / 2.74 | 0.0021 / 0.091 | 2000/2000 |
| architecture-street-bw | str | yes | 11,603 | 0.96 | 9.98 | 0.0078 / 3.9 | 0.0028 / 0.108 | 2000/2000 |
| architecture-street-bw | grid | no | 4,130 | 0.20 | 0.39 | 0.2945 / 2.85 | 0.2872 / 0.351 | 2000/2000 |
| architecture-street-bw | str | no | 4,130 | 0.34 | 3.56 | 0.2892 / 2.47 | 0.2885 / 0.362 | 2000/2000 |
| texture-bark-bw | grid | yes | 8,307 | 0.41 | 6.16 | 0.002 / 7.16 | 0.0018 / 0.097 | 2000/2000 |
| texture-bark-bw | str | yes | 8,307 | 0.69 | 6.94 | 0.0029 / 10.66 | 0.0022 / 0.014 | 2000/2000 |
| texture-bark-bw | grid | no | 904 | 0.04 | 0.14 | 0.8579 / 10.81 | 0.8512 / 0.879 | 2000/2000 |
| texture-bark-bw | str | no | 904 | 0.07 | 0.68 | 0.8611 / 8.55 | 0.8515 / 0.887 | 2000/2000 |
| architecture-street-limited | grid | yes | 12,553 | 0.69 | 4.36 | 0.01 / 2.3 | 0.0057 / 0.154 | 2000/2000 |
| architecture-street-limited | str | yes | 12,553 | 1.04 | 9.87 | 0.0108 / 1.65 | 0.0066 / 0.014 | 2000/2000 |
| architecture-street-limited | grid | no | 9,793 | 0.54 | 0.99 | 0.128 / 1.74 | 0.1218 / 0.177 | 2000/2000 |
| architecture-street-limited | str | no | 9,793 | 0.81 | 5.36 | 0.1289 / 1.95 | 0.1223 / 0.201 | 2000/2000 |
| portrait-large-color | grid | yes | 30,022 | 1.58 | 2.5 | 0.0036 / 0.68 | 0.0022 / 0.185 | 2000/2000 |
| portrait-large-color | str | yes | 30,022 | 2.48 | 19.55 | 0.0052 / 0.67 | 0.0032 / 0.008 | 2000/2000 |
| portrait-large-color | grid | no | 29,944 | 1.58 | 2.2 | 0.0034 / 1.3 | 0.0024 / 0.007 | 2000/2000 |
| portrait-large-color | str | no | 29,944 | 2.48 | 18.55 | 0.0054 / 0.69 | 0.0032 / 0.007 | 2000/2000 |
| architecture-street-halftone | grid | yes | 195,501 | 10.01 | 28.09 | 0.0017 / 58.58 | 0.0005 / 0.005 | 2000/2000 |
| architecture-street-halftone | str | yes | 195,501 | 16.16 | 78.9 | 0.0025 / 57.25 | 0.001 / 1.167 | 2000/2000 |
| architecture-street-halftone | grid | no | 1 | 0.00 | 0.17 | 13.8782 / 80.38 | 12.8315 / 13.398 | 2000/2000 |
| architecture-street-halftone | str | no | 1 | 0.00 | 1.34 | 13.0481 / 82.86 | 12.611 / 13.669 | 2000/2000 |
| synthetic-many-250k | grid | yes | 41,853 | 2.42 | 6.33 | 0.0017 / 0.02 | 0.0008 / 0.131 | 2000/2000 |
| synthetic-many-250k | str | yes | 41,853 | 3.46 | 25.74 | 0.003 / 0.02 | 0.0013 / 0.002 | 2000/2000 |
| synthetic-many-250k | grid | no | 41,853 | 2.42 | 4.38 | 0.002 / 0.01 | 0.0009 / 0.016 | 2000/2000 |
| synthetic-many-250k | str | no | 41,853 | 3.46 | 22.66 | 0.0036 / 0.02 | 0.0013 / 0.006 | 2000/2000 |
| synthetic-many-1m | grid | yes | 166,598 | 13.06 | 14.74 | 0.004 / 0.02 | 0.0016 / 0.006 | 2000/2000 |
| synthetic-many-1m | str | yes | 166,598 | 13.77 | 118.08 | 0.0092 / 0.03 | 0.0027 / 0.031 | 2000/2000 |
| synthetic-many-1m | grid | no | 166,598 | 13.06 | 15.4 | 0.0043 / 0.91 | 0.0015 / 0.006 | 2000/2000 |
| synthetic-many-1m | str | no | 166,598 | 13.77 | 109.84 | 0.007 / 0.05 | 0.0027 / 0.107 | 2000/2000 |
| synthetic-correctness | grid | yes | 32 | 0.00 | 0.02 | 0.0008 / 0.02 | 0.0007 / 0.001 | 2000/2000 |
| synthetic-correctness | str | yes | 32 | 0.00 | 0.02 | 0.0008 / 0 | 0.0007 / 0.001 | 2000/2000 |
| synthetic-correctness | grid | no | 32 | 0.00 | 0.02 | 0.0007 / 0.01 | 0.0006 / 0.001 | 2000/2000 |
| synthetic-correctness | str | no | 32 | 0.00 | 0.03 | 0.0008 / 0.01 | 0.0007 / 0.002 | 2000/2000 |

Hole and clip checks (11 fixed points × 4 variants): 0 failures.


- **Grid vs STR.** Same query speed. The grid builds faster (synthetic 1M: 15 ms vs 118 ms) and is smaller.
- **Subpath indexing** (paths with more than 8 subpaths) is **required**. Without it the 977k-anchor halftone is one item: warm p95 12.8 ms (budget ≤ 8 ms), cold up to 80 ms.
- **Band index** for huge single subpaths: the 129k-anchor bark path tests in 0.85 ms warm even as one item.
- **Cold first query.** Up to 58 ms on the halftone, from lazy flattening of the whole path. Production should pre-flatten large paths during the idle build into typed arrays, and flatten per subpath only. The prototype's JS-array polylines inflate the JS heap: Canvas heap 678 MB on the 977k halftone after hit tests, against 194 MB on the 1M synthetic.
- **Native `elementFromPoint` (SVG DOM)** agreed with the CPU index and was comparably fast, but is unavailable to Canvas and WebGL.

## 8. Memory and context loss
- **JS heap** (Chromium, warm median):
  - Canvas 79 / 194 / 678 MB at 304k / 1M synthetic / 977k halftone (the last inflated by hit-test polylines, §7);
  - SVG DOM 68 / 219 / 397 MB;
  - WebGL 190 / 572 / 731 MB (CPU copies of vertex data retained for context restore).
- **Backing stores.** The Canvas backing store is 16 MB at 2560×1600. The display cache is one more 16 MB bitmap.
- **WebGL GPU buffers:** 15–171 MB, plus an estimated MSAA framebuffer of ~147 MB. GPU memory is not observable from the page.
- **WebGL context loss** (`WEBGL_lose_context`): supported in every run; restore and redraw from the retained CPU arrays took 1–235 ms. Canvas has no context-loss path to manage.

## 9. Decision record
**Recommended production renderer:** retained Canvas 2D, hosted in an OffscreenCanvas render worker.
- Linear path construction.
- Viewport culling.
- A display-only raster cache for gestures, with exact redraw on settle.
- Layered caching for object drags: a background without the selection, plus the live selection. Extrapolated from the same mechanism; to be verified in G-R1.
- A main-thread overlay canvas for selection handles.
- The renderer-independent hit-test service on the main thread, over the document's packets.

**Known limitations.**
- Exact redraw after an edit or settle costs one full frame, which can be several hundred ms in Firefox and WebKit at 500k–1M anchors. It is off the main thread, but visible as latency.
- Firefox worker raster is slow for huge single paths.
- 2× geometry memory (document plus render copy).
- Real Safari, iOS and lower-end devices are NOT RUN.

**Required optimisations** (G-R0 / G-R1):
1. Path-data or chunked construction, with the Path2D scaling regression benchmark.
2. Worker host, with a main-thread fallback for engines without worker OffscreenCanvas 2D. The fallback is the same renderer: a disclosed degradation, not a second renderer.
3. Display cache in the worker, and layered caching for drags.
4. Pre-flattened typed-array hit geometry.
5. Progressive first frame: draw paths in paint order as they are built, so first feedback precedes complete preparation.

**Proposed scene-size limits** (reference machine, measured under load; to be re-measured on the lower-end device):
- **Interactive:** ≤ 250k anchors and ≤ ~40k paths. Gestures smooth in all engines. Exact settle measured on the 304k–430k scenes: Chromium 33 ms, WebKit 50–72 ms, Firefox 31–34 ms (rAF proxy) or 74–96 ms (sync).
- **Stress:** 500k–1M anchors. Gestures smooth (cache); exact settle labelled "rendering…" with no main-thread blocking.
- **Product cap:** 1M anchors, unchanged.
- No existing target is lowered. The preview ≤ 100 ms at ≤ 250k target is currently met only in Chromium. Optimise in G-R1 (progressive first frame); if still unmet, it is an owner decision.

**Revisit conditions** (re-open WebGL2 or WebGPU behind the same renderer port):
1. Exact settle or edit redraw at ≤ 250k misses the budget on real Safari, Firefox or the lower-end device after the optimisations above.
2. Creative Lab live previews need per-frame exact redraw of more than 500k marks (halftone, stipple or pattern scrubbing).
3. Firefox's worker canvas stays CPU-raster for large paths.
4. Browser Canvas regressions (such as the Chromium quadratic Path2D behaviour) cannot be worked around.

The narrow WebGL data here (fastest first visible; 0 geometry errors; draw-call-bound beyond ~30k paths; restore 1–235 ms) is the baseline for that revisit. A competitive version needs a robust tessellator (lyon-class, in WASM) and batching.

**Migration from the P0 SVG-image preview.**
1. G-R0: the engineering workbench switches its preview to the Canvas renderer fed by packets (G-ENG). The SVG `<img>` stays behind a debug toggle as a visual comparison.
2. G-R1: the worker host and caches land, and the toggle is removed once G-R1 passes.
3. Export never changes. SVG and PDF are always written from the frozen snapshot by the engine, never from any preview.
