# G-0 — Decision register

**Sources.**
- Maintainer G-0 brief (2026-11-25).
- Independent review [RFC-002-PROPOSED-AMENDMENTS](../rfc-002-review/RFC-002-PROPOSED-AMENDMENTS.md) and [FINAL-REPORT](../rfc-002-review/FINAL-REPORT.md).

The review's recommendation ("RFC-002 READY SUBJECT TO SPECIFIED AMENDMENTS") is **accepted**, and all 20 amendments are accepted in principle with the qualifications below.

**Status of these decisions.** Each records an **accepted architecture**, not a validated production implementation. Owner approval of the reconciled RFC closes G-0.

## 1. Amendment dispositions
| # | Amendment | Disposition | Qualification (maintainer) | Rationale | Implementation consequence |
|---|---|---|---|---|---|
| A1 | Immutable geometry chunks | **ACCEPT** | — | Granularity was undefined. Per-object buffers make transfers expensive; per-layer buffers make edits copy whole layers | `(chunkId, pathIndex)` references; new chunks only for traces, bakes and geometry ops (RFC §5.2, C2) |
| A2 | Copy-out-only GeometryStore | **ACCEPT** | — | Typed arrays cannot be frozen; a mistaken transfer destroys committed artwork (demonstrated) | Store API with `jobCopy`/`renderCopy` only; refcounts by owner kind; tests assert no detachment (G-DOC) |
| A3 | Packet-only editor transport | **ACCEPT** | JSON fallback removed; scene v1 JSON kept for interchange and export adapters | Equal size, but 97–198 ms parse vs 8–20 ms validate at ~1M anchors | One editor transport (RFC §6, C3); export via packet → scene v1 adapter (G-ENG) |
| A4 | Derived geometry metadata | **ACCEPT** | — | The single validation pass derives bounds and subpath starts cheaply | Never transport bounds, subpath starts or anchor counts (C3) |
| A5 | Shared adversarial validation suite | **ACCEPT** | — | The review found a real validator gap on its first adversarial run | Shared fixture directory; TS and Rust agree case by case (G-ENG) |
| A6 | Canvas 2D renderer architecture | **ACCEPT WITH QUALIFICATIONS** | The four parts are mandatory (display cache, OffscreenCanvas host with a measured and disclosed main-thread fallback, linear Path2D, geometric hit testing), plus a progressive first frame, layered drag caches, immutable snapshots, revision-aware invalidation, worker recovery, bounded cache memory, DPR correctness, and interaction vs exact frames. **The layered drag cache is not qualified:** it must preserve compositing (RFC §8.4). Limits accepted and scoped (§8.8). WebGL2/WebGPU are revisit paths only, with no new comparison project | Measured: gestures 17–23 ms and main thread 17–19 ms with worker plus cache (3 engines); exact redraw misses budget in Firefox and WebKit | G-R0 (architecture, worker host, cache, index), G-R1 (layered caches, qualification matrix, lower-end, Safari) |
| A7 | Linear Path2D construction | **ACCEPT** | — | Chromium builds paths incrementally in quadratic time (16.9 s at 250k anchors) | Path data or qualified chunked `addPath`; scaling regression benchmark (G-R0) |
| A8 | Scheduler cancellation contract | **ACCEPT** | Bounded start-up timeout and recovery; requeue eligible jobs once; G-JOB reproduces the WebKit churn against the **production build** (offline, service-worker updates). The prototype is evidence, not proof | Previews could cancel exports; termination during module load broke WebKit offline | RFC §10.3; production client replaces `client.ts` (G-JOB) |
| A9 | Fail-closed worker protocol | **ACCEPT** | Protocol version, generation, job ID, revision; discarded messages counted and exposed | Stale results and errors must not commit | Protocol v2 (C5); diagnostics counters (G-JOB) |
| A10 | Two-stage complexity estimation | **ACCEPT WITH QUALIFICATIONS** | Approved TD-PERF-002 wording (RFC §11.1). The forecast is approximate, with a range and choices, never auto-rejects and never downsamples. The post-segmentation decision rejects before fitting with typed errors, using the ledger. False-positive and false-negative rates are validated on a separately reserved corpus. The 2 s forecast is a qualification requirement, not a guarantee | Segmentation is 66–99 % of colour trace time, so no pre-segmentation decision meets 2 s | Staged API (G-ENG); forecast UI and FP/FN validation (G-TRACE) |
| A11 | Shared-boundary graph | **ACCEPT WITH QUALIFICATIONS** | Precision v2 is opt-in; Artistic and v1 are frozen (326 and 72 hashes). Version ownership: provisional identifiers. G-GEO acceptance allocates no version; the integer is allocated by the maintainer only at a release qualification (planned v2 at G-SB acceptance, jointly with G-GEO; the fresh holdout is spent once there) (C6). Crisp-sampled sliver metric accepted; the antialiased metric is still reported. Thresholds retained. Emitted-geometry validation. **Fresh, pre-registered, untouched holdout**; `h-discs-three` and all 12 held-out fixtures recorded as exposed. Visual owner bundle. G-SB may defer to P2, visibly | Oracle labels remove only 76–81 % of slivers; the graph prototype is exact on 6 synthetic fixtures only | G-GEO then G-SB; RFC §12 |
| A12 | Typed recipe extensions | **ACCEPT** | No plugin or arbitrary-code runtime | Side inputs, composite outputs and stable seeds are needed by the Creative Lab | RFC §13; P1 seam only (descriptors); full stacks in P2-B |
| A13 | Keyboard history coalescing | **ACCEPT** | — | Base UI commits on every arrow key (5 commits for 5 keys) | Command-layer coalescing (G-DOC API, G-UI qualification) |
| A14 | Early project serialization | **ACCEPT** | Serializer and strict loader in G-DOC (P1-A); Save/Open UI in G-PRJ (P1-C). Sources embedded only with opt-in. Integrity is distinct from authentication. Dump utility. No autosave, libraries, recent files, OPFS/IndexedDB or cloud | The serializer is the best document-model oracle; artists must not lose work | Container v1 (C7) |
| A15 | Required source digest | **ACCEPT** | — | Needed for relinking, provenance and integrity | `SourceAsset.digest` required (RFC §5.1) |
| A16 | Design-system fixes | **ACCEPT WITH QUALIFICATIONS** | Exact R05-A pins as the initial baseline; no Radix; owned patches accepted; strict CSP with `CSPProvider disableStyleElements`; provenance and notices; provisional bundle budgets (150 / 15 / 250 KiB gz); mandatory accessibility incl. screen-reader smoke tests. 42/42 does **not** close the gaps. Visual identity preserved | R05-A qualified the direction and identified specific blockers | DESIGN-SYSTEM (normative); G-UI |
| A17 | Performance budgets | **ACCEPT PROVISIONALLY** | Targets unchanged and never silently lowered. Measurement scopes defined (C9). Profiles provisional, with measured values distinguished from extrapolated ones. Unknown hardware ≠ high-end. Lower-end qualification required before broad claims (borrowing acceptable; it does not block G-ENG or G-DOC). Background `ngspice` load disclosed | Review timings ran under load; no lower-end device | RFC §17, §11.4; G-R1 sign-off needs lower-end hardware |
| A18 | Revised P1 gate sequence | **ACCEPT** | 13 gates incl. G-0; G-ENG and G-DOC independent after contracts freeze; owner prerequisites attached per gate | The original had a circular dependency and an oversized P1-B | [G0-P1-IMPLEMENTATION-PLAN](G0-P1-IMPLEMENTATION-PLAN.md) |
| A19 | Online build variants | **ACCEPT** | Before any online adapter: variants, CSP and `_headers`, secrets, attribution, network boundaries. No upload. No deployment, domain or DNS work now | R8 was deferred, not designed | RFC §15.2; post-core prerequisite |
| A20 | Read-only renderer boundary | **ACCEPT** | Enforced by an architectural test or lint rule | Renderer must never become a geometry authority | RFC §8.7, C8; G-R0 |

## 2. The review's unresolved decision categories (all 12 addressed)
| # | Category (review FINAL-REPORT) | Maintainer decision (G-0) | Consequence |
|---|---|---|---|
| 1 | Amendments A1–A20 | All accepted in principle, with qualifications (§1) | Integrated into RFC-002 |
| 2 | Performance budget and lower-end hardware | Targets retained, provisional. Lower-end qualification on an M1 8 GB and a 4c/8t ~8 GB laptop; borrowing acceptable; no broad claims before G-R1 qualification; does not block G-ENG or G-DOC | RFC §17; TD-PLATFORM-003; G-R1 owner prerequisite |
| 3 | TD-PERF-002 wording | **Approved:** "Provide a complexity forecast within two seconds on qualified workloads, followed by a definitive resource-budget decision after segmentation and before expensive fitting." | RFC §11.1; debt register |
| 4 | TD-GEO-001 metric restatement | Crisp-sampled metric accepted (4×, 0.25 px²); the antialiased metric still reported; thresholds retained | RFC §12.4; TD-GEO-010 |
| 5 | Save/Open scope | Serializer in P1-A (G-DOC), UI in P1-C (G-PRJ); source opt-in; P1 exclusions as listed | RFC §14; C7 |
| 6 | Core preset order | P1: B&W, Full Colour, Limited Palette, Grayscale, Silhouette. P2-A: Line Art (+ TD-GEO-005). P2-C: Old Print, DIY Underground, Virtual Printing Press, Variation Lab | RFC §18; PRD, ROADMAP and PRESETS updated |
| 7 | Real Safari | Approved in principle; `sudo safaridriver --enable` documented, to be run by the maintainer locally only; Playwright WebKit never reported as Safari | Plan "Platform qualification"; TD-PLATFORM-002 |
| 8 | CI policy | One required lightweight Linux job before P1-A PRs merge; heavy suites local; **specification only at G-0** | Plan "P-CI"; TD-PROCESS-001 |
| 9 | Canonical Linux builds | Approved for future published artefacts and hashes; native amd64 preferred; amd64 unqualified until recorded | TD-PLATFORM-001 |
| 10 | Design-system bundle budget and owned patches | Budgets 150 KiB JS / 15 KiB CSS additional and 250 KiB total initial UI JS (gzip), provisional; owned patches accepted | DESIGN-SYSTEM §7, §1 |
| 11 | Online build variants | A19 accepted; required before any online adapter | RFC §15.2 |
| 12 | Renderer scope | Canvas 2D with the mandatory parts; the extra worker copy (45–52 MB per 1M anchors); the 250k interactive target (not a hard limit); ~40k paths; 500k–1M stress; 1M cap | RFC §8.8 |

## 3. Additional decisions recorded at G-0
- **Principles reaffirmed** (RFC §2). MIT holder `Copyright (c) 2026 Stephane Pericat`, verified in `LICENSE`. The stale `CONTRIBUTING.md` sentence was corrected.
- **Geometry authority.** The P0 visual findings stand: circles were not approved in v1. Curve-fitting and shared-boundary defects are qualified independently (RFC §12.1).
- **Limits scoping** (RFC §8.8):
  - the 1M cap applies per document (all layers, visible or hidden) and per job;
  - the interactive target and stress workloads apply per rendered snapshot;
  - history-retained geometry is budgeted in bytes.
- **Single-build service-worker sessions** (RFC §15.3), adding TD-PLATFORM-006 (source inspection).
- **Merge order** (proposed, needs authorisation):
  1. PR #6 into `docs/rfc-002-vector-studio` (merge commit);
  2. the reconciliation PR into the same branch (merge commit);
  3. PR #4 into `main`.

  Merge commits only, with no squash or rebase, to preserve review SHAs.
- **No deployment, domain, DNS, Cloudflare, CI or runner changes during G-0.**

## 4. Decisions still pending the maintainer
See [G0-OWNER-ACCEPTANCE-CHECKLIST](G0-OWNER-ACCEPTANCE-CHECKLIST.md):
- approval of the reconciled RFC (closes G-0);
- merge authorisation;
- lower-end hardware access;
- local Safari automation authorisation;
- Precision version allocation at geometry-gate acceptance;
- the G-SB deferral decision if it arises;
- ratification of the provisional budgets after measurement.
