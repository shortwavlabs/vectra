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
| F-14 | Snapshot preparation of the 43k-path stress trace (bark-2350) is about 5 ms slower in real Safari (24 → 28–31 ms); load and validation of the interactive target are about 16 ms slower in Chromium (123–126 → 142–143 ms) | Recorded (report §10); the preview and exact frame are unchanged within noise |

## 6. Decisions requested from the maintainer (stage D)
| # | Decision | Recommendation |
|---|---|---|
| M-7 | Accept stage D and the G-DOC-R gate's implementation, with the open qualifications (lower-end hardware, quiet machine, browser-dispatch timing in the production build) | Accept as an implementation; the gate's hardware qualifications stay open |
| M-8 | TD-UI-006: confirmation flow to commit without history, or keep rejection | Decide before supporting very large single subtrees, or enabling the constrained profile |
| M-9 | `paletteLabels()` incrementalisation timing | With Recolor virtualisation |

**Safari environment (2026-11-26).** After the maintainer restarted Safari, all five harnesses pass on the final build `e3cfd750f82410a6`: gui 14/14, gr1 7/7, gjob 10/10, gr0 7/7, persistence 23/23. The earlier failures on `0700087` were the Safari environment fault diagnosed in report §11.
