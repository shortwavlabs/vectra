# G-R0 — Minimal renderer with worker host (engineering workbench)

**Status:** **PARTIAL**, waiting for maintainer review. The renderer, render-worker host, disclosed fallback, recovery, hit testing and workbench integration are implemented. Correctness is 0 geometry-error pixels against the independent resvg reference in Chromium, Firefox, Playwright WebKit **and real Safari 26.6.2**, and gestures stay within budget everywhere. Two performance targets are not met:
- **Preview rendering ≤ 100 ms at the interactive target**: exact frame 96 ms (Chromium), 181 ms (Firefox), 103 ms (WebKit), 116 ms (real Safari), on a 270k-anchor, 16k-path workload (§7).
- **≤ 50 ms attributable main-thread blocking**: the cold hit-test index build takes 30–93 ms on the main thread. Load blocking is dominated by the preview commit (TD-PERF-010, accepted for G-JOB) and reported separately (§7).

**Baseline.** Branch `gate/g-r0-renderer` from `main` `be74819` (G-JOB merged). Excluded: production editor layout, layered drag caches, transform handles, editing tools, WebGL/WebGPU, Precision v2, Creative Lab. G-UI runs in parallel on its own branch, coordinated as in §9.

## 1. Architecture
| Module | Role |
|---|---|
| `src/renderer/core.ts` | Retained Canvas 2D renderer, shared by the worker and the fallback: linear Path2D construction from SVG path data (lazy, cached per chunk path), progressive exact frames (paint-order prefixes in time slices of 16 ms in the worker and 8 ms on the main thread), viewport culling by path bounds, run clips, nonzero/evenodd, strokes, the selection overlay, and the display-only gesture cache |
| `src/renderer/render.worker.ts` | Render worker. Posts `ready` with its build identity (protocol 2, build ID, packet version 1, `workerRaf`); accepts nothing but `init` before that; ignores other generations |
| `src/renderer/client.ts` | Main-thread transport: handshake check (mismatch is a typed `build_mismatch` error, no fallback), generation, canvas transfer, stale-frame rejection (frames older than the last sent render revision), crash recovery (new worker on a **new canvas** inserted under the old one, which keeps showing the last frame until the new canvas draws; the last camera and a full snapshot are replayed), start-up retry, and the **disclosed main-thread fallback** (no OffscreenCanvas, two start-up failures, no 2D context, more than 3 crashes in 30 s, or `?renderer=main`) |
| `src/renderer/{snapshot,protocol,path-data,build-info}.ts` | Snapshot and packet read types, render protocol, path data, identity. `src/renderer` imports nothing outside itself (C8; architecture test) |
| `src/canvas-host/render-host.ts` | The renderer host (C2 rule 9): one document evaluation per state into an immutable `RenderSnapshot`; render copies (`GeometryStore.renderCopy`) only of chunks the renderer lacks, plus releases; a full replacement when the document changes (chunk IDs are per store); selection mapped to draw-list indices; camera (fit, zoom about a point, pan, gestures); hit testing; per-stage timings |
| `src/canvas-host/CanvasHost.tsx` | `VectorCanvas`, implementing the agreed `CanvasHostProps` and `CanvasHostHandle` (`types.ts`): pointer drag pans, a click selects by hit test (Shift toggles), Ctrl/⌘-wheel zooms about the cursor, wheel pans, resize and DPR changes tracked |
| `src/hit-test/index.ts` | Renderer-independent geometric hit testing over the document's packets (read-only chunk views): uniform grid; per-subpath index for paths with more than 8 subpaths; lazily flattened typed-array polylines (0.05 local units); band index for subpaths above 2,048 points; nonzero/evenodd winding; closed clip test; hidden and fully clipped items absent; locked items skipped |
| `src/document/evaluate.ts` | Draw items also carry their PathObject id and effective lock (not part of C8 snapshots or exports) |

**Workbench.** The canvas replaces the SVG `<img>`. A preview no longer runs an SVG export job: the trace's packet is validated into the preview session and drawn from vector geometry. **Download SVG** and **Download PDF** are explicit engine exports of the preview session. The P0 SVG `<img>` stays behind `?svgPreview=1` for visual comparison. The toolbar has Fit and zoom buttons, the renderer host is disclosed ("Canvas: render worker" or "Canvas: main-thread fallback"), and selection is shown.

**Deviations and decisions to review:**
1. **A `selection` render message** (draw-list indices plus a render revision), so a selection change does not re-send the draw list. C5 lists `snapshot` with an optional selection.
2. **Frame reports carry** `camera`, `buildMs` (Path2D construction), `drawn`, `built` and `complete` beside `renderRevision`, `kind` and `ms`. The worker also posts `stats` (chunks, paths and bytes held).
3. **Progressive frames are reported as `interaction` with `complete: false`**: a prefix of the exact frame. Only `exact` with `complete: true` counts as evidence.
4. **Locked items are drawn but not hit**, so a click passes through to what lies beneath.
5. The hit-test index is built lazily on the first query (cold cost in §7), not pre-built in idle time.

## 2. Correctness against the independent reference
`tests/browser/renderer-correctness.spec.ts`. Ten fixture documents are generated by `tests/browser/renderer/make-fixtures.ts` from the committed scenes and the synthetic correctness scene (`src/hit-test/testing/scenes.ts`):
- the synthetic scene: rings with holes in every winding configuration, evenodd and nonzero pentagrams, three translucent discs in paint order, a 1 px bar, tiny dots and a clipped disc;
- `adjacent_colors-limited` (palette references); `thin_strokes-halftone` and its transparent variant (halftone backgrounds); `logo_transparent_hole-mosaic`; `nested_rings-color`;
- edited documents: a layer transform plus clip; a palette edit, a translucent recolour, a hidden path and a locked path; two layers with a transformed top layer; an empty group.

For each: the exact settled frame of the canvas, at an integer scale at the origin (worker and main-thread fallback, DPR 1 and 2), is compared with resvg/tiny-skia's render (`render_compare` example, no browser) of the engine's SVG export of the same document. Interior pixels differing by more than 48 are geometry errors; the reference's 1 px-dilated edge band is antialiasing. A frame counts only after the complete exact frame of the requested camera and the latest render revision.

| Engine | Renders | Geometry-error pixels | Max % of pixels differing > 32 (AA band) |
|---|---|---|---|
| Chromium 159 | 40 | **0** | 0.35 |
| Firefox 159 | 40 | **0** | 0.34 |
| Playwright WebKit 27.2 | 40 | **0** | 0.30 |
| **Real Safari 26.6.2** (WebDriver, DPR 2, worker and fallback) | 20 | **0** | 0.13 |

Mutation check: drawing every path with nonzero gives 2,844 geometry-error pixels.

**Two defects found by these tests, both fixed:**
- **Chunk identity is per store.** When the canvas switched documents, the host thought the renderer already held `chk_1`, and the new document's styles were drawn on the old geometry. The host now replaces every render copy on a document change.
- **The camera was lost before `init`.** A document and fit view that arrived before a slow render-worker start (Firefox) were drawn with the default view, because pre-`init` messages are ignored. The client now replays the last camera after every (re)start.

## 3. Interactions, selection, recovery
`tests/browser/renderer-behaviour.spec.ts`, 8 tests per engine:
- fit, zoom and drag-pan with display-cache interaction frames and an exact settle, worker and fallback;
- Ctrl-wheel zoom keeps the document point under the cursor (exact to 1e-6 px);
- click selection by hit test: bodies select; holes and empty space deselect; Shift toggles; the overlay is drawn in the exact frame; locked paths are not selectable;
- 20 rapid edits end with the exact frame of the latest revision; older frames are dropped and counted;
- **render-worker crash, online and offline**: a new worker on a new canvas (old canvas removed after the new frame), the snapshot replayed with every chunk, the document revision unchanged, and the same frame presented again (0 geometry-error pixels against its resvg reference);
- a render worker from another build is refused (`build_mismatch`, no fallback);
- geometry copies are released when the document changes (2 chunks, then 1).

Unit tests (`vp test`): hit testing — every `HIT_CHECKS` point, locks, visibility, transforms, the subpath and band indexes, and 2,000 random points against an independent brute-force implementation (mutations caught: fill rule ignored, locks ignored); the C8 import boundary (mutation-checked); path data and linear construction.

**Application updates with old sessions open:** `tests/browser/sw-update-lifecycle.spec.ts`. An old tab recreates its render worker from its own version's cache, offline, after a new build is deployed (3 engines).

**WebKit presentation.** As in R02, a worker canvas may be presented after its exact frame. The tests wait until the screen matches the reference and record the wait. In real Safari it was 47–58 ms after the exact frame (§6).

## 4. Browser results
Production build, Playwright 1.65.1, Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2 (not Safari), headless. **Full run on `42db2e8`: 147/147 passed** (5.0 min): the P0 suites, the G-JOB specs (lifecycle, adversarial, update lifecycle incl. the render worker in an old tab), `renderer-correctness` (4 tests) and `renderer-behaviour` (8 tests), × 3 engines.

## 5. Real Safari (Safari 26.6.2, macOS 26.6.2 25G83)
`node tests/safari/gr0.mjs` (dependency-free WebDriver client; fresh session and origin per scenario). **7/7 pass.** Evidence: `docs/research/g-r0/safari/gr0-8145d1d.json`.

| Scenario | Result |
|---|---|
| OffscreenCanvas support | `OffscreenCanvas`, `transferControlToOffscreen` and worker 2D context present; host = render worker |
| Canvas 2D correctness, worker host | 10/10 fixtures, 0 geometry-error pixels (DPR 2) |
| Canvas 2D correctness, main-thread fallback | 10/10, 0 geometry-error pixels; fallback disclosed |
| First-frame presentation | show → exact frame 10–12 ms on the fixtures; presented ≤ 47–58 ms after the exact frame (an upper bound: it includes the WebDriver screenshot) |
| Render-worker recovery | crash → new worker and canvas → same frame presented again, online and with the origin unreachable (offline) |
| Pan and zoom | interactive (270k anchors): exact frame 116 ms, pan p95 19 ms, zoom p95 18 ms, exact settle 44/23 ms; stress (812k): exact frame 339 ms, pan p95 19 ms, zoom p95 18 ms, settle 78/80 ms |
| Main-thread fallback | disclosed label; correct frame presented |

**Project save/load interchange in Safari** (`node tests/safari/persistence.mjs`, the P1-A persistence harness): **23/23 checks.**
- Safari ↔ Node ↔ Chromium, Firefox and Playwright WebKit, both codecs, in both directions; `none` bytes identical to Node's.
- Round trip clean with a byte-identical resave.
- 8 or 7 malformed and 5 limit cases fail atomically with typed errors.

Evidence: `docs/research/g-r0/safari/persistence-42db2e8.json`.

## 6. Performance (run A)
**Conditions.**
- Apple M5 Max, headed, production build, viewport 1280×720 (DPR 1; WebKit DPR 2). Load average 1.5–1.9; no `ngspice` and no other project's CPU-bound jobs visible. My own G-UI agent may have been working, so the run is **not certified quiet**.
- Workloads: the G-JOB registered `bark-1224.png` `a4629ed3…` (colour, 269,996 anchors, 16,056 paths) and `bark-2350.png` `daa939de…` (colour, 812,003 anchors, 43,621 paths).
- Command: `R0_PERF=1 R0_PERF_LABEL=run-a pnpm exec playwright test tests/browser/renderer-perf.spec.ts --headed`. Artefacts: `docs/research/g-r0/bench/run-a/`.

**Stages** (ms; the trace itself runs in the compute worker):

| Workload / engine | Preview commit (doc prep, TD-PERF-010) | Snapshot prepare | Render copy / post | First (progressive) frame | Exact frame | Worker draw (incl. Path2D) |
|---|---|---|---|---|---|---|
| Interactive, Chromium | 60 | 6.7 | 0.7 / 2.9 | 68 | **96** | 40 |
| Interactive, Firefox | 65 | 6.0 | 0.0 / 5.0 | 68 | **181** | 117 |
| Interactive, WebKit | 61 | 8.0 | 1.0 / 5.0 | 68 | **103** | 44 |
| Stress, Chromium | 122 | 13.8 | 2.2 / 7.1 | 93 | 268 | 164 |
| Stress, Firefox | 151 | 20.0 | 2.0 / 15.0 | 110 | 536 | 376 |
| Stress, WebKit | 141 | 24.0 | 3.0 / 14.0 | 100 | 283 | 182 |

Render copies: 12.9 MB (interactive) and 64.4 MB (stress) per document. The worker held 13.4 MB and 40.1 MB.

**Responsiveness.**

| Measure | Chromium | Firefox | WebKit | Target |
|---|---|---|---|---|
| Pan p95, interactive / stress (worker + cache) | 18.5 / 18.4 | 18.5 / 18.5 | 19.0 / 18.0 | ≤ 33 ms: **met** |
| Zoom p95, interactive / stress | 18.5 / 18.6 | 18.6 / 18.5 | 19.0 / 18.0 | met |
| Main-thread max gap during gestures | 19 / 19 | 19 / 19 | 21 / 19 | ≤ 50 ms: **met** |
| Exact settle after a pan, interactive / stress | 28 / 51 | 55 / 100 | 55 / 77 | no target (off the main thread) |
| Main-thread max gap during load, interactive / stress | 48 / 117 | 67 / 150 | 74 / 161 | ≤ 50 ms: **not met**; the preview commit (60–151 ms, TD-PERF-010) dominates |
| Renderer main-thread work per document (prepare + copy + post), interactive / stress | 10 / 23 | 11 / 37 | 14 / 41 | within 50 ms |
| Hit test cold (index build + first query), interactive / stress | 31 / 73 | 30 / 82 | 41 / 93 | ≤ 50 ms blocking: **not met at stress** |
| Hit test warm p95 | 0.015 | 0.05 | 0.05 | ≤ 8 ms: **met** (1 ms clocks in Firefox and WebKit; 20-query loops) |
| Render-worker recovery (crash → first exact frame) | 60 | 98 | 54 | — |
| Path2D from path data, 25k / 125k / 250k anchors (one path) | 0.3 / 2 / 4 | 1 / 4 / 8 | 1 / 3 / 6 | linear (TD-REN-001) |
| Display surfaces (canvas + cache backing) | 1.7 MB | 1.7 MB | 7.0 MB (DPR 2) | — |

**Main-thread fallback** (same workloads): gestures still p95 17–19 ms through the cache. Load blocking is the same as the worker host's (dominated by the commit). The exact draw is time-sliced: a single huge path's `fill()` cannot be sliced.

## 7. Targets not met
- **Preview rendering ≤ 100 ms** (RFC §17; validated packet → first complete frame, ≤ 250k anchors): exact frame 96 / 181 / 103 / 116 ms (Chromium / Firefox / WebKit / Safari) at 270k anchors. The progressive first frame appears at 68 ms in every engine. R02 had already found that only Chromium met this target. **G-R1** owns closure (TD-PERF-001).
- **≤ 50 ms blocking: the cold hit-test index** build is 30–93 ms on the first click (TD-REN-004: idle pre-flattening was the planned remedy, not implemented here).
- **Load blocking** remains the G-JOB exception TD-PERF-010 (preview and final commits), owned by G-TRACE. The renderer's own main-thread stages are ≤ 41 ms.

## 8. Regression results
- Document export regression: **636/636** on the G-R0 code (`8145d1d`; evaluation now carries `nodeId` and `locked`, not exported).
- 326 + 72: `crates/` and `packages/` are unchanged since `main`; the `main` results apply.
- `vp test`: 360/360; `vp check`: pass.
- Bundle v1 regenerated through the canvas workbench (SVG and PDF downloads are now engine export jobs): **14/14** byte-identical.
- Full browser suite: 147/147 (§4).

## 9. G-UI coordination and G-R1 integration plan
- **File ownership.** G-R0 owns `src/renderer/**`, `src/canvas-host/{render-host.ts,CanvasHost.tsx}`, `src/hit-test/**`, the workbench files (`index.html`, `src/main.tsx`, `src/App.tsx`, `src/workspace/**`), its specs and `tests/safari/**`. G-UI owns `workspace.html`, `src/shell/**`, `src/ui/**`, `vite.config.ts`, the dependency manifests and notices.
- **Shared.** `src/canvas-host/types.ts` is byte-identical on both branches (`c9a30060…`).
- **G-R1 integration.** Replace G-UI's interim host with `VectorCanvas`, which already implements the agreed props and handle, and bind the shell's selection, view controls and status to it. Then add the layered drag caches and transform handles (G-R1), pre-build the hit index in idle time, and requalify against the targets in §7 on a quiet reference run and lower-end hardware.

## 10. CI
See the PR description (exact head and CI run).

## 11. Debt
- **TD-REN-001:** linear construction in the production renderer, and the scaling measured in 3 engines (§6). Closure criteria **met; proposed for closure**.
- **TD-REN-002:** worker-canvas presentation measured; real Safari first-frame presentation qualified (≤ 58 ms after the exact frame); fallback implemented, disclosed and measured. Closure criteria **met; proposed for closure**.
- **TD-REN-004:** subpath and band indexes implemented, warm p95 ≤ 0.05 ms on the bark workloads. Not closed: the 977k halftone stress case was not measured and cold queries are not pre-flattened.
- **TD-PERF-001:** first part (architecture, measurements) delivered; closure stays with G-R1 and lower-end hardware.
- **TD-PLATFORM-002:** real Safari now covers G-JOB, G-R0 and persistence interchange. iOS and Android are not covered.

## 12. Disposition
**G-R0: PARTIAL.** Functionally complete and correct in four engines including real Safari. Not met: preview rendering ≤ 100 ms at the interactive target (Firefox, WebKit, Safari), and the cold hit-index build (≤ 50 ms at stress). Not quiet-certified; lower-end hardware NOT RUN.
