# G-DOC-R — Decision register

This register separates the decisions taken within the authorised scope (implementation choices, open to maintainer review) from the decisions only the maintainer can take. Evidence is in the [report](G-DOC-R-REPORT.md).

## 1. Implementation decisions taken within the authorised scope
| # | Decision | Alternatives considered | Why | Where |
|---|---|---|---|---|
| G-1 | Three validation modes: `incremental` (production), `compare` (development and test builds), `full` | Always `compare`; a build flag | Production gets the fast path. Every unit test and every `vp dev` session checks each decided transaction against the oracle. `full` keeps the old path available | Report §1.1 |
| G-2 | The full pass is the only source of rejections. The proof never rejects; it accepts or answers `undecided` | The proof rejecting with its own errors | Error codes and messages stay those of the oracle, by construction | §1.1 |
| G-3 | The four rule constants are exported from `invariants.ts` and imported by the incremental validator | Keeping copies (the prototype) | The two validators cannot drift on those rules. The oracle's behaviour is unchanged | §1.1 |
| G-4 | The Draft write log is transaction-local (`CommandContext.log`), validated by `step` after each command | A side table keyed by state | A side table would retain each state's ancestry and its written keys in history | §2.1 |
| G-5 | An incomplete or absent log falls back to the identity diff. A size-balance check guards the log path | Trusting the log unconditionally | Defence in depth against a future write path outside the Draft | §2.1 |
| G-6 | Unchanged sealed maps are shared between states | Copying them every transaction (before) | They are immutable, and sharing makes the unchanged-map diff O(1) | §2.1 |
| G-7 | Document order comes from ancestor child-index chains | The whole-tree walk (before) | Identical order; cost proportional to the targets' ancestors' child lists | §2.1 |
| G-8 | Per-subtree summaries are not implemented | Implementing them in stage C | The optimised walk meets ≤ 50 ms at 250k. At 996k anchors it is projected to, after stage D. The ceiling is recorded | §2.4 |
| G-9 | `selectChunkIds` sorts by chunk number | Leaving map order | No consumer may depend on which validator built the derived chunk map | §1.6 |
| G-10 | Every `concert-*` photograph is excluded from the regression runs | Excluding only `concert-small-venue*` | An earlier session script treated all `concert-*` inputs as private; the conservative reading was taken | §3 |
| G-11 | Stage D stops before any code, and amendment AM-2 is raised | Implementing stage D with the accounting change | Change control: the accounting changes C3.2 and RFC §7. Brief §6: stage B revealed a correctness defect, which must be reported before progressing | [AM-2 draft](AM-2-DRAFT.md) |

## 2. Findings reported to the maintainer
| # | Finding | Disposition |
|---|---|---|
| F-1 | **Correctness defect C1** in the stage B validator. A map entry holding `undefined` under a new key was accepted. In `incremental` mode it would have been published | **Fixed** (`fd06b5a`) with regression forgeries and a faulty-command test; re-qualified (report §1.6) |
| F-2 | Published node maps retained their transaction's written-key set (introduced in stage C) | **Fixed** (`758a689`), with a test |
| F-3 | The browser suite's renderer-behaviour spec depends on a binary that another spec builds | Recorded; not G-DOC-R scope (report §3) |
| F-4 | The canvas-edge handle test is flaky under full-suite load (it passed in the final-head run) | Recorded; not G-DOC-R scope (report §3) |
| F-5 | Independent stage C review: no counterexample. Follow-ups: the published map's shape, an uncached parent map for `setFill`, the size-check comment, coverage tests | **Fixed** (`7799e6e`); report §2.4b |
| F-6 | Fresh worktrees lack local, gitignored prerequisites (`render_compare`, `export_samples` outputs, the G-R1 workloads). Their absence fails or skips tests rather than reporting them as not run | Recorded (report §3, §3.1) |

## 3. Decisions requested from the maintainer
| # | Decision | Options | Recommendation |
|---|---|---|---|
| M-1 | Accept stage B (with the F-1 fix) and stage C (**decided 2026-11-26: accepted as checkpoints at `9ae294f`**; decision register §11) | Accept / request changes | Accept. Every requirement in brief §2 B and C is met, except ≤ 50 ms at the stress workloads: 6–7 of 12 types miss it at 996k anchors, and `ungroup` is borderline at 756k. Stage D addresses this |
| M-2 | AM-2: the cost model for document-structure bytes | A deterministic formula calibrated against measured heap / another approach | The calibrated, conservative formula |
| M-3 | AM-2: attribution of shared allocations | Count once at the highest-precedence owner (the chunk rule) / another rule | The chunk rule |
| M-4 | AM-2: earlier history eviction under the unchanged 128 MiB | Approve / adjust the limits through RFC §7 | Approve; eviction stays oldest-first and visible |
| M-5 | Node-map iteration order under stage D | Bucket order / insertion order (an extra index) | Bucket order. Deterministic, persistence unaffected; only the first error named for a multi-defect load may differ |
| M-6 | Owner checks still open from earlier gates | VoiceOver, the stock-Safari keyboard check, lower-end hardware, a quiet-machine run | Unchanged by this gate |

**Decided 2026-11-26** ([decision register §11](../g0/G0-DECISION-REGISTER.md)):
- M-2 to M-5 are decided as recommended: AM-2 is approved, with calibration, attribution, eviction and ordering requirements;
- M-6 is unchanged.

**Safari status reconciled.** Real Safari was NOT RUN on `758a689` (screen locked). It was run on `9ae294f` (`VERSION` `4b829e176927371e`, `BUILD_ID` `e8cfaf88be26066f`): all five harnesses pass (report §3.1).

## 4. Stage D implementation decisions (within AM-2, 2026-11-26)
| # | Decision | Alternatives considered | Why | Where |
|---|---|---|---|---|
| G-12 | Order node-map chunks by (ID number, key): a two-level B+-tree | Hash buckets (the design note) | Measured. Hashing spread a trace's, a layer's or a group's nodes over every bucket: a trace replace took 49.8 ms at 330k (now 4.9), and walk lookups were 2× slower | Report §5.2 |
| G-13 | Within-chunk order sorted, so iteration depends on contents only | Insertion order within buckets | Equal contents iterate identically whatever the history (stronger than AM-2 requires); loaded and edited maps compare equal | §5.2 |
| G-14 | One accounting delta per step, with the chain argument; a full-traversal oracle in tests | Reference counts per allocation | Per-allocation counts would mean about a million live entries at 330k. The delta needs two integers per step and no traversal on an edit | §6.2 |
| G-15 | Per-key scoping of small records shared by `duplicate`; strings counted with their objects | Exact cross-key identity | Exact identity needs per-state reference counts. These over-counts are conservative and bounded; trace provenance (large) is exact | §6.1 |
| G-16 | Publish exact-length child lists and chunk directories | Model growth slack in the cost model | Reduces real retention, rather than inflating the model | §7 |
| G-17 | Freeze published chunks at runtime | Immutable by convention | Review follow-up. Costs about 4 ms on 330k walks, within target | §5.5 |
| G-18 | `render_compare` built by Playwright global setup | Each spec builds it | Specs no longer depend on running order | §8 |
| G-19 | Canvas-edge test: stable box (5 frames, in page), current box, atomic probe | Retries or a sleep | The race was a stale box in the test; the fix removes it without suppressing failures | §8 |
| G-20 | `paletteLabels()`: investigated, not implemented | A per-layer usage index now | It adds a persistent accounted index and a differential obligation for at most about 9.6 ms at bark-2350; recommended with Recolor virtualisation | §9 |

## 5. Stage D findings
| # | Finding | Disposition |
|---|---|---|
| F-7 | Hash-bucket storage missed ≤ 50 ms for commitTrace at 330k | Replaced (G-12) |
| F-8 | The accounting delta's first version was O(n) on wide writes (setFillMany 179 ms) | Fixed (`6a23a92`) |
| F-9 | Stage D review C1: a plain-`Map` start undercounts history | Fixed (`8229927`) |
| F-10 | Stage D review C2: non-string keys gave untyped errors | Fixed (`8229927`) |
| F-11 | Stage D review C4: compare mode skipped checks on the fallback | Fixed (`8229927`) |
| F-12 | Stage D review C3 (aliasing in hand-built states, over-count) and C5 (duplicate-ID message names the other entry) | Recorded; unreachable or permitted by AM-2 |
| F-13 | AM-2 makes `history_budget` reachable for single subtrees of about 450k paths or more; the shell has no "commit without history" confirmation | TD-UI-006 (Medium); decision for the maintainer |
| F-14 | Renderer path against the G-BRAND baseline (report §10): load and validation +15–16 ms in Chromium (interactive 123 → 142.5 ms); complete preview +7 ms (interactive, 149 → 156) and +12 ms (bark-2350, 305 → 317) in Chromium; snapshot preparation +0.6–1.5 ms in Chromium and +2–5 ms in real Safari (bark-2350 23–24 → 28–31 ms); gestures unchanged; drag settle 12–28 ms faster | Recorded. **Accepted as temporary regressions** (maintainer, closure brief §1), tracked as TD-PERF-012. *Corrected in the closure: this row earlier said the preview was unchanged within noise; §10 measures +7–12 ms* |

## 6. Decisions requested from the maintainer (stage D)
| # | Decision | Recommendation |
|---|---|---|
| M-7 | Accept stage D and the G-DOC-R gate's implementation, with the open qualifications (lower-end hardware, quiet machine, browser-dispatch timing in the production build) | Accept as an implementation; the gate's hardware qualifications stay open |
| M-8 | TD-UI-006: confirmation flow to commit without history, or keep rejection | Decide before supporting very large single subtrees, or enabling the constrained profile |
| M-9 | `paletteLabels()` incrementalisation timing | With Recolor virtualisation |

**Safari environment (2026-11-26).** After the maintainer restarted Safari, all five harnesses pass on the final build `e3cfd750f82410a6`: gui 14/14, gr1 7/7, gjob 10/10, gr0 7/7, persistence 23/23. The earlier failures on `0700087` were the Safari environment fault diagnosed in report §11.

**Decided 2026-11-26** (maintainer acceptance and final closure brief; [decision register §12](../g0/G0-DECISION-REGISTER.md)):
- **M-7:** stage D is accepted as an implementation, subject to the accounting closure (§7 below). Reviewed head `1a7b45f`; CI run 45895279690 verified. The gate stays PARTIAL.
- **M-8 (TD-UI-006):** a future explicit commit-without-history confirmation is authorised, **not** implemented in G-DOC-R. The refusal stays until that UI is qualified. The confirmation must disclose that the current implementation clears existing undo and redo history; Cancel is the safe default; users get a chance to save a project copy first. A follow-up of G-PRJ.
- **M-9:** incremental `paletteLabels()` with Recolor virtualisation, in a separate **G-COLOR-UI** gate, not in this PR. Strict provenance and palette semantics are preserved; retained usage indexes are accounted under AM-2.

## 7. Accounting closure (2026-11-26)
| # | Decision | Alternatives considered | Why | Where |
|---|---|---|---|---|
| G-21 | The 0.987 residual is the geometry store's per-chunk record, measured separately from the calibration scenarios: 3,688–3,767 bytes per chunk at every size from 1 to 4,000 paths. The nine typed-array and buffer headers are 1,800 of it; accessor views, closures and the manifest object are the rest | Fitting a margin to the 0.987 scenario | A direct measurement does not tune against noise; the term is fixed per chunk, not proportional to payload | Report §7.1 |
| G-22 | Account it as `COSTS.chunkRecord` = 3,776 (the largest per-size median, rounded up to 64) per chunk attributed to history, with the C3.2 owner precedence, in `historyBytes()` and the entry-fit check. **The C3.2 chunk ledger cost and GeometryStore (C2) are unchanged** | Amending the C3.2 chunk ledger cost (`M_mem + manifestBytes + D + K`): a C3 r4 amendment that changes every owner's store bytes; a conservative per-entry margin | AM-2's term 3 already covers "any other retained structural resource" and excludes only the chunk ledger cost, which this record is outside of; so no double count and no GeometryStore change. **Maintainer to confirm the reading (M-10)** | §7.1 |
| G-23 | `COSTS.typedArray` 160 → 216 | Keeping 160 | Measured 198–200 bytes off-heap (any length) and 216 + payload on-heap: the model under-counted every node-map chunk by about 40 bytes | §7.1 |
| G-24 | Constants frozen at `4899605`; six closure-fresh scenarios written afterwards and run once | Re-using earlier scenarios | Brief §2: freeze before fresh validation, including traced-layer replacement and large structural deletions | §7.1 |
| G-25 | `ResourceLedger.snapshot().historyBytes` reports `session.historyBytes()` | Leaving chunk + source only | It is documented as the RFC §7 budget quantity, and had omitted term 3 since AM-2 | §7.1 |

| # | Finding | Disposition |
|---|---|---|
| F-15 | The container loader cannot open the 250k-path (756k-anchor) or 330k-path workload: the document section is 72.7 MB at 250k, over C7's 64 MiB document cap | Recorded for G-PRJ and the approved compact Document v1 serialization follow-up (TECHNICAL-DEBT); the browser dispatch harness replays the workload's commands instead (report §11.1) |

| # | Decision requested | Recommendation |
|---|---|---|
| M-10 | Confirm that the per-chunk store record is counted under AM-2 term 3 ("any other retained structural resource"), with the C3.2 chunk ledger cost and C2 unchanged, or require a C3 r4 amendment that adds it to the chunk ledger cost instead | Confirm term 3: no contract text or serialized version changes, and store bytes by owner stay as specified |

