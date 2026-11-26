# G-DOC-R — Document-store performance (report)

**Status: IN PROGRESS.** Stage B is implemented and qualified (§1). Stages C and D are not started. Nothing is merged; the gate awaits maintainer acceptance stage by stage ([scope](G-DOC-R-SCOPE.md)).

| | |
|---|---|
| Base | `main` `0e957372b4badbd0ba82ec807b752c57a84cc654` (G-BRAND merged, #21; main CI run 45863375261 succeeded) |
| Branch | `gate/g-doc-r` |
| Mandate | The maintainer's "G-BRAND Acceptance and G-DOC-R" brief (2026-11-26); [G-DOC-R-SCOPE](G-DOC-R-SCOPE.md); [TD-PERF-007 investigation](../g-r1/TD-PERF-007-INVESTIGATION.md) §6–§7; decision register §9 and §10 |
| Machine | Apple M5 Max, 18 cores, 128 GiB, macOS 26.6.2 (Darwin 25.6.0). **Shared, not quiet**: load averages are recorded with every run |
| Runtime | Node v24.22.1 (type stripping, main thread, `--expose-gc`); pnpm 12.23.0; Vite+ 1.7.0 (`vp test` on Vitest 5.1.0) |
| Workload | `src/document/testing/bench-workload.ts`, the TD-PERF-007 investigation's workload, now shared by both benchmark scripts |

## 1. Stage B — incremental validation in `dispatch`

### 1.1 What changed
`DocumentSession.dispatch` validates each transaction's result with the incremental proof (`checkIncremental`) against its validated predecessor. When the proof cannot decide, the full `validateState` runs and either accepts or throws. So **every rejection is the full pass's error**, by construction.

`SessionOptions.validation` selects the mode (`ValidationMode`):

| Mode | Behaviour | Default in |
|---|---|---|
| `incremental` | The proof; the full pass when it is undecided | production builds and Node (`import.meta.env.DEV` false or absent) |
| `compare` | As `incremental`. Every decided transaction is also checked by the full pass. A disagreement throws `ValidationDisagreement`, a non-`DocumentError` defect, and the document is unchanged | development and test builds (`vp dev`, `vp test`) |
| `full` | The full pass only: the pre-G-DOC-R behaviour | explicit option only |

**The oracle and the load path are unchanged.**
- `validateState` (`invariants.ts`) is unchanged, except that four rule constants it already used (`isU32`, `DIGEST_RE`, `MIMES`, `LONE_SURROGATE`) are exported. The incremental validator imports them instead of keeping copies, so the two cannot drift on those rules.
- The session constructor still runs `validateState` in every mode. `loadContainer` builds its document through that constructor, so every untrusted loaded document is fully validated.
- A guard test fails if any production module other than `session.ts` imports the incremental validator, or if the constructor stops calling `validateState(o.state, …)` or starts calling `checkIncremental`.

**Rule kept from the investigation.** A change to `invariants.ts` adds the rule to `incremental-validate.ts` and a forgery to the differential harness in the same change. The rule is now in both files' headers.

**Files.**

| Path | Change |
|---|---|
| `src/document/session.ts` | `ValidationMode`, `DEFAULT_VALIDATION_MODE`, `ValidationDisagreement`, `#validate`, `validations` counters (accepted transactions by deciding path), exported `sameDerived` |
| `src/document/incremental-validate.ts` | Production header and preconditions; imports the shared rule constants. The logic is the investigation's prototype, unchanged |
| `src/document/invariants.ts` | Exports four existing constants; header comment |
| `src/document/testing/incremental-differential.ts` | Episodes run their sessions in `compare` mode; a `ValidationDisagreement` from a real dispatch is recorded as a disagreement |
| `src/document/incremental-validate.test.ts` | The guard test rewritten for the wired state (above) |
| `src/document/session-validation.test.ts` | New: modes agree, atomic rollback, resource limits, immutability, undo/redo, untrusted constructor input |
| `src/document/session-compare.test.ts` | New: `compare` mode catches injected faults atomically |
| `src/document/testing/bench-workload.ts`, `scripts/bench-g-doc-r.mjs` | The shared workload; the integrated dispatch benchmark |
| `scripts/bench-td-perf-007.mjs` | Imports the shared workload and pins its sessions to `validation: "full"`, so its stage profile keeps its original meaning |

### 1.2 Correctness qualification
**Differential against the oracle.** The seeded harness (`testing/incremental-differential.ts`) runs real command transactions, forged post-states that model command bugs, and undo/redo. Each validator-reached state is checked by both validators. Each real transaction then also goes through the integrated `dispatch` of a `compare`-mode session, which must reach the same verdict.

| Run | Comparisons | Full pass rejected | Incremental decided | Command-rejected | Disagreements |
|---|---|---|---|---|---|
| `vp test` (seed 20261125, enforced minimum ≥ 10,000) | 12,427 | 4,767 | 7,573 | 3,230 | **0** |
| Record, 6 seeds × 16,000 transactions (20261125, 1, 2, 3, 4, 20261126) | **74,601** | 28,180 | 45,957 | 19,401 | **0** |

- Record: `node scripts/bench-td-perf-007.mjs --differential --seeds 20261125,1,2,3,4,20261126 --transactions 16000` → [`bench/stage-b-differential-8913cfb.json`](bench/stage-b-differential-8913cfb.json).
- The unit test also requires every forgery class that must be rejected (cycle, second parent, orphan, dangling child, bad palette reference, bad entry, anchor budget) and the error codes `invalid_transform`, `clip_transform_unsupported` and `budget` to reach the full pass.
- **At benchmark scale.** All 12 workload transaction types at 43k and 250k paths were run in `compare` mode (3 repetitions each): every one was decided by the proof and agreed with the full pass ([`bench/stage-b-compare-scale-8913cfb.json`](bench/stage-b-compare-scale-8913cfb.json)).

**Integrated session tests** (`session-validation.test.ts`, `session-compare.test.ts`):
- **Modes agree.** One 31-step script runs in all three modes and must give the same revisions, the same errors (code and message), the same final document, history, `nextId` and store bytes. The script covers one-node edits, a layer transform, group, undo and redo, clip, duplicate, delete, fill, reorder, palette, artboard, a second trace, bake, ungroup and a no-op. Its six rejections are `invalid_transform`, a lone-surrogate name (`invariant`), `clip_transform_unsupported`, a two-command transaction whose committed chunk must be freed, and two command-level refusals.
- **Atomic rollback.** After every rejection, everything is unchanged: the snapshot object (identity), `nextId`, the undo and redo stacks, the store's live chunk IDs, its byte totals and every chunk's owner counts.
- **Derived data.** After every step, the session's cached derived data equals a fresh `validateState`.
- **Resource limits**, in each mode: the anchor cap (`budget`), the node cap and the depth cap (`invariant`) reject identically and atomically, and a change exactly at the depth limit is accepted.
- **Immutable ownership.** Published states are frozen and their maps sealed, earlier states are untouched, and undo/redo restore states by reference. A transaction from an undone state validates against that state's own derived data.
- **Untrusted input.** A cyclic state given to the constructor is rejected in every mode.
- **Fault injection.** With a faulty incremental validator (one that accepts anything, or one that returns wrong anchors), `compare` mode throws `ValidationDisagreement` and leaves the document unchanged; `full` mode never consults it.

### 1.3 Performance: integrated dispatch (Node)
`node --expose-gc scripts/bench-g-doc-r.mjs --sizes 43000,250000 --modes incremental,full --reps 30` on `8913cfb` (no tracked changes): [`bench/stage-b-8913cfb.json`](bench/stage-b-8913cfb.json). Load average 2.5–3.0 throughout (low for this machine, but shared, so not "quiet"). Each repetition times `session.dispatch` end to end on a fresh state, which has cold per-state caches.

Workloads:
- **Interactive target:** 43,000 paths, 44,012 nodes, 264,000 anchors (the investigation's workload; slightly above the registered 250k anchors).
- **Stress:** 250,000 paths, 251,012 nodes, 756,000 anchors (within the 500k–1M stress range).

Dispatch in ms (median / p95):

| Type | 43k incremental | 43k full | 250k incremental | 250k full |
|---|---|---|---|---|
| setFill1 | 7.9 / 8.4 | 26.4 / 26.8 | 62.2 / 66.7 | 171.4 / 191.9 |
| setFillMany | 8.5 / 9.0 | 27.0 / 27.4 | 65.1 / 67.7 | 172.3 / 178.4 |
| setVisible | 4.0 / 4.6 | 23.1 / 23.9 | 31.9 / 32.9 | 141.3 / 147.6 |
| rename | 3.9 / 4.6 | 23.3 / 23.5 | 32.1 / 32.6 | 140.2 / 145.3 |
| reorder | 7.1 / 7.5 | 25.6 / 26.1 | 52.6 / 55.9 | 155.1 / 160.8 |
| applyTransformPath | 5.7 / 6.5 | 23.4 / 23.6 | 44.2 / 45.4 | 139.5 / 141.8 |
| applyTransformLayer | 11.6 / 14.3 | 23.4 / 23.6 | 79.6 / 90.1 | 139.9 / 150.7 |
| group | 11.1 / 11.7 | 29.4 / 29.8 | 84.4 / 89.4 | 186.0 / 190.2 |
| ungroup | 9.4 / 10.5 | 25.5 / 25.8 | 67.4 / 72.0 | 153.5 / 156.5 |
| delete | 11.7 / 12.2 | 29.3 / 32.2 | 88.3 / 91.7 | 181.3 / 184.2 |
| duplicate | 11.0 / 11.5 | 29.3 / 29.6 | 80.4 / 83.9 | 182.2 / 184.6 |
| commitTrace | 8.0 / 8.7 | 24.9 / 25.8 | 42.8 / 44.7 | 141.4 / 143.1 |

- The proof decided **every** measured transaction (`incrementalDecided` 1.0 for all 24 type × size cases). The full pass was never a fallback.
- Undo and redo: ≤ 0.03 ms in every case, unchanged.
- **Interactive target, Node:** every type has median ≤ 11.7 ms (≤ 16.7) and p95 ≤ 14.3 ms (≤ 33). Previously, with the full pass, the medians were 23–29 ms.
- **Stress (≤ 50 ms):** met in Node only by setVisible, rename, applyTransformPath and commitTrace (32–44 ms median). **Not met** by the other 8 types (53–88 ms). As the investigation estimated, what remains is the O(nodes) map copy, the publication scan, the identity diff, `documentOrder` and cold `parents`; stages C and D address these.
- These are Node figures on a shared machine. The production build in a browser, real Safari and lower-end hardware are measured at the end of the gate (§5); no stage-level claim is made beyond Node.

### 1.4 Frozen regressions on `8913cfb`
The maintainer's private concert photograph is **excluded** from every run (`concert-small-venue*`; standing instruction). The counts below are the frozen sets minus exactly those cases; no other case is missing.

| Check | Command | Result |
|---|---|---|
| Engine corpus (frozen 326) | `regression_corpus` over the procedural fixtures and 7 of the 9 local photographs; SHA-256 against `a4cf172.sha256` | **302/302 identical**. The 24 missing hashes are all `concert-small-venue*` |
| Owner bundle v2 (frozen 72) | `geo_bundle`, then `cmp` with `owner-acceptance-bundle-v2/` | **72/72 identical** |
| Document export (frozen 636) | `node scripts/document-export-regression.mjs <corpus out>`: scene → packet → session commit → `.vectra` save (both codecs) → strict load → export → bake → scene, SVG, PDF | **588/588 identical**, 98 scenes × 3 files × 2 codecs. The 48 missing hashes are the 8 concert scenes |
| Canonical serialization (new guard) | `session-validation.test.ts`: the 31-step script, saved with codec `none`, in every mode | SHA-256 `e60fa327…538e36`, frozen on Stage B for stages C and D |

The engine (Rust) is untouched by G-DOC-R; its runs confirm the baseline and supply the scenes for the document-export run.

### 1.5 Stage B checkpoint
| Requirement (brief §2 B) | Result |
|---|---|
| Full validator stays the authoritative oracle | **PASS**: every rejection comes from `validateState`; `compare` mode and the differential check every acceptance against it |
| Full-pass fallback | **PASS**: `undecided` → `validateState`; `full` mode keeps the old path |
| Differential comparison mode | **PASS**: `compare`, the default in development and test builds |
| Untrusted loaded documents fully validated | **PASS**: the constructor (load) path is unchanged and guarded |
| Invalid transactions, resource limits, rollback | **PASS**: §1.2 |
| Atomicity and immutable ownership | **PASS**: §1.2 |
| ≥ 10,000 randomized differential transactions | **PASS**: 12,427 enforced in `vp test`; 74,601 recorded, 0 disagreements |
| Correctness defect, contradiction or regression found | **None.** Every type is faster than the full-pass baseline (Node) |
