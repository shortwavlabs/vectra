# RFC-002 independent architecture review — final report

| | |
|---|---|
| Reviewed | RFC-002 at `0e32fdabdbfa9aae5f7613be46c60dee375ca788` (PR https://github.com/shortwavlabs/vectra/pull/4, branch `docs/rfc-002-vector-studio`), with DESIGN-SYSTEM.md and RFC-002-REVIEW.md |
| Baseline | P0 accepted at `baf1d17972f8a06d46c0538030e2eeba75cf4354` |
| Review branch | `review/rfc-002-architecture` (from `0e32fda`); review PR targets `docs/rfc-002-vector-studio` |
| Scope | Critique and bounded experiments only. No P1 implementation, no production runtime change, no P0 algorithm change, no dependency added to the root project, no deployment, no merge |
| Date | 2026-11-24 |

## Recommendation
<!-- recommendation -->

## Decision matrix (D01–D10)
| Decision | RFC proposal | Reviewer disposition | Evidence | Proposed amendment |
|---|---|---|---|---|
| D01 Document and geometry ownership | Main-thread authoritative document, immutable geometry buffers, React as view | **ACCEPT WITH AMENDMENTS** | R03: committed layer byte-identical (SHA-256) after 3–8 worker terminations per run; undo/redo intact; 3 engines, online and offline. R01: transferring a committed buffer detaches it | Immutable geometry **chunks** with `(chunkId, pathIndex)` refs; GeometryStore with copy-out only; aggregate memory ledger (A1, A2) |
| D02 Commands and bounded history | Transactional commands, monotonic revisions, 100 tx / 128 MiB (64 MiB constrained) | **ACCEPT WITH AMENDMENTS** | R03: stale result after undo discarded by revision guard. R05-A: keyboard sliders commit on every key | Cap defined over chunk bytes; transforms and styles never copy geometry; keyboard commit coalescing; source retention counted (A1, A13) |
| D03 Typed geometry transport | GeometryPacket v1; binary bridge conditional; capped JSON fallback | **ACCEPT WITH AMENDMENTS** | R01: same size as JSON (−21 to +15 %); main-thread parse 97–198 ms vs validate 8–20 ms at ~1M anchors; delivery 0–10 ms transferred; adversarial 27/27 after fixing a found gap | Packet is the **only** editor transport; no JSON fallback; derived data not transported; shared TS/Rust adversarial suite (A3–A5) |
| D04 Rendering | Retained Canvas 2D first candidate; benchmark SVG DOM and WebGL | <!-- D04-disp --> | <!-- D04-evidence --> | <!-- D04-amend --> |
| D05 Workers and scheduling | One disposable worker plus scheduler; frozen snapshots; no SAB or pool | **ACCEPT WITH AMENDMENTS** | R03: scenarios 1–12, 16/16 in 3 engines online and offline. WebKit offline start-up failure under termination churn (14/16), fixed by the "post before terminate" rule | Normative contract: only previews pre-emptible; never terminate before the job is posted; fail-closed acceptance; protocol v2 (A8, A9) |
| D06 Shared colour boundaries | Trace-local shared topology; independent paths at commit | **ACCEPT WITH AMENDMENTS** | R04: defect reproduced exactly; hashes 326/326 and 72/72; oracle labels remove only 76–81 % of slivers; graph prototype gives exact partitions and 0 slivers on 6 fixtures | Graph in the Rust evaluation stage; precision v2 opt-in; junction correction plus estimator; G-SB gate; metric restatement for owner (A11) |
| D07 Typed recipes | Versioned typed linear recipes, explicit conversions, seeds, bake | **ACCEPT WITH AMENDMENTS** | Analysis against the CL-01…CL-08 catalogue | Side inputs by reference; composite multi-output values; seeds from operation-instance IDs (A12) |
| D08 Local persistence | Minimal explicit Save/Open in P1-C | **ACCEPT WITH AMENDMENTS** | R05-B: browser APIs; packet open path 17–20 ms vs JSON 104–169 ms + re-encode; native deflate and SHA-256 timings | Bounded custom container v1; serializer and loader in P1-A (G-DOC), UI in P1-C; no autosave, no history persistence (A14) |
| D09 Design system | Vite+, React, TS, Tailwind, shadcn/ui + Dice UI, Base UI, Lucide | **ACCEPT WITH AMENDMENTS** | R05-A: 42/42 in 3 engines (reproduced); 0 `@radix-ui`; 0 CSP violations with `CSPProvider disableStyleElements`; +122 KiB gz JS | Pinned versions; CSP mitigation; slider and colour-picker accessibility fixes or an owned picker; contrast token fixes; notices extension (A16) |
| D10 Hosting and offline | Workers Static Assets + versioned SW; online adapters isolated | **ACCEPT AS PROPOSED** | Approved at P0; R03 offline worker recreation in 3 engines | R8 build variants recorded as a post-core prerequisite (A19) |

## Engineering review gates
| Gate | Result | Basis |
|---|---|---|
| R00 — Architecture critique | **PASS** | [ARCHITECTURE-CRITIQUE](ARCHITECTURE-CRITIQUE.md): all ten decisions, the focus topics and R1–R9 reviewed; contradictions listed |
| R01 — Document and transport | **PASS** | [DOCUMENT-OWNERSHIP](DOCUMENT-OWNERSHIP.md), [GEOMETRY-TRANSPORT-BENCHMARK](GEOMETRY-TRANSPORT-BENCHMARK.md): 12 workloads (10k–1M, real and synthetic) in Node and 3 browsers; adversarial suite; termination safety. The Rust producer and validator were not built, so the production encode path is NOT RUN (an equivalent was measured) |
| R02 — Rendering | <!-- R02-result --> | [RENDERER-EVALUATION](RENDERER-EVALUATION.md) |
| R03 — Scheduling and memory | **PARTIAL** | Scheduling and recovery PASS (12 scenarios, 3 engines, online and offline). Estimation PARTIAL (bw and colour only; no guaranteed decision within 2 s for large colour). Memory model by component, estimated end to end. Lower-end NOT RUN ([WORKER-SCHEDULING-AND-RECOVERY](WORKER-SCHEDULING-AND-RECOVERY.md), [MEMORY-AND-RESOURCE-BUDGET](MEMORY-AND-RESOURCE-BUDGET.md)) |
| R04 — Shared boundaries | **PARTIAL** | Reproduction, hash protection, Option A bound and Option B prototype executed on 6 synthetic fixtures. Real images, full corpus and the held-out set NOT RUN; metric needs owner ratification ([SHARED-BOUNDARY-STRATEGY](SHARED-BOUNDARY-STRATEGY.md)) |
| R05-A — Design system | **PASS with amendments** (items: provenance and pins PASS; Base UI foundation PASS; CSP PASS with mitigation; Tailwind/Vite+ PASS; bundle, accessibility and contrast PARTIAL) | [DESIGN-SYSTEM-FEASIBILITY](DESIGN-SYSTEM-FEASIBILITY.md); real Safari and screen readers NOT RUN |
| R05-B — Persistence | **PASS** (review scope) | [PROJECT-PERSISTENCE-REVIEW](PROJECT-PERSISTENCE-REVIEW.md); no container implemented, by design |
| Creative Lab architecture | **PASS** | [CREATIVE-LAB-ARCHITECTURAL-REVIEW](CREATIVE-LAB-ARCHITECTURAL-REVIEW.md) (analysis only) |
| Technical debt reconciliation | **PASS** | [TECHNICAL-DEBT-DISPOSITION](TECHNICAL-DEBT-DISPOSITION.md): 25/25 classified; no item marked resolved; 9 new risks proposed |
| P1 implementation sequence | **PASS** | [REVISED-P1-SEQUENCE](REVISED-P1-SEQUENCE.md): 13 gates with scope, dependencies, acceptance, performance, owner acceptance and stop conditions |

## Unresolved maintainer decisions
1. **Approve, revise or reject each amendment** A1–A20 ([RFC-002-PROPOSED-AMENDMENTS](RFC-002-PROPOSED-AMENDMENTS.md)). The RFC author reconciles them.
2. **Performance budget and lower-end hardware.** Ratify the reference-machine targets, which are unchanged by this review. Obtain an M1 8 GB or a 4c/8t laptop for G-R1; until then, disclose a support restriction.
3. **TD-PERF-002 wording.** Accept "forecast within 2 s plus guaranteed early failure before fitting" (R03 §4), or fund a cheaper segmentation path.
4. **TD-GEO-001 metric restatement.** A crisp-sampled sliver metric and a junction criterion valid for stacked output (R04 §3), before G-SB.
5. **Save/Open scope.** Container v1 serializer in P1-A, UI in P1-C; source inclusion opt-in.
6. **Core preset order.** Grayscale, Silhouette and Line Art (which brings in TD-GEO-005) in P1 or later.
7. **Real Safari.** Authorise `safaridriver` for automated runs, or test manually (TD-PLATFORM-002, raised by R03 and R05-A WebKit-only findings).
8. **CI policy.** One cheap required job before P1-A merges begin (TD-PROCESS-001).
9. **Canonical Linux builds** for published hashes (TD-PLATFORM-001/005).
10. **Design-system bundle budget,** and acceptance of owned patches to copied registry sources (colour picker, slider).
11. **Online build variants (R8)** before any optional online adapter (post-core).
<!-- renderer-decision -->

## Environment and integrity notes
- **Hardware.** Apple M5 Max, 18 cores, 128 GB; macOS 26.6.2. Browsers: Playwright 1.65.1 with Chromium 159.0.8154.6 (headed: ANGLE Metal on Apple M5 Max; **headless uses SwiftShader**, so all renderer timings are headed), Firefox 159.0, WebKit 27.2. Node 24.22.1; Rust 1.96.0.
- **Background load.** Throughout the timing runs, 12–14 unrelated `ngspice` processes were running on this machine, not started by the review. Load average was 12.9–16.4 on 18 cores at each step (recorded per step in `artifacts/renderer/timing-environment.txt`). Absolute timings are therefore pessimistic for this machine. Relative comparisons ran under the same conditions. **No timing here is evidence about lower-end hardware.**
- **Clock resolution.** Firefox and WebKit expose `performance.now()` at 1 ms in this non-isolated context, so sub-millisecond values are quantized there.
- **Subagents.** Two gates were executed by delegated subagents: R05-A and R04. The lead reviewer re-ran both: the design-system Playwright suite (42 passed) and the R04 prototype (table reproduced). The lead reviewer also re-verified the 326 regression hashes independently.
- **Production code.** None of `src/`, `crates/`, `packages/`, `public/`, the root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `Cargo.lock` or `vite.config.ts` was modified (checked with `git diff --stat 0e32fda -- …` before the PR).
- **Not run.** Lower-end hardware; real Safari, iOS and Android; screen readers; production-build worker churn offline; shared boundaries on real images; Rust packet producer and validator; container implementation.

## Deliverables
`docs/research/rfc-002-review/`:
- [ARCHITECTURE-CRITIQUE](ARCHITECTURE-CRITIQUE.md)
- [DOCUMENT-OWNERSHIP](DOCUMENT-OWNERSHIP.md)
- [GEOMETRY-TRANSPORT-BENCHMARK](GEOMETRY-TRANSPORT-BENCHMARK.md)
- [RENDERER-EVALUATION](RENDERER-EVALUATION.md)
- [WORKER-SCHEDULING-AND-RECOVERY](WORKER-SCHEDULING-AND-RECOVERY.md)
- [MEMORY-AND-RESOURCE-BUDGET](MEMORY-AND-RESOURCE-BUDGET.md)
- [SHARED-BOUNDARY-STRATEGY](SHARED-BOUNDARY-STRATEGY.md)
- [DESIGN-SYSTEM-FEASIBILITY](DESIGN-SYSTEM-FEASIBILITY.md)
- [PROJECT-PERSISTENCE-REVIEW](PROJECT-PERSISTENCE-REVIEW.md)
- [CREATIVE-LAB-ARCHITECTURAL-REVIEW](CREATIVE-LAB-ARCHITECTURAL-REVIEW.md)
- [TECHNICAL-DEBT-DISPOSITION](TECHNICAL-DEBT-DISPOSITION.md)
- [REVISED-P1-SEQUENCE](REVISED-P1-SEQUENCE.md)
- [RFC-002-PROPOSED-AMENDMENTS](RFC-002-PROPOSED-AMENDMENTS.md)
- this report

Raw data is in `artifacts/`. Disposable experiments are in `experiments/rfc-002-review/`; reproduction is described in [REPRODUCING](REPRODUCING.md).
