# RFC-002 review R02 — renderer bake-off

<!-- summary -->

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
