# G-DOC-R — Document-store performance (report)

**Status: PARTIAL. Stage D is accepted as an implementation (maintainer, 2026-11-26), subject to the accounting closure, which this revision delivers (§7.1, §11.1, §13). The gate stays open: Playwright WebKit misses ≤ 50 ms at 996k anchors for one transaction type, and lower-end hardware and a designated quiet machine are not run.**
- Stages B and C were accepted as checkpoints on 2026-11-26. AM-2 is approved and recorded (C3 r3, RFC-002 §7, decision register §11). Stage D acceptance and the closure brief: decision register §12.
- **Accounting closure (§7.1).**
  - The 0.987 calibration residual (kept on record) was the geometry store's per-chunk record: 3.7 KB per chunk, half of it typed-array headers.
  - It is now accounted under AM-2 term 3; the C3.2 chunk cost and GeometryStore are unchanged (M-10 asks the maintainer to confirm).
  - With the constants frozen first, every scenario above the noise floor has a median ratio ≥ 1.001, including six fresh scenarios of traced-layer replacement and large deletion.
- **Browser dispatch in the production build (§11.1).**
  - All 12 types are ≤ 50 ms at the interactive target and at 756k anchors in Chromium, Firefox and Playwright WebKit, and at 996k anchors in Chromium and Firefox.
  - **WebKit at 996k: applyTransformLayer 59 / 68 ms** (reproduced).
- **Node** meets ≤ 50 ms for all 12 types at all three workloads (§5.5).
- Three independent reviews ran (§1.6, §2.4b, §5.6). Every confirmed defect that breaks a stated claim is fixed and re-qualified. Two low-severity findings are recorded, not fixed (§5.6 C3, an over-count in hand-built states; C5, an error message).
- **Real Safari:** all five harnesses pass on build `e3cfd750f82410a6` (§11). Real Safari dispatch is not run.
- Nothing is merged. Decisions: [G-DOC-R-DECISIONS](G-DOC-R-DECISIONS.md).

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
- **Modes agree.** One 30-step script runs in all three modes and must give the same revisions, the same errors (code and message), the same final document, history, `nextId` and store bytes. The script covers one-node edits, a layer transform, group, undo and redo, clip, duplicate, delete, fill, reorder, palette, artboard, a second trace, bake, ungroup and a no-op. It has seven rejections:
  - `invalid_transform`;
  - a lone-surrogate name (`invariant`);
  - `clip_transform_unsupported`;
  - a two-command transaction whose committed chunk must be freed (`invalid_transform`);
  - three command-level refusals (`invalid_argument`).
- **Atomic rollback.** After every rejection, everything is unchanged: the snapshot object (identity), `nextId`, the undo and redo stacks, the store's live chunk IDs, its byte totals and every chunk's owner counts.
- **Derived data.** After every step, the session's cached derived data equals a fresh `validateState`.
- **Resource limits**, in each mode: the anchor cap (`budget`), the node cap and the depth cap (`invariant`) reject identically and atomically, and a change exactly at the depth limit is accepted.
- **Immutable ownership.** Published states are frozen and their maps sealed, earlier states are untouched, and undo/redo restore states by reference. A transaction from an undone state validates against that state's own derived data.
- **Untrusted input.** A cyclic state given to the constructor is rejected in every mode.
- **Fault injection.** With a faulty incremental validator (one that accepts anything, or one that returns wrong anchors), `compare` mode throws `ValidationDisagreement` and leaves the document unchanged; `full` mode never consults it.

### 1.3 Performance: integrated dispatch (Node)
`node --expose-gc scripts/bench-g-doc-r.mjs --sizes 43000,250000 --modes incremental,full --reps 30` on `8913cfb` (no tracked changes): [`bench/stage-b-8913cfb.json`](bench/stage-b-8913cfb.json). Load average 2.5–3.0 throughout (low for this machine, but shared, so not "quiet"). Top CPU consumers just before the run (`ps -Ao pcpu,comm -r`): WindowServer 18 %, the Claude app processes 5–10 % each; no `ngspice`. The JSON records load averages only; from stage D on, `bench-g-doc-r.mjs` records the top consumers and the `ngspice` count itself (`conditionsStart`/`conditionsEnd`). Each repetition times `session.dispatch` end to end on a fresh state, which has cold per-state caches.

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
**Corrected in §3.** These counts excluded only `concert-small-venue*`. §3 re-counts them with every `concert-*` input excluded, which gives 294/294 and 576/576.

The maintainer's private concert photograph is **excluded** from every run (`concert-small-venue*`; standing instruction). The counts below are the frozen sets minus exactly those cases; no other case is missing.

| Check | Command | Result |
|---|---|---|
| Engine corpus (frozen 326) | `regression_corpus` over the procedural fixtures and 7 of the 9 local photographs; SHA-256 against `a4cf172.sha256` | **302/302 identical**. The 24 missing hashes are all `concert-small-venue*` |
| Owner bundle v2 (frozen 72) | `geo_bundle`, then `cmp` with `owner-acceptance-bundle-v2/` | **72/72 identical** |
| Document export (frozen 636) | `node scripts/document-export-regression.mjs <corpus out>`: scene → packet → session commit → `.vectra` save (both codecs) → strict load → export → bake → scene, SVG, PDF | **588/588 identical**, 98 scenes × 3 files × 2 codecs. The 48 missing hashes are the 8 concert scenes |
| Canonical serialization (new guard) | `session-validation.test.ts`: the 30-step script, saved with codec `none`, in every mode | SHA-256 `e60fa327…538e36`, frozen on Stage B for stages C and D |

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
| Correctness defect, contradiction or regression found | **One defect, found after this table was first written:** the independent review (§1.6) found an input the proof wrongly accepted. Fixed and re-qualified. No regression: every type is faster than the full-pass baseline (Node) |

### 1.6 Independent review and the defect it found
A separate reviewer read `incremental-validate.ts` against `validateState` rule by rule at `8913cfb`, without seeing this report's conclusions.

**Defect C1 (confirmed, now fixed in `fd06b5a`).**
- **Input.** A map entry whose **value is `undefined`**, under a key the previous state lacks, in any of the four ID maps.
- **Why it was missed.** `diff` compared `old !== v`. For a new key, `old` and `v` are both `undefined`, so the entry was neither seen as changed nor counted as added. An uncounted addition could also hide a real removal from the size shortcut.
- **Effect.** The proof accepted states that `validateState` rejects (with a `TypeError`), sometimes with stale anchors and chunks. A faulty command (`map.set(id, lookup.get(missing))`) could have reached it.
  - In `incremental` mode, the production default, such a state would have been **published**.
  - `compare` mode would have reported it as a `ValidationDisagreement`.
  - The existing harness never forged an `undefined` value.
- **Fix.** `diff` and `diffKeys` treat a present key as changed whenever the previous map lacks it. The entry then reaches the per-entry checks, which throw, and the proof answers `undecided`.
- **Evidence the fix is needed and sufficient.**
  - With the fix reverted, seed 20261125 gives **199 disagreements** on the new `undefined-entry` forgery; with it, **0**.
  - `session-faulty-command.test.ts` injects the entry through a faulty `applyCommand` into an `incremental`-mode session, for each map. It fails 4/4 without the fix and passes with it. The full pass rejects, and nothing is published.

**Review gaps now covered.**
- **New forgeries:** `undefined-entry` (four maps, sometimes with a hidden removal), `asset-field` (changed asset fields under the same key), `shared-list` (two containers sharing one child array), `remove-source` (valid removal of a source and its asset).
- **A deterministic test:** an ancestor transform overflowing an existing 34-deep chain of 1e9 scales is rejected with `invalid_transform`, identically in every mode.

**Residual risks recorded, not fixed.**
- **R1.** The identity diff assumes committed states are deeply immutable. `Draft.finish`, `createDocument` and `parseDocumentJson` guarantee this. The constructor trusts a caller-supplied state, which is the existing contract (G-DOC review 3). `full` mode is unaffected.
- **R2.** The order of the derived chunk map depended on which validator ran. No consumer depends on it: `container.ts` sorts, and `selectChunkIds` now sorts by chunk number.
- **R3.** "Every chunk prev references is live" holds inside `dispatch`. The source-scan guard pins `session.ts` as the only production caller.

**Re-qualification on the fixed code** (`fcf1425`; production code as in `fd06b5a`, plus one harness-only fix to the new `asset-field` forgery):
- The 6-seed record: **74,325 comparisons, 0 disagreements** ([`bench/stage-c-differential-fcf1425.json`](bench/stage-c-differential-fcf1425.json)).
- 30 further seeds (100–129): 385,254 comparisons, 0 disagreements.
- `vp test`: 435 passed.

## 2. Stage C — Draft write keys and the command fixes

### 2.1 What changed (`85d65f1`)
**The Draft write log (`DraftLog`, `commands.ts`).**
- Each `Draft`'s node map is a `DraftNodes`. It records every key passed to `set` or `delete`; `clear` throws. `SealedMap` is the only write path to a Draft's nodes.
- `dispatch` gives each transaction one `DraftLog` through `CommandContext.log`. Every Draft adds its written keys when it finishes.
- After each command, `log.step(input, output)` requires the output to be either the input (a no-op) or the last Draft result built on that input. Anything else marks the log **incomplete**, and an incomplete log is never used.
- **The log is transaction-local.** Nothing is attached to states, so nothing extra is retained in history. A state-keyed side table was rejected for that reason: it would have retained every state's ancestry and its written-key sets.

**Use in validation.**
- With a complete log, `checkIncremental` builds the node change set from the written keys only, O(written), instead of the whole-map identity diff, O(nodes).
- The log may be a superset; unchanged keys are skipped.
- **Defence in depth.** If the map sizes do not balance with the counted additions and removals, the proof answers `undecided`.
- Forged states and incomplete logs keep the identity diff.

**Publication.**
- `Draft.finish` freezes only written node entries; before, it scanned the whole map.
- An unchanged sealed map (`stylesById`, `paletteById`, `sourceAssetsById`) is **shared** with the predecessor. `sealMap` now returns an already-sealed map as is; it is immutable, so sharing is safe.
- So `diff` on those maps is O(1) when they are unchanged.

**Document order without a tree walk.**
- `documentOrder`, a whole-tree walk run by every `setFill`, `group`, `delete`, `duplicate` and `reparent`, is removed.
- A single target needs no order.
- Several targets are sorted by comparing their root-to-node child-index chains, built from the child lists of their ancestors only. The result is identical: it is pre-order, and distinct nodes have distinct chains.

**Subtree walk** (for container transforms, moves and new edges; the investigation measured 56 ms for a whole layer at 250k).
- Leaves are checked with `finiteProduct`, which evaluates exactly `multiply`'s six expressions without allocating the matrix.
- Only containers are deduplicated.

**Not changed in stage C:** the O(nodes) copy in the `Draft` constructor, and cold `parents()`. These belong to stage D.

### 2.2 Correctness qualification
| Requirement (brief §2 C) | Evidence | Result |
|---|---|---|
| Complete mutation tracking | `commands-writelog.test.ts`, for 21 command forms (all 20 command types, plus replace-trace): the log is complete and covers every key the identity diff finds. For patch commands it is exactly their targets. Chains of commands give the union. A foreign result marks the log incomplete. In the differential, **every** command transaction's log is checked against the identity diff | **PASS**: 0 incomplete logs |
| Correct incremental validation coverage | The differential validates every command transaction through its log and every forgery through the identity diff, both against the full pass: 40,922 log-path comparisons in the 6-seed record | **PASS**: 0 disagreements |
| No-op transactions | An empty transaction and a no-op command (`releaseClip` on an unclipped node) change nothing: same snapshot, same revision. An edit to the same value is still a transaction, as before (semantics unchanged) | **PASS** |
| Undo and redo | The session script (undo and redo inside), `published states stay immutable…`; the benchmark asserts undo restores the state by reference. Undo and redo stay ≤ 0.03 ms | **PASS** |
| Invalid-command rejection | The differential's 19,741 command-rejected transactions (6 seeds); the session script's rejections; atomic rollback | **PASS** |
| Stable serialization and export semantics | The frozen canonical-serialization hash (`e60fa327…`, taken on stage B) is unchanged. Document export **588/588** identical on `fcf1425`. Shared maps and document order are covered by tests (target order in a command does not matter; styles are allocated in document order) | **PASS** |

### 2.3 Performance: integrated dispatch (Node, `incremental` mode)
Runs:
- `node --expose-gc scripts/bench-g-doc-r.mjs --sizes 43000,250000 --modes incremental --reps 30` on `fd06b5a` → [`bench/stage-c-fd06b5a.json`](bench/stage-c-fd06b5a.json);
- `--sizes 330000` → [`bench/stage-c-1m-fd06b5a.json`](bench/stage-c-1m-fd06b5a.json): 330,000 paths, 331,012 nodes, **996,000 anchors** (the 1M-anchor stress workload).

Both runs had no tracked changes. Load average 0.8–2.6 (low, shared). Top CPU consumers before the first run: the Claude app (8 %), the wallpaper extension (7 %) and WindowServer (6 %); no `ngspice`.

Dispatch in ms (median / p95):

| Type | 43k B | 43k C | 250k B | 250k C | 330k C (996k anchors) |
|---|---|---|---|---|---|
| setFill1 | 7.9 / 8.4 | 2.0 / 2.0 | 62.2 / 66.7 | 14.0 / 14.7 | 21.5 / 22.5 |
| setFillMany | 8.5 / 9.0 | 6.9 / 7.3 | 65.1 / 67.7 | 40.7 / 41.6 | 61.1 / 64.0 |
| setVisible | 4.0 / 4.6 | 2.0 / 2.1 | 31.9 / 32.9 | 14.6 / 15.3 | 22.2 / 23.3 |
| rename | 3.9 / 4.6 | 2.0 / 2.1 | 32.1 / 32.6 | 14.5 / 15.1 | 22.0 / 23.6 |
| reorder | 7.1 / 7.5 | 4.9 / 5.1 | 52.6 / 55.9 | 37.1 / 38.1 | 56.1 / 57.9 |
| applyTransformPath | 5.7 / 6.5 | 3.7 / 3.9 | 44.2 / 45.4 | 27.5 / 27.9 | 42.9 / 44.6 |
| applyTransformLayer | 11.6 / 14.3 | 4.5 / 4.8 | 79.6 / 90.1 | 30.6 / 31.1 | 46.0 / 48.0 |
| group | 11.1 / 11.7 | 5.6 / 6.0 | 84.4 / 89.4 | 39.6 / 40.9 | 60.9 / 63.2 |
| ungroup | 9.4 / 10.5 | 6.2 / 6.4 | 67.4 / 72.0 | 44.7 / 45.7 | 66.1 / 69.7 |
| delete | 11.7 / 12.2 | 4.9 / 5.1 | 88.3 / 91.7 | 34.8 / 36.4 | 57.4 / 59.1 |
| duplicate | 11.0 / 11.5 | 5.1 / 5.2 | 80.4 / 83.9 | 35.6 / 37.3 | 57.3 / 59.3 |
| commitTrace | 8.0 / 8.7 | 5.4 / 5.6 | 42.8 / 44.7 | 17.5 / 19.0 | 27.7 / 29.1 |

- **Interactive target:** every type has median ≤ 6.9 ms and p95 ≤ 7.3 ms.
- **250k paths (756k anchors), in this run:** every type is under 50 ms at median and p95 (medians 14–45 ms, p95 ≤ 45.7 ms). Later runs under worse conditions put `ungroup` at the threshold (§2.4a).
- **996k anchors:** 6 types meet ≤ 50 ms at median and p95; applyTransformLayer is the closest (46.0 / 48.0). **Six exceed it** (median 56–66 ms): setFillMany, reorder, group, ungroup, delete and duplicate.
- The proof decided every measured transaction. Undo and redo stay ≤ 0.03 ms.

**Where the remaining time goes** (stage profile, `bench-td-perf-007.mjs --only applyTransformLayer,applyTransformPath,setVisible`, [`bench/stage-c-walk-profile-fcf1425.json`](bench/stage-c-walk-profile-fcf1425.json); all figures in ms):

| | 250k | 330k |
|---|---|---|
| Draft constructor copy, O(nodes) | 14.0 | 21.5–22.1 |
| Cold `parents()`, O(nodes): commands that need a parent, and transformed nodes in the proof | 13.0 | 18.2–18.6 |
| Whole-layer walk (the proof's checks for `applyTransformLayer`) | 19.0 (the investigation measured 56) | 26.1 |
| Publication | ~1 (was ~8) | ~1 |

The copy and `parents` costs are exactly what stage D's chunked copy-on-write map and persistent parent index remove.

### 2.4 Per-subtree summaries (investigation, brief §2 C)
**Question.** Do whole-layer transforms need per-subtree summaries to meet ≤ 50 ms?

**Design considered.** For each container, cache a bound on the composed entries of its subtree relative to itself (max |linear entry|, max |translation|). A container transform could then prove finiteness from the bound alone. A translation-only change leaves every linear part, and therefore the clip rule, unchanged, so it needs no walk. The cost: every edit must update the summaries of all its ancestors (O(depth)), structural edits must rebuild them, and the summaries are a second derived structure for the differential harness to check.

**Measured.**
- The optimised walk costs 19 ms at 250k paths and 26 ms at 330k, about 80 ns per node. The rest of a whole-layer dispatch is the copy and the proof's fixed costs.
- After stage D removes the copy, the projection is about 30 ms at 996k anchors, within ≤ 50 ms. This is a projection, to be verified in stage D.

**Decision.** **Not implemented in stage C.** The walk is within the target at the 250k workload and, as projected after D, at the 1M-anchor workload. Summaries add an incrementally maintained structure with its own correctness surface.

**Ceiling, recorded.** The walk is O(subtree). A degenerate document of ~1M one-anchor paths in one layer would take about 80 ms. Revisit summaries if a stress workload with realistic paths misses ≤ 50 ms after stage D.

### 2.4a Final stage C head (`7799e6e`, after the review follow-ups)
`node --expose-gc scripts/bench-g-doc-r.mjs --sizes 43000,250000,330000 --modes incremental --reps 30` → [`bench/stage-c-final-7799e6e.json`](bench/stage-c-final-7799e6e.json). No tracked changes.

**Conditions** were worse than for the `fd06b5a` run, and recorded by the script itself. At the start: load 2.4, with UserEventAgent 62 %, a file-deletion service 35 %, a browser renderer 21 % and WindowServer 18 %. At the end: load 3.6. No `ngspice`.

| Type | 43k | 250k | 330k (996k anchors) |
|---|---|---|---|
| setFill1 | 2.2 / 2.3 | 14.5 / 15.9 | 21.3 / 22.4 |
| setFillMany | 7.1 / 7.4 | 41.0 / 43.3 | 60.5 / 62.4 |
| setVisible | 2.2 / 2.2 | 14.8 / 15.6 | 21.1 / 22.2 |
| rename | 2.3 / 2.4 | 14.5 / 15.6 | 21.1 / 29.5 |
| reorder | 5.4 / 5.5 | 37.2 / 39.9 | 53.9 / 57.5 |
| applyTransformPath | 4.1 / 4.3 | 27.2 / 28.5 | 41.8 / 44.1 |
| applyTransformLayer | 5.0 / 5.2 | 32.1 / 33.2 | 47.3 / 50.3 |
| group | 6.8 / 7.0 | 40.6 / 43.0 | 59.0 / 62.8 |
| ungroup | 7.1 / 7.5 | **49.1 / 52.1** | 69.7 / 75.8 |
| delete | 5.6 / 5.8 | 35.3 / 36.4 | 56.0 / 58.8 |
| duplicate | 5.7 / 5.9 | 36.2 / 38.0 | 56.5 / 58.1 |
| commitTrace | 6.2 / 6.5 | 18.0 / 19.7 | 25.6 / 26.5 |

**Is the follow-up commit the cause, or the conditions?**
- The follow-up resets the published map's prototype. To test it, an A/B ran back to back at 250k (20 repetitions each, `ungroup`, `group`, `setVisible`, `delete`; the prototype reset commented out for B; working tree restored afterwards).
- `ungroup` median / p95:

  | Round | A, with the reset | B, without |
  |---|---|---|
  | 1 | 48.0 / 49.8 | 47.2 / 49.8 |
  | 2 | 51.4 / 53.6 | 49.2 / 50.7 |

- The other three types differed by ≤ 1.7 ms either way.
- **Verdict.** There is no effect beyond run-to-run noise (about ±2 ms). The slowdown against the `fd06b5a` run (`ungroup` 44.7 / 45.7) follows the machine's conditions.

**Status of ≤ 50 ms at 250k paths (756k anchors).**
- **`ungroup` is borderline.** Across 6 runs its median is 44.7–51.4 ms and its p95 45.7–53.6 ms. That is **not** reported as met.
- Every other type is ≤ 43.3 ms p95.
- At **996k anchors** (the designated 1M-anchor stress workload) **7 types exceed 50 ms** on this head: the six of §2.3, plus applyTransformLayer at p95 50.3.

**Differential on this head:** 6 seeds, **108,362 comparisons** (forged states are now compared through both change-set paths), **0 disagreements**; 40,770 through the write log ([`bench/stage-c-differential-7799e6e.json`](bench/stage-c-differential-7799e6e.json)).

### 2.4b Independent review of stage C
A second reviewer read `758a689` against `8913cfb` (`src/document`) without this report's conclusions. It ran the document tests (165 passed) and a scratch fuzz of verbatim copies of the pure functions:
- `inDocumentOrder` against the old `documentOrder` on random valid forests: 20,000 comparisons, **0 differences**;
- `finiteProduct` against `multiply(...).every(Number.isFinite)`: 2,000,000 matrices built from ±0, ±1, ±1e9, ±1e154, ±1e308, the extreme magnitudes, ±Infinity and NaN, **0 differences**.

**No counterexample.** Every node-map write goes through `DraftNodes`. Every `applyCommand` branch returns its input or one `Draft.finish`. `step` holds by induction over a transaction. Given a superset, `diffKeys` returns the same change set as `diff`.

**Follow-ups, fixed in `7799e6e`:**
- **The published map's shape.** It was a `DraftNodes` carrying an own property, while a loaded state's map is a plain `SealedMap`. Vitest's `toEqual` compares constructors and own keys. It is now a plain `SealedMap` again (with a test comparing published and loaded maps).
- **Retained parent maps.** A multi-target `setFill` built `parents(s)`, which is cached per state, so it was retained with history. `inDocumentOrder` now builds an uncached map unless the state already has one. Note that `parents()` maps cached by `delete`, `group`, `duplicate`, `reparent` and by the proof are **pre-existing per-state retention**, uncounted, like the node maps themselves. AM-2's "indexes" covers them, and stage D's persistent parent index replaces them.
- **The size-check comment** now says it catches only unbalanced misses. Soundness rests on `DraftNodes` being the only write path.
- **Tests for the coverage gaps:** `DraftLog` negatives (a result built on another base, a stale result); multi-command transactions on nodes created earlier in the same transaction (dispatched in `compare` mode); `inDocumentOrder` against a pre-order walk (500 random target sets); write-set forgeries with strict supersets.

**Residual risk, recorded.** A write that bypasses the map overrides would reach every state sharing that sealed map and be hidden from the validator (`Map.prototype.set.call(map, …)`, or a future `Map` method such as `getOrInsert`). No code does this today, and `SealedMap` has the same exposure. The `full` mode and the load path are unaffected.

### 2.5 Stage C checkpoint
| Requirement | Result |
|---|---|
| Draft-recorded write keys | **PASS** (§2.1, §2.2) |
| Qualified command optimisations | **PASS**: `documentOrder` removed; sealed maps shared; publication only of written entries; walk without allocation. Cold `parents` remains for stage D |
| Mutation tracking, coverage, no-ops, undo/redo, invalid commands, serialization and export | **PASS** (§2.2) |
| Per-subtree summaries | **Investigated** (§2.4); deferred with a recorded ceiling |
| ≤ 50 ms at the stress workloads | **NOT MET.** 996k anchors (the designated workload): 6–7 of 12 types exceed it (§2.3, §2.4a). 756k anchors: 11 of 12 types meet it; `ungroup` is borderline (p95 45.7–53.6 ms across runs). Stage D addresses the remaining O(nodes) costs |
| Defect, contradiction or regression | **None in stage C.** Every type is faster than in stage B |

## 3. Production build and browsers, on the stage C head (`758a689`)
**Build.** `pnpm run build` passed, including notices, the service worker and `check-dist`. Identifiers: `VERSION` `a202e8a4cde2a2e7`, `BUILD_ID` `3057066590054808`.

**Bundle** (`node docs/research/g-ui/measure-bundle.mjs`, gzip KiB; budgets 150 / 15 / 250):

| | G-BRAND (`main`) | G-DOC-R |
|---|---|---|
| Design-system JS | 114.3 | 114.3 |
| Workspace CSS | 9.5 | 9.5 |
| Total initial workspace JS | 231.2 | **234.0** |

The 2.8 KiB growth is the incremental validator. Before stage B no production module imported it, so the bundler dropped it. All budgets pass.

**Playwright 1.65.1, full suite, 3 engines.** First run: **369 passed, 3 failed, 39 skipped** (9.0 min). The three failures:
- **renderer-behaviour, render-worker crash, both cases.**
  - The spec needs `target/release/examples/render_compare`, which only `renderer-correctness.spec.ts` builds, in its `beforeAll`.
  - In this fresh worktree, renderer-behaviour ran first, so the binary was missing (`spawnSync … ENOENT`).
  - Once it existed, the whole spec passed, **8/8**.
  - This is a test-environment ordering dependency, unrelated to G-DOC-R; recorded for the gate that next touches the browser suite.
- **ui-document, "canvas edges: transform handles beside all four edges are never intercepted"** (Chromium, 1280×720).
  - The `elementFromPoint` probe returned nothing at the e handle.
  - Run alone 5 times (`--repeat-each=5`), it passed **5/5**.
  - The test polls until the handle is near the edge, then reads its position once more and probes. Under full-suite load the view can still be settling between the two reads.
  - The phase that failed changes only the camera (`setView`); no transaction runs in it.
  - Recorded as **flaky under load**, not fixed here (UI tests are outside this gate). The G-BRAND run of the same suite had no flake.

The three extra skips, compared with G-BRAND's 36, are opt-in or serial dependants of the failed cases. The first run leaves them unexplained; they are not counted as passes.

**Bundle v1 through the workbench** (`OWNER_BUNDLE=1 … owner-bundle.spec.ts`, Chromium): **15/15 files byte-identical** to `docs/research/p0-r/owner-acceptance-bundle/`.

**Real Safari on `758a689`: NOT RUN.** The screen was locked (`CGSSessionScreenIsLocked` true), and runs under a locked screen are invalid (G-R1 report §13).

**Reconciled.** The harnesses were later run on the final stage C head: commit `9ae294f`, built as `VERSION` `4b829e176927371e`, `BUILD_ID` `e8cfaf88be26066f` (production code identical to `7799e6e`). All five pass (§3.1). `758a689` itself was never run in Safari.

**Engine and document regressions on the stage C head**, recounted with **every** `concert-*` input excluded. An earlier session script treated all `concert-*` photographs as private, so `concert-stage-light` is now excluded too:
- engine corpus **294/294** (326 minus 32 concert files);
- bundle v2 **72/72**;
- document export **576/576** (636 minus 60), on `758a689`.

The figures in §1.4 (302 and 588) included `concert-stage-light`; those outputs have been deleted locally.

### 3.1 Final head (`9ae294f`; production code as `7799e6e`)
**Build.** It passes. Identifiers: `VERSION` `4b829e176927371e`, `BUILD_ID` `e8cfaf88be26066f`. Bundle (gzip KiB): design-system JS 114.3, CSS 9.5, workspace JS 234.0 (budgets 150 / 15 / 250).

**Playwright, full suite, 3 engines.** **372 passed, 0 failed, 39 skipped** (9.0 min).
- The three skips beyond G-BRAND's 36 were `pdf-eval`, which needs locally generated `export_samples` outputs that a fresh worktree lacks.
- After `cargo run --release --locked -p vector-engine --example export_samples`, `pdf-eval` passed **3/3**.
- Total: **375 passed, 0 failed, 36 opt-in skips**, identical to G-BRAND's final run.
- §3's render_compare ordering issue did not recur, because the binary now exists. The canvas-edge test passed.

**Bundle v1 (workbench): 15/15** byte-identical. **Document export: 576/576** identical.

**Real Safari 26.6.2** (macOS 26.6.2). The screen was unlocked, the page visible before and after every harness, and each run's directory records the commit, build, load and lock state. Records are in [`safari/`](safari/).

| Harness | Result |
|---|---|
| `gui.mjs` (G-UI workspace) | **14/14 PASS**, 0 findings |
| `gr1.mjs` (focus ring, crash fallback) | **7/7** |
| `gjob.mjs` (scheduler, service-worker eviction and isolation) | **10/10** |
| `gr0.mjs` (renderer) | First run **6/7**: `pan-zoom-responsiveness` timed out (300 s) waiting for its workload. The registered G-R1 workloads (`bark-1224`, `bark-2350`, local and gitignored under `tests/output/g-job-workloads/`) were missing from this fresh worktree. Copied from the main checkout (SHA-256 verified identical) and re-run: **7/7** |
| `persistence.mjs` (save, open, relink) | **23/23** |

**Renderer in real Safari on this head** (`gr0` pan-zoom, worker host, [`safari/gr0-9ae294f.json`](safari/gr0-9ae294f.json)):

| | bark-1224 (interactive) | bark-2350 (stress) |
|---|---|---|
| Snapshot preparation | 9 ms | 24 ms |
| First frame | 69 ms | 102 ms |
| Exact frame | 108 ms | 343 ms |
| Exact draw in the worker | 70 ms | 243 ms |
| Pan, gesture frames p50 / p95 | 17 / 18 ms | 17 / 18 ms |
| Zoom, gesture frames p50 / p95 | 17 / 19 ms | 17 / 18 ms |

- These are single-run figures for this head. No `main` baseline was taken under the same conditions, so they are **not** a measured G-DOC-R effect. Stages B and C change no renderer code, and the 100 ms preview target is unchanged and not graded here.
- The comparison against `main` is still planned with stage D (§4).

**Local evidence** (gitignored, in this worktree): `tests/output/g-doc-r/` (Playwright logs, build and bundle outputs, regression hashes, load records) and `tests/output/safari-runs/`. Archive these under `docs/EVIDENCE-PRESERVATION.md` before this worktree is ever removed.

## 4. Palette traversal and renderer effect (brief §3, §4)
**`paletteLabels()`** (`src/shell/document.ts`).
- **Cost.** It walks every path under every traced layer once per new state: 6.1 / 16.5 / 1.5 ms on bark-1224, bark-2350 and synthetic-many-250k ([scope](G-DOC-R-SCOPE.md)). It is cached per state and runs only when the inspector shows a Fill note or Recolor. No code was changed in stages B and C.
- **What the result depends on:**
  - which paths each traced layer holds, and their `styleRef`;
  - `stylesById` and `paletteById`;
  - the layer's provenance.
- **What makes it incremental.** Stage C makes two of those inputs cheap to watch.
  - Unchanged style and palette maps are now **shared** between states, so an identity check proves them unchanged.
  - The Draft write log names every node a transaction wrote. Membership changes (delete, duplicate, group, reparent, trace) and `styleRef` changes are visible in the logged keys.
  - So a previous state's labels can be reused, or patched per written path, instead of walking the whole document. This keeps stored names, strict provenance, collision handling, palette order and export semantics, since it computes the same function.
- **Not implemented here.** The log is transaction-local by design (G-4). Reusing it for UI derivations needs either an exposed per-transaction change set or stage D's persistent per-layer indexes. The choice belongs with stage D, and is listed under AM-2's follow-up work.
- **Recolor panel virtualisation:** kept separate, as instructed.

**Renderer scheduling and snapshot preparation: NOT RUN for stages B and C.**
- B and C change no renderer code. The renderer still receives a `RenderSnapshot` built from the published state.
- The renderer keeps its own O(nodes) parent maps: `render-host.ts` `parents()`, and `CanvasHost.tsx` `parentOf()`, which scans all nodes per call. A stage D parent index could replace them.
- The measurement (snapshot preparation and frame scheduling after an edit, kept separate from dispatch and from the unchanged 100 ms preview target) is planned with stage D.

## 5. Stage D — persistent storage (AM-2 authorised, 2026-11-26)
Commits: `c40ca5f` (storage), `7a416dd` (accounting), `d2c1839` (calibration, exact child lists, wider corpus), `f23b79f` (fault injection), `9aac564` (test infrastructure). Design notes: [STAGE-D-DESIGN](STAGE-D-DESIGN.md), written before the code. The implementation departs from that note where measurement required (§5.2).

### 5.1 Audit of node-map iteration consumers (before replacing the map)
Every production use of `nodesById` beyond `get`, `has` and `size`:

| Consumer | Uses the order? | Result |
|---|---|---|
| `invariants.ts` `validateState`: per-node checks | Which defect is reported **first** in a document with several defects | Allowed by AM-2. Single-defect rejections keep the same code and message, with one exception: a **duplicate ID number** between two nodes names whichever is visited second. That can now be the other node; the code (`invariant`) is unchanged. **Tested:** the differential validates every single-forgery state as a plain `Map` and as a `NodeMap`. Over 3 seeds, 12,818 states: identical verdicts and codes; messages differ only for duplicate numbers (96). `vp test` asserts this |
| `commands.ts` `parentMap` (verification); `render-host.ts` `parents`; `CanvasHost.tsx` `parentOf` | No: each node has one parent in a valid tree | Unchanged |
| `incremental-validate.ts` max-ID rescan | No (a maximum) | Unchanged |
| `document-json.ts` save | No: canonical JSON sorts keys | Bytes unchanged (frozen hash test; 576/576 export regression, §11) |
| `shell/qualification.ts` (chunk count), `workspace/qualification.ts` (setFill IDs) | No: a count, and setFill sorts targets in document order | Unchanged |

Three **tests** had picked "the first path" by map iteration while meaning the first path in paint order (`export.test.ts`, `p1a-document-export.test.ts`). They now walk the tree. Export, rendering, layer order and persistence never relied on map order.

### 5.2 `NodeMap`: a chunked copy-on-write map ordered by node ID
**Design** (`src/document/node-map.ts`):
- An immutable, `ReadonlyMap`-compatible map; all state is in private fields.
- Entries are sorted by **(ID number, key)**: the number of `xxx_<digits>`, otherwise +∞, with ties broken by the key string. They are cut into chunks of about 512, splitting above 1,024 and merging rebuilt chunks below 128: a two-level B+-tree.
- **Iteration order depends on the contents only**, never on chunk boundaries or edit history, which is AM-2's deterministic bucket iteration. It also follows creation order.
- **Copy-on-write.** An edit copies only the chunks it touches and the directory, which has about n/512 entries. An update-only chunk shares its keys and numbers arrays and copies only the values. Writes that change nothing are skipped.
- **Draft overlay.** `NodeMapDraft` is O(1) to create and never mutates its base, so a failed transaction simply drops the overlay. It publishes once.
- A key may hold `undefined`, as in a `Map`.

**Why not hash buckets (STAGE-D-DESIGN §1).** That was implemented first and measured at 331k entries (Node 24):

| Operation | Hash buckets (`Map` per bucket) | Hash buckets (sorted arrays) | **ID-ordered chunks** | Plain `Map` |
|---|---|---|---|---|
| Wide write: 1,000 deletes and 1,000 inserts (a trace replace) | 25.4 ms | 5.0 ms | **0.35 ms** | — |
| 1,000 scattered updates (setFillMany) | 18.7 ms | 0.4 ms | **0.8 ms** | — |
| 331k lookups in walk order | 25 ms | 30 ms | **15 ms** | 8 ms |
| 331k lookups in random order | — | 42 ms | 78 ms | 20 ms |
| Iteration | 19 ms | 6.5 ms | **2 ms** | — |

- **Hashing scatters locality.** A trace's nodes, a deleted layer's nodes and a group's children have neighbouring IDs. A hash spreads them over every bucket, so a trace replace rebuilt every bucket: `commitTrace` took 49.8 / 51.7 ms at 330k paths, over the target.
- **ID order keeps them together.** The same transaction now takes 4.9 ms.
- **Walk lookups** hit a cached chunk hint, with a binary search on a `Float64Array` of numbers inside the chunk.
- **Random-order lookups are slower** than a `Map`. They are rare in the edit paths: commands, the validator walks and evaluation all follow tree order.

### 5.3 Persistent parent index
- **What it is.** `parents(s)` is a `NodeMap<NodeId | null>` per state, held in a `WeakMap` keyed by state. It references no state, so there is no ancestry retention (verified in §6.3).
- **Derivation.** `Draft.finish` derives it from the base's index through the written keys. Only the child lists of written containers whose list changed, and the root list when it changed, are rescanned.
- **Seeding.** The session constructor seeds the index once at load, in O(n log n).
- **Exact-length lists.** `Draft.finish` also publishes **exact-length child lists**: a list built by `filter`, `splice` or `push` would otherwise keep up to a third in growth slack, and history would retain it.
- **Checkable.** `parentIndexMatches(s)` compares the index with a full traversal. `compare` mode runs it after **every decided transaction**, which covers every unit test and the differential. `compare` mode also checks that the write log covers every changed node key, using the structural chunk diff.

### 5.4 Stage D correctness qualification
**Differential on the final code** (`6a23a92`; `bench/stage-d-differential-6a23a92.json`). Six seeds: **108,249 comparisons**, 51,977 rejected by the full pass, 55,498 decided, 40,951 through the write log, **0 disagreements**. A further 30 seeds (100–129) give **558,472 comparisons, 0 disagreements**.

The corpus now also includes:
- existing keys set to `undefined`;
- a node object aliased under two keys;
- one episode in eight with a 1,100–3,000-path trace, so maps and indexes span several chunks and edits cross split and merge boundaries;
- a check that no transaction, failed or not, changes its predecessor.

Every episode session runs in `compare` mode. So every real dispatch also checks write-log completeness and the parent index against a full traversal, on the decided path and, after review C4, on the full-pass fallback.

**Targeted tests:**

| Area | Test | Result |
|---|---|---|
| Map semantics, chunk boundaries, sharing, `undefined` values, number ties, order, non-string keys, runtime immutability, iterator prototype | `node-map.test.ts` (12) | pass |
| Write log, map sharing, document order | `commands-writelog.test.ts` | pass |
| Modes agree, rollback, resource limits, frozen serialization hash, deep overflow, non-string IDs | `session-validation.test.ts` | pass |
| Fault injection: undefined entries, a misleading log (decided and fallback paths), a corrupted parent index | `session-faulty-command.test.ts` | pass |
| AM-2 ledger against the oracle (8 seeds × 120 operations; multi-chunk documents; every command kind; multi-command transactions), ownership transitions, a plain-`Map` start | `structure-accounting.test.ts` | pass |
| No retention | `tests/unit/g-doc-r-retention.test.ts`; `node --expose-gc scripts/check-retention.mjs` | pass, pass |
| Whole unit suite | `vp test` | **464 passed** |

### 5.5 Stage D performance: integrated dispatch (Node)
`node --expose-gc scripts/bench-g-doc-r.mjs --sizes 43000,250000,330000 --modes incremental --reps 30` on `6a23a92` → [`bench/stage-d-final-6a23a92.json`](bench/stage-d-final-6a23a92.json).
- The only tracked change in the tree at run time was the deletion of a superseded record (`stage-d-final-8229927.json`, restored since).
- **Conditions,** recorded by the script: load 1.3–1.5; top consumers below 3 % each before the run; no `ngspice`. That is a low load, not a designated quiet-machine qualification.

Median / p95 in ms ("before" is the full-pass baseline from §1.3):

| Type | 43k before | **43k D** | 250k before | 250k C | **250k D** | 330k C | **330k D** |
|---|---|---|---|---|---|---|---|
| setFill1 | 26.4 / 26.8 | **0.07 / 0.12** | 171.4 / 191.9 | 14.5 / 15.9 | **0.14 / 0.17** | 21.3 / 22.4 | **0.17 / 0.20** |
| setFillMany | 27.0 / 27.4 | **6.3 / 6.7** | 172.3 / 178.4 | 41.0 / 43.3 | **19.7 / 20.1** | 60.5 / 62.4 | **26.1 / 26.8** |
| setVisible | 23.1 / 23.9 | **0.06 / 0.08** | 141.3 / 147.6 | 14.8 / 15.6 | **0.12 / 0.15** | 21.1 / 22.2 | **0.15 / 0.17** |
| rename | 23.3 / 23.5 | **0.06 / 0.09** | 140.2 / 145.3 | 14.5 / 15.6 | **0.13 / 0.17** | 21.1 / 29.5 | **0.15 / 0.17** |
| reorder | 25.6 / 26.1 | **2.7 / 2.8** | 155.1 / 160.8 | 37.2 / 39.9 | **14.9 / 15.2** | 53.9 / 57.5 | **20.0 / 20.3** |
| applyTransformPath | 23.4 / 23.6 | **0.06 / 0.09** | 139.5 / 141.8 | 27.2 / 28.5 | **0.13 / 0.15** | 41.8 / 44.1 | **0.15 / 0.18** |
| applyTransformLayer | 23.4 / 23.6 | **5.0 / 5.3** | 139.9 / 150.7 | 32.1 / 33.2 | **26.2 / 26.5** | 47.3 / 50.3 | **34.4 / 34.7** |
| group | 29.4 / 29.8 | **3.3 / 3.4** | 186.0 / 190.2 | 40.6 / 43.0 | **17.6 / 18.2** | 59.0 / 62.8 | **23.2 / 23.7** |
| ungroup | 25.5 / 25.8 | **5.1 / 5.4** | 153.5 / 156.5 | 49.1 / 52.1 | **25.2 / 25.8** | 69.7 / 75.8 | **33.2 / 35.0** |
| delete | 29.3 / 32.2 | **2.9 / 3.0** | 181.3 / 184.2 | 35.3 / 36.4 | **15.5 / 16.3** | 56.0 / 58.8 | **20.0 / 21.2** |
| duplicate | 29.3 / 29.6 | **2.9 / 3.0** | 182.2 / 184.6 | 36.2 / 38.0 | **16.0 / 16.4** | 56.5 / 58.1 | **20.7 / 20.9** |
| commitTrace | 24.9 / 25.8 | **6.9 / 7.5** | 141.4 / 143.1 | 18.0 / 19.7 | **6.1 / 7.1** | 25.6 / 26.5 | **5.8 / 6.3** |

- **Interactive target** (43k paths, 264k anchors): every type has median ≤ 6.9 ms (target 16.7) and p95 ≤ 7.5 ms (target 33): **MET**, in Node.
- **Stress workloads:** at 250k paths (756k anchors) every type is ≤ 26.2 / 26.5 ms. At the designated **996k-anchor** workload every type is ≤ 34.4 / 35.0 ms. ≤ 50 ms is **MET** in Node, for all 12 types, at both.
- The incremental proof decided every measured transaction, and undo/redo stay ≤ 0.02 ms.
- **Regressions found and fixed during stage D:**
  1. **Hash-bucket storage:** commitTrace took 49.8 / 51.7 ms at 330k; replaced by ID-ordered chunks (§5.2).
  2. **The first version of the accounting delta:** setFillMany took 179 ms and one-node edits 0.6 ms at 330k (`stage-d-final-8229927.json`, kept). The delta now uses the write log and aligned chunk directories (`6a23a92`).
- **A measured cost kept on purpose.** Runtime freezing of published chunk arrays (review follow-up) costs about 4 ms on walk-heavy edits at 330k: applyTransformLayer 34.7 ms against 30.3 ms unfrozen (A/B, 20 repetitions). Kept for enforced immutability; still within target.

### 5.6 Independent adversarial review of stage D
A third reviewer examined the implementation's assumptions at `f23b79f`, writing its own probes and fuzzers. It did not re-run our tests. Its NodeMap fuzz covered about 4,800 edits on maps of up to 36 chunks; the ledger against the oracle, 2,400 comparisons over 8 seeds, 22 command kinds and multi-command transactions. **Main claims held.**

It confirmed five counterexamples. None is reachable from the shipped app; each was reproduced:

| # | Finding | Severity | Disposition |
|---|---|---|---|
| C1 | A session built from a state whose node map is not a `NodeMap` undercounted history after an undo: `structureDelta` counted only the map header on mixed sides | Medium (an undercount) | **Fixed** (`8229927`). The test fails without the fix (1,200 against 1,792 bytes) |
| C2 | `NodeMap.get`/`has` threw `TypeError` for non-string keys, so commands with non-string IDs gave untyped errors instead of `invalid_argument` | Medium-low | **Fixed**: the lookup misses, as in a `Map`. Tested in every mode |
| C3 | One sealed map used for two map slots, or one array for two node fields, is counted once per slot in the ledger but once in the oracle | Low (an over-count) | Recorded. Unreachable through commands, the loader or `createDocument`. Conservative |
| C4 | `compare` mode skipped the log and parent-index checks on the full-pass fallback | Low (verification gap) | **Fixed**; tested |
| C5 | A duplicate ID number names the other entry | Low (message only) | Recorded. AM-2 permits it; the code is unchanged (§5.1) |

Plausible risks and untested assumptions it named:
- **Contiguity is not enforced.** It is now a stated rule in `commands.ts`, and the oracle fuzz covers every command kind.
- **Production never checks the parent index.** By design, `compare` mode checks it in development and tests.
- **Published chunks were immutable only by convention.** Fixed: frozen at runtime.
- **Iterator helpers would fail.** Fixed: `%IteratorPrototype%`.
- **The accounting fuzz was narrow.** Widened.
- **The oracle shares the cost functions.** Acknowledged in §7.
- **`instanceof NodeMap` fails across module instances.** There is a single instance in the app; the C1 fix covers the effect.
- **`deriveParents` assumes every intermediate state of a multi-command transaction is a forest.** Commands throw before producing one that is not. Recorded.

## 6. AM-2 history accounting
### 6.1 Model (`src/document/structure-accounting.ts`)
- **Accounted bytes, not a measurement.** They come from deterministic, checked integer costs (`COSTS`), with `Number.isSafeInteger` and non-negativity asserted.
- **Allocations, each counted once by identity:**
  - **Per state:** the state record, roots, artboard, derived data, and the node-map and parent-index headers and directories.
  - **Shared:** node-map and parent-index chunks. The chunk object and its numbers, keys and values arrays count separately, because updates share them.
  - **Per node:** the node object, with its id and name strings.
  - **Per key:** transforms, geometry and clip records, and child lists.
  - **Exact across keys:** trace provenance (layers are roots).
  - **Entry maps:** style, palette and asset map tables, and each entry with its strings and its stroke or provenance record.
- **Excluded:** chunk bytes and source bytes, which are C3.2 terms 1 and 2, and shared constants (`IDENTITY`, the empty chunk).
- **Documented approximations:**
  - **Per-key records shared by `duplicate`** are counted once per key: a conservative over-count bounded by those small records.
  - **Strings** are counted with their node or entry object. A setVisible copy, which shares the id string, over-counts it by a few dozen bytes.

### 6.2 Incremental computation and the reference oracle
- **One delta per step.** `structureDelta(a, b)` gives the accounted bytes `a` holds and `b` does not (removed), and the reverse (added). It costs O(chunks + changed entries): unshared chunks, changed node keys, provenance through the roots, and entry maps only when they changed.
- **History-only bytes.** The session stores one delta per published state, measured from its chain predecessor (coalescing included). History-only bytes are the removed bytes of retained steps up to the current state, plus the added bytes of redo steps. That is O(history entries), with no traversal of any state; undo, redo and eviction compute nothing new.
- **Why that is correct (contiguity).** No command revives an allocation once a later state has dropped it, so each allocation lives in one contiguous run of the history chain.
- **What it relies on.** The contiguity rule is stated in `commands.ts`. Since `6a23a92`, which came after the stage D review, the delta takes node keys from the transaction's complete write log, so the accounting also rests on log completeness. `compare` mode asserts that completeness on every decided and fallback transaction. Coalesced steps use the structural diff instead, because the log is relative to a dropped state.
- **The oracle.** `testing/structure-oracle.ts` recomputes the same quantity by full traversal with identity sets, without the chain argument.
- **Ledger against oracle.** `structure-accounting.test.ts` compares the two after **every operation** of random histories: 6 seeds × 160 operations, mixing edits, undo, redo, branching, keyed coalescing, `withoutHistory` and evictions by count and by bytes. The first run of this test found a real double count, fixed before commit: the shared empty-chunk constant was counted once per map.

### 6.2a Accounting and eviction costs, profiled separately
`node --expose-gc scripts/profile-accounting.mjs --sizes 43000,330000 --reps 20` → [`bench/stage-d-accounting-profile-6f4b5d4.json`](bench/stage-d-accounting-profile-6f4b5d4.json). Load 0.3–1.0. Times are medians, in ms.

| | 43k | 330k |
|---|---|---|
| `structureDelta`, with the write log: one-node edits (setVisible, rename, setFill1, transforms) | 0.003–0.012 | 0.010–0.015 |
| `structureDelta`, with the write log: structural edits (reorder, group, ungroup, delete, duplicate) | 0.004–0.019 | 0.010–0.018 |
| `structureDelta`, with the write log: setFillMany / commitTrace | 0.48 / 0.55 | 0.86 / 0.58 |
| `structureDelta`, structural diff (coalesced steps only): structural edits | 0.24–0.25 | 0.23–0.24 |
| `structureDelta`, structural diff: setFillMany / commitTrace | 0.73 / 0.88 | 3.30 / 1.03 |
| `historyStructureBytes()` / `historyBytes()`, 103 entries | 0.001 / 0.002 | 0.001 / 0.001 |
| Eviction: dispatch median at maxEntries 10 (evicting every edit) against 1000 | 0.023 vs 0.025 | 0.065 vs 0.065 |

Accounting adds at most about 0.9 ms to an ordinary edit at 330k (setFillMany). Eviction costs nothing measurable. Neither traverses the document or the history.

### 6.3 Ownership transitions and retention
Each transition the maintainer listed is tested against the oracle and against the expected delta (`ownership transitions …`):
- an edit;
- a state entering history;
- undo and redo;
- a discarded redo branch;
- eviction from either end;
- `withoutHistory`.

**Replaced or closed documents.** `tests/unit/g-doc-r-retention.test.ts` and `scripts/check-retention.mjs` force garbage collection and hold `WeakRef`s. Evicted states, a discarded redo state and every state of a dropped session must all be collected, and they are: **PASS** in both.
- A first version of the in-runner test failed. The test's own block-scoped variables held states; reproduced outside the runner and fixed in the test.
- The GeometryStore ownership contract (C2) is unchanged; chunk accounting is untouched.

### 6.4 Budget behaviour (user-visible)
- The limits are unchanged: 100 entries, 128 MiB. Eviction stays oldest-first, with visible truncation.
- **Small edits are cheap.** A one-node edit's step is about 7 KB at 43k paths and about 20 KB at 330k (directories plus one chunk).
- **Large edits.** Deleting the whole 330k-path, 996k-anchor layer is a **114.9 MiB** entry: 70.9 MiB of structure plus 44.1 MiB of chunks.
  - It **fits** the standard 128 MiB.
  - In the **constrained 64 MiB profile** it would now be refused with `history_budget`; chunks alone, 44 MiB, fitted.
  - The application does not configure the constrained profile today: `historyLimits` is never set in `src/shell` or `src/workspace`.
- **Beyond the designated workloads**, a single deleted or replaced subtree of roughly 450k paths or more would now exceed 128 MiB. The shell then reports "Edit rejected: … confirm to commit without history".
  - The shell has **no confirmation path** to commit without history. RFC §7's "committed without history after explicit confirmation" is not implemented in the UI; that gap predates this gate.
  - It is recorded as debt (TD-UI-006) for the maintainer. No UI change is authorised in this gate.

## 7. Cost-model calibration (AM-2 §3)
**Record:** `node --expose-gc scripts/calibrate-structure-accounting.mjs --reps 3` on `629cec6` → [`bench/stage-d-calibration-final-629cec6.json`](bench/stage-d-calibration-final-629cec6.json). (The earlier record, [`bench/stage-d-calibration-6a23a92.json`](bench/stage-d-calibration-6a23a92.json), has the same values for its scenarios under the old labels.)

**Method.** Each scenario:
1. builds a document and clears its history;
2. collects garbage and reads `heapUsed + arrayBuffers`, since chunk arrays live in ArrayBuffers;
3. runs the scenario and reads the session's **accounted** history-only structure bytes;
4. collects and reads the heap;
5. clears the history, collects and reads again.

**Measured** retention is the heap before clearing minus after, minus chunk bytes retired into history (their own ledger term). The builder keeps no build-time state alive. An earlier builder, the benchmark workload's closures, did keep it: that hid retention, and the run was discarded.

**Constants.** They model:
- hash-table capacity: the next power of two, 28 bytes per slot;
- numbers outside the small-integer range, which are boxed (16 bytes);
- typed-array headers (160 bytes);
- structured-clone property arrays in provenance;
- 320 bytes of per-state session bookkeeping.

**Implementation changes the calibration prompted.** Exact-length child lists and an exact chunk directory remove array growth slack from history. They reduce real retention rather than inflate the model.

**Which scenarios were seen during tuning.**
- **"Calibration":** every scenario whose result changed a constant. The two large-palette and provenance scenarios were first labelled validation; their undercounts (0.71, 0.73, then 0.80) shaped three constants, so they are **relabelled calibration**.
- **"Validation":** results observed while tuning but not used to choose constants.
- **"Fresh validation":** added **after** the constants were frozen at `6a23a92`, and run once as they came out.

| Set | Scenario | Entries | Accounted (MiB) | Measured median [min, max] (MiB) | Ratio |
|---|---|---|---|---|---|
| calibration | 43k paths: 1 small edit | 1 | 0.007 | 0.004 [−0.038, 0.043] | below noise |
| calibration | 43k: 10 small edits | 10 | 0.071 | 0.067 [0.067, 0.068] | 1.061 |
| calibration | 43k: 50 small edits | 50 | 0.356 | 0.343 [0.339, 0.343] | 1.037 |
| calibration | 43k: 100 small edits | 100 | 0.712 | 0.686 [0.686, 0.686] | 1.037 |
| calibration | 43k: 20 structural edits | 20 | 0.991 | 0.987 [0.987, 0.987] | 1.004 |
| calibration | 43k: replace the 1k-path layer ×10 | 10 | 2.229 | 2.258 [2.258, 2.270] | **0.987** |
| calibration | 20k styles, 10k entries, 30k-entry provenance, ×5 recolour | 5 | 4.436 | 4.427 | 1.002 |
| calibration | 30k-entry provenance: replace a traced layer ×3 | 3 | 10.874 | 10.122 [10.121, 10.122] | 1.074 |
| validation | 250k: 100 small edits | 100 | 1.636 | 1.611 [1.607, 1.611] | 1.016 |
| validation | 250k: 20 structural edits (with setFillMany) | 20 | 13.836 | 13.681 | 1.011 |
| validation | 330k (996k anchors): 50 small edits | 50 | 0.998 | 0.985 | 1.013 |
| validation | 330k: delete the whole main layer | 1 | 70.851 | 60.909 [60.905, 60.909] | 1.163 |
| validation | 43k: undo/redo and a branch | 21 | 0.216 | 0.211 | 1.025 |
| fresh | 120k paths: 60 mixed edits (visibility, rename, layer transform) | 60 | 0.761 | 0.742 | 1.025 |
| fresh | 8k styles, 12k-entry provenance: ×8 palette and fill edits | 16 | 2.685 | 2.679 | 1.002 |
| fresh | 50k-entry provenance: replace ×2 | 2 | 11.936 | 11.063 | 1.079 |
| fresh | 250k: 15 structural edits (group, duplicate, delete) | 15 | 3.404 | 3.402 | 1.001 |
| fresh | **eviction:** 60 small edits at maxEntries 10 | 10 | 0.071 | 0.103 [0.069, 0.106] | **0.689** (noise floor) |
| fresh, added after the line above | **eviction:** 40 reorders in a 31k-sibling group at maxEntries 10 | 10 | 2.548 | 2.546 | 1.001 |

**Disposal** (a 43k-path session with 53 entries is dropped): it held about 21.9 MB. After dropping it and collecting, the heap is back within **−1.5 to +4.1 KB** of its pre-build level (3 repetitions). Nothing is retained.

**Reading.**
- **Validation and fresh validation:** every scenario above the noise floor is conservative (ratio ≥ 1.001).
- **The 10-entry eviction case** holds about 70 KB, inside the ±30 KB noise floor. Its median is 0.69, but its range reaches 0.97, so it is inconclusive, not counted as a pass. The larger eviction case, added and labelled as such, measures 1.001.
- **The one calibration value below 1** (0.987, 29 KB) retires chunks into history. Chunk typed-array headers are not in the chunk term, which most likely explains it.

**Browser evidence: Chromium only** (`G_DOC_R_MEMORY=1 … g-doc-r-memory.spec.ts`; page main-isolate heap via the DevTools protocol, after forced collection; [`bench/stage-d-memory-chromium.json`](bench/stage-d-memory-chromium.json)):

| Workload | Scenario | Accounted | Measured | Ratio |
|---|---|---|---|---|
| bark-1224 | 50 small edits | 308,000 B | 291,416 B | 1.057 |
| bark-1224 | 10 reorders (new sibling list each) | 1,346,640 B | 886,732 B | 1.519 |
| bark-2350 | 50 small edits | 370,856 B | 284,472 B | 1.304 |
| bark-2350 | 10 reorders | 3,564,400 B | 1,450,956 B | 2.457 |

- **Chromium over-counts in these four scenarios.** Chromium's V8 uses pointer compression (4-byte pointers), while the model is calibrated on Node's 64-bit layout (8-byte pointers). Pointer arrays, such as child lists, cost about half the modelled bytes there. In the measured scenarios, Chromium would therefore evict history earlier than strictly necessary. This is evidence about Chromium only, not a guarantee.
- **Other engines:** Firefox and WebKit expose no comparable heap reading. **No conservative-accounting claim is made for them, nor any universal browser heap guarantee.** The accounted bytes are a deterministic model calibrated on V8 (Node); they are not a browser measurement.

**Limits.** The cost functions are shared with the oracle, so the oracle checks the incremental bookkeeping, not the model. The model is checked only by this calibration.

### 7.1 Accounting closure (maintainer closure brief §2, 2026-11-26)
**The original result stands on record.** The table above, the 0.987 replace scenario included, is the calibration on `629cec6` and is not edited. What follows is the closure investigation and the re-run with corrected constants.

**Investigation: what the 0.987 residual is.**
- **Measured separately from every calibration scenario.** `node --expose-gc scripts/measure-chunk-overhead.mjs --n 400 --reps 7` → [`bench/closure-chunk-overhead-1a7b45f.json`](bench/closure-chunk-overhead-1a7b45f.json).
- **Method.** 400 freshly built chunks are committed into a bare GeometryStore and retained as history, then the heap is read (`heapUsed + arrayBuffers`). The per-chunk overhead is `(Δheap − Σ chunk ledger cost) / 400`. Each repetition runs in its own function, so nothing from it stays reachable.
- **Result.** Retained heap beyond the C3.2 chunk ledger cost:

| Chunk size | Ledger cost per chunk | Overhead per chunk: median [min, max] (bytes) |
|---|---|---|
| 1 path | 657 | 3,767 [3,753, 4,644] |
| 10 paths | 2,877 | 3,727 [3,712, 3,785] |
| 100 paths | 24,388 | 3,695 [3,691, 3,702] |
| 1,000 paths | 239,495 | 3,688 [−8,117, 3,747] (one negative outlier: a buffer release landing between readings) |
| 4,000 paths | 560,488 | 3,688 [3,640, 3,746] |

- **The suspected typed-array headers: confirmed, as about half of it.** A chunk holds nine typed arrays, each over its own buffer: six sections, moved into new views at commit, and three derived arrays. Their headers alone measure **1,800 bytes per chunk** (200 per array). The other ~1.9 KB is the store's record: frozen accessor views and their closures, the manifest object, the owner counts and the map entry.
- **A fixed term, not a payload term.** The overhead does not grow with the chunk's size, from 1 path to 4,000. The C3.2 chunk ledger cost (`M_mem + manifestBytes + D`) counts payload exactly and leaves this out.
- **Consistency with the residual.** The replace scenario retires one chunk per entry. Its shortfall was 30 KB over 10 entries, about 3.0 KB per chunk, inside the measured 3.7 KB.
- **The same header under-count in the structure model.** A typed array with its own buffer measures 198–200 bytes off-heap at any length (128 to 1,024 elements), and 216 bytes plus payload on-heap. The model used 160 for every node-map chunk's ID array.

**Correction** (`4899605`; decisions G-21 to G-25):
- **`COSTS.chunkRecord` = 3,776 bytes** per chunk attributed to history. That is the largest per-size median, rounded up to 64.
  - It follows the C3.2 owner precedence: a chunk also held by the document, a snapshot or a job is not counted.
  - It is counted in `historyBytes()` (`historyChunkRecordBytes()`) and in the RFC §7 entry-fit check.
- **`COSTS.typedArray` 160 → 216.**
- **Contract procedure.**
  - AM-2's term 3 (C3.2 r3) already covers "any other retained structural resource". It excludes only the chunk ledger cost, and this record is outside that cost.
  - So there is **no double counting**, and the **C3.2 chunk ledger cost, store bytes by owner and GeometryStore (C2) are unchanged**.
  - No contract text or serialized version changes. The maintainer is asked to confirm this reading (M-10); the alternative is a C3 r4 amendment of the chunk ledger cost.
- **`ResourceLedger.snapshot().historyBytes`** now reports `session.historyBytes()`. It is documented as the RFC §7 budget quantity, and had omitted term 3 since AM-2.
- **Budgets unchanged:** 100 entries; 128 MiB standard, 64 MiB constrained.
- **Constants frozen** at `4899605` before any fresh run. The small eviction case was not used.

**Re-run with the frozen constants** (`node --expose-gc scripts/calibrate-structure-accounting.mjs --reps 3` on `0cd85a2`, clean tree; load 0.93–1.65; no `ngspice` → [`bench/closure-calibration-0cd85a2.json`](bench/closure-calibration-0cd85a2.json)).
- **Accounted** = structure + chunk records, reported separately.
- **Ratio range** = accounted ÷ the largest and smallest measured repetition.

| Set | Scenario | Accounted (MiB) | of which chunk records | Measured median (MiB) | Ratio [range] | Structure only (before the record term) |
|---|---|---|---|---|---|---|
| calibration | 43k: 10 small edits | 0.072 | 0 | 0.067 | 1.069 [1.051, 1.073] | 1.069 |
| calibration | 43k: 100 small edits | 0.717 | 0 | 0.686 | 1.045 [1.045, 1.045] | 1.045 |
| calibration | 43k: 20 structural edits | 0.994 | 0 | 0.987 | 1.008 | 1.008 |
| calibration | **43k: replace the 1k-path layer ×10** (was **0.987**) | 2.268 | 37,760 B | 2.258 | **1.004** [1.004, 1.010] | 0.988 |
| calibration | large palette and provenance, ×5 recolour | 4.436 | 0 | 4.427 | 1.002 [0.993, 1.002] | 1.002 |
| calibration | large provenance: replace a traced layer ×3 | 10.887 | 11,328 B | 10.122 | 1.076 | 1.075 |
| validation | 250k: 100 small edits | 1.642 | 0 | 1.611 | 1.019 | 1.019 |
| validation | 250k: 20 structural edits | 13.840 | 0 | 13.681 | 1.012 | 1.012 |
| validation | 330k: 50 small edits | 1.001 | 0 | 0.985 | 1.016 | 1.016 |
| validation | 330k: delete the whole main layer | 70.923 | 3,776 B | 60.909 | 1.164 | 1.164 |
| validation | 43k: undo/redo and a branch | 0.218 | 0 | 0.211 | 1.031 [0.889, 1.031] | 1.031 |
| fresh | 120k: 60 mixed edits | 0.765 | 0 | 0.742 | 1.030 | 1.030 |
| fresh | 8k styles: ×8 palette and fill edits | 2.685 | 0 | 2.679 | 1.002 | 1.002 |
| fresh | 50k-entry provenance: replace ×2 | 11.945 | 7,552 B | 11.063 | 1.080 | 1.079 |
| fresh | 250k: 15 structural edits | 3.407 | 0 | 3.402 | 1.002 | 1.002 |
| fresh | eviction: 60 small edits at maxEntries 10 | 0.072 | 0 | 0.103 [0.069, 0.106] | 0.694 [0.674, 1.045] (**noise floor; inconclusive**) | 0.694 |
| fresh | eviction: 40 reorders at maxEntries 10 | 2.549 | 0 | 2.546 | 1.001 | 1.001 |
| **closure-fresh** | 200k paths: replace a 5k-path traced layer ×4 | 4.405 | 15,104 B | 4.401 [4.399, 4.418] | **1.001** [0.997, 1.001] | 0.998 |
| **closure-fresh** | 43k: replace the whole 43k-path main layer ×2 | 18.511 | 7,552 B | 17.269 | **1.072** | 1.072 |
| **closure-fresh** | 250k: delete 4 of the main layer's 8 groups at once | 26.843 | 0 | 23.097 | **1.162** | 1.162 |
| **closure-fresh** | 330k (996k anchors): delete 3 groups one at a time | 26.664 | 0 | 22.955 | **1.162** | 1.162 |
| **closure-fresh** | 40 traced 100-path layers, each deleted (40 history-only chunks) | 1.957 | 151,040 B | 1.926 | **1.016** | **0.941** |
| **closure-fresh** | 43k: replace the 1k layer ×5, delete 2 groups, undo 3 (redo kept) | 2.291 | 18,880 B | 2.163 | **1.059** | 1.051 |

(The 1-small-edit row is below the noise floor, as before.)

**Disposal:** after dropping the session and collecting, the heap is within **−2.1 to +4.5 KB** of its pre-build level (3 repetitions).

**Reading.**
- **Medians.** Every scenario above the noise floor has a median ratio of at least **1.001**, in every set. That includes all six closure-fresh scenarios: traced-layer replacement, large structural deletions, and many history-only chunks.
- **Why the correction was needed.** Without the record term, three closure-fresh scenarios would under-count: 0.998, and **0.941** for 40 history-only chunks.
- **Uncertainty.**
  - Repetition spread is within **±30–40 KB**, as before: the largest outlier is one repetition 34 KB high in the undo/redo case.
  - Individual repetitions dip below 1 only inside that band: 0.997 (200k replace), 0.993 (palette), 0.889 (the undo/redo outlier).
  - A ratio is meaningful only where the retained bytes are well above that band.
- **Eviction.** The 10-entry eviction case is unchanged and **inconclusive**. Its retention (about 70 KB) is inside the noise band; no constant was tuned against it. The larger eviction case is 1.001.
- **Large deletions over-count by 16 %.** That is the per-key scoping of small records and strings (G-15), and it is conservative.
- **Engines.** Browser heap evidence is still Chromium only (above). Nothing here extends to Firefox or WebKit.

**Re-qualified** on `4899605` and later heads:
- `vp test`: **465 passed**, including:
  - the ledger and session budget tests, re-derived for the new term;
  - a new owner-precedence test: a snapshot holding a history chunk removes its record from history, and undo and redo move it back and forth;
  - the ledger-against-oracle fuzz and the ownership-transition tests;
  - the retention test.
- `node --expose-gc scripts/check-retention.mjs`: **PASS**.
- Accounting cost (`scripts/profile-accounting.mjs` → [`bench/closure-profile-accounting-0cd85a2.json`](bench/closure-profile-accounting-0cd85a2.json)): `historyBytes()` takes 0.001–0.002 ms with a 103-entry history, and eviction is still not measurable (−0.002 ms per edit).

## 8. Test infrastructure (brief §7)
**`render_compare`.**
- `tests/browser/global-setup.ts` builds the binary once, before any spec, so specs no longer depend on running order.
- Verified by deleting the binary and running `renderer-behaviour.spec.ts` alone: 8/8.

**Canvas-edge race: a test defect, not a product defect.**
- **Diagnosis.** On a failure, the e handle lay at x 975–984 while the canvas ended at x 968: outside the canvas, over the panel splitter.
- **Cause.** The test measured the canvas box once per viewport. The layout kept settling after that measurement under load, so the "within 12 px of the edge" poll passed against a stale box.
- **Fix:**
  - the box must be unchanged for five consecutive animation frames, measured in the page;
  - the gap uses the current box, and the handle must lie inside the canvas;
  - the handle's centre is read and probed in one in-page step.
- No sleep was added and the assertion is unchanged.
- **Result:** 40/40 passes under load. The atomic probe alone was not enough: 1 failure in 20, then many under load, which is what led to the diagnosis.

## 9. `paletteLabels()` investigation (brief §6)
**Cost on stage D storage** (`scripts/bench-palette-labels.mjs --reps 15`, median per new state):

| Document | Now | Stage B/C baseline |
|---|---|---|
| bark-1224 | 6.3 ms | 6.1 ms |
| bark-2350 | 17.5 ms | 16.5 ms |
| synthetic-many-250k | 2.8 ms | 1.5 ms |

Random-order lookups in its tree walk are a little slower on `NodeMap` (§5.2).

**Split for bark-2350:**
- the walk over traced paths: **9.6 ms**, including 0.9 ms to collect provenance IDs;
- the per-entry label pass over 30,595 entries: about **8 ms**.

**What could make it incremental.** Labels change only when the set of generated entries changes or the palette changes. Stage C already shares unchanged palette and style maps, and the Draft write log names every node a transaction wrote. Two designs keep strict provenance, collision handling, palette order and export semantics:
1. **Reuse a predecessor's labels** when the transaction wrote no path, group or layer whose palette membership could change, and the palette and style maps are the same objects. This needs the transaction's change set exposed to the shell, plus a one-slot reference to the predecessor's labels.
2. **A persistent per-layer usage index** (palette reference → count), derived at `Draft.finish` like the parent index. This is a new retained structure that AM-2 accounting must count.

Either removes the walk, at most about 9.6 ms at bark-2350. Only (2) also avoids recomputation after edits to unrelated paths. The O(entries) label pass remains whenever the generated set changes.

**Not implemented here:**
- The labels are cached per state and computed only while the inspector shows a Fill note or Recolor.
- Design (1) changes the session snapshot API used by the shell; design (2) adds an accounted persistent index and a differential obligation.
- **Recommendation:** implement (2) together with Recolor panel virtualisation, which stays separate as instructed, in the gate that next works on that panel.

## 10. Renderer and preview against the G-BRAND `main` baseline (brief §6)
**Matched setup.**
- **Builds:** the baseline is `main` `0e95737`, built in a separate worktree. Its `BUILD_ID` is `69b8618a0497ded6`, **the build ID recorded at G-BRAND acceptance**; it reuses the identical WASM package, since the engine sources are unchanged. G-DOC-R is `0700087`, `BUILD_ID` `7debe2a41e0f74d5`.
- **Same spec, workloads and machine:** `tests/browser/workspace-perf.spec.ts` (`R1_PERF=1`, headed Chromium 159), the registered G-R1 workloads (hash-checked), the same machine and the same session. Runs are interleaved; the second set reversed the order.
- **Safari:** `tests/safari/gr0.mjs` (pan and zoom, worker host), interleaved pairs.
- **Evidence:** [`renderer/`](renderer/) (12 Chromium reports), [`safari/gr0-*.json`](safari/).

**Chromium, final build** (8 runs: 4 baseline, 4 G-DOC-R, interleaved both ways). Medians of the runs, in ms:

| Stage | synthetic-many-250k (interactive target) baseline → G-DOC-R | bark-2350 (stress trace) baseline → G-DOC-R |
|---|---|---|
| Container load and validation | 123 → **142.5** (+16) | 289 → **304** (+15) |
| Document evaluation | 11.5 → 14.5 (+3) | 11.8 → 13.6 (+2) |
| **Snapshot preparation** | 4.0 → 4.6 (+0.6) | 5.2 → **6.7** (+1.5) |
| Path construction (render worker) | 135 → 139 (noise) | bimodal in **both** builds (≈1,000 or ≈1,160): noise |
| Exact frame | 129 → 133 (+4) | 284 → 292 (+8) |
| **Complete preview** (validated document → exact frame; target ≤ 100 ms, unchanged) | 149 → **156** (+7) | 305 → **317** (+12) |
| Pan / zoom / drag frames p95 | 17.3–18.4 in both | 16.8–18.5 in both |
| Drag release → exact settle | 93 → **81** (−12) | 134 → **106** (−28) |

**Real Safari 26.6.2** (gr0, interleaved pairs; final build and the earlier `df8e8f2` build agree):

| | Interactive: baseline → G-DOC-R | Stress: baseline → G-DOC-R |
|---|---|---|
| Snapshot preparation | 7–8 → **10** ms | 23–24 → **28–31** ms |
| First frame | 68–70 → 72 ms | 105–110 → 112–117 ms |
| Exact frame | 107–112 → 108–115 ms | 335–344 → 342–354 ms |
| Pan / zoom p95 | 17–18 → 17–18 ms | 17–19 → 17–19 ms |

**Reading.** Structural dispatch is reported separately (§5.5), and the renderer's scheduling is unchanged: gestures are identical.

What G-DOC-R costs the renderer path:
- **Load and validation, about 15 ms slower.** Loading now builds the ID-ordered node map, a sort, and seeds the parent index.
- **Evaluation and snapshot preparation, 1–6 ms slower.** These are tree walks; `NodeMap.get` is slower than `Map.get` for their access pattern (§5.2).
- **Complete preview, 7–12 ms slower** in Chromium.

What it gains:
- **Releasing a drag settles 12–28 ms sooner**, because the transform's dispatch is cheaper.

The preview target (≤ 100 ms at the interactive target) was already missed before G-DOC-R (149 ms baseline). It is unchanged, still missed, and still under the temporary exception. These regressions are recorded (decisions F-14) and are candidates for a later optimisation of the walk lookups.

## 11. Final qualification (document code as `6a23a92`; builds `0700087` and `748e820`)
**Exact final head `748e820`.** The only production change since `0700087` is the debug-only qualification hooks (`historyBytes()`, a `withoutHistory` option). Rebuilt as `VERSION` `47772f1728efb048`, `BUILD_ID` `e3cfd750f82410a6`, bundle workspace JS 237.5 KiB. Re-run there:
- the full Playwright suite: **375 passed, 0 failed, 39 skipped** (36 opt-in, plus the new opt-in memory spec in 3 engines);
- `vp test`: 464 passed.

**Closure head** (`d10ef36`, `VERSION` `6cdbae7e5bb8ad3f`, `BUILD_ID` `83daa2d29699dfdb`; the later commits are documentation and records only):
- the full Playwright suite: **375 passed, 0 failed, 42 skipped**. The 42 are the 36 earlier opt-in skips, plus the opt-in memory spec and the new opt-in dispatch spec, each in 3 engines. Load was 1.24–1.82 and the run took 9.0 minutes;
- `vp test`: **465 passed**;
- `vp check`: clean on the changed sources;
- bundle (gzip KiB): design-system JS 114.3, CSS 9.5, workspace JS **237.8** (+0.3 for the debug hook; budgets 150 / 15 / 250).

**Opt-in skip counts, reconciled:**
- 36 on `0700087`: the earlier opt-in specs;
- 39 on `748e820`: plus the memory spec in 3 engines;
- 42 on `d10ef36`: plus the dispatch spec in 3 engines.

The rows below were measured on `0700087` (`BUILD_ID` `7debe2a41e0f74d5`) unless stated.
| Check | Result |
|---|---|
| `vp check` / `vp test` | clean / **464 passed** |
| Retention outside the runner (`node --expose-gc scripts/check-retention.mjs`) | **PASS** |
| Differential, final code | 108,249 comparisons (6 seeds) + 558,472 (30 seeds): **0 disagreements** |
| Ledger against oracle | `structure-accounting.test.ts`: pass (8 seeds, multi-chunk documents, every command kind) |
| Single-defect equivalence (plain `Map` against `NodeMap`) | identical verdicts and codes over 12,818 states; only duplicate-ID messages differ (permitted); asserted in `vp test` |
| Accounting and eviction cost | ≤ 0.02 ms per ordinary edit, ≤ 0.9 ms for the widest; eviction not measurable (§6.2a) |
| Calibration (§7) | validation and fresh validation conservative (1.001–1.163) above the noise floor; disposal returns the heap within 4 KB |
| Browser memory | Chromium: 1.06–2.46, conservative (pointer compression). Firefox and WebKit: NOT RUN (no comparable heap reading) |
| Production build | passes; `VERSION` `5c13b9c9d919e60c`, `BUILD_ID` `7debe2a41e0f74d5` |
| Bundle (gzip KiB; budgets 150 / 15 / 250) | design-system JS 114.3, CSS 9.5, workspace JS **237.5** (G-BRAND 231.2; +6.3 for the validator, node map and accounting) |
| Playwright 1.65.1, full suite, 3 engines | **375 passed, 0 failed, 36 opt-in skips** on the first run, identical to G-BRAND. The `render_compare` setup and the canvas-edge fix hold |
| Bundle v1 (workbench) | **15/15** byte-identical |
| Document export (frozen 636, every `concert-*` input excluded) | **576/576** identical on `6a23a92` |
| Engine corpus / bundle v2 | 294/294, 72/72 (engine unchanged by G-DOC-R; runs of §3) |
| Canonical serialization | the frozen hash (taken on stage B) is unchanged |
| Real Safari 26.6.2 on the final build `e3cfd750f82410a6` (`2e37eba`), after a Safari restart. Screen unlocked; page visible before and after each harness. Records: `safari/g-doc-r-rerun*-e3cfd750-*` | **gui 14/14 · gr1 7/7 · gjob 10/10 · gr0 7/7 · persistence 23/23** |
| CI (GitHub Actions) | Run 45893021136 on `2e37eba` **failed**. The randomized test in `node-map.test.ts` (3.2 s here, 12/12 pass) exceeded Vitest's 5 s default timeout on the CI runner. `4e42dbc` gives it an explicit 60 s timeout; no product code changed. CI result on that head: see the PR |
| Real Safari on `0700087`, before the restart | gr0 7/7 and persistence 23/23 passed. gui 7/15, gjob 2/10 and gr1 6/7 (offline only) failed through the environment fault below; superseded by the re-run |

**Real-Safari environment fault, diagnosed (`safari/harnesses-0700087-*`).** Every failure is a timeout waiting for a trace, for "offline ready", or for a job stage. Two diagnostic sessions showed:
- **Imports.** An import fails with "The I/O read operation failed", from the worktree and from `/private/tmp` alike.
- **Service worker.** `navigator.serviceWorker.register` resolves, but the worker never installs or controls the page.
- **Workers.** Both workers load and complete their handshake.
- **The baseline fails identically.** The **verified G-BRAND baseline** (`69b8618a0497ded6`), whose harnesses passed in full earlier on 2026-11-26, shows exactly the same failures in the same Safari session.
- **Last valid run.** The same harnesses passed in full on `9ae294f` at 12:13 (§3.1).

So Safari's blob and storage layer, or its file access, was failing for every build. Those runs were recorded as invalid (environment), not as passes or as G-DOC-R regressions.

**Resolved.** The maintainer restarted Safari. On the final build all five harnesses pass, including every import, trace and commit, offline readiness, the scheduler and the service-worker update scenarios (table above). This confirms the diagnosis.

**NOT RUN, or open:**
- lower-end hardware;
- a designated quiet-machine run (the final dispatch run had load 1.3–1.5, but is not labelled quiet);
- dispatch timing inside the production build in a browser (the renderer stages are measured in §10);
- browser-engine heap evidence;
- VoiceOver and the stock-Safari keyboard check.

### 11.1 Browser dispatch in the production build (maintainer closure brief §3, 2026-11-26)
**Can the existing harness do it?**
- **Partly.** The debug qualification API already dispatched on the shown session. That session has subscribers (React, the render host), and the container loader cannot open the stress workloads.
- **The loader limit.** The 250k-path workload's document section is **72.7 MB**, over C7's 64 MiB document cap, so `saveContainer` refuses it (F-15; recorded for G-PRJ under TD-PERF-009).
- **So a debug-only hook was added: `buildDetached`.** It replays the workload's own commands into a production `DocumentSession` that is not shown: no subscribers, no renderer.
  - The commands come from `bench-workload.ts` `setup()`: the two traces and the pre-made group.
  - Each packet is served as its C3.1 geometry record and decoded by the production codec.
  - The replayed document has the Node build's node count (asserted), so every command's IDs match.
- **What is timed.** Only `session.dispatch`, on the **production validation path** (`incremental`, asserted; every measured transaction was decided incrementally: 1.000 for all 12 types, every workload and every engine). Renderer scheduling is outside the measurement; it is measured separately in §10.

**Run.**
- **Command:** `G_DOC_R_DISPATCH=1 pnpm exec playwright test tests/browser/g-doc-r-dispatch.spec.ts` (one worker, engines in sequence).
- **Build:** commit `d10ef36`, `VERSION` `6cdbae7e5bb8ad3f`, **`BUILD_ID` `83daa2d29699dfdb`**.
- **Engines:** Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2.
- **Conditions:** load 1.35–1.72; no `ngspice`; shared machine, not a designated quiet run.
- **Records:** [`bench/closure-dispatch-{chromium,firefox,webkit}-d10ef36.json`](bench/), plus a WebKit 996k repeat ([`bench/closure-dispatch-webkit-996k-repeat-d10ef36.json`](bench/closure-dispatch-webkit-996k-repeat-d10ef36.json)).

**Procedure.** Identical to Node (`scripts/bench-g-doc-r.mjs`): 2 warm-up and 30 measured repetitions. Each repetition:
1. an untimed `setArtboard` gives a fresh state S;
2. `dispatch(cmd)` on S is timed;
3. undo and redo are timed;
4. an untimed undo returns to S.

**Differences from Node,** all recorded:
- **Commands are built before the timed section.** Node builds them inside it, which for commitTrace includes synthesising the packet; so the browser commitTrace numbers are lower.
- **No forced collection.** Pages cannot force one in Firefox or WebKit, so none was used in any engine. A 5 ms yield between repetitions lets scheduled collection run outside the timed sections, but p95 may include GC pauses.
- **Timer resolution.** The page is not cross-origin isolated, so `performance.now()` resolution is **0.1 ms in Chromium and 1 ms in Firefox and WebKit**. Sub-millisecond types therefore read 0 / 1 there.

**Interactive target: 43k paths, 264k anchors** (median / p95, ms)

| Type | Node (§5.5) | Chromium 159 | Firefox 159 | WebKit 27.2 |
|---|---|---|---|---|
| setFill1 | 0.072 / 0.123 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |
| setFillMany | 6.277 / 6.682 | 5.9 / 6.8 | 6 / 7 | 9 / 11 |
| setVisible | 0.059 / 0.079 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |
| rename | 0.062 / 0.086 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |
| reorder | 2.683 / 2.754 | 2.9 / 4 | 3 / 5 | 5 / 7 |
| applyTransformPath | 0.058 / 0.086 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |
| applyTransformLayer | 4.955 / 5.337 | 5.9 / 7.9 | 6 / 8 | 8 / 10 |
| group | 3.329 / 3.401 | 3.3 / 3.3 | 3 / 4 | 5 / 5 |
| ungroup | 5.146 / 5.367 | 3.3 / 4.1 | 5 / 6 | 7 / 7 |
| delete | 2.883 / 2.968 | 2.8 / 3.2 | 3 / 4 | 5 / 5 |
| duplicate | 2.875 / 2.972 | 2.5 / 3 | 3 / 4 | 5 / 6 |
| commitTrace | 6.875 / 7.47 | 4.6 / 4.9 | 5 / 6 | 7 / 8 |

**250k paths, 756k anchors** (median / p95, ms)

| Type | Node (§5.5) | Chromium 159 | Firefox 159 | WebKit 27.2 |
|---|---|---|---|---|
| setFill1 | 0.14 / 0.169 | 0.1 / 0.4 | 0 / 0 | 0 / 1 |
| setFillMany | 19.658 / 20.076 | 14.6 / 17 | 12 / 15 | 29 / 30 |
| setVisible | 0.124 / 0.148 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |
| rename | 0.131 / 0.166 | 0.2 / 0.4 | 0 / 1 | 0 / 1 |
| reorder | 14.902 / 15.198 | 11.1 / 13.6 | 13 / 15 | 23 / 25 |
| applyTransformPath | 0.125 / 0.146 | 0.1 / 0.2 | 0 / 1 | 0 / 1 |
| applyTransformLayer | 26.17 / 26.498 | 25.9 / 26.7 | 26 / 27 | 43 / 44 |
| group | 17.613 / 18.173 | 12.2 / 12.7 | 14 / 16 | 24 / 25 |
| ungroup | 25.169 / 25.773 | 14.7 / 15 | 20 / 21 | 33 / 34 |
| delete | 15.508 / 16.308 | 10.9 / 11.2 | 13 / 13 | 23 / 24 |
| duplicate | 15.959 / 16.384 | 11.2 / 11.3 | 13 / 14 | 23 / 24 |
| commitTrace | 6.085 / 7.095 | 4.7 / 4.9 | 5 / 6 | 7 / 8 |

**996k anchors: 330k paths** (median / p95, ms)

| Type | Node (§5.5) | Chromium 159 | Firefox 159 | WebKit 27.2 | WebKit repeat |
|---|---|---|---|---|---|
| setFill1 | 0.165 / 0.198 | 0.1 / 0.2 | 0 / 1 | 0 / 1 | 0 / 1 |
| setFillMany | 26.123 / 26.829 | 19.7 / 21.5 | 14 / 16 | 39 / 40 | 39 / 41 |
| setVisible | 0.149 / 0.17 | 0.1 / 0.2 | 0 / 1 | 0 / 1 | 0 / 1 |
| rename | 0.154 / 0.166 | 0.3 / 0.5 | 0 / 1 | 1 / 1 | 0 / 1 |
| reorder | 20.016 / 20.315 | 13.9 / 16 | 17 / 20 | 31 / 32 | 31 / 32 |
| applyTransformPath | 0.153 / 0.184 | 0.1 / 0.3 | 0 / 1 | 0 / 1 | 0 / 1 |
| applyTransformLayer | 34.363 / 34.723 | 34.3 / 34.6 | 33 / 34 | **59 / 68** | **58 / 58** |
| group | 23.197 / 23.709 | 16 / 17.2 | 20 / 23 | 33 / 35 | 33 / 34 |
| ungroup | 33.178 / 34.954 | 19.1 / 19.9 | 25 / 27 | 45 / 47 | 44 / 44 |
| delete | 20.01 / 21.199 | 13.5 / 14 | 17 / 18 | 32 / 32 | 31 / 31 |
| duplicate | 20.655 / 20.897 | 13.6 / 14.1 | 17 / 19 | 32 / 33 | 31 / 34 |
| commitTrace | 5.82 / 6.264 | 4.7 / 5 | 5 / 6 | 7 / 8 | 7 / 8 |

**Reading** (≤ 50 ms dispatch target; interactive targets median ≤ 16.7 ms and p95 ≤ 33 ms; no threshold relaxed):
- **Interactive target:** **MET in all three engines.** The worst type is 5.9 / 7.9 ms in Chromium, 6 / 8 ms in Firefox and 9 / 11 ms in WebKit.
- **756k anchors:** **MET in all three engines.** The worst type is applyTransformLayer at 25.9 / 26.7 ms in Chromium, 26 / 27 ms in Firefox and 43 / 44 ms in WebKit.
- **996k anchors:**
  - **MET in Chromium** (34.3 / 34.6 ms) **and in Firefox** (33 / 34 ms).
  - **MISSED in Playwright WebKit by one type: applyTransformLayer 59 / 68 ms**, reproduced at 58 / 58 ms. ungroup is the next highest at 45 / 47 ms. The other ten types are ≤ 40 / 41 ms.
  - WebKit runs this engine's walk-heavy transactions about 1.7× slower than V8 and SpiderMonkey.
- **Undo and redo** are ≤ 1 ms everywhere (timer resolution).
- **Real Safari dispatch: NOT RUN.** The safaridriver harnesses have no packet routing; Playwright WebKit stands in, and the 996k miss may or may not hold in Safari 26.

**Consequence.** Browser dispatch is qualified at the interactive target and at 756k in three engines. At 996k anchors it is qualified in Chromium and Firefox only. **The WebKit 996k miss keeps TD-PERF-007 open and the gate PARTIAL**, together with lower-end hardware and the quiet machine.

## 12. Disposition
| Brief item | Result |
|---|---|
| AM-2 recorded (C3 r3, RFC §7, decision register, amendment record) | **Done** (`161c679`) |
| Chunked copy-on-write node map and persistent parent index | **Done**, qualified (§5) |
| History accounting covering structural allocations; shared allocations once; ownership transitions verified | **Done** (§6). Approximations documented: per-key small records, strings, aliasing in hand-built states |
| Cost-model calibration (separate validation set; uncertainty; limits) | **Done** (§7). Validation and fresh validation 1.001–1.163 above the noise floor. The 10-entry eviction case is at the noise floor (inconclusive); the larger eviction case is 1.001. Disposal frees everything. One calibration residual is 0.987. Chromium heap evidence is conservative; other engines are NOT RUN |
| No whole-document or whole-history traversal on ordinary edits; accounting and eviction costs profiled | **Done** (§6.2a). `structureDelta` takes ≤ 0.02 ms on ordinary edits and ≤ 0.9 ms on the widest; eviction is not measurable |
| Adversarial corpus; ≥ 10,000 differential; slower reference oracle; independent review | **Done** (§5.4, §5.6). Single-defect equivalence tested (§5.1) |
| `paletteLabels()` investigation | **Done**: recommendation in §9; not implemented |
| Renderer against the verified G-BRAND baseline, matched | **Done** (§10): small regressions in load, evaluation and preview; gestures unchanged; drag settle faster |
| All 12 types at three workloads, median and p95 | **Met in Node** (§5.5) |
| Browser suite, real Safari, serialization, export equivalence, history tests | **Done.** Playwright 375/0 in 3 engines; real Safari 5/5 harnesses on the final build (§11) |
| `render_compare` deterministic setup; canvas-edge race | **Done** (§8) |
| Exact omitted fixture set | `concert-small-venue.png`, `concert-small-venue-1280.png`, `concert-stage-light.png` (and every output derived from them): 32 of the 326 engine-corpus hashes and 60 of the 636 export hashes |

**Overall: PARTIAL.** *(As first written; superseded by §13.)*
- Stage D and the G-DOC-R implementation are ready for maintainer review.
- The gate stays **open and unqualified** until the remaining runs are done:
  - lower-end hardware;
  - a quiet machine;
  - in-browser dispatch timing.
- No threshold has been relaxed.

## 13. Maintainer acceptance and final closure (2026-11-26)
The maintainer accepted stage D as an implementation at `1a7b45f`, subject to an accounting closure, and asked for browser dispatch qualification ([decision register §12](../g0/G0-DECISION-REGISTER.md)).

| Closure item | Result |
|---|---|
| 0.987 residual investigated | **Done** (§7.1). The geometry store's per-chunk record: 3,688–3,767 bytes per chunk at every size; the nine typed-array and buffer headers are 1,800 of it. The structure model's typed-array header was also low (160 vs 198–200 measured) |
| Correction | `COSTS.chunkRecord` 3,776 per history-attributed chunk (C3.2 precedence) and `COSTS.typedArray` 216, frozen at `4899605`. Counted under AM-2 term 3: the C3.2 chunk ledger cost, `bytes()` and C2 are unchanged, and the budgets are unchanged. **M-10:** the maintainer is asked to confirm this reading, or require a C3 r4 amendment instead |
| Original result | Kept: §7 table (`629cec6`) and [`bench/stage-d-calibration-final-629cec6.json`](bench/stage-d-calibration-final-629cec6.json) |
| Fresh validation, constants frozen | Six closure-fresh scenarios: **1.001–1.162** at the median. Without the record term, three would under-count (0.998, 0.941). Repetitions dip to 0.997 only inside the ±30–40 KB noise band |
| Small eviction case | Inconclusive (0.694, at the noise floor); nothing tuned against it |
| Browser heap claims | Chromium only. Wording corrected (§7): no conservative claim for Firefox or WebKit, no universal guarantee |
| Re-qualification | `vp test` 465 passed (ledger, budget, owner precedence, oracle fuzz, transitions, retention); `check-retention.mjs` PASS; accounting cost unchanged (§7.1) |
| Browser dispatch | Production build `83daa2d29699dfdb`, a session that is not shown, the incremental path, 12 types, median and p95 (§11.1). **Met:** interactive target and 756k anchors in Chromium, Firefox and WebKit; 996k anchors in Chromium and Firefox. **Missed: WebKit at 996k anchors, applyTransformLayer 59 / 68 ms** (repeat 58 / 58). Real Safari dispatch NOT RUN |
| Blocker found on the way | The container loader cannot open the 250k-path workload: its 72.7 MB document section is over C7's 64 MiB cap (F-15; TD-PERF-009, G-PRJ input) |
| Debt | TD-PERF-012 added (renderer regressions, accepted and tracked); TD-UI-006: confirmation authorised as a G-PRJ follow-up, refusal kept; TD-PERF-007 and TD-PERF-011 stay OPEN; TD-PERF-009 gains F-15. **45 open items, 14 High** |
| Decisions | M-7, M-8 and M-9 recorded as decided (decisions §6, decision register §12). G-PRJ and G-COLOR-UI recorded in the roadmap; neither is started |
| Reconciled | F-14 (the preview regression is +7 / +12 ms, not "unchanged"); the PR summary's calibration range (0.987–1.074, not 1.061), disposal (within 4 KB) and eviction ratio (0.689); opt-in skip counts (§11) |

**Remaining open qualifications:**
- Playwright WebKit dispatch at 996k anchors (applyTransformLayer);
- real Safari dispatch;
- lower-end hardware;
- a designated quiet-machine run;
- heap evidence from engines other than Chromium;
- VoiceOver and the stock-Safari keyboard check (owner).

**Overall: PARTIAL.** No threshold is relaxed. PR #22 stays unmerged until the maintainer reviews this closure.
