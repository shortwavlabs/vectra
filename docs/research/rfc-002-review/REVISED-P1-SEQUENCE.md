# RFC-002 review §15 — revised P1 implementation sequence

RFC-002 §14 has three large phases (P1-A, P1-B, P1-C). This review proposes **small, independently testable gates** inside them. The phase names stay; the scope changes are marked **(moved)**.

Every gate:
- is a review branch and PR with a gate report;
- keeps the 326 regression and 72 bundle-v2 hashes byte-identical unless the gate is explicitly versioned;
- runs the local checks (`vp check`, `vp test`, `cargo test`, and Playwright in 3 engines where UI is involved);
- needs maintainer acceptance before the next dependent gate merges.

No gate starts before the reconciled RFC is approved.

## Dependencies and the circularity the RFC leaves open
- **Renderer ↔ document.** RFC §14 tells P1-A not to lock renderer structures while the renderer decision is pending. Yet P1-A's exit criteria (transforms, hit tests, holes, locks) cannot be validated without drawing. Breaking the cycle:
  - R02 decides the backend now ([RENDERER-EVALUATION](RENDERER-EVALUATION.md));
  - a **minimal renderer moves into P1-A** (G-R0) as a test instrument inside the engineering workbench, not product UI;
  - the document's geometry granularity, immutable chunks (DOCUMENT-OWNERSHIP §4), is renderer-neutral: Path2D, DOM and vertex caches are all derived per chunk.
- **Persistence ↔ document.** The serializer is the strictest consumer of document invariants, so **it moves into P1-A** (G-DOC) as the round-trip oracle. The Save/Open UI stays in P1-C (G-PRJ).
- **Scheduler ↔ engine API.** The scheduler is policy-only and can be built against fake workers. Its acceptance against the real engine needs packet output (G-ENG). Hence G-ENG ‖ G-DOC → G-JOB.
- **Design system ↔ renderer.** These are independent. G-UI only needs a canvas host element, so it can run in parallel with G-R1 once G-DOC exists (commands to bind to).
- **Shared boundaries.** These are engine-internal and must not block the editor. G-SB lives in P1-C but may slip to P2 without blocking a P1 release (precision v1 stays available).

```text
G-0 (owner decisions)
 ├─ G-ENG ─┐
 └─ G-DOC ─┼─ G-JOB ─┬─ G-R0 ─ G-R1 ─┬─ G-TRACE ─ G-EDIT ─ G-EXP ─ G-PRJ
           │         │               │
           └─────────┴─ G-UI ────────┘                  G-GEO ─ G-SB (may slip to P2)
```

## Gates
| Gate | Phase | Scope | Deliverables | Depends on | Acceptance tests | Performance | Owner acceptance | Stop conditions |
|---|---|---|---|---|---|---|---|---|
| **G-0** | pre-P1 | Decisions only | Reconciled RFC-002; FINAL-REPORT owner decisions answered | this review | — | — | Approve RFC, budget and lower-end device plan, TD-GEO-001 metric restatement, Save/Open scope, core preset order, CI policy | Any decision deferred → the gates depending on it wait |
| **G-ENG** | P1-A | Engine API for the editor | Rust-built GeometryPacket output from `vectorize`; packet → scene v1 adapter for SVG/PDF; Rust packet validator; staged "segment → estimate → fit" hook (bw, colour); diagnostics behind a cargo feature (TD-ARCH-004) | G-0 | 326 + 72 hashes identical; native = WASM fingerprints; scene v1 exports from the packet byte-identical to direct exports over the regression corpus; Rust validator passes the 27-case adversarial suite (shared with TS) | Trace time within noise of baseline; packet copy-out ≤ 2 ms at 1M anchors (measured equivalent 1.6 ms) | none (engineering) | Any hash change; any VTracer type in the new API (TD-ARCH-001) |
| **G-DOC** | P1-A | Document, commands, history, GeometryStore, IDs, serializer **(moved)** | TS store (no framework); chunked immutable GeometryStore with copy-out only; command set from RFC §5; bounded history with byte accounting; container v1 serializer and strict loader (PROJECT-PERSISTENCE §4), with no UI | G-0 | Property and fuzz tests of invariants; every command undo/redo-able; save → load → save byte-identical; container security fuzz list (R05-B §6); "committed buffer never transferred" assertion; memory accounting test | Commit of a 1M-anchor trace ≤ 50 ms main thread (validate 8–20 ms measured); undo/redo ≤ 16 ms for structural commands | none | Needs renderer types or worker handles in the document → stop and redesign |
| **G-JOB** | P1-A | Scheduler, protocol v2, lifecycle | The R03 §2 policy in production code; protocol v2 fields; replacement of `client.ts` behind the workbench | G-ENG, G-DOC | R03 scenarios 1–12 plus the WebKit churn case, against the **production build**, 3 engines, online, offline and across an SW update; stale result and error drops counted | Cancel ack ≤ 200 ms (P0: < 1 ms); no main-thread gap > 50 ms attributable to job handling | Real Safari run (needs `safaridriver` authorisation) or explicit restriction | A preview can cancel an export or Apply; committed state lost on any termination |
| **G-R0** | P1-A | Minimal renderer **(moved)** | Canvas 2D per R02: linear path construction (path data); **OffscreenCanvas render-worker host** with a disposable packet copy (main-thread host only as a disclosed fallback); display-only gesture cache; progressive first frame; renderer-independent hit-test service on the main thread (grid + subpath index + band index); fit, pan, zoom and selection overlay in the engineering workbench | G-DOC (G-JOB for live traces) | Correctness vs resvg: 0 geometry-error pixels on the correctness fixtures, 3 engines, for the worker host; fixed hit checks (holes, evenodd, clips); Path2D scaling regression benchmark | Main-thread gaps ≤ 50 ms during load, gestures and settle in 3 engines (R02 worker host measured ≤ 24 ms); others record baselines only | none | Correctness failure in any engine |
| **G-UI** | P1-B | Design-system shell | D09 with amendments: token fixes, `CSPProvider`, slider names, owned or patched colour picker with commit/cancel, keyboard commit coalescing, notices extension; rail, inspector, layers (keyboard reorder) | G-DOC | R05-A suite promoted into the repo (3 engines, CSP violations 0, zero network); contrast table passes; screen-reader smoke test | Bundle delta reported against an agreed budget (R05-A: +122 KiB gz JS) | Visual review of the charcoal/lime shell | `unsafe-inline` needed; a Radix primitive introduced |
| **G-R1** | P1-B | Production renderer and interactions | Layered display caches for object drags (background without the selection, plus the selection layer), selection, transform handles, visibility and lock, palette edits; worker host verified on real Safari | G-R0, G-UI | R02 scenario suite as a repeatable benchmark; context-loss recovery if WebGL; correctness again | RFC §13 interaction budgets on the reference machine; lower-end device if available, else **support restriction disclosed** | Owner hands-on review; real Safari or restriction | Budget unmet at 250k with no owner-approved cap change |
| **G-TRACE** | P1-C | Trace tool (Artistic / Precision) | Preview-resolution tracing with forecast range; post-segmentation early fail; commit to a new layer or explicit replace; no import debounce (TD-PERF-004) | G-JOB, G-R1 | Estimator FP/FN on a held-out corpus (R03 §4); no stale results; replace is undoable | Import → preview ≤ 0.5 s at ~1 MP B&W (P0: 363 ms incl. 200 ms debounce) | Artistic review on licensed photos | Silent downsampling or auto-rejection on a forecast |
| **G-EDIT** | P1-C | Smooth, Simplify, Cleanup, Recolor | Rust geometry ops producing new chunks; deviation and node-count reports | G-ENG, G-DOC, G-R1 | PRD-002 acceptance scenarios (simplify reports tolerance; holes preserved; undo exact) | Op on a 30k-path layer within budget with progress | Owner review | Topology change without explicit authorisation |
| **G-EXP** | P1-C | Exact export from frozen snapshots | Snapshot → packet → scene v1 → SVG/PDF in the worker; physical size | G-ENG, G-JOB | Unedited P0 bytes identical; vector-only verification (`verify-exports.mjs`); export unaffected by concurrent edits | Export of 1M anchors does not block interaction | Owner opens SVG and PDF in external tools | Any raster in the output |
| **G-PRJ** | P1-C | Save/Open UI | File input and download; missing-source relink; no autosave | G-DOC, G-UI | Round trip in 3 engines; the security fuzz suite through the UI path; atomic failure | Open of a 1M-anchor project ≤ 1 s on reference (validate 8–20 ms plus decompress; see R05-B) | Scope approved in G-0 | Any automatic persistence of artwork |
| **G-GEO** | P1-C | TD-GEO-003/004 slice | Fitter fixes behind a precision version bump | G-ENG | Pre-registered tiers; held-out set run once after freeze | — | Owner geometry review | Threshold changes after seeing results |
| **G-SB** | P1-C → P2 | Shared-boundary graph (precision v2) | Per [SHARED-BOUNDARY-STRATEGY §8](SHARED-BOUNDARY-STRATEGY.md) | G-ENG, G-GEO, metric ratification | R04 §8 proof list | Edge, junction and face counts; time vs precision v1 | Owner geometry review | Artistic or precision v1 bytes change |

## What this removes from the RFC's P1 risk
- No single enormous P1-B: the renderer is proven in G-R0 before any product UI depends on it.
- The document model is validated by two independent consumers (renderer and serializer) before tools are built on it.
- Persistence lands with the model it serializes, so tools never ship without a way to save their output.
- Shared-boundary research cannot hold the editor release hostage.
