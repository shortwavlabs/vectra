# P1-A integration — G-ENG and G-DOC on one production path

**Status:** **PARTIAL**, waiting for maintainer acceptance. The integration work is done and verified (§3–§6). Two performance targets are not met: project load at 250k paths (≤ 1 s) and copy-out (≤ 2 ms) in Chromium and at p95. Structural edits carry a measured risk (TD-PERF-007). Benchmarks on a quiet machine were NOT RUN (§7.0).

**Branch:** `p1a/integration`, based on `main` at `d6c1cbf`. It merges AM-1 (PR #13), G-ENG (PR #10) and G-DOC (PR #11) with merge commits only, then adds the integration commits below. No history was rewritten and no commit is duplicated: every gate commit reaches this branch through a merge of its own branch.

| Integration commit | What it adds |
|---|---|
| `67aba06` | G-DOC wired to G-ENG's validator and codec (§3); test adapter deleted |
| `7c5aced` | End-to-end document export proof (§4) |
| `a642e6e` | Relinking test on the production loader |
| `42b67d4` | Browser persistence qualification (§5) |
| `e07c083`, `7fa6374` | G-DOC benchmarks on the production path, interactive-target configuration, dispatch profile (§7) |
| this commit | This report, benchmark artefacts, debt register updates |

## 1. P-CI
- **Merge.** PR #8 was merged with a merge commit, **`d6c1cbf8fecda859c12171db0222049566c18761`**, after its head (`a1c3e7f`), base (`main`), diff and CI were checked. It was the only PR merged during this task.
- **Hardening before the merge** (`.github/workflows/ci.yml`):
  - The path classifier skips the heavy steps only for an explicit docs-only allowlist (`*.md`, `LICENSE`, and images, PDFs, text and `.sha256` files under `docs/`), using `git diff --no-renames`. Any other path, including an unknown one, runs every check.
  - Toolchain versions are read from the pinned files, checked against `^[0-9]+\.[0-9]+\.[0-9]+$`, and passed through `GITHUB_ENV`. They are never interpolated into shell text.
  - Production Rust runs `cargo clippy -p vector-engine -p vector-engine-wasm --lib --locked -- -D warnings` natively and for `wasm32-unknown-unknown`.
- **Runs.** Probes covered a docs-only diff (8–13 s, heavy steps skipped), an unknown path (3 min 43 s, full checks), and the final head (`45548519353`, success). The full table is in [P-CI-REPORT](../p-ci/P-CI-REPORT.md). The `main` push run after the merge is `45548824122` (success).
- **Enforcement.** A read-only check before the merge found `main` unprotected, with 0 rulesets, so nothing existing was overwritten. After the merge, `main` was set to require the `ci` status check (GitHub Actions app) with `strict: false` and `enforce_admins: false`, and no other rule. **Owner action:** confirm these settings, or tighten them (for example `enforce_admins: true`, or requiring branches to be up to date).

## 2. Amendments (AM-1, PR #13)
One amendment set, `docs/p1a-amendments-am1` at `8011555`, is merged into both gate branches and into this branch.
- **Accepted and processed** through the frozen-contract mechanism: AR-1, AR-2, AR-3 (qualified), A1, A2, A3, `stylesById`, palette names, artboard background, header-relative offsets with contiguous sections, and the transform tolerance. RFC-002, the contracts, the decision register and the debt register were updated.
- **Spec revisions vs serialized versions.**

  | Spec revision | Serialized version |
  |---|---|
  | C2 r2, C3 r2, C4 r2, C5 r2, C6 r2, C7 r2, C8 r2; new C10 r1 | unchanged: `packetVersion` 1, `protocolVersion` 2, `formatVersion` 1, `documentSchemaVersion` 1 (unreleased; finalised here) |
  | | new: `provenanceVersion` 1 |

  No wire format changed.
- **C3 r2 determinism.** "Identical validated scenes must produce byte-identical geometry packets across Rust, WASM and TypeScript." Proved from identical canonical scene inputs: 8 committed goldens and **106/106** corpus scenes (G-ENG report §10.2).
- **Native vs WASM tracing** stays open as **TD-PLATFORM-007**: 3 of 65 default-mode fixtures differ. Their first divergent values are recorded, confirmed against the frozen G-0 baseline. Artistic and Precision v1 algorithms were not changed.

## 3. Production validator integration
- **One path.** `src/document/packet-port.ts` adapts G-ENG's `validatePacket`, `encodeRecord` and `decodeRecord` (`src/geometry/packet/`) to the result values the store and loader use. It re-exports G-ENG's C3 types and uses `PRODUCT_LIMITS` as the default.
  - `GeometryStore` and `loadContainer` no longer accept a port, so no alternative validator can be injected.
  - `src/document/testing/packet-adapter.ts` and its test are deleted.
  - `src/document/architecture.test.ts` asserts that the document code imports packet validation only from `src/geometry/packet/`.
  - Canonical JSON has one implementation (`src/persistence/canonical-json.ts`), re-exported by the codec. The manifest-text cap is G-ENG's `MAX_MANIFEST_BYTES`.
- **G-DOC's suites rerun on the production path** (not a trial merge). `pnpm exec vp test run`: **263/263** in 17 files, including every G-DOC and G-ENG suite.

  | Area | Where it is tested |
  |---|---|
  | C3 conformance (47 shared cases, Rust and TS codes agree) | `tests/unit/geometry-packet.test.ts`; Rust `crates/vector-engine/tests/packet.rs` (CI) |
  | WASM conformance and adapter | `tests/unit/wasm-packet-adapter.test.ts`: the 35 shared cases the WASM signature can express give the expected codes and totals through the built `validatePacket`, plus adapter limits and `PacketResult` misuse. `tests/unit/geometry-determinism.test.ts`: WASM packets equal the goldens |
  | Ownership and detachment | `geometry-store.test.ts` (aliases detached after commit; rule-1 violations are `ownership`); browser suite (§5) |
  | Derived-data isolation | `geometry-store.test.ts` (no buffer exposure in views, derived views or results); `review-regressions.test.ts` 3 |
  | Accounting and refcounts | `geometry-store.test.ts` (refcounts per owner kind; freed at the settle after the last release); `ledger.test.ts`; `session.test.ts` history budgets |
  | Per-reference anchors | `session.test.ts` (duplicate beyond the cap is `budget`); `container.test.ts` (`document:budget`); Rust `bake_alloc.rs` |
  | Persistence security | `container.test.ts` (truncation at every boundary, adversarial sections, decompression limits, fuzzing); `canonical-json.test.ts`; browser suite (§5) |
  | Eviction | `property.test.ts` (chunks freed exactly when an evicted history entry releases them); `review-regressions.test.ts` 8 |

- `pnpm exec vp check`: PASS.

## 4. End-to-end export proof
Pipeline (`tests/unit/p1a-export-pipeline.ts`): P0 scene → GeometryPacket (WASM `sceneToPacket`) → document `commitTrace` with provenance → `.vectra` save → strict load → export draw list (`buildExport`) → Rust bake (WASM `exportDrawList*`) → scene JSON, SVG and PDF.
- **Full corpus** (`node scripts/document-export-regression.mjs <regression output>`): **636/636** files identical to the frozen `a4cf172.sha256`. That is 106 scenes × 3 files × 2 codecs; the 8 over-budget cases have no scene. Run time 75 s. The frozen regression counts stay **326 + 72**: verified on G-ENG `3ae7c09`; no file under `crates/` or `packages/` has changed since. The corpus run used integration `c923479`; later commits change no code it executes.
- **In CI** (`tests/unit/p1a-document-export.test.ts`, 32 tests): the committed corpus subset (12 scenes covering halftone with clip and background, transparent halftone, mosaic, limited palette, colour and B&W) reproduces scene, SVG and PDF hashes for both codecs.
- **Edited documents export current values** (document form), never the packet's historical styles or provenance:

  | Edit | Checked |
  |---|---|
  | Recolouring a path | the fill overrides the packet style; `derivedFrom[0].edited` is true |
  | Palette entry | every path referencing it is recoloured |
  | Transform | baked into the coordinates in f64 (`2x + 10`, `2y − 5`) |
  | Clip and visibility | taken from the document |
  | Multiple layers | one document, unique run ids, one `derivedFrom` entry each |
  | Empty group | its run is kept |
  | Halftone background | follows the artboard |

- **Schema and provenance** are described in [G-DOC-REPORT §11](../g-doc/G-DOC-REPORT.md) and contract C10 r1. Original metadata is used only for a single unedited trace on its original artboard.

## 5. Browser persistence (Chromium, Firefox, Playwright WebKit)
`pnpm exec playwright test -c tests/browser/persistence/playwright.config.ts`: **28 passed, 2 skipped** (run on `42b67d4`; since then only `container.test.ts` changed under `src/`, plus documentation). The cross-engine test launches all three engines itself, so it runs once, in the Chromium project; the 2 skips are its Firefox and WebKit copies. Engines: Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2. **Playwright WebKit is not Safari**; real Safari remains NOT RUN (TD-PLATFORM-002).

A harness page runs the production container, session and store. Every engine is compared with the same document built in Node.

| Check | Result |
|---|---|
| Save → strict load equivalence, both codecs | equal in every engine and equal to Node; re-save identical; clean state after load |
| Canonical section identity | section sha256 and `uncompressedLength` identical to Node in all engines, both codecs |
| Container bytes, `none` | byte-identical in all engines and Node (63,804 B) |
| Container bytes, `deflate-raw` | compressed bytes differ by engine (Chromium = Node 16,067 B; Firefox 16,411 B; WebKit 15,510 B) while section hashes agree, as C7 allows |
| Cross-browser interchange | each engine's file loads in every engine and in Node, both codecs |
| Atomic failures | malformed input raises a typed `ContainerError`; session, snapshot, state and revision unchanged |
| Bombs and limits | 256 MiB of deflated zeros refused inside the streaming loop (`inflate`); per-section caps and the session budget each raise `limit` |
| Ownership transfers | commit detaches the caller's buffers; 5 job copies round-trip a Worker intact; committed records unchanged |
| Missing-source relinking | wrong digest or size refused; matching bytes relink; no revision, no dirty flag |

## 6. Independent review
Both gates were reviewed independently, including the G-DOC code written by this agent. Each finding was reproduced before it was fixed, and each fix has an adversarial regression test.
- **G-ENG:** 8 findings: 1 HIGH, 3 MEDIUM, 4 LOW. Seven were fixed. Finding 5 (LOW: Rust and TS give different codes for malformed manifest text) is documented and pinned by a test. See [G-ENG-REPORT §10.3](../g-eng/G-ENG-REPORT.md).
- **G-DOC:** 9 findings, all fixed with tests. Finding 6, first fixed by inspection, now has a test that fails when the check is removed. See [G-DOC-REPORT §11.3](../g-doc/G-DOC-REPORT.md).
- **CI check for production Rust without diagnostics:** the clippy step in §1, on `main` since `d6c1cbf`.

## 7. Performance
All figures use the production validator. Results and machine state are in [`bench/`](bench/): `no-ngspice/` holds the primary run and `loaded-ngspice/` the earlier loaded runs. Each run file records its load averages.

### 7.0 Conditions
- **Hardware and software:** Apple M5 Max (18 cores), macOS, Node 24.22.1; Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2.
- **Primary run (no `ngspice`)**, 23:43–23:45. No `ngspice` process was running. The machine was **not quiet**: another project's CPU-bound jobs had 14 processes above 50 % CPU at the start and 4–5 during most of the run. Load average went from 12.1 to 8.7.
- **Loaded runs**, 23:14–23:42: 3–28 `ngspice` processes, load average 12–40. They are kept for comparison only.
- **Not run:** a quiet-machine run.
- **Method:** 30 measured repetitions after a warm-up, 15 for project open. Medians and p95 are reported. Each workload is identified by a hash: the SHA-256 of its C3.0 geometry record, or of the block for copy-out.

### 7.1 Copy-out at 1M anchors (≤ 2 ms): PARTIAL
Workload: 995,405 anchors, 42.6 MB, block `b318ecfc…` (Node). The browser harness uses the same generator, with the same anchor and byte counts; it records no block hash. Copy-out ms are median / p95.

| Runtime | Compute | **Copy-out** | Transport | Main-thread validation |
|---|---|---|---|---|
| Node | 87.5 | **0.97** / 2.18 | 0.30 | 14.0 |
| Chromium (worker) | 84.2 | **2.2** / 2.4 | 0.1 | 7.8 |
| Firefox (worker) | 82 | **2** / 3 | 0 | 12 |
| Playwright WebKit (worker) | 87 | **1** / 3 | 0 | 6 |

- The median meets the target in Node, Firefox and WebKit, and misses it in Chromium by 0.2 ms. The p95 exceeds 2 ms everywhere. Firefox and WebKit timers have 1 ms resolution here.
- The one copy is WASM memory → transferable `ArrayBuffer`, which the design requires. Transport is zero-copy. The analysis is in [G-ENG-REPORT §10.4](../g-eng/G-ENG-REPORT.md).

### 7.2 Project load (≤ 1 s at 50k and 250k paths): PARTIAL
Open is `loadContainer` end to end: header, inflate, per-section SHA-256, strict canonical JSON, schema, packet decode and C2 commit through the production validator, and session invariants. Times are median / p95 in ms.

| Workload | Anchors | Workload hash | `none` | `deflate-raw` | File (`none` / `deflate-raw`) | Verdict |
|---|---|---|---|---|---|---|
| A: 50,000 paths × 20 | 1,000,000 | `772c4349…` | 179 / 189 | 300 / 332 | 43.9 / 24.9 MB | **met** |
| B: 250,000 paths × 4 | 1,000,000 | `d4a4aa8d…` | **1,048 / 1,135** | **1,108 / 1,242** | 88.1 / 25.7 MB | **missed** |
| I: 41,666 paths × 6 (interactive target) | 249,996 | `cfa6aebd…` | 118 / 128 | 165 / 170 | 17.3 / 6.3 MB | **met** |

**Phase profile at B** (one pass, `open-profile.mjs`; the 54.8 MB document section):

| Phase (ms) | `none` | `deflate-raw` |
|---|---|---|
| header | 0.3 | 0.1 |
| inflate + SHA-256 | 32 | 395 |
| strict canonical JSON | 350 | 484 |
| schema | 258 | 322 |
| packet decode + C2 commit | 26 | 25 |
| session + invariants | 157 | 157 |
| total | 823 | 1,383 |

- **Reading.** Load cost follows the **node count**, not the anchor count. The geometry path (decode and commit) is about 25 ms. Parsing, the strict canonical check, the schema and the invariant pass are linear in the about 220 bytes of JSON each PathObject carries. The single-pass total for `none` (823 ms) is below the 15-repetition median (1,048 ms); the median is the gate figure.
- **Bounded optimisations investigated.**
  - The linear-time strict canonical reader, already in G-DOC, took B from 2.6–2.8 s to about 1.65 s in the G-DOC run.
  - A scratch experiment, not committed, omitted default-valued node members. It cut the B document by 32 % and `JSON.parse` time by 21 %. It changes the Document v1 schema that AM-1 just finalised, so it needs an amendment and was not implemented.
  - Parsing in a worker keeps the UI responsive but does not shorten the wall-clock open the target measures.
  - Validation, integrity checks and decompression limits were not weakened.
- **Recommendation** (maintainer decision; the target is not lowered): before `documentSchemaVersion` 1 is released, amend Document v1 to a compact node encoding, then re-measure B. If B still misses, decide whether the 1 s target applies to node count or anchor count, with evidence from a quiet machine.

### 7.3 Interactive target (≈ 250k anchors, ≈ 40k paths; workload I)
| Measure | Median | p95 | Budget | Verdict |
|---|---|---|---|---|
| Store commit (move, validate and derive, publish) | 5.3 ms | 15.6 ms | ≤ 50 ms | met |
| Trace-commit transaction (`commitTrace` dispatch, single run) | 58 ms | — | — (G-TRACE budget) | information |
| Structural dispatch (transform, rename, hide, recolour, delete group) | 25.2–28.9 ms | 26.9–32.1 ms | no dispatch target in RFC-002 §17; attributable main-thread blocking ≤ 50 ms; interaction frame p95 ≤ 33 ms (16.7 ms aspirational) | within 50 ms; **risk**: uses most of a 33 ms gesture frame |
| Undo / redo | ≤ 0.003 ms | ≤ 0.004 ms | ≤ 16 ms | met |
| Open, `none` / `deflate-raw` | 118 / 165 ms | 128 / 170 ms | ≤ 1 s | met |

- **Dispatch profile** (`dispatch-profile.mjs`): 20.8 ms, of which `validateState` takes 16.6 ms (80 %), the node-map copy 2.2 ms, and everything else 2.1 ms. At 250k paths the same profile is 156 ms (79 % in `validateState`).
- **At 1M anchors**, the store commit is 19.9 ms at A and 24.0 ms at B, within ≤ 50 ms. Structural dispatch is 34–41 ms at A, within the 50 ms blocking budget. At B (250k paths) it is **172–253 ms**, above that budget (p95 186–300 ms).

### 7.4 O(nodes) transaction cost: registered as debt
**TD-PERF-007** (gate **G-EDIT**). Every transaction copies the node map and runs the whole-state invariant pass.
- **Upgrade path:** incremental invariants over the nodes a transaction touched, and structural sharing for the state maps. The whole-state pass stays authoritative for load, import and recovery, and serves as the test oracle.
- **Closure criteria** (numeric thresholds **proposed** for maintainer decision, derived from RFC-002 §17):
  - a structural dispatch of ≤ 16.7 ms median and ≤ 33 ms p95 at the interactive target, and ≤ 50 ms at the 1M-anchor stress workloads, measured on a quiet machine with the production build;
  - incremental and full validation agree over at least 10,000 randomized transactions;
  - load still runs the full pass.
- No store rewrite and no new dependency were made in P1-A. The approach and any dependency need approval at G-EDIT.

### 7.5 Loaded runs, for comparison
- With `ngspice` running, B's open measured 1,029 ms (`none`) and 1,103 ms (`deflate-raw`), and the interactive structural dispatch 27–31 ms.
- Copy-out medians were 1.37 ms in Node, 3.4 in Chromium, 4 in Firefox and 1 in WebKit.
- The conclusions are the same as in the primary run.

## 8. Outstanding debt and NOT RUN
- **TD-PERF-007** (new, G-EDIT): structural transactions cost O(nodes) (§7.3).
- **Project load at 250k paths** misses ≤ 1 s (§7.2). The recommended amendment is in §7.2; it was not implemented.
- **TD-PLATFORM-007**: native vs WASM Artistic tracing, 3/65 fixtures.
- **Copy-out** misses ≤ 2 ms in Chromium at the median (2.2 ms), and at p95 in every runtime (§7.1).
- **NOT RUN:**
  - benchmarks on a quiet machine;
  - real Safari and mobile (TD-PLATFORM-002);
  - lower-end hardware (TD-PLATFORM-003);
  - Linux amd64 (TD-PLATFORM-001).

## 9. Pull requests, heads and merge order
| PR | Branch | Head | CI |
|---|---|---|---|
| [#8](https://github.com/shortwavlabs/vectra/pull/8) P-CI | `ci/p-ci-minimal` | `a1c3e7f` | **merged** as `d6c1cbf` |
| [#13](https://github.com/shortwavlabs/vectra/pull/13) AM-1 | `docs/p1a-amendments-am1` | `8011555` | `45549103203` success (docs-only path) |
| [#10](https://github.com/shortwavlabs/vectra/pull/10) G-ENG | `gate/g-eng-engine-packet` | `ed3994e` | `45556525261` **success** (full checks, 2 min 4 s) |
| [#11](https://github.com/shortwavlabs/vectra/pull/11) G-DOC | `gate/g-doc-document-store` | `38afd35` | `45556525464` **success** (full checks, 1 min 51 s) |
| integration | `p1a/integration` | the commit adding this report | see the PR |

**Dependencies.** #10 and #11 each contain `main` and AM-1 (#13) through merge commits. #11 does not depend on #10's code: it validates through its test adapter until integration. The integration PR contains all three plus the wiring, the E2E proof and browser persistence, and it removes the test adapter.

**Merge order** (merge commits only; squash or rebase merges would duplicate these commits in the integration branch):
1. **#13 AM-1** (documentation): the contract text both gates implement.
2. **#10 G-ENG.**
3. **#11 G-DOC.** After #10 it has one known conflict: adjacent appended lines under TD-ARCH-003 in `docs/TECHNICAL-DEBT.md`. Keep both lines. The resolution is a forward merge of `main` into the G-DOC branch (no rebase), the same resolution this branch already carries. The register rows no longer conflict, because TD-PERF-007 sits with the PERF rows.
4. **The integration PR**, last. After steps 1–3, its diff is only the integration commits.

Alternative: merge #13 and #10, then the integration PR. #11's commits are then on `main` and GitHub marks #11 merged. This skips the manual conflict step, but it does not merge #11 as a reviewed PR in its own right. Either way, nothing is merged without maintainer authorisation.

## 10. Disposition
| Gate | Disposition | Why |
|---|---|---|
| **G-ENG** | **PARTIAL** | Engine, packet, determinism and review fixes are done and verified on the production path. Copy-out ≤ 2 ms is missed in Chromium at the median and at p95 in every runtime, and quiet-machine runs are NOT RUN. |
| **G-DOC** | **PARTIAL** | Schema, provenance, export semantics, the production wiring, the E2E proof and browser persistence pass. Project load at 250k paths misses ≤ 1 s. Structural dispatch exceeds the 50 ms blocking budget at 250k paths and is a risk for gesture frames at the interactive target (TD-PERF-007). Quiet-machine runs are NOT RUN. |

Neither gate is claimed closed. Stopping here for maintainer acceptance.
