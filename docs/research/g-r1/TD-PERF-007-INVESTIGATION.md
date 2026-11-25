# TD-PERF-007 investigation — whole-state validation and map copying (G-R1)

**Status: INVESTIGATION. Nothing is wired.** `DocumentSession.dispatch`, `validateState`, commands, document semantics, export output and the container format are unchanged. The recommendation (§7) is for the maintainer to decide.

| | |
|---|---|
| Date | 2026-11-25 |
| Branch | `td-perf-007-investigation` (an isolated worktree), based on `ba2cb53` (`gate/g-r1-interactive`) |
| Mandate | TD-PERF-007 (High, G-EDIT); [decision register](../g0/G0-DECISION-REGISTER.md) §8 (G-R1 owns the investigation) and §9 (the full validator stays the oracle; ≥ 10,000 randomized comparisons before an incremental validator is accepted) |
| Machine | Apple M5 Max, 18 cores, 128 GiB, macOS (Darwin 25.6.0). **Shared and not quiet**: load averages are recorded with every run |
| Runtime | Node v24.22.1 (type stripping; main thread; `--expose-gc`) |
| Scope | Node only. No browser, no production build (§8) |

**Read first:**
- **Validation dominates at every size.** `validateState` is **56–89 %** of a dispatch's median time. Node-map copying plus publication is **10–18 %**. History bookkeeping is a few percent. Per document size, for a one-node edit (`setVisible`, run 2, p50):

  | Paths (nodes) | dispatch | validateState | copy + publish | validation share | copy share |
  |---|---|---|---|---|---|
  | 1k (1,112) | 0.67 ms | 0.57 ms | 0.11 ms | 85 % | 15 % |
  | 16k (17,012) | 8.22 ms | 6.89 ms | 1.22 ms | 84 % | 15 % |
  | 43k (44,012) | 22.2 ms | 18.3 ms | 3.31 ms | 82 % | 15 % |
  | 250k (251,012) | 144 ms | 120 ms | 23.5 ms | 83 % | 16 % |

  Over all 12 transaction types, the validation share is 56–89 % at 1k, 65–84 % at 16k, 65–83 % at 43k and 62–83 % at 250k. The copy and publication share is 10–15 %, 11–15 %, 12–15 % and 12–18 %.
- **Other O(nodes) passes the debt entry does not name.** Every `setFill` calls `documentOrder`, a whole-tree walk, and so do `group`, `delete` and `duplicate` through `topLevel`; the last three also build `parents` cold. That costs 29–43 ms per transaction at 250k and 3–5 ms at 43k, even for a single target.
- **History memory (new finding).** Each history state retains its own full node-map table: **about 7 MiB per state at 251k nodes** and 1.75 MiB at 44k (retained heap, measured). Extrapolated to 100 entries (100 × the per-state measurement), that is about 700 MiB at 250k, and it is **not counted** by the RFC §7 128 MiB history budget, which counts chunks and sources only. A new debt item is proposed (§9).
- **The prototype incremental validator is exact on the recorded runs.** It is fast-accept and not wired. Five seeds give **62,124 validator-reached comparisons**: 23,462 invalid states, including 353 anchor-budget rejections, and 38,662 valid ones, with **zero disagreements**. It decided locally on 38,267 of the valid states, including **100 %** of valid states produced by real commands. Every undecided valid state was a forged removal of a style or palette entry, which no command performs. The required seed `20261125` alone gives 12,427 comparisons, and the unit test enforces it in `vp test` in under 1 s.
- **What it would buy** (estimate by composition, §6): at the interactive target (43k paths), dispatch medians would fall from 22–29 ms to roughly 5–12 ms, **under the 16.7 ms closure median for every measured type**. At 250k it would fall from 144–191 ms to 34–98 ms. That is still **above 50 ms** for structural edits and whole-layer transforms, because the O(nodes) copy, publication, diff, `documentOrder` and `parents` passes remain, and a container transform is O(subtree) by the invariants' nature.
- **Recommendation (§7).** First wire the fast-accept validator in `dispatch` behind the full-pass fallback (option B). Then record the Draft's written keys (option C). Structural sharing of the node map and a persistent parent index (option D) is the only route found to ≤ 50 ms at 250k and to bounded history memory; it changes `DocState`'s map type, so it needs approval. No adoption is made here.

## 1. Question and scope
The maintainer's instruction, binding: "Begin the approved TD-PERF-007 investigation. Profile whole-state validation and map copying separately. Investigate incremental validation and structural sharing. Preserve the full invariant validator as an independent oracle and as the required validation path for untrusted loaded documents. Require at least 10,000 randomized transaction comparisons before accepting an incremental validator. Do not introduce major dependencies or rewrite the authoritative document architecture without approval."

Delivered, all as new files; no existing file is changed:

| Path | Role |
|---|---|
| `scripts/bench-td-perf-007.mjs` | Stage profile, structural-sharing micro-benchmark, and `--differential` record |
| `src/document/incremental-validate.ts` | Prototype fast-accept incremental validator. **Not wired** |
| `src/document/testing/incremental-differential.ts` | Seeded differential harness (test-only; importable by Node) |
| `src/document/incremental-validate.test.ts` | Differential acceptance test (≥ 10,000 comparisons, zero disagreements), and a check that no production module uses the prototype |
| `docs/research/g-r1/td-perf-007/` | Run JSON and machine-load records (`profile-run1`, `profile-run2`, `differential.json`). The per-command console logs (`*.log`) are gitignored and not committed |

## 2. Method
**Commands.**
- Profile: `node --expose-gc scripts/bench-td-perf-007.mjs --reps 30 --out docs/research/g-r1/td-perf-007/profile-run<N>.json`, wrapped by a recorder that writes `uptime`, the `ngspice` count and the top CPU consumers before and after to `profile-run<N>.load.txt`.
- Differential: `node scripts/bench-td-perf-007.mjs --differential --seeds 20261125,1,2,3,4 --transactions 16000 --out docs/research/g-r1/td-perf-007/differential.json`.

**Documents.** Each is built through real commands: one `commitTrace` of a seeded synthetic packet (`seed 42`, 8 groups), then a second, replaceable layer, then one 10-path `group` used as the `ungroup` target.

| Paths | Nodes | Anchors per path | Anchors | Paths per group | Replace layer |
|---|---|---|---|---|---|
| 1,000 | 1,112 | 6 | 6,600 | 125 | 100 paths |
| 16,000 | 17,012 | 6 | 102,000 | 2,000 | 1,000 |
| 43,000 | 44,012 | 6 | 264,000 | 5,375 | 1,000 |
| 250,000 | 251,012 | **3** | 756,000 | 31,250 | 1,000 |

At 250k the profile uses 3 anchors per path, not 4: at 4, `duplicate` and `commitTrace` would hit the 1M anchor cap and the run would time rejected transactions. Dispatch cost follows node count, not anchors.

**Transactions:**
- `setFill1`, one path;
- `setFillMany`, 1,000 paths spread over the main layer (at 1k, all of them);
- `setVisible`, `rename`;
- `reorder`, a path to index 0 of its group;
- `applyTransformPath`, a translation of one path;
- `applyTransformLayer`, a translation of the 250k-path layer;
- `group`, 10 siblings;
- `ungroup`, the 10-path group;
- `delete` and `duplicate`, one path;
- `commitTrace`, replacing the replace layer with a fresh 1,000-path packet;
- `undo` and `redo`.

**Stages.** `dispatch` is not instrumented, because `session.ts` stays unchanged. Each stage is rebuilt from exported pieces. Per repetition:
1. An untimed `setArtboard` dispatch gives a **fresh state object S**, so the per-state caches are cold, as after any real commit.
2. `session.dispatch(cmd)` on S is timed (the real end-to-end cost).
3. `undo()` and `redo()` are timed, then an untimed `undo()` returns to S. Document size stays fixed, and history fills to its 100-entry steady state.
4. Shadow stages run on C, a shallow clone of S: same maps, new identity, so `parents()` is cold again.
   - **copy**: `new SealedMap(nodesById)` plus the root-list copy, exactly the Draft constructor.
   - **copy + publish**: `applyCommand(C, setArtboard with unchanged values)`, which is Draft creation plus `finish` and nothing else.
   - **apply (cold)**: `applyCommand(C, cmd)`; **apply (warm)**: the same again, with `parents(C)` memoised.
   - **validate**: `validateState(next)`.
   - **prototype**: `checkIncremental(...)`, whose result is cross-checked against `validateState` on every repetition.

Per-repetition derivations, never by subtracting medians:
- publish = (copy + publish) − copy;
- command (cold or warm) = apply − (copy + publish);
- history + publication residual = dispatch − apply (cold) − validate.

`gc()` runs between phases, outside timed sections. 2 warm-up repetitions, then 30 measured repetitions. Statistics are p50, p95 (nearest rank) and max.

**Runs.**

| Run | Commit | Notes | Load (1-min average), start → end |
|---|---|---|---|
| `profile-run1` | `6f8a83f` | First run. One-node `command` medians came out **negative** (−0.6 to −3 ms): the copy + publish probe was the first large allocation after `gc()` and paid for it. Kept as recorded | 2.33 → 4.29. A Playwright WebKit session was at 34 % CPU at the start; 0 `ngspice` |
| `profile-run2` (**primary**) | `20da63e` | An untimed warm-up apply before the timed copy and probe; the prototype resolves a root's parent without `parents()` | 3.36 → 4.72; 0 `ngspice` |
| `differential` | `d794428` | Prototype identical to `20da63e`. The harness reaches the anchor cap and forges bad palette and style entries: the first record (`056ff6c`) never produced a `budget` rejection, so it was replaced | not timing-sensitive |

Neither profiling run is **quiet**. Dispatch, validation and copy medians agree between the runs within about 10 % at ≤ 43k. At 250k they spread more (e.g. `commitTrace` 157 vs 191 ms), with load rising during the run. Run 1's publish medians were inflated by the allocation artefact: 1.0 vs 0.42 ms at 16k, 2.1 vs 1.2 ms at 43k.

## 3. Results (run 2)
### 3.1 Stage profile
All times are in ms. **copy** is the node-map copy; **publish** is `Draft.finish`; **command** is the command's own work with `parents()` cold, and warm in parentheses; **history** is the history and publication residual. **val %** and **copy %** are each stage's share of the median dispatch. The prototype column gives the median followed by diff / `parents` / checks.

**1,000 paths** (1,112 nodes; load 3.17 → 3.17)

| Transaction | dispatch p50 / p95 / max | validateState p50 / p95 / max | copy | publish | command cold (warm) | history | val % | copy % | prototype: p50 (diff / parents / checks) |
|---|---|---|---|---|---|---|---|---|---|
| setFill1 | 0.77 / 0.85 / 1.01 | 0.58 / 0.64 / 0.66 | 0.04 | 0.06 | 0.09 (0.10) | -0.01 | 75 | 13 | 0.04 (0.03 / 0.00 / 0.01) |
| setFillMany | 1.04 / 1.16 / 1.23 | 0.58 / 0.66 / 0.68 | 0.04 | 0.06 | 0.36 (0.40) | -0.01 | 56 | 10 | 0.50 (0.02 / 0.00 / 0.48) |
| setVisible | 0.67 / 0.73 / 0.76 | 0.57 / 0.63 / 0.64 | 0.04 | 0.07 | 0.00 (0.02) | -0.01 | 85 | 15 | 0.03 (0.02 / 0.00 / 0.01) |
| rename | 0.68 / 0.79 / 0.80 | 0.60 / 0.67 / 0.70 | 0.04 | 0.07 | 0.00 (0.02) | -0.02 | 89 | 15 | 0.03 (0.02 / 0.00 / 0.01) |
| reorder | 0.69 / 0.75 / 0.75 | 0.57 / 0.60 / 0.61 | 0.04 | 0.07 | 0.04 (0.02) | -0.03 | 82 | 15 | 0.06 (0.02 / 0.00 / 0.04) |
| applyTransformPath | 0.68 / 0.73 / 0.77 | 0.58 / 0.62 / 0.63 | 0.04 | 0.07 | 0.00 (0.02) | -0.01 | 85 | 15 | 0.07 (0.02 / 0.04 / 0.01) |
| applyTransformLayer | 0.68 / 0.75 / 0.76 | 0.57 / 0.63 / 0.64 | 0.04 | 0.07 | 0.00 (0.02) | -0.01 | 84 | 15 | 0.21 (0.02 / 0.00 / 0.19) |
| group | 0.79 / 0.84 / 0.85 | 0.57 / 0.60 / 0.62 | 0.04 | 0.07 | 0.13 (0.12) | -0.02 | 72 | 13 | 0.07 (0.02 / 0.00 / 0.05) |
| ungroup | 0.72 / 0.80 / 0.81 | 0.59 / 0.65 / 0.66 | 0.04 | 0.07 | 0.04 (0.03) | -0.01 | 82 | 14 | 0.15 (0.05 / 0.00 / 0.10) |
| delete | 0.79 / 0.88 / 0.94 | 0.57 / 0.63 / 0.77 | 0.04 | 0.06 | 0.13 (0.12) | -0.01 | 72 | 13 | 0.08 (0.04 / 0.00 / 0.04) |
| duplicate | 0.81 / 0.87 / 0.89 | 0.58 / 0.63 / 0.63 | 0.04 | 0.06 | 0.13 (0.12) | -0.02 | 72 | 13 | 0.06 (0.02 / 0.00 / 0.05) |
| commitTrace | 0.95 / 1.14 / 1.16 | 0.59 / 0.65 / 0.66 | 0.04 | 0.06 | 0.17 (0.20) | 0.09 | 62 | 11 | 0.22 (0.04 / 0.00 / 0.18) |

**16,000 paths** (17,012 nodes; load 3.17 → 3.54)

| Transaction | dispatch p50 / p95 / max | validateState p50 / p95 / max | copy | publish | command cold (warm) | history | val % | copy % | prototype: p50 (diff / parents / checks) |
|---|---|---|---|---|---|---|---|---|---|
| setFill1 | 9.70 / 10.2 / 10.3 | 6.84 / 7.27 / 7.36 | 0.80 | 0.43 | 1.42 (1.75) | 0.22 | 71 | 13 | 0.33 (0.30 / 0.00 / 0.02) |
| setFillMany | 9.94 / 10.1 / 10.1 | 6.83 / 6.92 / 6.93 | 0.80 | 0.42 | 1.70 (2.07) | 0.22 | 69 | 12 | 0.84 (0.32 / 0.00 / 0.53) |
| setVisible | 8.22 / 8.37 / 8.49 | 6.89 / 7.01 / 7.03 | 0.80 | 0.42 | 0.00 (0.29) | 0.09 | 84 | 15 | 0.33 (0.31 / 0.00 / 0.02) |
| rename | 8.24 / 8.40 / 8.41 | 6.83 / 6.97 / 7.00 | 0.80 | 0.42 | 0.01 (0.31) | 0.13 | 83 | 15 | 0.33 (0.30 / 0.00 / 0.02) |
| reorder | 9.01 / 9.15 / 10.7 | 6.85 / 7.00 / 7.11 | 0.79 | 0.41 | 0.76 (0.34) | 0.16 | 76 | 13 | 0.79 (0.31 / 0.00 / 0.49) |
| applyTransformPath | 8.30 / 8.66 / 8.80 | 6.88 / 7.11 / 7.22 | 0.80 | 0.42 | 0.01 (0.32) | 0.20 | 83 | 15 | 1.07 (0.31 / 0.72 / 0.03) |
| applyTransformLayer | 8.29 / 8.47 / 8.55 | 6.88 / 7.00 / 7.05 | 0.80 | 0.42 | 0.00 (0.30) | 0.15 | 83 | 15 | 3.15 (0.31 / 0.00 / 2.84) |
| group | 10.6 / 10.8 / 10.9 | 6.90 / 7.09 / 7.09 | 0.80 | 0.41 | 2.23 (1.93) | 0.21 | 65 | 11 | 0.76 (0.31 / 0.00 / 0.44) |
| ungroup | 9.08 / 9.18 / 9.18 | 6.89 / 7.00 / 7.05 | 0.80 | 0.42 | 0.74 (0.34) | 0.22 | 76 | 13 | 1.55 (0.61 / 0.00 / 0.94) |
| delete | 10.5 / 10.6 / 10.7 | 6.95 / 7.06 / 7.10 | 0.80 | 0.43 | 2.10 (1.78) | 0.20 | 66 | 12 | 0.98 (0.61 / 0.00 / 0.36) |
| duplicate | 10.6 / 10.8 / 11.1 | 6.93 / 7.07 / 7.09 | 0.80 | 0.42 | 2.13 (1.83) | 0.26 | 66 | 12 | 0.68 (0.31 / 0.00 / 0.37) |
| commitTrace | 9.58 / 10.5 / 11.2 | 6.94 / 7.40 / 7.51 | 0.82 | 0.42 | 1.09 (1.43) | 0.45 | 72 | 13 | 1.69 (0.68 / 0.00 / 1.00) |

**43,000 paths** (44,012 nodes; load 3.54 → 2.52)

| Transaction | dispatch p50 / p95 / max | validateState p50 / p95 / max | copy | publish | command cold (warm) | history | val % | copy % | prototype: p50 (diff / parents / checks) |
|---|---|---|---|---|---|---|---|---|---|
| setFill1 | 26.0 / 27.0 / 27.1 | 18.1 / 18.9 / 20.3 | 2.10 | 1.18 | 3.23 (4.13) | 1.28 | 70 | 13 | 0.93 (0.91 / 0.00 / 0.02) |
| setFillMany | 26.5 / 28.7 / 29.2 | 18.3 / 19.6 / 19.8 | 2.12 | 1.19 | 3.65 (4.60) | 1.41 | 69 | 13 | 1.30 (0.94 / 0.00 / 0.36) |
| setVisible | 22.2 / 22.9 / 24.0 | 18.3 / 19.4 / 26.7 | 2.11 | 1.20 | 0.01 (0.37) | 0.61 | 82 | 15 | 0.94 (0.92 / 0.00 / 0.02) |
| rename | 22.3 / 22.9 / 23.6 | 18.3 / 18.8 / 20.7 | 2.10 | 1.19 | 0.01 (0.43) | 0.66 | 82 | 15 | 0.94 (0.93 / 0.00 / 0.02) |
| reorder | 24.4 / 25.3 / 26.3 | 18.5 / 18.9 / 19.0 | 2.10 | 1.21 | 1.53 (0.43) | 1.13 | 76 | 14 | 2.00 (0.92 / 0.00 / 1.08) |
| applyTransformPath | 22.5 / 22.8 / 22.8 | 18.4 / 18.7 / 20.8 | 2.11 | 1.22 | 0.00 (0.39) | 0.71 | 82 | 15 | 2.80 (0.93 / 1.85 / 0.03) |
| applyTransformLayer | 22.5 / 24.9 / 26.2 | 18.6 / 20.9 / 21.3 | 2.12 | 1.21 | 0.02 (0.41) | 0.56 | 83 | 15 | 8.24 (0.93 / 0.00 / 7.32) |
| group | 28.4 / 28.9 / 29.0 | 18.4 / 18.6 / 18.8 | 2.10 | 1.22 | 5.42 (4.50) | 1.29 | 65 | 12 | 2.05 (0.92 / 0.00 / 1.12) |
| ungroup | 24.6 / 25.5 / 28.1 | 18.5 / 19.1 / 19.4 | 2.11 | 1.23 | 1.44 (0.39) | 1.25 | 75 | 14 | 4.03 (1.77 / 0.00 / 2.27) |
| delete | 28.2 / 28.9 / 29.1 | 18.5 / 19.6 / 20.4 | 2.11 | 1.22 | 5.15 (4.09) | 1.06 | 66 | 12 | 2.79 (1.76 / 0.00 / 1.00) |
| duplicate | 28.5 / 29.9 / 31.9 | 18.7 / 19.7 / 19.9 | 2.13 | 1.22 | 5.29 (4.28) | 0.95 | 66 | 12 | 1.97 (0.93 / 0.00 / 1.03) |
| commitTrace | 23.9 / 24.8 / 25.4 | 18.6 / 19.2 / 19.6 | 2.12 | 1.21 | 0.71 (1.54) | 1.37 | 78 | 14 | 2.93 (1.88 / 0.00 / 1.03) |

**250,000 paths** (251,012 nodes; load 2.52 → 4.72)

| Transaction | dispatch p50 / p95 / max | validateState p50 / p95 / max | copy | publish | command cold (warm) | history | val % | copy % | prototype: p50 (diff / parents / checks) |
|---|---|---|---|---|---|---|---|---|---|
| setFill1 | 176 / 210 / 227 | 114 / 137 / 140 | 14.7 | 7.96 | 28.7 (34.3) | 9.52 | 65 | 13 | 9.16 (9.13 / 0.00 / 0.03) |
| setFillMany | 177 / 221 / 239 | 113 / 136 / 143 | 14.8 | 7.34 | 29.7 (35.7) | 13.0 | 64 | 13 | 10.3 (9.72 / 0.00 / 0.56) |
| setVisible | 144 / 171 / 173 | 120 / 154 / 186 | 15.3 | 8.19 | -0.08 (2.58) | 0.37 | 83 | 16 | 10.2 (10.2 / 0.00 / 0.03) |
| rename | 154 / 178 / 181 | 125 / 150 / 152 | 16.2 | 8.05 | -0.47 (2.48) | -2.04 | 81 | 16 | 9.99 (9.96 / 0.00 / 0.03) |
| reorder | 175 / 189 / 190 | 129 / 142 / 145 | 17.4 | 8.30 | 13.6 (2.73) | 4.40 | 74 | 15 | 18.7 (10.1 / 0.00 / 8.41) |
| applyTransformPath | 158 / 176 / 177 | 130 / 146 / 154 | 15.9 | 8.80 | -0.14 (2.48) | 6.71 | 82 | 16 | 24.1 (10.2 / 13.6 / 0.04) |
| applyTransformLayer | 161 / 192 / 197 | 130 / 170 / 175 | 16.7 | 7.42 | 0.97 (1.65) | 3.60 | 81 | 15 | 66.3 (10.4 / 0.00 / 55.5) |
| group | 183 / 194 / 236 | 113 / 123 / 126 | 14.7 | 7.25 | 42.5 (36.4) | 4.03 | 62 | 12 | 17.7 (9.44 / 0.00 / 8.22) |
| ungroup | 156 / 163 / 170 | 114 / 160 / 190 | 14.8 | 7.24 | 12.0 (3.14) | 7.26 | 73 | 14 | 35.1 (19.9 / 0.00 / 15.1) |
| delete | 185 / 210 / 219 | 116 / 123 / 125 | 15.0 | 7.98 | 42.1 (33.1) | 2.63 | 63 | 12 | 25.3 (18.7 / 0.00 / 6.46) |
| duplicate | 190 / 224 / 226 | 120 / 161 / 163 | 15.5 | 7.76 | 43.1 (35.7) | 0.58 | 63 | 12 | 16.0 (9.13 / 0.00 / 6.90) |
| commitTrace | 191 / 205 / 210 | 152 / 169 / 174 | 22.3 | 10.4 | 2.75 (4.41) | 2.63 | 80 | 18 | 27.1 (25.6 / 0.00 / 1.40) |

Medians of the per-repetition differences can be slightly negative (one-node `command` at 250k, some `history` residuals): these are below the method's resolution, about ±3 ms at 250k. Run 1's tables are in `profile-run1.json`; its medians differ as described in §2.

### 3.2 Undo and redo
Undo and redo medians are ≤ 0.01 ms at every size, and the maximum over all repetitions is 0.01 ms in run 2 (0.07 ms in run 1). They swap validated states and run no validation or copy, which confirms TD-PERF-007's < 0.03 ms.

### 3.3 O(nodes) work outside validation and copying
| Pass | Where | 43k | 250k | Note |
|---|---|---|---|---|
| `Draft.finish` changed-entry scan | `commands.ts` `finish` → `freezeChanged`: one `base.get` per node, on every transaction | 1.2 ms | 7–10 ms | part of "publish" |
| `sealMap` re-copy of already-sealed maps | `model.ts` `sealMap`: `finish` copies `stylesById`, `paletteById` and `sourceAssetsById` **even when unchanged**, because a sealed map is copied, not reused | small | small | Grows with the style map: `setFill` allocates new styles and nothing removes replaced ones |
| `documentOrder` (whole-tree walk) | every `setFill`, and `topLevel` (`delete`, `duplicate`, `group`, `reparent`) **even for one target** | 3.6 ms | 29 ms | inside "command" |
| `parents()` cold | `topLevel`, `reorder`, `ungroup`; memoised per state object (`src/shell/document.ts` also calls it, so it may be warm in the app) | 1.9 ms | 12.3 ms | cold vs warm "command" |
| Child-list rewrite | `reorder`, `group`, `delete` and `duplicate` copy or filter a sibling array (31,250 per group at 250k) | < 1 ms | 1–10 ms | inherent to array lists |
| Packet validation in `commitTrace` | `GeometryStore.commit` validate (1,000 paths) | 0.61 ms | 0.70 ms | O(packet), not O(document) |

### 3.4 Structural-sharing candidates (standalone micro-benchmark on the real node maps)
A **chunked copy-on-write map** keeps a directory of B native Maps (bucket = ID number mod B). A draft copies the directory and, on first write to a bucket, that bucket only. 15 repetitions. "Heap per state" is the retained heap of 20 states that each differ from the base by one entry, measured after `gc()` and divided by 20.

| Nodes | Candidate | copy + 1 write p50 / p95 / max (ms) | 100k gets p50 (ms) | full iteration p50 (ms) | heap per one-change state |
|---|---|---|---|---|---|
| 44,012 | native `Map` (current) | 1.87 / 1.94 / 1.94 | 2.39 | 0.23 | 1.75 MiB |
| 44,012 | chunked, 256 buckets | 0.01 / 0.02 / 0.02 | 6.28 | 0.74 | 0.009 MiB |
| 44,012 | chunked, 1,024 buckets | 0.01 / 0.01 / 0.01 | 6.70 | 0.75 | 0.010 MiB |
| 251,012 | native `Map` (current) | 13.5 / 15.2 / 15.2 | 6.77 | 1.50 | **7.0 MiB** |
| 251,012 | chunked, 256 buckets | 0.07 / 0.11 / 0.11 | 18.7 | 4.34 | 0.030 MiB |
| 251,012 | chunked, 1,024 buckets | 0.03 / 0.04 / 0.04 | 19.2 | 4.25 | 0.015 MiB |
| 251,012 | chunked, 4,096 buckets | 0.01 / 0.02 / 0.02 | 20.0 | 4.55 | 0.033 MiB |

1k and 16k are in the JSON. Copy falls by 2–3 orders of magnitude. Gets are 2.5–3× slower (about 0.19 µs vs 0.07 µs at 250k), iteration is about 3× slower, and iteration order becomes bucket order. History memory per entry falls from megabytes to kilobytes.

## 4. Invariant analysis
### 4.1 What the full validator checks
`validateState` (`src/document/invariants.ts`) makes one pass over the whole state and throws the first violation it meets. The order is: document → palette → styles → assets → node count → nodes in map order → tree in pre-order → reachability → anchor budget. On success it returns the derived data the session caches: chunk reference counts, anchors counted per reference, and the highest ID number.

| # | Invariant | Scope | Error code |
|---|---|---|---|
| G1 | `documentId` follows the scene-v1 ID rule | document | invariant |
| G2 | Artboard 0 < w, h ≤ 16,384; background null or RGBA8888 | document | invariant |
| I1 | Map key = entry `id`; `id` matches `NODE_ID_RE` with the prefix of its map or kind | per entry | invariant |
| I2 | ID **numbers** are unique across palette, styles, assets and nodes (one number space; leading zeros allowed, so `pth_007` and `sty_7` collide) | **all four maps** | invariant |
| P1–P2 | Palette: name follows the scene-v1 rule; colour is RGBA8888 | per entry | invariant |
| S1–S5 | Style: fill is RGBA8888; `paletteRef` exists; fill and `paletteRef` are exclusive; fill or stroke present; stroke valid | per entry, plus a palette reference | invariant |
| A1–A6 | Asset: digest, MIME type, dimensions, `embedded`, `decodePolicy`, provenance | per entry | invariant |
| N0 | Node count ≤ `maxNodes` | global, O(1) | invariant |
| N1–N3 | Name: a string, ≤ `maxNameLength`, well-formed Unicode; boolean flags | per node | invariant |
| N4 | `localTransform`: finite, \|v\| ≤ 1e9, non-singular, κ ≤ 1e8 | per node | invalid_transform |
| N5 | `clipRef` only on layers and groups; rect finite and positive | per node | clip_unsupported / invariant |
| N6 | Path: chunk live, `pathIndex` in range, style exists, valid `fillRule` | per node, plus the store and a style reference | invariant |
| N7 | Source: asset exists; `sourceToDocument` valid | per node, plus an asset reference | invariant / invalid_transform |
| N8 | Container: `orderedChildIds` is an array; layer `traceProvenance` valid; groups have none | per node | invariant |
| T1 | Depth ≤ `maxDepth` | **ancestor chain** | invariant |
| T2 | Every child reference exists | per list | invariant |
| T3 | No node is visited twice (no second parent, no reachable cycle) | **global** | invariant |
| T4 | Parent-kind rule: root → layer or source; layer or group → group or path | per edge | invariant |
| T5 | Composed transform finite, for paths and containers | **ancestor chain** | invalid_transform |
| T6 | Clipped container under an axis-preserving composed transform | **ancestor chain** | clip_transform_unsupported |
| T7 | Every node reachable (no orphans or detached cycles) | **global** | invariant |
| B1 | Anchors (per reference) ≤ `maxAnchors` | **global sum** | budget |
| D | Derived data: chunk reference counts, anchors, `maxIdNumber` | **global** | — |

### 4.2 What each command can break, and the local check that suffices
"Touched" means entries the command writes. The prototype obtains them by diffing entry identity (§5.1); adopting it would mean the Draft records them. The last column is the inherent part: invariants T1, T5 and T6 depend on the ancestor chain, so changing a node's transform or position re-checks its whole subtree.

| Command | Can break | Sufficient local check | Cost beyond touched entries |
|---|---|---|---|
| `setVisible`, `setLocked`, `rename` | N1–N3 on the touched nodes | the touched nodes' own fields | none |
| `setFill` | S1–S5 on new styles; N6 style reference | new styles; touched paths | none |
| `setPaletteColor` | P2 | one entry | none |
| `setArtboard` | G2 | the artboard | none |
| `setTransform`, `applyTransform`, `rotate90` | N4; T5 and T6 below the node | the node; composed transforms over its subtree | O(subtree): O(depth) for a path, the **whole layer** for a layer transform |
| `setClip`, `releaseClip` | N5; T6 for the node itself | the node; its composed transform (ancestor chain) | O(depth) |
| `reorder` | nothing (same members) | the reference delta of one list | O(siblings): the list is an array |
| `reparent` | T1, T3, T4, T5, T6, T7 | reference delta; kind rule on new edges; an upward walk from the new parent (cycle and depth); a downward walk of the moved subtrees | O(moved subtree + depth) |
| `group` | T1 (one level deeper), T4 | as `reparent`, for the grouped children | O(grouped subtrees) |
| `ungroup` | T5, T6 (children get the product transform), T1 | as `reparent`, plus a transform recheck of the lifted children | O(the group's subtree) |
| `delete` | T2 (a dangling reference if the parent list is not updated); a removed asset still referenced; D (anchors, chunks; `maxIdNumber` may fall) | a balanced reference delta over removed nodes; a source-node check against removed assets (sources are roots only) | O(removed subtree); a key scan only if the highest ID is deleted |
| `duplicate` | I2 (new IDs); B1 (anchors rise); T1–T6 for the copies | new IDs above the previous maximum; anchor delta; walk the copies | O(copied subtree) |
| `commitTrace` | everything for the new layer; B1; I2; P1–P2, S1–S5 for new entries | as `duplicate`, plus new palette entries and styles; the packet itself is validated by `GeometryStore.commit` | O(new content), plus O(replaced subtree) for a replace |
| `bake` | N6 (new chunk, `pathIndex`), N4 and T5 (transform reset), D | touched paths; the path's ancestor chain | O(targets · depth) |
| `attachSource` | A1–A6, I2, T4 | the new asset and node; the root list | O(roots) |

Invariants that are **not local** whatever the command, and what the prototype does about each:
- **I2, ID-number uniqueness.** It spans four maps, and leading zeros alias numbers. The allocator is monotonic, so the prototype accepts a new key only if its number is above the previous `maxIdNumber` and unique among the transaction's new keys. Otherwise it answers *undecided*.
- **D, `maxIdNumber`.** It can only fall when the entry holding the maximum is removed. The prototype then rescans the keys, which is O(nodes) but cheap per key. In dispatch the value is never read: only the session constructor uses it, against `nextId`.
- **Removed referents.** A removed style or palette entry invalidates unchanged referrers, which needs a reverse index. No command removes either, so the prototype answers *undecided*. A removed asset is checked against the root list, because only roots can be sources in a valid tree.
- **T3 and T7, one parent and reachability.** prev is a valid tree, so every prev node has exactly one reference. The prototype sums ±1 for each entry of every changed, added or removed child list, and of the root list if its content changed. The sum must be exactly 1 for nodes in next and 0 otherwise. Unchanged lists keep their references.
- **Cycles.** A new cycle must contain a new edge. The prototype walks up from the parent of every new edge; a chain longer than `maxDepth` is a cycle or too deep, and the answer is *undecided*. Parents come first from the patched child lists, then from the root list, then from `parents(prev)`. That memoised map costs O(nodes) when cold, and is the second O(nodes) pass the prototype keeps.
- **T1, T5, T6.** The prototype re-walks every moved, added or re-transformed subtree, starting from a composed transform built top-down from the ancestor chain. Built that way, the transform is bit-identical to the full pass.

## 5. Prototype incremental validator
### 5.1 Design (`src/document/incremental-validate.ts`)
`checkIncremental(prev, prevDerived, next, store, limits)` is **fast-accept only**. It returns one of two answers:
- the `StateDerived` that `validateState(next)` would return, meaning *proved valid*;
- `{ derived: null, reason }`, meaning *undecided*: run the full pass.

It never rejects on its own. On *undecided* the caller runs `validateState`, which accepts or throws its canonical first error. So a wired version would report exactly today's errors by construction: reproducing the full pass's first-error order from a touched set is not worth the code.

How it works:
1. **Change set.** An identity diff of each map: entries whose value is not the same object as in prev, plus removed keys. The node-map diff is O(nodes): 0.9 ms at 44k and 9–10 ms at 251k, twice that when nodes are removed.
2. **Local checks.** Copies of the full pass's per-entry rules, run on added or updated entries only. `invariants.ts` is left unchanged, so the two are independent implementations.
3. **IDs** (I2 and `maxIdNumber`) as in §4.2.
4. **Derived data by delta.** Chunk reference counts and anchors are adjusted by ±1 per removed, updated or added path; a chunk whose count reaches 0 is dropped.
5. **Tree** as in §4.2.
6. **Anchor budget** on the delta.

Preconditions, stated in the module:
- `prev` passed `validateState` with the same store and limits, and `prevDerived` is that result.
- prev's chunks are still live, which is true inside `dispatch`, where prev stays owned until publication.

Not wired, and load is unaffected: `loadContainer` builds a `DocumentSession`, whose constructor calls `validateState`. The unit test asserts that no production module under `src/document` or `src/persistence` mentions the prototype.

### 5.2 Differential test
`src/document/testing/incremental-differential.ts` is one harness, shared by the unit test (which asserts) and by `--differential` (which records). Sessions are built from seeded synthetic packets and restarted every 150 transactions, with random limits: `maxDepth` of 4, 5 or 64; `maxNodes` of 150 or 2M; `maxAnchors` of 30–330 in a third of the episodes, otherwise 2k–22k. Undo and redo move between states before about 12 % of transactions. Each transaction belongs to one class:

| Class | What | Validators run? |
|---|---|---|
| command-rejected | 1–3 random commands; one throws in `applyCommand`. Examples: reparent into its own subtree (**cycles via reparent**), **dangling IDs**, `setFill` with a **missing palette reference**, bad indices | no (as in `dispatch`) |
| command | 1–3 random commands of all 20 types, including **invalid transforms** (singular, ill-conditioned, NaN), skew and 45° rotation under clips, lone-surrogate and over-long names, bad artboards and bad asset digests. Both validators run on the shadow-applied state before `store.settle()`; then the real `dispatch` advances the session and must reach the same verdict | both |
| forged | 1–2 direct edits of prev's maps that bypass the commands (a model of a command bug). Invalid edits: cycles, second parents, orphans, dangling children, dangling styles, bad palette references, removed styles, palette entries or assets, key ≠ id, duplicate ID numbers (including leading zeros), kind-rule breaks, deep chains (depth limit and composed-transform overflow), clips (bad rect, on a path, under rotation), anchor-budget and node-count overflow, bad palette and style entries, local corruption, bad artboard and document ID. Valid edits: rename, move, reorder, a new list with the same content, add a path, delete a path, delete the highest ID, recolour | both |

A **disagreement** is either:
- the prototype accepting a state the full validator rejects; or
- the prototype accepting with derived data that differs from the full validator's: anchors, `maxIdNumber`, or the chunk counts compared as a set. No consumer depends on chunk order: `saveContainer` sorts, and `#own` and `#entryBytes` do not care.

*Undecided* on a valid state is a missed fast path, not a disagreement. In a wired version it costs one full pass.

**Results** (`differential.json`; 16,000 transactions per seed):

| Seed | Validator-reached comparisons | Full rejected | Full accepted | Decided locally | Undecided on valid | Command-rejected | No-ops | Disagreements | Time |
|---|---|---|---|---|---|---|---|---|---|
| **20261125** (unit test) | **12,427** | 4,767 | 7,660 | 7,573 | 87 | 3,230 | 343 | **0** | 0.76 s |
| 1 | 12,448 | 4,741 | 7,707 | 7,633 | 74 | 3,210 | 342 | **0** | 0.64 s |
| 2 | 12,450 | 4,649 | 7,801 | 7,714 | 87 | 3,248 | 302 | **0** | 0.60 s |
| 3 | 12,385 | 4,688 | 7,697 | 7,629 | 68 | 3,285 | 330 | **0** | 0.61 s |
| 4 | 12,414 | 4,617 | 7,797 | 7,718 | 79 | 3,226 | 360 | **0** | 0.59 s |
| **Total** | **62,124** | 23,462 | 38,662 | 38,267 | 395 | 16,199 | 1,677 | **0** | |

- **The prototype never accepted an invalid state:** all 23,462 rejections were *undecided*. The full validator's codes were `invariant` 20,719, `invalid_transform` 1,934, `budget` 353, `clip_unsupported` 233 and `clip_transform_unsupported` 223.
- **Valid states from real commands: 100 % decided locally** for every command type, and for multi-command transactions. That is 29,007 of 29,007 valid command states; the other 5,050 of the 34,057 command states were invalid.
- **Undecided on valid states:** 390 forged removals of an unreferenced style and 5 of an unreferenced palette entry. These are conservative by design (§4.2), and no command removes either.
- **Coverage per forged class** (all seeds, single-forgery transactions). The invalid classes were rejected by the full validator every time, and the prototype never accepted them: cycle 808, second-parent 800, orphan 785, dangling-child 779, dangling-style 777, bad-palette-ref 824, dup-number 662, key-mismatch 775, kind 808, remove-asset 553, remove-palette 774, bad-local 758. In the mixed classes, every valid state was decided: bad-entry 763 (564 invalid), deep-chain 780 (499), transform 742 (244), clip 789 (274), budget 774 (322: anchor cap or node count), artboard 797 (592), document-id 757 (378), rename 781 (217), move 730 (45), add-path 762 (6). Full counts per class and per command type are in the JSON.
- **Not covered by construction:** `history_budget` (the harness's history limit is 128 MiB) and limits changing between prev and next. The prototype assumes the same limits; dispatch never changes them.

## 6. Options compared
Every figure in this section is an **estimate by composition** from the run 2 stage medians, not a measurement of the combined code. "B" is dispatch − `validateState` + prototype.

| Paths | Transaction | Measured dispatch p50 | B (estimate) | O(nodes) still inside B: copy / publish / diff / `parents` / command |
|---|---|---|---|---|
| 43k | setVisible | 22.2 | 4.9 | 2.1 / 1.2 / 0.9 / 0 / 0 |
| 43k | setFill1 | 26.0 | 8.8 | 2.1 / 1.2 / 0.9 / 0 / 3.2 |
| 43k | applyTransformPath | 22.5 | 6.8 | 2.1 / 1.2 / 0.9 / 1.9 / 0 |
| 43k | applyTransformLayer | 22.5 | 12.1 | 2.1 / 1.2 / 0.9 / 0 / 0, plus a 7.3 ms layer walk |
| 43k | group | 28.4 | 12.1 | 2.1 / 1.2 / 0.9 / 0 / 5.4 |
| 43k | delete | 28.2 | 12.4 | 2.1 / 1.2 / 1.8 / 0 / 5.2 |
| 43k | duplicate | 28.5 | 11.7 | 2.1 / 1.2 / 0.9 / 0 / 5.3 |
| 43k | commitTrace | 23.9 | 8.3 | 2.1 / 1.2 / 1.9 / 0 / 0.7 |
| 250k | setVisible | 144 | 34 | 15 / 8 / 10 / 0 / 0 |
| 250k | setFill1 | 176 | 71 | 15 / 8 / 9 / 0 / 29 |
| 250k | applyTransformPath | 158 | 52 | 16 / 9 / 10 / 14 / 0 |
| 250k | applyTransformLayer | 161 | 98 | 17 / 7 / 10 / 0 / 1, plus a 56 ms layer walk |
| 250k | group | 183 | 87 | 15 / 7 / 9 / 0 / 43 |
| 250k | delete | 185 | 94 | 15 / 8 / 19 / 0 / 42 |
| 250k | duplicate | 190 | 86 | 16 / 8 / 9 / 0 / 43 |
| 250k | commitTrace | 191 | 65 | 22 / 10 / 26 / 0 / 3 |

All 12 types at 16k, 43k and 250k are in the JSON; B at 43k ranges from 4.9 to 12.4 ms.

| Option | What changes | Copy cost | History memory | Complexity and risk |
|---|---|---|---|---|
| **A. Status quo** | — | O(nodes) per transaction: 15 + 8 ms at 250k | one full node-map table per history state: about 7 MiB at 250k (measured per state), uncounted by the history budget | none |
| **B. Fast-accept incremental validation**, wired as `checkIncremental(…).derived ?? validateState(next)` | `dispatch` only; one new module | unchanged | unchanged | Medium. The per-entry rules are duplicated, so every future invariant must be added to both validators, and a forgery added to the harness. Kept honest by the differential test in `vp test` (< 1 s). Errors unchanged: rejections come from the full pass |
| **C. B plus a Draft write log** | `commands.ts` internals: the Draft records written keys (`SealedMap` is the only write path, so the log is complete); `finish` freezes logged entries only; `sealMap` stops copying already-sealed maps; `documentOrder` is computed only for multi-target ordering, or from ancestor chains | removes the diff and the publication scan: about 18 ms at 250k, 2 ms at 43k. The Map copy stays | unchanged | Low to medium; no change to semantics or format |
| **D. C plus structural sharing**: a chunked copy-on-write `nodesById` of about √n buckets, plus a persistent parent index. About 100 lines, no dependency | `DocState.nodesById` becomes a `ReadonlyMap`-compatible class. This is the **authoritative document architecture** and needs approval | 13.5 ms → 0.01–0.07 ms at 250k; cold `parents` (12 ms) becomes O(depth) | about 7 MiB → about 0.015–0.03 MiB per state at 250k, so about 700 MiB → about 3 MiB for 100 entries (extrapolated) | Medium to high. Gets 2.5–3× slower, iteration about 3× slower. Iteration order becomes bucket order: the full pass's *first* error message on a multi-defect file may change (still rejected). Persistence unaffected (canonical JSON sorts keys). Consumers use only the `ReadonlyMap` surface: no `instanceof Map`, no structured cloning of states. Checked: the renderer receives a `RenderSnapshot` (evaluated runs and draw list, `src/renderer/snapshot.ts`), not `DocState`; `src/jobs/controller.ts` only calls `get` and `has`; `structuredClone` is never applied to a state |
| **E. A faster full pass** (constant factors) | `invariants.ts` | — | — | Not pursued: the full validator is the oracle and stays unchanged. Still O(nodes) |

Estimated after B + C + D at 250k:
- one-node edits: about 1–3 ms (history residual plus local checks);
- `group`, `delete`, `duplicate`: roughly 10–20 ms, mostly the 31,250-entry sibling array;
- **a whole-layer transform: still about 56 ms**, the O(subtree) walk that T5 and T6 require.

Two costs survive every option:
1. **Container transforms are O(subtree).** Meeting ≤ 50 ms for a whole-layer transform at 250k would need per-subtree summaries. For example, for a translation-only change, a cached bound on the subtree's composed translation entries proves finiteness, and the linear part, and so the clip rule, is unchanged. This is not prototyped, and the summaries would themselves need incremental maintenance.
2. **Child lists are arrays.** Structural edits copy or scan a sibling array, measured at 1–10 ms with 31,250 siblings.

## 7. Recommendation (not adoption)
Changing what `dispatch` runs is the maintainer's decision. Nothing is wired on this branch.
1. **Keep the full validator as it is**, as the oracle and as the only path for load, import and recovery (`loadContainer` → `DocumentSession` constructor). This branch preserves both.
2. **Approve option B for G-EDIT**: wire `checkIncremental(prev, derived(prev), next).derived ?? validateState(next)` in `dispatch`, with:
   - the differential test kept in `vp test` (seed 20261125: 12,427 validator-reached comparisons, zero disagreements), with the seed and count as a frozen minimum;
   - in tests and development builds, a switch that also runs `validateState` in shadow on decided transactions and asserts identical derived data;
   - a rule that any change to `invariants.ts` adds the rule to `incremental-validate.ts` and a forgery to the harness in the same PR;
   - a review of the prototype as production code before wiring. It was written as an investigation artefact.

   By estimate, B meets ≤ 16.7 ms median at the interactive target for every measured type (4.9–12.4 ms). This needs a measured p95, a production build and a quiet machine before any claim. It does **not** meet ≤ 50 ms at 250k for structural edits (65–98 ms).
3. **Then option C** (Draft write log and the cheap command fixes in §3.3). It is internal to `commands.ts` and changes no semantics or format, but it touches the authoritative command layer, so ask for review.
4. **Decide on option D.** Structural sharing of the node map and a persistent parent index is the only route found to:
   - ≤ 50 ms at 250k for one-node and structural edits;
   - history memory bounded by the transaction count rather than by count × nodes (the proposed new debt item).

   Prefer a chunked copy-on-write map (≈ √n buckets; no dependency, about 100 lines) to a HAMT: both are measured or analysed here, and the chunked map is enough. Decide whether bucket iteration order is acceptable, or whether insertion order must be preserved (then a small extra index).
5. **Decide on whole-layer transforms at 250k.** Either accept O(subtree) for container transforms (about 56 ms at 250k by the prototype's walk), or commission per-subtree summaries.
6. **Do not lower any threshold.** All numbers here come from a shared, not-quiet machine and from Node, not the production build in a browser.

## 8. NOT RUN
- **Browsers.** No browser, Safari or worker run: every figure is Node 24.22.1 on the main thread. The closure criteria name the production build on the reference machine.
- **Quiet machine.** No quiet-machine run: load averages are in each `*.load.txt`.
- **Wired dispatch.** No end-to-end measurement of a wired incremental validator, write log or structural sharing: §6 figures are compositions of measured stages, including the 43k estimates below 16.7 ms. No p95 is estimated.
- **Lower-end hardware** (TD-PLATFORM-003).
- **Real trace output.** No documents from real traces or large fixtures: the profile uses seeded synthetic traces (one layer, 8 groups). Deeper nesting and many small groups are not profiled.
- **Other commands.** `reparent`, `setClip`, `rotate90`, `bake`, `setLocked` and `attachSource` are not profiled at size; they are covered only by the differential test.
- **Memory.** No long-session heap growth measurement. The retained memory of memoised `parents()` maps (one per history state that computed one) and of accumulated `setFill` styles was not measured.
- **Persistent-map candidates.** Only a chunked copy-on-write map was measured. No HAMT, tree-structured store or persistent parent index was prototyped.
- **Other paths.** Composed-transform overflow from real commands is not reached in the harness's small documents; it is covered by forged deep chains only. `history_budget` and differing limits are not covered (§5.2).
- **Frozen regressions** (326 + 72, 636, bundle v1). Not re-run: only new files were added, and no existing source, export path or format changed.
- **Browser and Safari suites.** Not run: no browser-facing code changed.
- **Full reading of the AGENTS.md read list.** PRD, RFC-001, RESEARCH, PRESETS, VALIDATION and ROADMAP were only skimmed for document, history and performance content. Read in full: TD-PERF-007, decision register §7–§9, RFC-002 §7 (history budget), the G-DOC report header, and the document sources.

## 9. Proposed debt-register wording (for the lead; this branch does not edit the register)
- **TD-PERF-007, evidence addendum (status unchanged, OPEN):**

  > G-R1 investigation (`docs/research/g-r1/TD-PERF-007-INVESTIGATION.md`, Node 24.22.1, M5 Max, not quiet). `validateState` is 56–89 % of a dispatch's median at 1k–250k paths; node-map copy plus publication 10–18 %; history bookkeeping a few percent. Undo and redo ≤ 0.01 ms median. `setFill`, `group`, `delete` and `duplicate` also pay O(nodes) command work (`documentOrder`, cold `parents`): 29–43 ms at 250k. A fast-accept incremental prototype (not wired) agrees with `validateState` on 62,124 validator-reached randomized transactions over five seeds (23,462 invalid, including 353 anchor-budget rejections), with zero disagreements and every valid command state decided locally. Estimated by composition, wiring it alone brings the 43k medians to about 5–12 ms; at 250k structural edits stay at 65–98 ms without structural sharing.
- **New item (proposed): TD-PERF-011, "History retains a full node-map table per entry."**

  > Each committed state owns a native Map of all nodes: about 1.75 MiB at 44k nodes and about 7 MiB at 251k nodes per state (retained heap, measured). Extrapolated to 100 history entries, this is about 175 MiB and about 700 MiB, not counted by the RFC §7 history byte budget (chunks and sources only). RFC D02 describes a structural-sharing history; node objects are shared but the maps are not.

  Limitation (measured); **High**; gate G-EDIT, with TD-PERF-007. Closure: structural sharing of node maps, or history accounting that includes them, measured at the stress workload.

## 10. Verification
| Check | Command | Result |
|---|---|---|
| Unit tests at the base | `pnpm exec vp test` at `ba2cb53`, with the WASM package built in this worktree by `node scripts/build-wasm.mjs` | 24 files, 372/372 passed |
| Unit tests on this branch | `pnpm exec vp test` | 25 files, **374/374** passed: the base 372 plus the 2 new tests (the differential, 16,000 transactions and 12,427 comparisons, about 0.9 s; the not-wired check) |
| Static checks (scoped) | `pnpm exec vp check scripts/bench-td-perf-007.mjs src/document/incremental-validate.ts src/document/incremental-validate.test.ts src/document/testing/incremental-differential.ts` | formatting, lint and types pass on the 4 code files; Markdown is outside `vp check`. `vp check --fix` was run only on these new files, never at the repository root |
| Differential record | `node scripts/bench-td-perf-007.mjs --differential --seeds 20261125,1,2,3,4 --transactions 16000` | 62,124 comparisons, 0 disagreements (`d794428`) |
| Profile | `node --expose-gc scripts/bench-td-perf-007.mjs --reps 30` (×2) | `profile-run1.json`, `profile-run2.json`; every incremental result in both runs matched `validateState`, since the script throws on a mismatch |
