# G-DOC-R — Document-store performance (report)

**Status: STAGES B AND C ACCEPTED AS CHECKPOINTS (maintainer, 2026-11-26); AM-2 APPROVED; STAGE D IN PROGRESS.** The gate as a whole remains open and unqualified. §§1–4 are the stage B/C record as accepted; stage D follows from §5.
- Stage B (§1) and stage C (§2) are implemented and qualified, in Node and in the production build in 3 browser engines (§3).
- An independent review of stage B found one correctness defect, which is fixed and re-qualified (§1.6).
- Following brief §6 and change control, stage D is **not started**. Its history accounting needs amendment AM-2 ([draft](AM-2-DRAFT.md)), and the defect is reported here first.
- On the final head (`9ae294f`):
  - real Safari passes all five harnesses (§3.1), with the screen unlocked and the page visible;
  - the full Playwright suite passes in 3 engines: 375 passed, 0 failed, 36 opt-in skips.
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
## 5. Stage D — persistent storage (AM-2 authorised, 2026-11-26)
Commits: `c40ca5f` (storage), `7a416dd` (accounting), `d2c1839` (calibration, exact child lists, wider corpus), `f23b79f` (fault injection), `9aac564` (test infrastructure). Design notes: [STAGE-D-DESIGN](STAGE-D-DESIGN.md), written before the code. The implementation departs from that note where measurement required (§5.2).

### 5.1 Audit of node-map iteration consumers (before replacing the map)
Every production use of `nodesById` beyond `get`, `has` and `size`:

| Consumer | Uses the order? | Result |
|---|---|---|
| `invariants.ts` `validateState`: per-node checks | Which defect is reported **first** in a document with several defects | Allowed by AM-2. Single-defect rejections keep the same code and message, with one exception: a **duplicate ID number** between two nodes names whichever is visited second. That can now be the other node; the code (`invariant`) is unchanged |
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
- **The oracle.** `testing/structure-oracle.ts` recomputes the same quantity by full traversal with identity sets, without the chain argument.
- **Ledger against oracle.** `structure-accounting.test.ts` compares the two after **every operation** of random histories: 6 seeds × 160 operations, mixing edits, undo, redo, branching, keyed coalescing, `withoutHistory` and evictions by count and by bytes. The first run of this test found a real double count, fixed before commit: the shared empty-chunk constant was counted once per map.

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
<!-- filled from the final calibration run (§11) -->

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
