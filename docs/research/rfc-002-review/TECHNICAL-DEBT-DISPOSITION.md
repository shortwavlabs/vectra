# RFC-002 review — technical debt disposition (§14)

Reviewer classification of all 25 open items in [TECHNICAL-DEBT.md](../../TECHNICAL-DEBT.md) at baseline `baf1d17`. **No item is marked resolved.** No correction was implemented in the product. This review only ran spikes in `experiments/rfc-002-review/`, and the register stays unchanged. Where an item's planned treatment should change, the change is a proposal for the RFC author and maintainer.

Classes (from the brief):
- **RFC** — must influence RFC-002;
- **P1-A**, **P1-B**, **P1-C** — must be addressed during that phase. The phase names refer to the revised gates in [REVISED-P1-SEQUENCE](REVISED-P1-SEQUENCE.md); the gate IDs are in brackets;
- **P2+** — can be deferred to P2 or later;
- **OWNER** — requires a maintainer decision.

An item can carry two classes: the architectural decision now, and the implementation later.

| ID | Sev. | Class | Review evidence | Disposition and change vs register |
|---|---|---|---|---|
| TD-GEO-001 | High | **RFC** + P1-C [G-SB] + OWNER (metric) | R04 reproduced the defect exactly. Oracle labels (Option A) remove 76–81 % of slivers but fail curvature. A shared-edge graph prototype gives 0 gaps, 0 overlaps and 0 slivers on 6 fixtures ([SHARED-BOUNDARY-STRATEGY](SHARED-BOUNDARY-STRATEGY.md)). | Representation decided in RFC-002 (D06 amended); implementation in the P1-C geometry gate, opt-in as precision v2. **New owner decision:** the registered antialiased sliver metric flags analytic truth on `discs-x2`. R04 proposes a crisp-sampled metric, which needs ratification before G-SB. |
| TD-GEO-002 | Med | P2+ | None (not architectural). | Unchanged. Keep out of the P1 editor path. |
| TD-GEO-003 | Med | P1-C [G-GEO] | None. | Unchanged. It sits in a geometry-quality gate separate from the editor gates, so it cannot block the document or renderer. |
| TD-GEO-004 | Low | P1-C [G-GEO] | R04: the end-constrained open-section fitter (prerequisite of G-SB) is the same machinery. | Same gate as GEO-003. Schedule after the byte-neutral fitter refactor (G-SB step 2). |
| TD-GEO-005 | Med | OWNER → P1 Line Art or P2 | None. | Depends on whether Line Art is in the P1 preset set (core preset order is an owner decision). It needs stroke output, which scene v1 supports. |
| TD-GEO-006 | Med | P2+ | None. | Unchanged. Needs scene v2 opacity or gradient constructs; no P1 dependency. |
| TD-GEO-007 | Med | **RFC** (promise) + P2-C (decoder) | None new. RFC §8 already words the promise "per identical decoded RGBA". | The determinism wording is settled in RFC-002. In-WASM decoding is needed **before** P2-C shared recipes or Variation Lab claim cross-browser reproducibility, not for P1. |
| TD-GEO-008 | Low | P2+ | None. | Unchanged (monitor). |
| TD-GEO-009 | Med | **RFC** + P1-C/P2 [G-SB step 3] | R04: stacked and mosaic both derive from one edge graph. | The route to precision with mosaic is the G-SB graph. Lift the validation error only after the gate. |
| TD-PERF-001 | High | **RFC** + P1-A [G-R0] + P1-B [G-R1] | R02: renderer bake-off, see [RENDERER-EVALUATION](RENDERER-EVALUATION.md). Path2D construction in Chromium is quadratic when built incrementally. | Renderer decision taken in RFC-002 (D04). A minimal renderer moves to P1-A so the document model can be validated visually; the production renderer, caches and index belong to P1-B. |
| TD-PERF-002 | Med | P1-A [G-ENG] (engine API) + P1-B (UI) | R03 estimator on the corpus, see [WORKER-SCHEDULING-AND-RECOVERY §4](WORKER-SCHEDULING-AND-RECOVERY.md). | Needs a staged engine API (segment → estimate → fit) instead of the hidden `segment_layers` diagnostic. Limited and halftone need their own estimators. |
| TD-PERF-003 | High | **RFC** + P1-A [G-DOC] + OWNER (lower-end budget) | R03 aggregate memory model, see [MEMORY-AND-RESOURCE-BUDGET](MEMORY-AND-RESOURCE-BUDGET.md). | RFC-002 must state the aggregate accounting model; P1-A implements the accounting. The per-device budget waits for real lower-end hardware (TD-PLATFORM-003). |
| TD-PERF-004 | Med | P1-A [G-JOB] + P1-B | R03: a start-up churn failure in WebKit offline, caused by terminating a worker during module load. | Remove the import debounce (P1-B). **New:** the scheduler rule "never terminate a worker before its job is posted" moves into the P1-A job gate. Preview-resolution tracing is P1-B. |
| TD-PERF-005 | Low | P2 (P2-C) | R02: the 977k-anchor single compound halftone is the hit-test and renderer worst case. | Unchanged phase. The physical-pitch default should land before Old Print becomes a product preset. |
| TD-PERF-006 | Low | P2+ | None. | Unchanged (product guidance: Artistic vs Precision). |
| TD-ARCH-001 | Med | **RFC** (ongoing) | R03/R04 used only the public or diagnostic API; no VTracer types are needed by the new seams. | Restate in RFC-002: new engine APIs (staged segmentation, packet output, edge graph) must not expose VTracer or visioncortex types. |
| TD-ARCH-002 | High | **RFC** + P1-A [G-JOB] | R03: 12 lifecycle scenarios, 16/16 checks in 3 engines online and offline. Committed layers were byte-identical after 3–8 worker terminations. | **Design answered, not closed:** the document stays on the main thread, workers hold only disposable work, and job inputs are copies. Closure requires the P1-A implementation and its termination tests. |
| TD-ARCH-003 | High | **RFC** + P1-A [G-DOC] | R01: JSON and packet are equal in size; the packet removes main-thread parse cost and is renderer-ready ([GEOMETRY-TRANSPORT-BENCHMARK](GEOMETRY-TRANSPORT-BENCHMARK.md)). | GeometryPacket v1 is accepted as the only editor transport (no JSON fallback). Scene v1 stays the export format; scene v2 only when a feature needs it. |
| TD-ARCH-004 | Low | P1-A [G-ENG] | R03 had to use `segment_layers` (hidden) for estimation. | Replace the diagnostic with a documented staged API, then gate the diagnostics behind a feature as planned. |
| TD-PLATFORM-001 | Low | OWNER / later | None. | Unchanged: before published hashes. Canonical Linux build is an owner decision. |
| TD-PLATFORM-002 | **High** | P1-B [G-R1, G-UI] + OWNER (safaridriver) | R03 found a WebKit-only offline start-up failure; R05-A found WebKit-only CSP noise from Playwright screenshots. | **Raised in priority.** Real Safari is needed for renderer, worker-lifecycle and design-system qualification. That needs the owner to enable `safaridriver` or test manually. |
| TD-PLATFORM-003 | **High** | OWNER (hardware) — blocks budget ratification | NOT RUN in this review (no lower-end device available). | Unchanged. All R01–R03 timings are reference-machine only, and were measured under unrelated background load ([FINAL-REPORT §Environment](FINAL-REPORT.md)). |
| TD-PLATFORM-004 | Med | OWNER / when UI exists | None. | Unchanged. |
| TD-PLATFORM-005 | Low | later (next Linux run) | None. | Unchanged. |
| TD-PROCESS-001 | Low | OWNER (before P1-A) | Review harnesses are local-only, by design. | The reviewer recommends one cheap required job before P1-A starts merging (fmt, clippy, cargo test, vp check, vp test, build). Browser, benchmark and review suites stay local. |

Counts:
- RFC-002 inputs, confirmed: 9 — GEO-001, GEO-007, GEO-009, PERF-001, PERF-003, ARCH-001, ARCH-002, ARCH-003, plus PERF-002 through the staged API.
- Owner decisions: GEO-001 metric, GEO-005, PERF-003 budget, PLATFORM-001/002/003/004, PROCESS-001.

## Additional risks discovered by this review (proposed register entries, not added)
| Proposed ID | Risk | Evidence | Proposed treatment |
|---|---|---|---|
| RISK-R02-PATH2D | Chromium 159 builds a Path2D incrementally (`moveTo`/`bezierCurveTo`) in **quadratic** time: 250k anchors in one path take 16.9 s, against 30 ms via `new Path2D(svgPathData)` and 8 ms via `addPath` of small paths. Firefox and WebKit are linear. | `artifacts/renderer/path2d-scaling.json` | The renderer must construct paths from path-data strings or chunked `addPath`. Add a regression benchmark to the renderer gate. |
| RISK-R03-WKCHURN | WebKit 27.2: when module workers are terminated while their service-worker-served module graph is still loading offline, the next worker fails with "Importing a module script failed". The P0 `client.ts` terminates a worker that may still be starting (`trace()` → `cancel()` → `discard()`). | `artifacts/lifecycle/lifecycle-v1-*.json` (14/16 checks, deterministic 4/4 runs) and v2 after the fix (16/16) | Scheduler rule in G-JOB: terminate only a worker that has received its job; requeue a job once on start-up failure. Production susceptibility is NOT RUN; add a production-build regression test. |
| RISK-R05-CSP | Base UI injects an inline `<style>` (ScrollArea), which violates `style-src 'self'`. Playwright's WebKit screenshot injects a `<style>` too. | `artifacts/design-system/csp-violations.json` | `<CSPProvider disableStyleElements>` plus one owned CSS rule; CSP violation tests clear their log before screenshots. |
| RISK-R05-A11Y | The Dice colour picker is not keyboard-complete (saturation area pointer-only, hex typing reverts, unnamed thumbs) and has no commit/cancel API. The shadcn Slider drops `aria-label`. | [DESIGN-SYSTEM-FEASIBILITY](DESIGN-SYSTEM-FEASIBILITY.md) | Patch the copied sources or own a picker built from Base UI sliders; this is a gate item in G-UI. |
| RISK-R05-TOKENS | `border` #414347 reaches 1.31–1.76:1 and the slider track 1.11:1, against the 3:1 non-text minimum. The lime focus ring fails on paper and on lime fills. | `artifacts/design-system/contrast.json` | Adopt control-border #787a7e (or similar) and a dual-colour focus ring; owner visual review. |
| RISK-R05-NOTICES | The root notice generator does not cover copied registry source or Tailwind CSS output. | R05-A §10 | Extend `generate-notices.mjs` before any distributed build that includes the design system. |
| RISK-R01-IMMUTABLE | Typed-array immutability is a convention: placing a committed buffer in a transfer list detaches it (byteLength 0) and silently destroys committed geometry. | R01 §5 | A GeometryStore API that never exposes committed `ArrayBuffer`s; job copies only (`jobCopy()`); an assertion in tests. |
| RISK-R02-WKOFFSCREEN | WebKit 27.2: the first frame of an OffscreenCanvas render worker appeared in page screenshots only after a delay (blank captures at 0–1 s for some sizes; visible at every size after 1.5 s). Firefox rasters huge single paths slowly in a worker (977k halftone: 594 ms). | `artifacts/renderer/offscreen-visibility.json`, `offscreen*.json` | G-R0: measure first-frame presentation on real Safari; keep the measured main-thread fallback (same renderer plus cache). |
| RISK-R02-DRAG | Object translate and scale with exact redraw cost an exact frame per frame (Firefox 467–917 ms on halftones); the gesture cache does not cover object drags. | `artifacts/renderer/bench-*.json` (editing table) | Layered display caches (background without the selection, plus the selection layer) in G-R1, measured in 3 engines. |
| RISK-R02-COMPOUND | One traced object can be a 195k-subpath compound path (halftone). Selection, hit-testing and editing granularity need subpath indexing; "select a dot" is impossible without an explicit split. | R02 hit-test | Subpath-level index for paths with many subpaths (prototype measured); explicit, containment-checked "split compound path" command later. |
| RISK-R04-METRIC | The registered TD-GEO-001 sliver metric and junction criterion fail on analytic truth (§3 of R04). | R04 | The owner ratifies the metric restatement before G-SB (no threshold lowering). |
