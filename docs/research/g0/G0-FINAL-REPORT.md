# G-0 — RFC-002 final reconciliation and architecture freeze

**Outcome: APPROVED by the maintainer (2026-11-25).** The approval came with a narrow contract clarification pass (C2, C3, C5, C7, C8). That pass is integrated (§11) and introduces no architectural departure or blocker. G-0 closes when this PR merges in the authorised order. The sections below record the reconciliation as submitted; §11 records the closure.

| | |
|---|---|
| Date | 2026-11-25 |
| Reviewed RFC | `0e32fdabdbfa9aae5f7613be46c60dee375ca788` (PR #4, `docs/rfc-002-vector-studio`) |
| Independent review | `91552aad1d4c7289441ca8c61348495db4ac7f36` (PR #6, `review/rfc-002-architecture`) |
| Reconciliation branch | `docs/g0-rfc-002-reconciliation`, created from `91552aa` (contains `0e32fda` and all PR #6 commits with their original SHAs) |
| Baseline | `main` `baf1d17` (accepted P0) |

All references matched the brief at the start of G-0; no divergence was found.

**What G-0 establishes and what it does not.** G-0 records **accepted architecture**. It does **not** validate any production implementation, performance, browser support, accessibility or geometric quality. Those are qualified by the gates in [G0-P1-IMPLEMENTATION-PLAN](G0-P1-IMPLEMENTATION-PLAN.md).

## 1. Reconciliation outcome
RFC-002 was **rewritten as one coherent normative specification**: the amendments are integrated and superseded language removed, not appended. It now defines:
- ownership and immutable geometry chunks with a copy-out-only GeometryStore;
- GeometryPacket v1 as the sole editor transport and storage, with a byte-level contract;
- Canvas 2D with its four mandatory parts, plus compositing-preserving drag caches that still need qualification;
- the normative scheduler and fail-closed protocol;
- two-stage complexity estimation with the approved TD-PERF-002 wording;
- Precision v2 version ownership, the shared-boundary graph, restated metrics and evaluation integrity;
- the typed recipe seams;
- `.vectra` container v1, with the serializer in P1-A;
- the design-system qualifications;
- provisional budgets with measurement scopes;
- build variants and single-build service-worker sessions;
- the core preset order;
- explicitly scoped limits;
- packet-vs-document authority after commit, and export through a draw list baked in Rust (C3.1).

The unamended requirements of the draft were checked clause by clause against `0e32fda` and retained: export rules, decoding and preview downsampling, arbitrary clips, stack and plate rules, P0 guardrails, reporting integrity (audit #30). Performance scopes keep the draft's import → visible meaning; exact settled frames have no numeric target yet (audit #31).

Cross-module details are frozen in [G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md) (C1–C9), so G-ENG and G-DOC can proceed independently after approval.

## 2. Amendments incorporated
All **20** amendments are dispositioned and traced ([G0-DECISION-REGISTER](G0-DECISION-REGISTER.md) §1, [G0-TRACEABILITY-MATRIX](G0-TRACEABILITY-MATRIX.md) §1):

| Disposition | Amendments |
|---|---|
| ACCEPT | A1, A2, A3, A4, A5, A7, A8, A9, A12, A13, A14, A15, A18, A19, A20 (15) |
| ACCEPT WITH QUALIFICATIONS | A6, A10, A11, A16 (4) |
| ACCEPT PROVISIONALLY | A17 (1) |

## 3. Maintainer decisions
All **12** decision categories from the review are addressed (decision register §2):
1. Amendments accepted.
2. Budgets retained provisionally, with lower-end qualification before broad claims.
3. TD-PERF-002 wording approved.
4. Crisp-sampled sliver metric accepted.
5. Save/Open: serializer in P1-A, UI in P1-C.
6. Preset order: P1 B&W, Full Colour, Limited Palette, Grayscale, Silhouette; Line Art in P2-A; P2-C flagship.
7. Real Safari approved in principle (`safaridriver` documented, not executed).
8. Minimal CI specification.
9. Canonical Linux builds approved.
10. Bundle budgets and owned patches.
11. Online build variants.
12. Renderer scope.

Additional G-0 interpretations awaiting confirmation are listed in [G0-OWNER-ACCEPTANCE-CHECKLIST](G0-OWNER-ACCEPTANCE-CHECKLIST.md):
- limit scoping;
- the Precision version allocation rule;
- single-build sessions;
- the disclosed main-thread renderer fallback.

## 4. Documents created or updated
**Created (`docs/research/g0/`):**
- [G0-FINAL-REPORT](G0-FINAL-REPORT.md)
- [G0-DECISION-REGISTER](G0-DECISION-REGISTER.md)
- [G0-TRACEABILITY-MATRIX](G0-TRACEABILITY-MATRIX.md)
- [G0-CONSISTENCY-AUDIT](G0-CONSISTENCY-AUDIT.md)
- [G0-P1-IMPLEMENTATION-PLAN](G0-P1-IMPLEMENTATION-PLAN.md)
- [G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md)
- [G0-OWNER-ACCEPTANCE-CHECKLIST](G0-OWNER-ACCEPTANCE-CHECKLIST.md)
- [G0-NEXT-GATE-BRIEF](G0-NEXT-GATE-BRIEF.md)
- `artifacts/` (verification output)

**Updated (authoritative):**
- [RFC-002](../../RFC-002.md) (rewritten);
- [DESIGN-SYSTEM](../../DESIGN-SYSTEM.md) (normative for G-UI);
- [TECHNICAL-DEBT](../../TECHNICAL-DEBT.md) (G-0 dispositions plus 12 items).

**Updated (consistency notes):**
- PRD, PRD-002, ROADMAP, PRESETS, VECTOR-STUDIO-TOOLS, CREATIVE-LAB;
- DESIGN (marked superseded), VALIDATION;
- IMAGE-SOURCES, DEPLOYMENT;
- RFC-002-REVIEW (status), RFC-001 (R9 note);
- P1-HANDOFF, README, CONTRIBUTING (stale licence sentence corrected).

**Unchanged:**
- the independent review (`docs/research/rfc-002-review/`, `experiments/rfc-002-review/`);
- P0 acceptance and the phase reports;
- all production code.

## 5. Contradictions resolved
37 inconsistencies are listed with their resolutions in [G0-CONSISTENCY-AUDIT](G0-CONSISTENCY-AUDIT.md). Rows 30–37 were found in a self-review before the PR. Notable ones:
- the preset order, which conflicted across PRD, ROADMAP, PRESETS and TOOLS;
- persistence placed in P4;
- the JSON fallback;
- undefined geometry granularity;
- optional renderer caches;
- the circular P1-A renderer dependency;
- the 2 s estimate wording;
- the focus-ring contrast;
- Precision v2 double ownership;
- unscoped limits;
- **service-worker version skew** (new: TD-PLATFORM-006, found by source inspection, not reproduced);
- IoU used as circle evidence;
- held-out fixture exposure;
- the stale LICENSE sentence;
- clauses dropped by the first rewrite (restored);
- a re-scoped 24 MP target (restored to the draft's meaning);
- Precision allocation at G-GEO (clarified);
- the packet-vs-document contract gap (closed).

No contradiction is left without an explicit disposition.

## 6. Technical debt
**Counts:** **37** open items. The original 25 are all preserved, each with a G-0 disposition. 12 were added, all mapped to stable IDs; the review documents are unchanged.

| Added at G-0 | IDs |
|---|---|
| Architecture | TD-ARCH-005 (immutability convention), TD-ARCH-006 (WebKit start-up churn) |
| Renderer | TD-REN-001 (Chromium quadratic Path2D), TD-REN-002 (worker-canvas presentation and raster), TD-REN-003 (drag-cache correctness), TD-REN-004 (large compound paths) |
| UI | TD-UI-001 (CSP inline style), TD-UI-002 (colour picker and slider accessibility), TD-UI-003 (contrast tokens), TD-UI-004 (notices coverage) |
| Geometry | TD-GEO-010 (metric restatement) |
| Platform | TD-PLATFORM-006 (service-worker version skew) |

**Lifecycle stages** now distinguish: architecture accepted, implementation pending, prototype demonstrated, production verified, owner acceptance pending, and qualified and closed. **No item is resolved by G-0.** R03, R04 and R05-A remain **PARTIAL** in the historical review.

## 7. Verification
| # | Check | Result |
|---|---|---|
| 1 | Branch and PR integrity | Remote `docs/rfc-002-vector-studio` = `0e32fda`, `review/rfc-002-architecture` = `91552aa` (unchanged). This branch contains `91552aa` with its history; review commits are not rewritten |
| 2 | 20 amendments dispositioned and traced | 20/20 in the decision register and traceability matrix |
| 3 | 12 decision categories addressed | 12/12 |
| 4 | Contradictions | 37 resolved, each with a disposition; residual items are explicit owner or qualification items |
| 5 | Historical review evidence unaltered | `git diff 91552aa -- docs/research/rfc-002-review experiments/rfc-002-review` is empty |
| 6 | No production, algorithm, root-dependency or lockfile changes | `git diff 0e32fda -- crates packages src public scripts tests package.json pnpm-lock.yaml pnpm-workspace.yaml Cargo.toml Cargo.lock vite.config.ts tsconfig.json playwright.config.ts rust-toolchain.toml .node-version wrangler.jsonc LICENSE` is empty |
| 7 | P0 Artistic and Precision v1 baselines | `regression_corpus` re-run: **326/326 identical** to `a4cf172.sha256`. `geo_bundle` re-run: **72/72 identical** to the committed bundle v2 (`artifacts/rust-and-regression.txt`) |
| 8 | `vp check` | PASS (93 files formatted; no lint or type errors) |
| 9 | `vp test` | PASS (14/14) |
| 10 | Rust checks | `cargo fmt --all --check` PASS; `cargo clippy --workspace --all-targets --locked -- -D warnings` exit 0; `cargo test --workspace --locked` all test binaries ok, 0 failed |
| 11 | Documentation links | 260 relative links and anchors in the 26 touched or new files resolve, 0 problems (`artifacts/link-check.txt`) |
| 12 | Diff review | `91552aa..HEAD`: 18 files modified and 11 added (8 G-0 documents plus 3 verification artefacts), 0 deleted, **all** under `docs/`, `README.md` and `CONTRIBUTING.md`. The reconciled RFC-002 was read in full after the self-review; the other modified files were reviewed as diffs. No code, configuration or lockfile changed |

**Not run at G-0:**
- Playwright browser suites (no runtime change);
- real Safari, which needs maintainer authorisation;
- lower-end hardware (unavailable);
- Linux amd64.

**Environment.** Machine load at verification was load average 1.3, with 3 unrelated `ngspice` processes. That is irrelevant to correctness checks; no timings are claimed here.

## 8. Remaining blockers and deferred qualification
**Blocking G-0 closure:** none; approved (§11). The merges are authorised.

**Before P1-A merges:** P-CI configured.

**Deferred qualification**, never implied by G-0:
- **Real Safari** (TD-PLATFORM-002; owner authorisation): G-JOB, G-UI, G-R1.
- **Lower-end hardware** (TD-PLATFORM-003): G-R1 sign-off. No broad performance claims until then.
- **Preview ≤ 100 ms** is currently met only in Chromium (review): G-R1 optimisation, or an owner decision.
- **Layered drag-cache correctness** (TD-REN-003): G-R1.
- **WebKit worker-canvas presentation** (TD-REN-002): G-R0 and G-R1.
- **Production-build churn and service-worker update tests** (TD-ARCH-006, TD-PLATFORM-006): G-JOB.
- **Estimator false-positive and false-negative rates** on a reserved corpus: G-TRACE.
- **Precision v2**: fresh holdout and owner visual bundle (G-GEO, G-SB). G-SB may defer to P2 visibly.
- **Accessibility of the repaired controls**, with screen readers: G-UI.
- **Linux amd64** and the canonical release build.

## 9. Stacked pull requests and proposed merge order
| PR | Head → base | Content |
|---|---|---|
| #4 | `docs/rfc-002-vector-studio` → `main` | Draft RFC-002, DESIGN-SYSTEM and review protocol |
| #6 | `review/rfc-002-architecture` → `docs/rfc-002-vector-studio` | Independent review (unchanged) |
| this PR | `docs/g0-rfc-002-reconciliation` → `docs/rfc-002-vector-studio` | PR #6's commits (same SHAs) plus G-0 commits |

**Order** (authorised at closure):
1. Merge **PR #6** into `docs/rfc-002-vector-studio` with a **merge commit**.
2. The reconciliation PR's diff then shows only the G-0 commits. Merge it with a **merge commit**.
3. Merge **PR #4** into `main`.

Use **merge commits only** (no squash or rebase), so the review SHAs are preserved and never duplicated.

If the reconciliation PR is merged first, PR #6's head becomes reachable from the base and GitHub marks PR #6 as merged. That is acceptable but less clear, so merging PR #6 first is recommended.

## 10. Recommended next gate
After approval, merge and P-CI: **G-ENG ‖ G-DOC**, as two independent PRs following [G0-NEXT-GATE-BRIEF](G0-NEXT-GATE-BRIEF.md).

**Confirmation:** no P1 implementation, deployment, domain, DNS, Cloudflare, CI or runner change was made in G-0.

## 11. G-0 closure (maintainer approval and contract clarifications)
**Approved:**
- the reconciled RFC-002;
- C1–C9, subject to the clarifications;
- all 20 dispositions;
- the 13-gate plan;
- the design system;
- the debt register;
- the provisional budgets;
- the preset order;
- the P-CI specification.

All reconciliation interpretations were confirmed. The full record is in [G0-DECISION-REGISTER §5](G0-DECISION-REGISTER.md) and the [owner acceptance record](G0-OWNER-ACCEPTANCE-CHECKLIST.md).

**Clarifications** (CL-1 to CL-9; contract versions unchanged because they precede the freeze):

| Contract | Clarification |
|---|---|
| C2 | Commit = shape check → detaching move → validation of store-owned bytes → publish. The input is consumed; `copyIncoming` is the only (explicit) copy; fail-closed startup check; runtime tests. Commands never copy; render copies are host-driven (population, recovery, new chunks) |
| C3 | Exact, checked accounting: `M_mem = V + 8C + 16P + 8` (the old formula overstated by 8 bytes); `D = 36P + 4S`; ledger cost; `B`; `G`. Caps before allocation, with u64 checked arithmetic in Rust (wasm32 `usize` is 32-bit). Offsets computed, not stored. Single-owner byte attribution (Σ = total). Anchors per PathObject reference (`pathAnchors`) |
| C5 | Supersession for previews and thumbnails only. Explicit jobs: bounded queue or `busy` before acceptance, and always a visible outcome (including `stale`). Identity handshake for both workers before any post |
| C7 | Canonical uncompressed content (RFC 8785; C3.0 records), identical across browsers. Whole-container byte identity within a qualified environment, or everywhere with codec `none`; native deflate never assumed deterministic. `nextId` and `nextChunkId` persisted. Dirty state is state identity, not per-edit digests |
| C8 | One rect clip per Layer or Group, in local space. Axis-preserving composed transforms only (exact), else `clip_transform_unsupported` with Release clip. Intersection of nested clips; empty means fully clipped. One evaluation for preview, hit testing and export. No bounding-box approximation |

Also: the next-gate brief now assigns **every shared file one owner**, fixes the single production validator in G-ENG (`src/geometry/packet/`), gives G-DOC a validator port and a test-only adapter, and defines the integration PR and its final shared conformance test. Audit rows 38–47.

**Closure verification** (`artifacts/closure-verification.txt`; load average 0.49, no `ngspice` processes):
- 267 relative links in 26 files resolve, 0 problems;
- `cargo fmt` PASS, `clippy -D warnings` exit 0, `cargo test` 0 failures;
- `regression_corpus` **326/326** identical; `geo_bundle` **72/72** identical;
- `vp check` PASS, `vp test` 14/14;
- review evidence and every production, dependency and lockfile path unchanged (empty diffs).

The clarification pass changed documentation only.
