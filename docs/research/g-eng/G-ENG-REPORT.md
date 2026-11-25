# G-ENG — Engine API and GeometryPacket v1 (P1-A)

**Status:** IMPLEMENTED, PENDING MAINTAINER REVIEW. Not merged.

| | |
|---|---|
| Date | 2026-11-25 |
| Branch | `gate/g-eng-engine-packet`, from `main` `29432da` (G-0 architecture baseline) |
| Specification | [G0-NEXT-GATE-BRIEF §G-ENG](../g0/G0-NEXT-GATE-BRIEF.md), [contracts C3, C4, C6](../g0/G0-ARCHITECTURE-CONTRACTS.md), [RFC-002 §6, §11](../../RFC-002.md) |
| Toolchain | Rust 1.96.0, wasm-bindgen 0.2.130, Node 24.22.1, pnpm 12.23.0, Vite+ 1.7.0; Apple M5 Max (18 cores), macOS |

**Scope rule.** No geometry-algorithm change. The 326 regression hashes, the 72 bundle-v2 hashes, Artistic, Precision v1, SVG/PDF behaviour and P0 effects are unchanged (§4). G-JOB, G-R0, UI, Precision v2, shared boundaries and deployment were not started.

## 1. Delivered (brief work items 1–7)
| # | Item | Where | Result |
|---|---|---|---|
| 1 | GeometryPacket v1: struct, `from_scene`, `Scene::from_packet`, `validate_packet` (C3 order and codes), C3.0 bytes with caps before allocation, C3.2 checked accounting, `pathAnchors` | `crates/vector-engine/src/packet.rs` | Done |
| 2 | Shared adversarial fixtures: the review's 27 cases (adapted) plus manifest and C3.0 byte cases, 47 in total | `tests/fixtures/packet-conformance/` | Done |
| 3 | Production TS validator and C3.0 codec (block and geometry record; RFC 8785 manifest JSON) | `src/geometry/packet/` | Done; the only production validator |
| 4 | Staged API `segment → estimate → fit`; opaque `Segmentation`; boundary-length estimator for B&W and colour; explicit `Unavailable` for limited and halftone | `crates/vector-engine/src/staged.rs` | Done; `vectorize` is `fit(segment(..))` |
| 5 | `bake_draw_list` (effective transforms in f64, styles, fill rules, clip runs; identity is bit-exact) | `crates/vector-engine/src/bake.rs` | Done |
| 6 | WASM: `vectorizePacket`, `validatePacket`, `PacketSet`, `exportDrawListSvg`/`Pdf`, `packetToSvg`/`Pdf`, the segment/estimate/fit handle; existing exports unchanged | `packages/vector-engine-wasm/src/lib.rs` | Done |
| 7 | TD-ARCH-004: `diagnostics` cargo feature | `crates/vector-engine/Cargo.toml`, `lib.rs` | Done |

Also delivered:
- `examples/packet_regression.rs`: the corpus through the packet route;
- `examples/staged_timing.rs`;
- the packet route in `scripts/wasm-fingerprint.mjs`;
- tests in `crates/vector-engine/tests/packet.rs` and `tests/unit/geometry-packet.test.ts`.

## 2. Final API signatures (C4 "finalised in G-ENG")
```text
GeometryPacket::from_scene(&Scene) -> Result<GeometryPacket, PacketError>     // Result: counts must fit u32
Scene::from_packet(&GeometryPacket, &SceneMeta) -> Result<Scene, EngineError>
validate_packet(&GeometryPacket, &Limits) -> Result<Derived, PacketError>
parse_manifest(&serde_json::Value, &Limits) / parse_manifest_json(&str, &Limits) -> Result<Manifest, PacketError>
GeometryPacket::to_bytes(&self) -> Vec<u8>;  GeometryPacket::from_bytes(Manifest, &[u8], &Limits) -> Result<GeometryPacket, PacketError>
bake_draw_list(&DrawList, &[GeometryPacket], &SceneMeta, &Limits) -> Result<Scene, EngineError>
segment(&[u8], w, h, &TraceRequest, clock) -> Result<Segmentation<'_>>;  segment_owned(Vec<u8>, …) -> Segmentation<'static>
estimate(&Segmentation) -> Estimate::{Range{anchors_low, anchors_high, basis} | Unavailable{reason}}
fit(Segmentation, clock) -> Result<Output>      // the request travels inside the Segmentation
```
Differences from the C4 sketch, all within "signatures finalised in G-ENG":
- `bake_draw_list` also takes `SceneMeta` and `Limits`, which a scene needs.
- `segment` takes the clock, so stage timings stay in the metrics.
- `fit` takes no request: it uses the one inside the `Segmentation`, so the two cannot disagree.
- WASM `exportDrawList` is split into `exportDrawListSvg` and `exportDrawListPdf`. Packets are passed through a `PacketSet`, because wasm-bindgen has no variadic typed arrays.
- WASM `validatePacket` returns totals only (anchors, paths, subpaths). The per-path arrays are re-derived where they are needed.

**Export draw list.** Each item carries `{chunk, pathIndex, transform, fill, paletteId, stroke, evenOdd, groupRun}`, and the list carries `runs: [{id, clip}]`.
- `paletteId` is part of the effective style (C3.1, C5 "effective … style"). It is required to reproduce P0 scenes, whose palette references are validated.
- C8's render items (`fill`, `stroke`) are unaffected.

## 3. Contract amendment requests (maintainer decision required; no contract was changed)
Per the change-control rule, G-ENG did not edit the frozen contracts. Each request below names the proposed wording and what stays **unaccepted until it is decided**.

| # | Contract | Issue | Proposed amendment | Unaccepted until decided |
|---|---|---|---|---|
| **AR-1** | C3 | Validation order: "Byte decoding (C3.0) precedes step 1 and may additionally return `length` or `padding`" cannot hold, because the block length `B` depends on the validated counts | Replace with: "For byte streams, steps 1–2 run on the manifest first; the block is then decoded (`length`, `padding`) before step 3." (editorial; no version bump proposed) | The byte-decoding order of the conformance suite (6 `bytes` cases). The implementation follows the proposed wording |
| **AR-2** | C5 / C8 (export draw list) | C8's `RenderSnapshot` lists `drawList` items with `chunkId` and `fill`/`stroke`/`evenOdd`, and C5 `export` refers to it. Reproducing P0 scenes also needs the item's **`paletteId`**: scene v1 validates palette references, so it is part of C3.1's effective style. The Rust and WASM export input is `{width, height, runs: [{id, clip}], items: [{chunk, pathIndex, transform, fill, paletteId, stroke, evenOdd, groupRun}]}`, where `chunk` indexes the job's `PacketSet` | C5 `export.drawList` = C8 draw list **plus** `paletteId` per item and the artboard `width`/`height`; the WASM adapter maps `chunkId` → packet index. C8 render items are unchanged | `bake_draw_list` and `exportDrawListSvg`/`Pdf` as the frozen export input shape (G-EXP depends on it). They are implemented and tested, but not to be built upon until decided |
| **AR-3** | C3 (determinism) | "Native and WASM builds produce byte-identical packets" is **not met for 3/65** procedural default-mode cases. The cause is a pre-existing native vs WASM difference in Artistic tracing (TD-PLATFORM-007): the inputs are verified identical, and `main`'s own WASM shows it. The packet encoding adds no difference | Either (a) narrow the clause to "identical scenes yield byte-identical packets in native, WASM and TS (verified); engine native/WASM output identity is tracked by TD-PLATFORM-007", or (b) keep it and make TD-PLATFORM-007 a blocker for the affected gate | The C3 determinism clause; TD-PLATFORM-007's priority |

**Risk next to AR-2 (found in the G-DOC cross-check).** `bake_draw_list` rebuilds the export scene from `SceneMeta`: background, palette, and `metadata` (generator, engine version, mode, preset version, seed, source size, params). G-DOC's v1 schema stores the artboard background and palette entries, but **no trace provenance or scene metadata**: it omitted `TraceProvenance` as an undefined shape. Until the document keeps enough provenance to rebuild `SceneMeta`, the unedited-P0 export hash guarantee is reachable through the engine route (tested here), **not** through the document. This needs a decision before G-EXP.

**Notes** (within the contracts; recorded for review):
- **E2.** The step-2 sub-order and the per-path running of steps 5–12 are fixed identically in Rust and TS and documented in the fixture README.
- **E3.** The review's "declared 2³² coordinates → `budget`" case conflicts with C3's integer range. The fixture was adapted (`2^32` → `manifest`, `2^32−1` → `budget`); the review's evidence itself is unchanged.

## 4. Verification (local; commands and results)
**Frozen baselines:**
- `regression_corpus` → **326/326 identical** to `a4cf172.sha256`;
- `geo_bundle` → **72/72 identical** to bundle v2.

Both were run with the scratch script `regress.sh` (build the two examples, regenerate, compare), after the staged refactor and again at the final head (§8).

**Packet route over the whole corpus** (`packet_regression`, 114 cases, photographic inputs included: 106 produce scenes, and 8 end in the same `too_many_primitives` error in both routes):
- `fit(segment(x)) == vectorize(x)` for all 106 scenes, and the same typed error for the 8 over-budget cases;
- `Scene::from_packet(from_bytes(to_bytes(from_scene(s)))) == s` for all 106 scenes;
- identity-bake scene, SVG and PDF: **326/326 hashes identical to `a4cf172.sha256`**.

**Rust tests.** `cargo test --workspace --locked`: all pass, including 6 new integration tests and 3 new unit tests:
- conformance: 44 Rust-expressible cases, plus Rust re-encoding equal to the shared bytes;
- lossless round trip and identical SVG/PDF on every procedural fixture × 6 modes, plus a stroked, translucent scene;
- staged identity;
- estimator domain;
- f64 transform baking and stroke rules;
- the tracer boundary check.

**TS tests.** `pnpm exec vp test`: 69 tests in 4 files, all pass (55 new):
- all 47 conformance cases;
- C3.2 formulas;
- the TS block equals the shared fixture bytes;
- fresh whole-buffer decode, including from pooled Node `Buffer` views (a bug found in self-review: `Buffer#slice` returns a view; fixed by copying with `ArrayBuffer#slice`);
- record round trip and typed errors;
- canonical JSON.

**Checks:** `cargo fmt --all --check` PASS; `cargo clippy --workspace --all-targets --locked -- -D warnings` exit 0. `--all-targets` unifies the self dev-dependency's `diagnostics` feature, so the library **without** the feature was also checked: `cargo clippy -p vector-engine --lib -- -D warnings` and `cargo clippy -p vector-engine-wasm --lib --target wasm32-unknown-unknown -- -D warnings` both exit 0. P-CI only runs the `--all-targets` form; adding the no-feature check is recommended. `pnpm exec vp check` PASS; `pnpm run build` PASS (notices verified, dist check passed).

**WASM** (`node scripts/wasm-fingerprint.mjs` with `NATIVE_PACKETS_DIR`):
- default-mode output digest `68723671…` and precision digest `07fdd00d…`, both **unchanged since P0**;
- packet-route and draw-list SVG/PDF vs the direct WASM route: **0 mismatches in 65 cases**;
- native vs WASM C3.0 blocks: **62/65 identical**. The 3 differences are explained by different *scenes*: `main`'s WASM shows the same coordinate deltas, up to 2 px (TD-PLATFORM-007).

**wasm32 conformance.** The built WASM `validatePacket` export (product limits), fed every shared case it can express, matched **35/35**. These include the overflow declarations: `2^32−1` coordinates, `2^32`, 10M paths, `verbCount 2^30`.
- **12 were skipped:** the 3 TS-only cases; the 3 custom-limit cases, because the export uses fixed product limits; and the 6 byte-block cases, because the export takes arrays, not blocks. Those are covered by the native Rust tests.
- The `4.0` count case passes through `JSON.stringify` as `4`.

**Public API.** No `vtracer::`/`visioncortex::` outside the private `trace` module (test). `Segmentation` has only private fields.

**WASM size.** `vector_engine_wasm_bg.wasm` is 608.22 kB (238.87 kB gzip), up from 526.56 kB (208.25 kB gzip) on `main`. The worker JS glue grew from 6.55 to 10.74 kB. These are worker assets, outside the UI JS budget.

## 5. Performance (reference machine; loads recorded; not clean runs)
Every run had unrelated CPU load from the maintainer's `ngspice` jobs (10–13 processes). The figures are **ratios and indications, not clean reference measurements** (C9). Raw outputs: `artifacts/`.

**Trace time vs `main`** (brief: within noise of baseline). Interleaved A/B over 3 rounds of `vectorize` for the `main` build and the G-ENG build, median of 3 reps per round; load average 14.9–18.9 with 13 `ngspice` processes:

| Image, mode | `main` median (ms) | G-ENG median (ms) | Δ | `main` range | G-ENG range |
|---|---|---|---|---|---|
| hokusai-great-wave-640, bw | 13.8 | 13.9 | +0.7 % | 13.7–15.1 | 13.4–15.6 |
| hokusai-great-wave-640, color | 369.0 | 375.5 | +1.8 % | 361.6–413.8 | 372.3–458.0 |
| talbot-scene-in-a-library-640, bw | 22.2 | 22.0 | −0.9 % | 20.7–23.3 | 21.2–23.9 |
| talbot-scene-in-a-library-640, color | 262.9 | 260.4 | −1.0 % | 257.8–285.0 | 258.7–339.6 |
| architecture-street, bw | 781.1 | 786.8 | +0.7 % | 777.6–874.6 | 780.1–929.2 |
| architecture-street, color | 9173.5 | 9289.3 | +1.3 % | 8765.4–11116.0 | 8775.7–11452.3 |

The differences are −1.0 % to +1.8 %, with fully overlapping ranges, so they are **within noise**. `vectorize` runs the same code as before, split into two calls.

**Staged API** (`staged_timing`, medians of 3; load average 7.8 rising to 19.2, 10 `ngspice` processes). Estimate time is reported separately from segmentation:

| Image, mode | MP | vectorize | segment | estimate | fit | Anchors | Estimate range |
|---|---|---|---|---|---|---|---|
| hokusai-640, bw | 0.28 | 11.7 | 7.1 | 0.46 | 5.1 | 2,118 | 1,762–3,318 |
| hokusai-640, color | 0.28 | 308.0 | 214.2 | 9.6 | 100.7 | 54,573 | 43,718–74,072 |
| talbot-640, bw | 0.34 | 18.7 | 8.5 | 1.4 | 10.0 | 3,334 | 2,339–4,405 |
| talbot-640, color | 0.34 | 215.9 | 135.7 | 7.2 | 77.7 | 33,123 | 27,247–46,165 |
| architecture-street, bw | 12.48 | 674.1 | 306.5 | 42.6 | 367.2 | 128,973 | 79,140–148,986 |
| architecture-street, color | 12.48 | 7,503 | 5,850 | 182.8 | 1,655 | 389,717 | 361,062–611,747 |
| portrait-face, bw | 17.92 | 852.5 | 424.8 | 52.3 | 438.7 | 59,426 | 35,106–66,091 |
| portrait-face, color | 17.92 | 26,041 | 22,659 | 429.2 | 3,920 | 1,145,297 | 796,621–1,349,710 |

(All times in ms.)

- `segment + fit` equals `vectorize` within noise.
- The estimate costs 1–11 % of the fitting time it can save.
- The range contained the actual count in all 8 cases. Two of these images were in R03's calibration set, so this is **not** an FP/FN validation (G-TRACE).
- portrait-face colour is a correct over-budget flag: its high bound is above 1M, and so is the actual count.

**WASM packet copy-out** (brief: ≤ 2 ms at 1M anchors). Node 24.22.1, so this is not browser evidence. A synthetic 2200² gradient halftone gives 897,005 anchors in one path, a 38.4 MB packet. All six arrays came back as fresh whole-buffer arrays.

| Load average | `vectorizePacket` | Copy-out (6 `take*`), median of 7 | Copy-out range | WASM `validatePacket` (copy-in + validate) |
|---|---|---|---|---|
| ≈ 8 (first run) | 102.1 ms | **2.36 ms** | — | 8.0 ms |
| 28.0 (final head) | 170.3 ms | 3.70 ms | 1.43–13.52 ms | 15.6 ms |

**Not demonstrated.** At ~0.9M anchors the median is above 2 ms in both runs, though a 1.43 ms rep shows the target is reachable on an idle core. The copy is one memcpy per array (wasm-bindgen's `slice`), so the result is bandwidth-bound. A clean-machine and in-browser measurement is required before this target is claimed. **The target is not lowered.**

## 6. Debt dispositions (appended to TECHNICAL-DEBT)
- **TD-ARCH-001:** boundary check PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING.
- **TD-ARCH-003, engine and validator half:** PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING. The document half is G-DOC; integration is pending.
- **TD-ARCH-004:** PRODUCTION VERIFIED / OWNER ACCEPTANCE PENDING.
- **TD-PERF-002, API part:** PRODUCTION VERIFIED. The forecast UI, the FP/FN validation and the 2 s forecast stay with G-TRACE.
- **New: TD-PLATFORM-007** (native vs WASM Artistic difference, pre-existing). Open items now total 38; none is closed.

## 7. NOT RUN, and why
- **Playwright, rest of the suite:** `offline-recovery`, `sw-update`, `owner-bundle`, `pdf-eval` and the benchmarks were not run. The worker and app code are unchanged; only the WASM binary gained exports. The subset in §8 covers the worker trace, CSP, exports, precision and privacy.
- **Real Safari and lower-end hardware:** not G-ENG prerequisites.
- **Estimator FP/FN validation on a reserved corpus:** G-TRACE. The R03 calibration constants are used as recorded.
- **Clean-machine timings:** unrelated `ngspice` load (10–13 processes) was present during every timing run.
- **Linux amd64:** CI will exercise build, lint and tests once P-CI is on `main`.

## 8. Final-head checks
At engine head `23440c0`; the later commits change only TS and documentation:
- `regression_corpus` 326/326 identical and `geo_bundle` 72/72 identical (load average ≈ 24–28);
- `pnpm run build` PASS, with WASM `e4571a64…` at 608,220 B;
- Playwright 1.65.1, 39/39 PASS in Chromium, Firefox and WebKit:
  - `smoke`, `csp`, `workbench`, `precision` and `privacy` specs, against the production build;
  - Playwright WebKit is not Safari.
- `cargo fmt --check`, `clippy -D warnings`, `cargo test`, `vp check` and `vp test`: as in §4.
- **Packet route re-run at the final engine code:** 326/326 identical to `a4cf172.sha256` (`artifacts/packet-route-final.sha256`).
- **WASM fingerprint with the final WASM `e4571a64…`:**
  - default-mode digest `68723671…` and precision digest `07fdd00d…`, both unchanged;
  - packet and draw-list exports equal the direct route, with 0 mismatches;
  - native vs WASM blocks 62/65, the same 3 cases as TD-PLATFORM-007 (`artifacts/wasm-fingerprint.json`, `artifacts/packet-route-final.txt`; load average 45.9 → 11.4).
- **TS fix after these runs:** the `decodeBlock` Buffer fix (TS only) was verified by `vp check` and `vp test` (69/69). It does not touch the engine or the WASM.

## 9. Integration
The single production validator and codec are in `src/geometry/packet/`. G-DOC's test-only adapter is replaced in the P1-A integration PR, as described in the brief.
- **Two small helpers will be duplicated until then:** canonical JSON (G-DOC's container code versus `canonicalJson` here). The integration PR keeps one.
- **`docs/TECHNICAL-DEBT.md`:** G-ENG and G-DOC both append lines under TD-ARCH-003. Whichever PR merges second resolves the trivial adjacent-line conflict by keeping both lines.

## 10. P1-A corrective review (AM-1)
This section records the corrective work on this branch after the P1-A corrective-review brief. The production wiring with G-DOC, the end-to-end export proof and the browser persistence suite are on the integration branch (`p1a/integration`, report `docs/research/p1a-integration/P1A-INTEGRATION-REPORT.md`). Isolated results on this branch do not close the gate.

### 10.1 Amendments (AM-1, PR #13)
The §3 amendment requests were accepted and processed as AM-1 through the frozen-contract mechanism: AR-1 (C3 byte-decoding order), AR-2 (export draw list with `paletteId` and artboard size; C5 r2 and C8 r2), AR-3 qualified (C3 r2 determinism wording, below), A1–A3, `stylesById`, palette names, the artboard background, header-relative offsets with contiguous sections, and the transform tolerance. Spec revisions (C2 r2 … C8 r2, new C10 r1) are separate from serialized versions, which did not change: `packetVersion` 1, `protocolVersion` 2, `formatVersion` 1, `documentSchemaVersion` 1. `provenanceVersion` 1 is new.

### 10.2 Packet determinism (C3 r2)
New wording: identical validated scenes must produce byte-identical geometry packets across Rust, WASM and TypeScript.
- **Producers.** Rust `GeometryPacket::from_scene` (native), WASM `sceneToPacket`, and TS `packetFromScene` (`src/geometry/packet/scene.ts`). `SceneMeta::from_json` and `exportDrawListScene` complete the scene ↔ packet ↔ export loop.
- **Proof.** `tests/fixtures/packet-determinism/` holds 8 frozen G-0 scenes (including the three TD-PLATFORM-007 cases) with native golden blocks. The Rust test, the built WASM and the TS producer all reproduce them (`tests/unit/geometry-determinism.test.ts`). `node scripts/packet-determinism.mjs <packet_regression output>` runs the same proof over the corpus: **106/106** scenes identical in all three.
- **Native vs WASM tracing** is not covered by this wording and stays open as **TD-PLATFORM-007**: 62/65 default-mode cases agree. The first divergent values for the 3 others are recorded in the debt entry, confirmed against the frozen G-0 baseline. Artistic and Precision v1 algorithms were not changed.

### 10.3 Independent review findings
| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | HIGH | A trace `vectorize` accepts, with more than 65,536 distinct styles or groups, produced an invalid packet | `from_scene` refuses it up front with a typed `budget` (the C3 table cap is unchanged) | `crates/vector-engine/tests/packet.rs` |
| 2 | MEDIUM | Sparse `styles`/`groups` arrays slipped past the TS validator; `canonicalJson` serialised holes | index loops; sparse arrays refused | `geometry-packet.test.ts` |
| 3 | MEDIUM | Rust parsed JavaScript's shortest float text inexactly | serde_json `float_roundtrip` | `crates/vector-engine/tests/packet.rs` |
| 4 | MEDIUM | `bake_draw_list` copied geometry before enforcing the anchor cap (OOM abort in wasm32) | per-reference anchor sum before copying | `crates/vector-engine/tests/bake_alloc.rs` (counting allocator: 347 MB → 0) |
| 5 | LOW | Text-level JSON failures: Rust `manifest`, TS a later step | documented, not changed (`tests/fixtures/packet-conformance/README.md`) | `wasm-packet-adapter.test.ts` |
| 6 | LOW | WASM produced packets above the limits it accepts | packet route capped at the product limits | `wasm-packet-adapter.test.ts` |
| 7 | LOW | `PacketResult` allowed a second take, or `blockBytes` after a take | explicit `invalid_params` | `wasm-packet-adapter.test.ts` |
| 8 | LOW | `decodeRecord` stripped a BOM; Rust parsed manifest text above the 16 MiB cap; non-`Uint8Array` input was untyped | BOM kept (refused as non-canonical); cap before parsing; typed `type` error | codec tests |

A CI step now runs `cargo clippy -p vector-engine -p vector-engine-wasm --lib --locked -- -D warnings` (native and `wasm32-unknown-unknown`), so production Rust builds without diagnostics.

### 10.4 Copy-out at 1M anchors (P1-A performance item)
Workload: a 2318² gradient halftone at pitch 5.2, **995,405 anchors**, 42,603,358 packet bytes, block SHA-256 `b318ecfc…9e79` (Node). The browser harness uses the same generator and records the same anchor and byte counts; it records no block hash. Each run is 30 measured repetitions after one warm-up, with main-thread validation by the production TS validator. Apple M5 Max, macOS, Node 24.22.1, Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2 (not Safari). Values are medians in ms, with p95 for copy-out.

**Run 1: no `ngspice`** (23:45; load average 9.3 → 8.7). Not a quiet machine: another project's CPU-bound jobs were running, with 4–14 processes above 50 % CPU.

| Runtime | Compute | **Copy-out** (median / p95) | Transport | Main-thread validation |
|---|---|---|---|---|
| Node (`worker_threads`) | 87.5 | **0.97** / 2.18 | 0.30 | 14.0 |
| Chromium (dedicated worker) | 84.2 | **2.2** / 2.4 | 0.1 | 7.8 |
| Firefox | 82 | **2** / 3 | 0 | 12 |
| Playwright WebKit | 87 | **1** / 3 | 0 | 6 |

**Run 2: under load** (23:28; 26–28 `ngspice` processes, load average 20–26): Node 1.37 / 9.87, Chromium 3.4 / 3.5, Firefox 4 / 15, WebKit 1 / 4 (copy-out median / p95). The other phases were 1.5–2.2 times slower than in run 1.

- **Target ≤ 2 ms: PARTIAL.** In run 1 the median meets the target in Node, Firefox and WebKit. Chromium misses it by 0.2 ms with a tight spread (2.0–2.4 ms). The p95 is above 2 ms in all four runtimes. Firefox and WebKit report `performance.now()` to the millisecond in this context, and Chromium to 0.1 ms.
- **Avoidable copies.** Copy-out is one `slice` per section from WASM linear memory into a fresh `ArrayBuffer` (42.6 MB). WASM memory cannot be transferred, so this is the one copy the design requires. Transport is a zero-copy transfer, and the main thread makes no further copy. Chromium's 2.2 ms is about 19 GB/s for that copy. Doing better would need fewer bytes (a smaller packet encoding) or producing directly into a transferable buffer, which are C2/C4 changes outside this gate.
- Commands: `node scripts/bench-packet-copyout.mjs 30 2318 5.2` and `node tests/browser/perf/run-copyout.mjs 30`. The JSON results are in `docs/research/p1a-integration/bench/` on the integration branch.

### 10.5 Checks on this head
- `pnpm exec vp check`: PASS (110 files formatted; 51 files without lint or type errors).
- `pnpm exec vp test run`: 86/86 PASS (6 files).
- **WASM conformance as a committed test.** The 35 shared cases the WASM signature can express (product limits, no TS-only types, no byte streams) give the expected codes and totals through the built `validatePacket` (`tests/unit/wasm-packet-adapter.test.ts`). The 35/35 in §4 was an ad-hoc run until now.
- Earlier on `3ae7c09`: the Rust regression corpus 326/326 and its 72/72 precision cases, the packet route 326/326, and unchanged WASM output digests (`68723671…`, `07fdd00d…`). The CI run for this head is listed in the integration report.

### 10.6 Disposition
**PARTIAL.** The corrective items are done and tested. Copy-out ≤ 2 ms is missed in Chromium at the median and at p95 everywhere. A quiet-machine run is NOT RUN. Gate closure depends on the integration branch.
