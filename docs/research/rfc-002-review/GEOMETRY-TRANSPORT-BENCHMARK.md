# RFC-002 review R01 (part 2) — geometry transport benchmark

**Gate result for R01:** PASS for the transport and ownership decision, with the amendments in [DOCUMENT-OWNERSHIP](DOCUMENT-OWNERSHIP.md). PARTIAL only in that the Rust-side packet producer and validator were not built: the review measured an equivalent JS path, labelled below.

## Method
- **Workloads.**
  - Real P0 scenes from the byte-regression corpus (`tests/output/regression-a4cf172/*.scene.json`, regenerated with `regression_corpus`). Each SHA-256 matches the committed `docs/research/p0-r-geo/artifacts/regression/a4cf172.sha256` (spot-checked for the halftone and portrait scenes).
  - Synthetic scenes from `gen-scenes.mjs`: deterministic PRNG; discs with 4 cubics, rings with reversed holes, translucent overlaps, 8 palette groups. Every synthetic scene was parsed and validated by the real engine (`sceneToSvg`) before use; hashes are in `tests/output/rfc-002-review/scenes/MANIFEST.json`.
  - The real scenes cover: B&W concert (17k), dense halftone single compound paths (97k and 977k anchors; 19k and 195k subpaths), many small paths (portrait colour, 30k paths), limited colour (304k, 670k).
- **Node** (`transport-node.mjs`). Each (scene, representation) runs in a fresh process with `--expose-gc`, so resident memory is not shared. 6 reps (cold + 5 warm). The packet is produced by **JS-side encoding from the parsed scene, which is not the production path** (production would build the typed arrays in Rust). The wasm-bindgen copy-out is reproduced as `Float64Array.slice()`, which is what the generated glue does for `Vec<f64>` returns [source: `pkg/vector_engine_wasm.js`].
- **Browser** (`transport.html`, `run-transport.mjs`).
  - Engines: Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2, all headed. Served under the exact production CSP by `server.mjs`.
  - The worker prepares each payload before taking its timestamp, so only serialization and delivery are timed.
  - Main-thread blocking is measured by a requestAnimationFrame gap probe plus Long Tasks (Chromium), because structured-clone deserialization happens *before* `onmessage` runs.
  - "Total" ends when the main thread has one Path2D per path, i.e. is renderer-ready.
- **Clock resolution.** Firefox and WebKit report `performance.now()` at 1 ms in this non-isolated context, so their small values are quantized.
- **Environment.** Apple M5 Max, 128 GB, macOS 26.6.2, Node 24.22.1. **Unrelated background load** of 12 `ngspice` processes kept the load average at ≈ 13–16 on 18 cores during every run (`artifacts/renderer/timing-environment.txt`). Absolute times are therefore conservative for this machine, and say nothing about lower-end hardware (NOT RUN).

## Results
Node v24.22.1 (darwin-arm64), 6 reps (cold + 5 warm); warm p50 unless marked.

| Scene | Anchors | Paths | Subpaths | JSON MB | Packet MB | JSON deflate MB | Packet deflate MB | String decode ms | JSON.parse ms | Parsed heap MB | JS encode ms (not prod. path) | Packet validate ms | Copy-out ms (wasm-bindgen equiv.) | Packet resident MB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| concert-small-venue-bw | 16,816 | 184 | 1,157 | 0.7 | 0.8 | 0.2 | 0.2 | 0.14 | 2.03 | 0.9 | 0.23 | 2 | 0.03 | 0.8 |
| concert-small-venue-1280-halftone | 97,045 | 1 | 19,409 | 3.6 | 4.2 | 0.9 | 1.0 | 0.14 | 9.15 | 4.3 | 0.87 | 1.98 | 0.1 | 4.2 |
| architecture-street-bw | 128,973 | 4,130 | 12,115 | 5.9 | 6.0 | 1.5 | 1.7 | 0.22 | 17.61 | 6.7 | 1.9 | 3.26 | 0.13 | 6.2 |
| architecture-street-limited | 303,869 | 9,793 | 13,272 | 13.8 | 14.3 | 3.6 | 3.9 | 0.46 | 40.78 | 15.9 | 4.53 | 7.33 | 0.34 | 14.7 |
| portrait-large-color | 430,119 | 29,944 | 31,145 | 22.5 | 20.6 | 6.1 | 6.4 | 1.38 | 73.17 | 27.1 | 14.15 | 12.04 | 0.5 | 21.7 |
| portrait-face-limited | 670,486 | 18,584 | 31,755 | 30.5 | 31.9 | 7.6 | 8.4 | 1.33 | 89.04 | 34.8 | 9.48 | 16.28 | 0.77 | 32.6 |
| architecture-street-halftone | 977,505 | 1 | 195,501 | 39.7 | 41.8 | 9.9 | 10.0 | 1.86 | 103.83 | 41.9 | 7.78 | 19.83 | 1.5 | 42.6 |
| synthetic-many-10k | 10,000 | 1,655 | 2,000 | 0.6 | 0.5 | 0.1 | 0.1 | 0.1 | 1.52 | 0.8 | 0.6 | 1.27 | 0.02 | 0.5 |
| synthetic-many-100k | 100,000 | 16,683 | 20,000 | 5.8 | 4.5 | 1.1 | 1.2 | 0.29 | 15.68 | 7.0 | 3.6 | 2.47 | 0.1 | 5.2 |
| synthetic-many-250k | 250,000 | 41,853 | 50,000 | 14.5 | 11.4 | 2.8 | 3.0 | 0.74 | 40.54 | 17.5 | 8.52 | 6.27 | 0.27 | 12.9 |
| synthetic-many-500k | 500,005 | 83,309 | 100,001 | 28.9 | 22.7 | 5.5 | 5.9 | 1.43 | 80.39 | 34.8 | 17.55 | 10.48 | 0.6 | 25.8 |
| synthetic-many-1m | 1,000,000 | 166,598 | 200,000 | 57.7 | 45.5 | 11.1 | 11.8 | 2.93 | 168.67 | 69.4 | 45.55 | 16.81 | 1.62 | 51.6 |

Browser (headed, production CSP; warm median of 5; ms). deliver = worker post → main onmessage (cross-context clock); p/v = JSON.parse or packet validate; Path2D = renderer-ready path objects via SVG path data; gap = largest main-thread frame gap in the window.

| Engine | Scene | JSON string: deliver / parse / Path2D / total / gap | JSON object clone: deliver / total / gap | Packet transfer: deliver / validate / Path2D / total / gap |
|---|---|---|---|---|
| chromium 159.0.8154.6 | concert-small-venue-bw | 0.4 / 1.5 / 4.9 / **6.5** / 17 | 2.0 / **8.2** / 17 | 0.2 / 0.2 / 4.5 / **4.7** / 17 |
| chromium 159.0.8154.6 | concert-small-venue-1280-halftone | 0.8 / 6.3 / 23.8 / **30** / 17 | 8.7 / **41.3** / 17 | 0.1 / 0.9 / 18.5 / **19.4** / 17 |
| chromium 159.0.8154.6 | architecture-street-bw | 1.1 / 9.8 / 33.4 / **43.3** / 17 | 14.3 / **59** / 33 | 0.1 / 1.7 / 30.7 / **32.4** / 17 |
| chromium 159.0.8154.6 | architecture-street-limited | 2.2 / 25.4 / 84.4 / **109.9** / 83 | 36.8 / **145.8** / 83 | 0 / 4.3 / 75 / **79.5** / 50 |
| chromium 159.0.8154.6 | portrait-large-color | 3.8 / 39.2 / 124.9 / **163.2** / 150 | 74.2 / **242.1** / 150 | 5.9 / 6.8 / 112.3 / **119.2** / 100 |
| chromium 159.0.8154.6 | portrait-face-limited | 5.2 / 50 / 158.9 / **209.8** / 183 | 83.9 / **296.7** / 200 | 0.2 / 8.8 / 154.6 / **163.7** / 150 |
| chromium 159.0.8154.6 | architecture-street-halftone | 6.6 / 69.5 / 278.8 / **348.8** / 333 | 138.7 / **492.5** / 367 | 0.1 / 8.4 / 266.1 / **274.5** / 250 |
| chromium 159.0.8154.6 | synthetic-many-10k | 0.1 / 1 / 2.6 / **3.6** / 17 | 1.8 / **5.8** / 17 | 0 / 0.2 / 2.4 / **2.5** / 17 |
| chromium 159.0.8154.6 | synthetic-many-100k | 1.1 / 9.1 / 25.4 / **34.5** / 17 | 19.8 / **55.2** / 17 | 0.1 / 1.3 / 22.5 / **23.8** / 17 |
| chromium 159.0.8154.6 | synthetic-many-250k | 2.6 / 24.7 / 67.9 / **92.8** / 67 | 50.3 / **138.1** / 83 | 0.1 / 3.1 / 58.1 / **61.2** / 33 |
| chromium 159.0.8154.6 | synthetic-many-500k | 4.8 / 46.5 / 128.4 / **178.5** / 167 | 107.8 / **281.5** / 167 | 0.0 / 8.9 / 118 / **127.7** / 100 |
| chromium 159.0.8154.6 | synthetic-many-1m | 9.7 / 96.6 / 253.2 / **349.8** / 333 | 217.6 / **574.3** / 367 | 0.1 / 12.6 / 237.6 / **249.7** / 233 |
| firefox 159.0 | concert-small-venue-bw | 1 / 3 / 12 / **15** / 17 | 5 / **17** / 17 | 0 / 1 / 10 / **11** / 17 |
| firefox 159.0 | concert-small-venue-1280-halftone | -1 / 15 / 65 / **80** / 67 | 21 / **104** / 83 | -1 / 1 / 65 / **66** / 67 |
| firefox 159.0 | architecture-street-bw | 0 / 24 / 68 / **93** / 83 | 39 / **131** / 83 | 0 / 3 / 65 / **68** / 67 |
| firefox 159.0 | architecture-street-limited | 0 / 59 / 139 / **200** / 183 | 95 / **292** / 183 | -1 / 6 / 138 / **144** / 133 |
| firefox 159.0 | portrait-large-color | 0 / 90 / 209 / **299** / 299 | 160 / **469** / 300 | 9 / 8 / 208 / **215** / 217 |
| firefox 159.0 | portrait-face-limited | 0 / 131 / 315 / **447** / 434 | 209 / **646** / 417 | 0 / 12 / 300 / **312** / 316 |
| firefox 159.0 | architecture-street-halftone | 0 / 158 / 768 / **927** / 916 | 232 / **1,149** / 867 | 0 / 14 / 742 / **758** / 750 |
| firefox 159.0 | synthetic-many-10k | 0 / 2 / 7 / **9** / 17 | 4 / **12** / 17 | 0 / 0 / 5 / **6** / 17 |
| firefox 159.0 | synthetic-many-100k | 0 / 21 / 63 / **83** / 67 | 41 / **126** / 83 | 0 / 2 / 59 / **61** / 50 |
| firefox 159.0 | synthetic-many-250k | 0 / 52 / 155 / **206** / 200 | 105 / **315** / 217 | 1 / 5 / 150 / **155** / 150 |
| firefox 159.0 | synthetic-many-500k | 1 / 101 / 311 / **410** / 400 | 215 / **630** / 417 | 1 / 9 / 311 / **322** / 317 |
| firefox 159.0 | synthetic-many-1m | 0 / 198 / 616 / **820** / 817 | 437 / **1,272** / 850 | 0 / 19 / 607 / **627** / 617 |
| webkit 27.2 | concert-small-venue-bw | 0 / 2 / 5 / **7** / 17 | 3 / **11** / 17 | 0 / 0 / 5 / **5** / 17 |
| webkit 27.2 | concert-small-venue-1280-halftone | 0 / 9 / 20 / **29** / 30 | 15 / **44** / 28 | 0 / 1 / 19 / **20** / 21 |
| webkit 27.2 | architecture-street-bw | 0 / 14 / 36 / **50** / 51 | 27 / **76** / 59 | 0 / 2 / 33 / **35** / 36 |
| webkit 27.2 | architecture-street-limited | 2 / 34 / 87 / **120** / 122 | 67 / **184** / 118 | 0 / 5 / 82 / **87** / 88 |
| webkit 27.2 | portrait-large-color | 4 / 58 / 133 / **191** / 198 | 127 / **309** / 172 | 10 / 8 / 127 / **135** / 151 |
| webkit 27.2 | portrait-face-limited | 5 / 77 / 203 / **280** / 285 | 147 / **404** / 237 | 1 / 10 / 191 / **201** / 207 |
| webkit 27.2 | architecture-street-halftone | 5 / 97 / 210 / **308** / 321 | 168 / **465** / 262 | 5 / 10 / 203 / **213** / 221 |
| webkit 27.2 | synthetic-many-10k | 0 / 1 / 3 / **4** / 17 | 3 / **6** / 17 | 0 / 0 / 2 / **3** / 17 |
| webkit 27.2 | synthetic-many-100k | 2 / 9 / 25 / **34** / 36 | 33 / **65** / 48 | 0 / 2 / 23 / **25** / 26 |
| webkit 27.2 | synthetic-many-250k | 2 / 26 / 68 / **93** / 96 | 89 / **178** / 95 | 0 / 5 / 64 / **69** / 71 |
| webkit 27.2 | synthetic-many-500k | 5 / 52 / 127 / **179** / 193 | 169 / **338** / 171 | 1 / 8 / 126 / **134** / 140 |
| webkit 27.2 | synthetic-many-1m | 11 / 102 / 283 / **385** / 396 | 354 / **690** / 327 | 1 / 18 / 280 / **298** / 301 |


## Findings
1. **Size is not a reason to switch.**
   - Scene v1 quantizes coordinates to 0.01 px, so each JSON number is about as many bytes as an f64.
   - Packet size is −21 % to +15 % of the JSON size; deflated, the packet is 2–11 % larger than deflated JSON.
   - Resident memory is also similar: the parsed JSON heap is 1.06–1.37× the JSON bytes, because V8 stores coordinate arrays as unboxed doubles.
2. **Main-thread cost is the reason.** At ~1M anchors:
   - `JSON.parse` costs 97–198 ms on the main thread across engines.
   - Cloning a parsed object graph from the worker is worse: 139–437 ms delivery, all of it blocking.
   - A transferred packet arrives in 0–10 ms and validates in 8–19 ms.
3. **Path2D construction is the next bottleneck, not transport.** Building renderer-ready paths costs 237–280 ms (Chromium), 607–768 ms (Firefox) and 203–283 ms (WebKit) at ~1M anchors, even with linear-time path-data construction (incremental Path2D is quadratic in Chromium: `artifacts/renderer/path2d-scaling.json`). Done on the main thread this is a frame gap of the same size. At ~250k anchors the total is 61 ms (Chromium), 155 ms (Firefox) and 69 ms (WebKit). The renderer gate must time-slice or move this work ([RENDERER-EVALUATION](RENDERER-EVALUATION.md)).
4. **The wasm-bindgen copy-out is negligible:** 1.5–1.6 ms for 42–46 MB, equivalent measurement.
5. **Adversarial validation:** 27/27 cases behave as expected (`artifacts/transport/adversarial.json`).
   - Covered: offsets (decreasing, out of range, sentinel), arity (surplus, missing), NaN, ±Infinity, |v| > 1e6, opcode, grammar, style and group references, group order, wrong array types, detached buffers, version, negative and non-integer counts, artboard range, anchor budget, plus 3 declared-size allocation bombs refused before any allocation.
   - The **first run found a real gap**: an out-of-range offset was rejected only indirectly, after reading past the array (`adversarial-run1-gap.json`). An explicit bounds check fixed it. The Rust validator needs the same suite.
6. **Detachment hazard, demonstrated.** Transferring a job copy leaves the committed packet intact; transferring the committed packet by mistake sets `coords.byteLength` to 0. Hence the GeometryStore copy-out rule.

## Recommendation
- The GeometryPacket is the only editor-side transport and storage format for geometry. Scene v1 JSON remains the export and interop format through an adapter. Drop the JSON fallback.
- Validate once on receipt, deriving bounds and subpaths; never transport derived data.
- Production packets are built in Rust. Gate G-ENG must show byte-identical scene v1 exports, and unchanged Artistic hashes, after the packet path is added.
- Treat main-thread Path2D or vertex construction as renderer work, governed by the renderer budget (R02), not by transport.
