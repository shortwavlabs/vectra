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
