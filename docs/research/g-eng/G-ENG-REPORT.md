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
