# G-DOC-R — Document-store performance (report)

**Status: STAGES B AND C QUALIFIED; STAGE D STOPPED.**
- Stage B (§1) and stage C (§2) are implemented and qualified, in Node and in the production build in 3 browser engines (§3).
- An independent review of stage B found one correctness defect, which is fixed and re-qualified (§1.6).
- Following brief §6 and change control, stage D is **not started**. Its history accounting needs amendment AM-2 ([draft](AM-2-DRAFT.md)), and the defect is reported here first.
- Real Safari is NOT RUN on this head (the screen was locked).
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
- **250k paths (756k anchors):** **every type** is under 50 ms at median and p95: medians 14–45 ms, p95 ≤ 45.7 ms.
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

### 2.5 Stage C checkpoint
| Requirement | Result |
|---|---|
| Draft-recorded write keys | **PASS** (§2.1, §2.2) |
| Qualified command optimisations | **PASS**: `documentOrder` removed; sealed maps shared; publication only of written entries; walk without allocation. Cold `parents` remains for stage D |
| Mutation tracking, coverage, no-ops, undo/redo, invalid commands, serialization and export | **PASS** (§2.2) |
| Per-subtree summaries | **Investigated** (§2.4); deferred with a recorded ceiling |
| ≤ 50 ms at the stress workloads | 250k / 756k anchors: **MET** (Node). 996k anchors: **NOT MET** for 6 of 12 types; stage D addresses this |
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

**Real Safari: NOT RUN.** The screen was locked at the time (`CGSSessionScreenIsLocked` true), and runs under a locked screen are invalid (G-R1 report §13). The harnesses (`tests/safari/*.mjs`) are to be run on this head once the screen is unlocked.

**Engine and document regressions on the stage C head**, recounted with **every** `concert-*` input excluded. An earlier session script treated all `concert-*` photographs as private, so `concert-stage-light` is now excluded too:
- engine corpus **294/294** (326 minus 32 concert files);
- bundle v2 **72/72**;
- document export **576/576** (636 minus 60), on `758a689`.

The figures in §1.4 (302 and 588) included `concert-stage-light`; those outputs have been deleted locally.