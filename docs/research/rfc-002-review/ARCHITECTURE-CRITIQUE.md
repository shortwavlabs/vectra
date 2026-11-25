# RFC-002 review R00 — independent architecture critique

Reviewed:
- RFC-002 at `0e32fda` (PR #4), with DESIGN-SYSTEM.md and RFC-002-REVIEW.md;
- the implementation at baseline `baf1d17`;
- the handoff, debt, postmortem and product documents listed in the brief.

Evidence labels:
- **[source]** — code or document inspection;
- **[measured]** — executed in this review; raw data under `artifacts/`;
- **[analysis]** — reasoning without execution.

Dispositions use the brief's four values. **No P1 code was written; RFC-002 itself is not edited.** Proposed redlines are collected in [RFC-002-PROPOSED-AMENDMENTS](RFC-002-PROPOSED-AMENDMENTS.md).

## Summary
RFC-002 gets the fundamentals right. The editable document is separate from the evaluated scene. Committed state lives outside disposable workers. Commands are transactional, and the export snapshot is frozen. The engine stays the only geometry authority. This review found **no blocking architectural flaw**.

It did find five gaps that would cost real time in P1 if left implicit:
1. **Geometry granularity is unspecified.** RFC §4 gives each `PathObject` its own `geometryRef`. A traced photo commits 30k paths, and a halftone commits one 195k-subpath path. Per-object buffers make transfers and history accounting expensive, and per-layer buffers make single-object edits copy whole layers. Amendment: immutable **geometry chunks** (one per trace commit or bake), with objects referencing `(chunkId, pathIndex)` and edits producing small new chunks (D01/D02).
2. **The transport proposal keeps two paths.** The "capped v1 JSON fallback for small scenes" doubles the test surface for no measured benefit: JSON and the packet are about the same size, and parse versus validate costs 97–198 ms against 8–19 ms on the main thread at ~1M anchors [measured, R01]. Amendment: the packet is the only editor transport; scene v1 JSON remains for export and interop (D03).
3. **Canvas 2D is the right renderer only with parts the RFC leaves optional.** Exact per-frame redraw misses the budget at ≥ 300k anchors in Firefox and WebKit [measured]. A display-only raster cache (gestures p95 17–22 ms in all engines up to 1M) and an OffscreenCanvas render worker (main thread ≤ 24 ms) fix it. Chromium also builds Path2D incrementally in **quadratic** time, so construction must use path data (D04).
4. **The scheduler needs two rules the RFC does not state.** Only previews are pre-emptible. A worker is never terminated before its job is posted; the second rule fixes a measured WebKit offline failure (D05, R03).
5. **The phase plan has a circular dependency.** P1-A must "not lock renderer-specific data structures" yet has no renderer with which to validate the document model. Amendment: a minimal Canvas 2D renderer and the project serializer move into P1-A as test oracles ([REVISED-P1-SEQUENCE](REVISED-P1-SEQUENCE.md)).

## Decision-by-decision

### D01 — Authoritative document and geometry ownership
**Proposal.** The main application owns the committed document, immutable geometry buffers and source references; React is a view.

**Strengths.**
- Satisfies TD-ARCH-002 directly. R03 terminated the compute worker 3–8 times per run (cancel, crash, fatal abort, recycle). The committed layer stayed byte-identical by SHA-256 over scene JSON and packet buffers. Undo and redo worked throughout, in 3 engines, online and offline [measured].
- Keeps a single source of truth for UI reads (inspector, layers, hit tests) without asynchronous round trips.

**Weaknesses and hidden assumptions.**
- **"Immutable buffers" is a convention, not a property.** Typed arrays cannot be frozen. Putting a committed `ArrayBuffer` in a transfer list detaches it silently (`byteLength` 0) [measured, R01 adversarial]. The RFC says "committed buffers never detached" but does not say how. It needs an API boundary: a GeometryStore that never exposes committed buffers, offers `jobCopy()`, and asserts in tests.
- **Geometry granularity is unspecified** (Summary item 1).
- **Main-thread memory is now the budget that matters.** A 1M-anchor document is ~45 MB of packets [measured]. Add the hit index (~10 MB for a 195k-subpath halftone [measured]), renderer caches, history and the decoded source (48 MB at 12 MP). The aggregate model is in [MEMORY-AND-RESOURCE-BUDGET](MEMORY-AND-RESOURCE-BUDGET.md).

**Alternatives** ([DOCUMENT-OWNERSHIP](DOCUMENT-OWNERSHIP.md)):
- (2) a persistent document worker plus disposable compute workers;
- (3) worker-owned geometry with recoverable snapshots.

Both move the authority further from the UI and add message round trips for every read. Option 3 reduces to option 1 once the snapshot is complete. Neither is justified by the measurements.

Option 4, a render worker holding a disposable copy, is adopted **for rendering only** after R02 (D04). Authority stays on the main thread.

**Disposition: ACCEPT WITH AMENDMENTS** (geometry chunks; a GeometryStore API with copy-out only; aggregate memory accounting).

### D02 — Transactional commands and bounded history
**Proposal.** Pure, validated commands; monotonic revisions; structural-sharing history capped at 100 transactions and 128 MiB (64 MiB constrained).

**Strengths.**
- Correct atomicity: async results are checked against the captured revision and discarded when stale. R03 demonstrated undo during a running final trace, with the stale result discarded [measured].
- Selection and camera stay out of history, and revisions are monotonic even across undo.

**Weaknesses.**
- **The byte cap depends on granularity.** With per-layer buffers, one retrace of a 1M-anchor layer retains ~45 MB, so 128 MiB holds about two retraces. With chunks, transforms and recolours retain only small records. The RFC should state that transforms and styles never copy geometry, which it implies via `localTransform`.
- **Keyboard parameter edits.** Base UI keyboard sliders commit on every arrow key: 5 commits for 5 keys, against 1 for a drag [measured, R05-A]. Without coalescing by parameter and time window, history fills with keystrokes.
- **Undo of source removal.** "Undo source removal must still work" implies the source Blob is retained by history. The source must then count against the history cap, or be explicitly exempt and counted in the asset budget.

**Disposition: ACCEPT WITH AMENDMENTS** (granularity rule; keyboard coalescing; source retention accounting).

### D03 — Compact typed geometry transport
**Proposal.**
- GeometryPacket v1: Uint8 opcodes, Float64 coordinates, Uint32 offsets with a sentinel, style and clip indices.
- Validated in both languages.
- Transfer only job-owned copies.
- A binary bridge "conditional", with a capped v1 JSON fallback.

**Evidence** [measured, [GEOMETRY-TRANSPORT-BENCHMARK](GEOMETRY-TRANSPORT-BENCHMARK.md)]:
- Scene v1 JSON is quantized to 0.01 px, so its text is already about as dense as f64. The packet is −21 % to +15 % of the JSON size; deflated, it is 2–11 % larger.
- The decisive differences are main-thread costs and transferability:
  - JSON.parse costs 97–198 ms on the main thread at ~1M anchors across engines (104–169 ms in Node); one validation pass over the packet costs 8–20 ms.
  - A transferred packet arrives in well under a millisecond, with no copy.
  - Typed arrays feed path construction, indexing and tessellation directly.

**Weaknesses.**
- The JSON fallback (Summary item 2).
- The RFC lists "bounds" in the packet. The validator already derives per-path bounds and subpath starts in its single pass at no extra cost [measured]. Transporting them only adds a consistency check. Recommendation: do not transport derived data.
- The first adversarial run found an offset bounds-check gap in the prototype validator. It was fixed; now 27/27 cases behave as expected, all malformed ones rejected with typed errors [measured]. The Rust validator for packets entering WASM, for export, must have the same suite.

**Disposition: ACCEPT WITH AMENDMENTS** (packet-only editor transport; derived data not transported; shared adversarial suite in TS and Rust; little-endian on disk).

### D04 — Rendering architecture
**Proposal.** Retained Canvas 2D with a spatial index and caches as the first candidate; SVG DOM and WebGL to be benchmarked; one production renderer.

**Evidence** [measured, [RENDERER-EVALUATION](RENDERER-EVALUATION.md)]:
- **Scope of the bake-off:**
  - 4 candidates, 3 engines (headed), DPR 2;
  - 11 workloads in Chromium and 6 in Firefox and WebKit, from 17k to 1M anchors and 1 to 167k paths;
  - cold plus 5 warm reps; 72 correctness renders against independent resvg;
  - a traced presentation check, a raster cross-check, and display-cache and OffscreenCanvas variants.
- **Correctness:** every candidate is correct (0 geometry-error pixels; hole, evenodd and clip hit checks pass).
- **Exact redraw cost differs by engine:** Canvas is ~0.5 / 5 / 2.3 µs per `fill()` in Chromium / Firefox / WebKit. Exact per-frame redraw therefore misses the budget on ≥ 300k-anchor scenes in Firefox and WebKit for Canvas and SVG, and beyond ~30k paths for WebGL.
- **A display-only raster cache** makes Canvas gestures p95 17–22 ms in all engines up to 1M anchors.
- **An OffscreenCanvas host** keeps the main thread ≤ 24 ms during load and pan in all engines. Worker plus cache, measured together: gestures 17–23 ms and main thread 17–19 ms. WebKit's first worker frame showed a presentation delay, to verify on real Safari.
- **Object drags** with exact redraw are as slow as exact frames, so layered caching is required (G-R1).
- **Construction trap:** Chromium builds Path2D incrementally in quadratic time.

**Weaknesses of the proposal as written.** None of the parts that make Canvas viable is specified:
- the construction method;
- the gesture cache;
- the worker host;
- subpath-level hit indexing.

"Incremental invalidation" (RFC §3) is not what makes it fast: a cache that makes gestures O(1) is.

**Alternatives.**
- **WebGL:** the best first visible, and the best exact redraw for few-path scenes in Firefox and WebKit. Rejected for P1 because it is draw-call-bound for many paths, and fixing that means a tessellator plus batching plus strokes, clips and context loss. Kept as the revisit path.
- **SVG DOM:** degrades with path count.
- **SVG image:** slowest load, no editing.

**Disposition: ACCEPT WITH AMENDMENTS.** Canvas 2D is confirmed, with the four mandatory parts (A6, A7), the proposed scene-size limits and the WebGL revisit conditions.

### D05 — Disposable workers and scheduling
**Proposal.** One disposable compute worker plus an explicit scheduler; frozen snapshots; no SharedArrayBuffer or pool until measured.

**Evidence** [measured, R03]:
- 12 scenarios with the real engine, 16/16 checks in Chromium 159, Firefox 159 and WebKit 27.2, online and offline.
- A preview can no longer cancel an export.
- Stale results and errors are dropped.
- Workers are replaced after crash, fatal abort and recycle.

**Weaknesses found.**
- The RFC says "explicit Apply/final/export higher priority than same-scope latest-wins preview" but not which jobs may be **terminated**. Terminating is the only cancellation available. The rule must be: only previews are pre-emptible.
- **New failure mode:** terminating a worker whose module graph is still loading (rapid preview churn) broke offline worker start-up in WebKit, deterministically, 4 of 4 runs. The P0 client has the same pattern. The fix is to never terminate before the job is posted, verified 16/16 twice in 3 engines.

**Disposition: ACCEPT WITH AMENDMENTS** (§2 scheduler contract in [WORKER-SCHEDULING-AND-RECOVERY](WORKER-SCHEDULING-AND-RECOVERY.md); protocol v2 fields; G-JOB against the production build and real Safari).

### D06 — Shared colour boundaries
**Proposal.** Shared boundary topology is trace- or evaluation-local; independent editable paths are materialized at commit.

**Evidence** [measured, [SHARED-BOUNDARY-STRATEGY](SHARED-BOUNDARY-STRATEGY.md)]:
- TD-GEO-001 reproduces exactly at this head, and P0 bytes are unchanged (326/326 regression, 72/72 bundle v2).
- Label correction with *oracle* labels removes only 76–81 % of slivers and fails curvature, so Option A alone is excluded.
- A minimal shared-edge graph gives exact partitions (0 gaps, 0 overlaps) and 0 slivers on 6 synthetic fixtures. Stacked and mosaic derive from the same edges.
- Junction accuracy still needs a junction-local correction and estimator; this is shown only with oracle labels.
- Materialized faces move independently. Once one is edited, provenance correctly reports the broken pairing.

**Weaknesses.**
- The registered sliver metric and junction criterion fail on analytic truth (R04 §3). An owner ratification is needed before any gate.
- The RFC does not say that the graph must not change Artistic bytes, or the precision v1 bytes either; precision v2 must be versioned.

**Disposition: ACCEPT WITH AMENDMENTS** (graph in the Rust evaluation stage; precision v2 opt-in; G-SB gate; metric ratification; provenance digest-checked, never live constraints; plates never coupled).

### D07 — Typed procedural effect recipes
**Proposal.** A P1 operation-descriptor seam; typed linear domains; deterministic seeds; bake.

**Assessment** [analysis, [CREATIVE-LAB-ARCHITECTURAL-REVIEW](CREATIVE-LAB-ARCHITECTURAL-REVIEW.md)]:
- A linear chain carries every catalogued feature, provided it gets:
  - side inputs by reference (halftone-in-shape, pattern-in-region);
  - composite multi-output values (ink plates, cut-and-paste groups);
  - seeds derived from stable operation-instance IDs, not stack positions.
- No DAG or plugin host is needed.

**Disposition: ACCEPT WITH AMENDMENTS.**

### D08 — Local project persistence in P1-C
**Assessment** [analysis + measured sizes, [PROJECT-PERSISTENCE-REVIEW](PROJECT-PERSISTENCE-REVIEW.md)]:
- Earlier persistence is right. Moreover, the *format and serializer* belong in P1-A as the document model's round-trip oracle, with the UI in P1-C.
- Recommended format: a bounded custom container (no file names, so no traversal; declared sizes capped before allocation; SHA-256 per section; native `DecompressionStream`). It carries a JSON manifest and document plus binary GeometryPacket chunks, with the source opt-in.
- No autosave and no history persistence.

**Disposition: ACCEPT WITH AMENDMENTS.**

### D09 — Frontend design system
**Evidence** [measured, [DESIGN-SYSTEM-FEASIBILITY](DESIGN-SYSTEM-FEASIBILITY.md); reproduced by the lead reviewer, 42/42]:
- **A common Base UI foundation is practical.** shadcn `base-nova` and Dice `diceui/base` use Base UI 1.9.0; resizable is react-resizable-panels; sortable is dnd-kit. The lockfile holds 0 `@radix-ui` packages.
- **CSP.** A production build has 0 violations under the exact production CSP in 3 engines with `<CSPProvider disableStyleElements>`. Without it, Base UI's ScrollArea `<style>` violates `style-src-elem`.
- **Tailwind 4 with Vite+ 1.7.0 works.**
- **Bundle:** +122 KiB gzip JS and +8 KiB gzip CSS.

**Blockers to adoption as-is (not to the direction).**
- Dice colour picker: keyboard and accessible-name gaps; no commit/cancel API.
- shadcn Slider drops `aria-label`.
- Keyboard slider commits per key.
- `border` and slider-track tokens fail 3:1, and the focus ring fails on paper and lime.
- The notice generator does not cover copied source or Tailwind CSS.

**Disposition: ACCEPT WITH AMENDMENTS.**

### D10 — Hosting and offline architecture
**Assessment.**
- Workers Static Assets plus a versioned SW were approved at P0 and are unchanged [source]. R03 confirmed offline worker recreation with a harness SW in 3 engines [measured].
- One open item from R8: online-enabled build variants and their `_headers` are deferred by RFC §11. That is acceptable for P1 (no online features), but must be specified before any optional online adapter (IMAGE-SOURCES).

**Disposition: ACCEPT AS PROPOSED.** The R8 build-variant question is recorded as an owner and post-core item.

## Focus topics from the brief
| Topic | Finding |
|---|---|
| Editable document vs evaluated export scene | Correctly separated. Export takes an exact frozen revision; R03 exported from snapshot revision 1 while later edits occurred [measured]. Keep scene v1 as export input via an adapter; scene v2 only when a feature needs it |
| Durable vs disposable worker state | Correct (D01/D05 evidence). Worker caches must stay derivable; R03 confirmed undo history survives 3–8 terminations |
| Stable identities across retracing | RFC chooses "retrace → new layer, explicit replace, no heuristic matching". Agree: simplest and honest. Object identity inside a re-evaluated recipe is "parent stable, children where well-defined"; R04 adds digest-checked provenance for shared edges |
| Compound path ownership | One traced compound path is one object (a halftone is one 195k-subpath object). Hit testing needs a subpath index: prototype exact, 0.0004 ms warm p95 on 977k anchors [measured]. Splitting is an explicit, containment-checked command later |
| Undo/redo memory | Depends on geometry granularity (D02); see the memory model |
| Transform composition and accuracy | f64 2×3 per node, baked at serialization: agree. Render caches may use f32; WebGL here used f32 vertices and passed 0 geometry-error pixels at 4× zoom [measured]. Reject singular transforms; the tolerance must be specified (RFC says "qualify") |
| Palette and style ownership | A style table in the packet plus palette references allows recolour without geometry change. The renderers measured recolour as a style-table or attribute update ([RENDERER-EVALUATION](RENDERER-EVALUATION.md)) |
| Derived geometry invalidation | Cache keys per RFC §10, plus side-input digests ([Creative Lab review](CREATIVE-LAB-ARCHITECTURAL-REVIEW.md)); main-thread caches hold only packets and count toward the budget |
| Export snapshot consistency | Demonstrated (R03 scenario 4). The export job receives a copy of the frozen snapshot, and later edits cannot change it |
| Local persistence and migration | D08 |
| Future effect stacks | D07 |

## R1–R9 reconciliation review
| # | RFC-002 §15 resolution | Reviewer |
|---|---|---|
| R1 | Workers Static Assets; Pages as alternate | Agree (approved at P0) |
| R2 | Phased PRD-002 supersedes; Save/Open earlier | Agree; go further (format in P1-A). PRD.md and ROADMAP.md still say P1 = six presets. Update them when RFC-002 is approved, or the contradiction persists |
| R3 | Charcoal/lime rail design supersedes | Agree; R05-A contrast fixes needed (`border`, focus ring) |
| R4 | Core / Print / DIY Underground / Advanced taxonomy | Agree. PRESETS.md still lists Grayscale, Silhouette and Line Art for P1. Their order is an owner decision (core preset sequence), and Line Art drags in TD-GEO-005 |
| R5 | shadcn + Dice + Tailwind + Lucide, no adoption until review | R05-A qualifies it with amendments. Zustand (RFC-001 candidate): agree to *not* adopt until proven; the R03 prototype store was 30 lines |
| R6 | IoU plus analytic metrics; tier amendments pending owner | Agree. **New:** the TD-GEO-001 sliver metric needs a restatement (R04 §3), also an owner decision |
| R7 | Deterministic per identical decoded RGBA | Agree; add "and the same WASM build" for seeded effects (TD-PLATFORM-005) |
| R8 | Isolated later online adapter; current offline build unchanged | Partially answered: deferred, not designed. Acceptable for P1; must precede any online feature |
| R9 | Module structure in §12 | Agree, with one change: `renderer` must not import `document` mutation APIs; it consumes immutable snapshots only |

## Contradictions and gaps found in RFC-002
1. §14 says P1-A must "not lock renderer-specific data structures into P1-A while the decision is pending". But P1-A's exit criteria need visual validation of documents, hit tests and transforms. Resolved by R02 choosing a renderer, and by a minimal renderer in P1-A.
2. §6: "binary bridge is conditional, capped v1 JSON fallback". This conflicts with §3's "no per-anchor React state … no deep clones": the JSON path creates millions of JS numbers in object graphs (resident heap ≈ JSON bytes [measured]). Resolved by packet-only transport.
3. §5 "128 MiB uniquely retained history-only data" vs §4's "geometryRef" per PathObject: the cap is meaningless until granularity is fixed (D02).
4. §8 "Preview must not silently cancel export" vs the existing client (export rejects with `busy`; a trace cancels everything) [source]. The RFC correctly requires a change; the contract is in R03 §2.
5. §13 "Early cost estimate after segmentation" vs TD-PERF-002's "report within 2 s". Segmentation is 66–99 % of colour trace time [measured], so these conflict for large images. An owner decision is needed (R03 §4).
6. DESIGN-SYSTEM.md "focus ring: lime or higher contrast where needed". Lime fails on paper and lime fills [measured]; a dual-ring token is needed.

## What this review did not establish
- Lower-end hardware: NOT RUN, no device (TD-PLATFORM-003).
- Real Safari: NOT RUN (Playwright WebKit only; TD-PLATFORM-002).
- Behaviour of the production build under worker churn offline: NOT RUN.
- Shared-boundary behaviour on real images or the full corpus: NOT RUN.
- All timings come from the M5 Max reference machine under unrelated background CPU load (12–14 `ngspice` processes, load average ≈ 13–16 on 18 cores), recorded per run in `artifacts/renderer/timing-environment.txt`.
