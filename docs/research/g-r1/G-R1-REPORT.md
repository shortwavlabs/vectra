# G-R1 — Production rendering and interactions (P1-B)

**Status:** **PARTIAL**. Maintainer review on 2026-11-25: accepted in principle. The decisions and the corrections they required are in §12 ([decision register §10](../g0/G0-DECISION-REGISTER.md)).

The G-R0 renderer now drives the real workspace. In Chromium, Firefox and Playwright WebKit:
- transform handles and compositing-preserving layered drag caches are qualified against exact frames, with 0 geometry errors in all 12 matrix cases;
- hit-index preparation is bounded;
- single paths are selectable by keyboard;
- gestures and drags stay at frame rate (p95 ≤ 19 ms).

These remain open:
- **Preview ≤ 100 ms** on the registered interactive target is missed in every engine: 146 / 270 / 147 ms. The maintainer accepted the miss temporarily for downstream engineering. TD-PERF-001 and the target are retained.
- **TD-PERF-007** structural transactions: investigated. Options B, C and D are authorised as the follow-up gate G-DOC-R.
- **Real Safari timing** is NOT RUN (the automation window was hidden). **VoiceOver** and the **stock-Safari keyboard** check are NOT RUN; owner checklists are provided.
- **Lower-end hardware** and a **quiet-machine** run are NOT RUN.

**Baseline.**
- `main` is `7f57dd716bdbec0a6160da3585b445852f464859`: G-R0 (#16) and G-UI (#17) merged with merge commits after the combined tree was verified (decision register §9).
- Branch: `gate/g-r1-interactive`.
- Not included: G-UI-R (a separate PR stacked on this branch) and R-COLOR (an independent research session). Not started: Precision v2, shared-boundary geometry, production CMYK, deployment.

## 1. The renderer in the workspace (brief §5)
- `src/shell/Workspace.tsx` renders the document with `VectorCanvas`: the render worker, or the disclosed main-thread fallback. `InterimCanvasHost`, its preview SVG export job and the bounding-box hit test are deleted.
- **Edits reach the canvas without any job.** `ui-document` "the canvas catches up with rapid keyboard edits" requires that the latest revision's exact frame is drawn with `jobsSubmitted` unchanged. SVG and PDF remain engine export jobs. The workbench keeps its labelled `?svgPreview=1` comparison path.
- **The status bar names the renderer state and host:**
  - "Renderer: worker · ready";
  - "Renderer: main thread (fallback: <reason>) · ready";
  - "recovering (<reason>)".
- **Selection colours** are the design-system lime over a dark halo, passed through the renderer surface. Lime alone is near-invisible on the ivory paper.

## 2. Targeted reviews (brief §6), on the integrated workspace

| Review | Result | Mutation check |
|---|---|---|
| 6.1 build-aware offline status | `jobs/offline-status.ts` is shared with the workbench. "Offline ready" only when the controller is this build; a mismatch and a waiting update are separate notices; no forced reload. `workspace-offline` 15/15 (3 engines), covering:<br>• offline reload;<br>• compute and render workers recreated from the cache;<br>• a deploy with old workspace and workbench tabs open;<br>• a template-only update;<br>• eviction (recovery page for another build, repair from an identical build);<br>• the mismatch after a first-install claim. | Build-unaware status: 3 of 3 fail |
| 6.2 selection semantics | Containers resolve to their drawn descendants per evaluation, never by identity (`itemsOf`). Hidden descendants are excluded from items and bounds; locked ones are drawn but never picked. Holes miss. Ancestor clips do not bound a path; a clipping group's own clip does. Overlay, inspector and camera agree. Shift adds to a multiple selection. Undo and redo keep the selection. **Bug fixed:** adopting another document clears the selection (node IDs repeat across documents; the test selects an ID both documents contain). | — |
| 6.3 import concurrency | **Bug fixed:** the `tracing` guard was React state set after the first `await`, so a repeat or a drop during decoding interleaved and re-pointed the job controller. A synchronous guard now refuses it, with a separate notice. The import target is fixed at start and re-checked after decoding. Preparation is cancellable, and the controller always targets the shown document. A deterministic preparation gate covers a rapid repeat, a drop, a failed second import, cancel during preparation, replacement during preparation, and a stale mid-trace replacement. | Guard disabled: the original race reappears and the test fails |
| 6.4 renderer lifecycle | 12 remounts, a document switch, a crash and 20 rapid edits leave exactly one render worker and one canvas, holding exactly the drawn chunks. The same holds under React StrictMode on the dev server. Generation and build validation and stale-frame rejection are exercised. | `dispose()` skipped: 6 of 6 fail |

**A renderer bug found by the performance spec** (G-R0 code, latent, all engines):
- The sequence: a selection arrived while an exact frame for a new camera was in progress. The renderer re-presented the old camera's cache, and the frame in progress completed under the old revision, which the client discards.
- The effect: no exact frame of the current revision was produced, and the canvas stayed "rendering". It reproduced on a 4000×3000 document.
- The fix (`81a706a`): a frame in progress continues and reports the latest revision; the cache is used only for its own camera.
- `src/renderer/core.test.ts` reproduces the sequence with a stub context and a manual clock and scheduler. Reverting the fix fails it.

## 3. Interactive renderer (brief §7)
**Contract.** `src/canvas-host/types.ts` gains two additive members, recorded here as the agreed amendment:
- `transformable`;
- `onTransform(ids, matrix)`: one completed gesture, which the shell dispatches as one command (one undo step).

The canvas stays read-only. The preview is display only, and Escape reports nothing.

**Pointer model (owner to confirm).**
- A click selects through the exact hit test.
- A drag that starts inside the selection's box moves it, when transformable; any other drag pans. Space-drag and the middle button always pan.
- Eight handles: corners scale uniformly about the opposite corner, edges along one axis; with Alt, about the centre.
- Escape cancels.

**Lock rule (owner to confirm).** A transform never moves a locked object. A selection that is locked, has a locked ancestor or contains a locked descendant shows no handles and does not move (the drag pans). The inspector freezes its transform fields with a note. Delete keeps G-UI's behaviour: a deleted container takes its locked descendants with it. That difference is recorded for the owner.

**Layered drag caches (RFC §8.4).** At drag start the draw list is cut in paint order:
- **Static layers** cover the ranges below, between and above the selection.
- **Moving layers** hold the selected runs, split where their fixed clip changes. Clips owned inside the moved subtree move with the layer; clips owned above it stay fixed and apply when compositing.
- **Poses.** A pure translation blits the moving layers. A scale redraws the moving items as vectors between the cached static layers: RFC §8.4's "live selection", exact.
- **Memory** is capped at 192 MiB and 10 segments. Over it, only the ranges below and above are cached and the moving range is redrawn exactly each frame (correct, slower). Layer count and bytes are reported.
- **Settle.** After release the pose stays on screen; the exact frame is drawn off-screen and swapped in when complete, so no partial frame flashes. An edit during a drag restarts the layers on the new snapshot.

**Qualification against exact frames** (`drag-correctness`, 48/48; `drag/*.json`). Each drag frame is compared with the exact frame after committing the same transform, under the G-R0 metric (difference > 48 outside the antialiasing band). Cases:
- bottom, middle and top of paint order;
- non-contiguous;
- translucent overlap;
- a clip owned outside the selection and a clip owned by it;
- nested groups with a hidden descendant;
- layer transforms;
- a fractional translation;
- a corner scale and a one-axis non-contiguous scale;
- an edit during a drag.

Result: **0 geometry-error pixels** in Chromium, Firefox and Playwright WebKit, and in **real Safari 26.6.2** for 6 cases. Pointer tests cover move with one undo step, Escape (no history entry), a uniform corner handle and the lock rule. Mutation: flattening the moving layers above everything fails 5 of 12 cases.

**Hit index (bounded).** The index is built incrementally:
- verbs scanned and entries placed are units, and the build pauses inside any path, including the 977k halftone;
- the host prepares it after each evaluation in slices of ≤ 4 ms of 512 units;
- a click before it is ready waits, with slices running back to back, and is answered only by the complete index, which throws on a partial one;
- an answer whose evaluation changed meanwhile is dropped.

Tests: stepping by 1, 7, 64 and 4096 units agrees with the reference build on fixed checks and 2,000 random points; no step adds more entries than its budget, which fails on the earlier code.

## 4. Accessibility (brief §9)
- **Keyboard selection of single paths, with no DOM element per object.** The canvas is a focusable widget (`role="application"`, roledescription "canvas") with a hint. Arrow keys walk the document tree in the Layers panel's order; Enter or Space selects; Shift toggles.
- **Announcements.** A polite live region announces the object, its position and its state; the keyboard cursor's object gets a dashed box, and the view follows it. Errors are alerts; processing is a polite status. The canvas focus ring is lime, drawn inside its edge.
- **Tests:** `workspace-a11y` 9/9 in 3 engines; real Safari keyboard scenario PASS ("Trace, layer, 11 paths, 1 of 1" → "Path 11, fill #0f766e, 1 of 1" → "… selected").
- **NOT RUN:**
  - the VoiceOver smoke test. The owner checklist is [VOICEOVER-CHECKLIST.md](VOICEOVER-CHECKLIST.md), covering import, canvas navigation, single-object selection, layers and groups, transform controls, colour picker, undo/redo, export dialog, and errors and processing;
  - the manual stock-Safari keyboard check (section A of the same checklist). Safari automation enables full keyboard access, so automation cannot show it.

## 5. Performance (brief §8): run B, reference machine, not quiet
**Machine and browsers.**
- Apple M5 Max; load 1.5–2.5; no ngspice.
- Headed, 1280×720, Playwright 1.65.1: Chromium 159.0.8154.6 (DPR 1), Firefox 159.0 (DPR 1), Playwright WebKit 27.2 (DPR 2).
- A fresh context for each workload. Raw data: `bench/run-b/`. The earlier run A is superseded: its gesture settle and drag start were measured before the camera backlog had drained, a fault in the spec, fixed.

**Workloads** (`bench/workloads.json`; built by `tests/browser/renderer/make-workloads.ts` from hash-checked registered inputs):

| Workload | Paths | Anchors | Subpaths | Input |
|---|---|---|---|---|
| synthetic-many-250k (RFC interactive target) | 41,853 | 250,000 | 50,000 | R02 register `46280a24…` (holes, translucency, palette refs) |
| bark-1224 (just above the 250k interactive bound, below the stress range) | 16,056 | 269,996 | 16,357 | G-JOB `a4629ed3…`, Full Colour defaults |
| bark-2350 (stress) | 43,621 | 812,003 | 45,211 | G-JOB `daa939de…`, Full Colour defaults |
| architecture-street-halftone (stress) | 1 | 977,505 | 195,501 | a4cf172 `482181c8…` |

**Stages, interactive target** (ms; Chromium / Firefox / WebKit):

| Stage | Chromium | Firefox | WebKit |
|---|---|---|---|
| Container load + validation (G-PRJ) | 123 | 145 | 148 |
| Evaluation | 11.2 | 10 | 14 |
| Snapshot construction | 4.0 | 7 | 3 |
| Geometry copy | 0.7 | 1 | 1 |
| Post (transfer) | 7.1 | 15 | 13 |
| Path construction (renderer) | 142 | 657 | 137 |
| Progressive first frame | 84 | 104 | 88 |
| Complete exact frame (renderer message) | 130 | 248 | 130 |
| **Preview** (validated document → exact frame) | **146** | **270** | **147** |
| Visible presentation (displayed canvas sampled) | 147 (+1.4 after the message) | 253 (same frame) | 151 (+4) |

**Path construction exceeds the exact-frame time** because it is summed per item, while the exact frame draws progressively and in parallel. It is the dominant renderer cost in Firefox.

**Presentation.** The page samples the displayed canvas every animation frame until it shows the final frame. Where the sampler works, the visible frame follows the renderer's exact-frame message within one animation frame (−17 to +11 ms; a negative value means the same rAF interval). Where it is inconclusive:
- the halftone in Firefox (its 16×16 signature settled early);
- the halftone in WebKit (the canvas read back as unsupported);
- bark-1224 in Chromium and WebKit (no stable final sample).

**All workloads** (Chromium / Firefox / WebKit):

| Measure | synthetic-many-250k | bark-1224 | bark-2350 | 977k halftone |
|---|---|---|---|---|
| Preview (ms) | 146 / 270 / 147 | 105 / 204 / 116 | 298 / 582 / 296 | 281 / 842 / 247 |
| Pan p95, max (ms) | 18.5, 18.6 / 18.1, 18.6 / 18, 23 | 18.5, 18.6 / 18.6, 18.6 / 18, 19 | 18.5, 18.6 / 18.2, 18.5 / 18, 19 | 18.5, 18.6 / 18.3, 18.5 / 18, **140** |
| Zoom p95 (ms) | 18.5 / 16.9 / 18 | 17.8 / 18.5 / 18 | 16.8 / 18.2 / 18 | 18.6 / 18.6 / 19 (max **92** WebKit) |
| Exact settle after a gesture (ms) | 55 / 55 / 57 | 30 / 79 / 56 | 74 / 137 / 101 | 6 / 171 / 76 |
| Drag: start to first pose (ms) | 27 / 36 / 18 | 17 / 40 / 17 | 52 / 92 / 65 | 11 / 230 / 99 |
| Drag frame p95 (ms); main-thread max gap | 18.4; 18.6 / 18.0; 38.6 / 18; 23 | 18.5; 18.6 / 18.5; 30.4 / 18; 19 | 18.5; 33.4 / 18.5; 38.2 / 18; 26 | 18.5; 18.6 / 18.2; 18.7 / 18; 19 |
| Drag layers (mode, MiB) | layers, 3.6 / 3.6 / 14.5 | layers, 3.6 / 3.6 / 14.5 | layers, 3.6 / 3.6 / 14.5 | layers, 5.0 / 5.0 / 19.8 |
| Exact settle after release (ms) | 91 / 127 / 118 | 72 / 106 / 85 | 134 / 218 / 183 | 16 / 88 / 60 |
| Hit index ready (ms); longest slice | 51; 4.0 / 113; 9 / 74; 5 | 36; 4.1 / 86; 4 / 54; 4 | 96; 4.4 / 180; 11 / 130; 4 | 90; 6.9 / 896; 4 / 71; 4 |
| Click before the index is ready: answered after (ms) | 23 / 28 / 42 | 16 / 27 / 34 | 66 / 92 / 95 | 69 / 68 / 58 |
| Warm hit p95 (ms) | ≤ 0.005 | ≤ 0.05 | ≤ 0.05 | ≤ 0.005 |
| Render-worker recovery (ms) | 83 / 164 / 83 | 71 / 148 / 74 | 215 / 429 / 203 | 237 / 624 / 192 |

**Halftone stage split.** For the single-path 977k halftone, the renderer reports almost no JS time for path construction and drawing in Chromium and WebKit; the cost appears only as message-to-frame latency. The per-stage split is therefore not resolved for that workload.

**Targets (RFC §17; none lowered):**

| Target | Result |
|---|---|
| Preview ≤ 100 ms at ≤ 250k anchors and ~40k paths (interactive target only) | **NOT MET**: 146 / 270 / 147 on the interactive target. Accepted temporarily by the maintainer for downstream engineering; TD-PERF-001 and the target are retained |
| Stress workloads (500k–1M anchors, RFC §8.8): bark-2350, 977k halftone | **Measured, no preview threshold**: the RFC sets the 100 ms target for the interactive target only, so no identical stress threshold is invented. Preview 298 / 582 / 296 and 281 / 842 / 247 ms. bark-1224 (270k anchors, just above the interactive bound) is reported, not graded: 105 / 204 / 116 |
| Gesture frame p95 ≤ 33 ms | **MET**: ≤ 19 ms everywhere. Single-frame maxima of 140 ms (pan) and 92 ms (zoom) on the WebKit halftone |
| ≤ 50 ms attributable blocking: renderer | **MET**: per snapshot, evaluation + snapshot + copy + post is 15–42 ms; hit-index slices ≤ 11 ms (cold index previously 30–93 ms); drag main-thread gaps ≤ 38.6 ms |
| ≤ 50 ms attributable blocking: load | **NOT MET, outside G-R1**: load-time gaps of 100–300 ms come from container validation (G-PRJ, TD-PERF-009), or from the trace commit for imports (TD-PERF-010) |
| Structural dispatch | **NOT MET**: TD-PERF-007, §6 |

**Not run:**
- real-Safari timing: the window was hidden (`visibilityState` "hidden", 0 animation frames), so the Safari render timings in `safari/gr1-8249a22.json` are flagged invalid;
- lower-end hardware;
- a quiet-machine run;
- Linux browsers.

## 6. TD-PERF-007 investigation
[TD-PERF-007-INVESTIGATION.md](TD-PERF-007-INVESTIGATION.md) (subagent, merged as `8249a22`; nothing is wired).

**Profile** (Node 24.22.1, load 2.3–4.7, not quiet). Whole-state validation is 62–89 % of a structural transaction and copying 10–18 %. A one-node edit costs:

| Paths | dispatch | of which validateState | of which copy |
|---|---|---|---|
| 43k | 22 ms | 18 ms | 3 ms |
| 250k | 144 ms | 120 ms | 24 ms |

**Additional findings:**
- whole-tree walks in `setFill`, `group`, `delete` and `duplicate`;
- unneeded map re-copies;
- each history state keeps a full node-map table, about 7 MiB at 251k nodes, which the 128 MiB history budget does not count. Proposed as **TD-PERF-011**.

**Prototype incremental validator.**
- It agrees with the full validator on 62,124 comparisons over 5 seeds, invalid transactions included, with 0 disagreements.
- Seed 20261125 (12,427 comparisons) runs in `vp test`.
- `validateState` remains the oracle and the only path for loaded documents.

**Decision (maintainer, 2026-11-25).** Options B, C and D are authorised, in that order, as the dedicated gate **G-DOC-R** ([scope](../g-doc-r/G-DOC-R-SCOPE.md)). The options:
- **B:** wire the prototype in with a comparison mode;
- **C:** Draft-recorded keys, plus cheap command fixes;
- **D:** a chunked copy-on-write node map, the only route found to ≤ 50 ms at 250k and to bounded history memory.

G-DOC-R also investigates per-subtree summaries for the whole-layer transform recheck at 250k (~56 ms).

## 7. Bundle (gzip -9; `node docs/research/g-ui/measure-bundle.mjs`)

| Measure | Result | Budget |
|---|---|---|
| Additional design-system JS | 113.8 KiB | ≤ 150 |
| Design-system CSS | 8.2 KiB | ≤ 15 |
| Initial workspace JS | 228.1 KiB | ≤ 250 |

All extra JS over the workbench baseline is 161.9 KiB. It now includes the renderer host, hit testing, the handles and keyboard navigation (domain code 35.7 KiB), and is disclosed, not budgeted. The persistence container code ships as a separate chunk, loaded only by the debug API.

## 8. Regressions
Filled from the final run (§10).

## 9. G-UI-R and integration
- G-UI-R, the design refinement with the Impeccable skill and before/after screenshots, is a separate PR stacked on this branch, based on the integrated workspace.
- File ownership: G-UI-R holds `src/shell/**` presentation and `src/ui/**`; G-R1 holds the canvas host, renderer, hit test, documents and engineering specs.

## 10. Regression results and CI
See the PR description: exact head, CI run, and the final regression run (full browser suite, export 636, bundle v1).

## 11. Disposition
**G-R1: PARTIAL.**
- Functionally complete and correct (compositing matrix 0 errors in four engines).
- Interaction budgets met on the reference machine.
- Not met: preview ≤ 100 ms at the interactive target, accepted temporarily by the maintainer (TD-PERF-001 retained), and the TD-PERF-007 structural dispatch targets, authorised for G-DOC-R.
- NOT RUN: real-Safari timing, VoiceOver, the stock-Safari keyboard check, lower-end hardware and a quiet run.

## 12. Maintainer review and corrections (2026-11-25)
These decisions are recorded in [decision register §10](../g0/G0-DECISION-REGISTER.md). All historical PARTIAL dispositions are unchanged.

**Accepted.**
- The additive contract amendment: `transformable` and `onTransform`.
- The pointer model, including "one completed gesture is one undo transaction".
- The layered drag-cache architecture.
- The complete-preview miss, temporarily, for downstream engineering. TD-PERF-001 and the targets are retained, and grading separates interactive from stress workloads (§5).
- G-DOC-R is authorised for TD-PERF-007 and TD-PERF-011 ([scope](../g-doc-r/G-DOC-R-SCOPE.md)).

**Corrections on this branch:**

| # | Correction | Commit | Verification |
|---|---|---|---|
| 1 | The two test-race fixes from G-UI-R, including the bounded diagnostic read: `selectOnCanvas` waits for each probe's asynchronous answer, and the selection reads poll the committed render | `19e9618`, `463a11d` (cherry-picked with `-x` from `83e0816`, `d283ef8`) | Full suite and stress (below) |
| 2 | **Canvas keyboard focus ring at the canvas-host level.** The host's outline was painted under its own canvas layers, invisible in Chromium (WCAG 2.4.7). The host now draws the dual ring as its top layer: it follows `:focus-visible`, is an outline (so it survives forced-colours mode) and takes no pointer input. The shell's `.vectra-canvas:focus-visible` rule is removed | `d9b5208` | `workspace-a11y` reads **rendered pixels**: both ring bands along all four edges, with artwork and the selection overlay under every edge. A pointer click shows no ring and still selects; the ring is never the hit element. Chromium, Firefox and Playwright WebKit pass. Mutations (no ring layer; ring under the layers) fail in all 3. Real Safari: the `gr1.mjs` 'focus' scenario (Option-Tab; viewport capture) passes |
| 3 | **Locks extend to deletion.** Deleting a container that holds locked descendants is refused with an actionable alert ("Not deleted: "…" contains N locked objects. Unlock them to delete."), with no partial deletion. Directly locked items are kept and reported. `planDeletion` is the one policy for the Delete key and the Layers menu. Commands do not enforce locks, so the document architecture is unchanged. Palette edits still reach locked paths, and the Recolor panel discloses this | `7783458`, `02d22bd` | Unit tests (a mutation removing the refusal fails 2). Browser tests cover pointer (a drag pans; no handles), keyboard Delete, the Layers menu, the inspector (frozen transform; a layer fill skips the locked path) and undo/redo (the lock returns and protects again). A UI-only test reproduces checklist D2b |
| 4 | Documentation: decision register §10, G-DOC-R scope, TECHNICAL-DEBT, this report, VoiceOver checklist (A5, C8, D2b) | `02d22bd` | — |

**Verification on `02d22bd`.** Environment: Apple M5 Max, macOS 26.6.2, Node 24.22.1, Playwright 1.65.1 (Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2). The machine is shared and was not quiet.

| Check | Result |
|---|---|
| `vp check` | Clean (301 files formatted; no lint or type errors in 168) |
| `vp test` | 26 files, **386 passed** |
| Build | Dist check passed; 55 notices verified |
| Bundle (gzip KiB) | Design-system JS 113.8, CSS 8.4, initial workspace JS 228.6 (budgets 150 / 15 / 250) |
| Playwright full suite, 3 engines | **333 passed, 0 failed, 0 flaky**, 27 skipped (opt-in specs); 7.3 min; load average 2.36 → 1.51 |
| Stress: `workspace-a11y`, `workspace-integration`, `ui-document`, `drag-correctness`, `--repeat-each=3`, 3 engines | **414 passed**; 5.4 min; load average 1.51 → 3.26 |
| Real Safari 26.6.2, G-JOB (`gjob.mjs`) | **10/10** |
| Real Safari, persistence (`persistence.mjs`) | **23/23** |
| Real Safari, focus ring (`gr1.mjs focus`, on `d9b5208`; `src/canvas-host` unchanged since) | **PASS**, page visible. Canvas reached in 9 Option-Tab presses; `:focus-visible` and the ring shown. Outer band sample (185, 225, 124) against the ring colour (185, 232, 123); inner band (24, 25, 26) against the halo (25, 26, 28). A pointer click: focused, not `:focus-visible`, no ring, 0 lime samples. The JSON record was overwritten by a later run; these values are transcribed from that run's output |
| Real Safari, G-R0 (`gr0.mjs`), G-UI (`gui.mjs`) and G-R1 (`gr1.mjs`) on `02d22bd` | **INVALID, re-run pending.** The macOS screen was **locked** during the run (`CGSSessionScreenIsLocked` true), so the automation page was hidden: `gr1.mjs` measured 0 animation frames in 500 ms. Focus-visible, tooltips, dialogs and animation-frame timing cannot be tested on a hidden page. Results: G-R0 6/7 (pan-zoom timing failed), G-UI 4/15, G-R1 4/5 with 1 NOT RUN. These are not counted as results. A probe after the run still reported the page hidden |

