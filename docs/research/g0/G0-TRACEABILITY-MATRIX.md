# G-0 — Traceability matrix

## Abbreviations

**Documents:**
- **RFC** — reconciled [RFC-002](../../RFC-002.md);
- **Draft** — RFC-002 at `0e32fda`;
- **C#** — [G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md);
- **Plan** — [G0-P1-IMPLEMENTATION-PLAN](G0-P1-IMPLEMENTATION-PLAN.md).

**Review evidence** (gates of the independent review, PR #6, under `../rfc-002-review/`):
- **R01** transport;
- **R02** renderers;
- **R03** scheduling;
- **R04** shared boundaries;
- **R05-A** design system;
- **R05-B** persistence.

## 1. Amendments
| # | Draft § | Review evidence | Disposition | Reconciled normative § | Gate | Acceptance tests | Remaining risks / prerequisites |
|---|---|---|---|---|---|---|---|
| A1 | §4, §5, §6 | R01 path and subpath counts (1 to 29,944 paths; 195k-subpath halftone); DOCUMENT-OWNERSHIP §4 | ACCEPT | RFC §5.2; C1, C2 | G-DOC | Refcount property tests; zero copies for structural commands | Chunk compaction for heavily edited documents (later, explicit) |
| A2 | §6 | R01 detachment demo (`adversarial.json`) | ACCEPT | RFC §5.2; C2 | G-DOC | No committed buffer detached after jobs and terminations | TD-ARCH-005 |
| A3 | §6 | GEOMETRY-TRANSPORT-BENCHMARK (Node and 3 browsers, 12 workloads) | ACCEPT | RFC §6; C3 | G-ENG, G-DOC | Lossless Scene ↔ Packet; packet-route exports byte-identical | TD-ARCH-003 |
| A4 | §6 | R01 validation pass derives bounds and subpaths | ACCEPT | RFC §6; C3 | G-ENG, G-DOC | Derived metadata equals recomputation; nothing derived is transported | — |
| A5 | §6 | R01 adversarial 27/27, with the first-run gap | ACCEPT | RFC §6; C3 | G-ENG | Shared fixture suite; identical codes in TS and Rust | — |
| A6 | §7 | RENDERER-EVALUATION (matrix, cache, OffscreenCanvas, combination, 84 correctness renders) | ACCEPT WITH QUALIFICATIONS | RFC §8.1–8.6, §8.8; C8, C9 | G-R0, G-R1 | resvg correctness (worker and fallback); main-thread gaps ≤ 50 ms; §8.4 drag matrix vs exact frames; budgets on lower-end devices | TD-REN-002, TD-REN-003, TD-PLATFORM-002/003; preview ≤ 100 ms met only in Chromium so far |
| A7 | §7 | `path2d-scaling.json` | ACCEPT | RFC §8.2(3) | G-R0 | Scaling regression benchmark in 3 engines | TD-REN-001 |
| A8 | §8 | WORKER-SCHEDULING-AND-RECOVERY (v1 14/16 WebKit offline; v2 16/16) | ACCEPT | RFC §10.3; C5 | G-JOB | Scenarios 1–12 plus churn case on the production build, offline and across service-worker updates; Safari | TD-ARCH-006; Safari authorisation |
| A9 | §8 | R03 stale result and error drops | ACCEPT | RFC §10.2; C5 | G-JOB | Handshake mismatch is fatal; drops counted; revision-checked commits | TD-PLATFORM-006 |
| A10 | §13 | R03 estimator (68 cases; leave-one-image-out) | ACCEPT WITH QUALIFICATIONS | RFC §11.1–11.2; C4 | G-ENG, G-TRACE | FP/FN on a separately reserved corpus; forecast never auto-rejects | TD-PERF-002; limited and halftone estimators |
| A11 | §9 | SHARED-BOUNDARY-STRATEGY (reproduction, 326/72 hashes, oracle bound, graph prototype) | ACCEPT WITH QUALIFICATIONS | RFC §12; C6 | G-GEO, G-SB | §12.4 metrics; emitted-geometry validators; fresh pre-registered holdout run once after a freeze; owner visual bundle | TD-GEO-001/009/010; G-SB may defer to P2 |
| A12 | §10 | CREATIVE-LAB-ARCHITECTURAL-REVIEW | ACCEPT | RFC §13 | P1 seam: G-ENG and G-DOC descriptors; full: P2-B | Seed reorder stability; side-input digest invalidation (CL-G4) | — |
| A13 | §5 | R05-A D7 (5 commits for 5 keys) | ACCEPT | RFC §7 | G-DOC (API), G-UI | Keyboard edits produce one history entry per parameter run | TD-UI-002 |
| A14 | §11 | PROJECT-PERSISTENCE-REVIEW; `compression.json` | ACCEPT | RFC §14; C7 | G-DOC, G-PRJ | C7 determinism (canonical uncompressed content; whole-container identity in the qualified environment); container adversarial suite; atomic failure | — |
| A15 | §4 | R05-B relinking requirement | ACCEPT | RFC §5.1 | G-DOC | Required digest validated; relink by digest | — |
| A16 | §12, DESIGN-SYSTEM | DESIGN-SYSTEM-FEASIBILITY (42/42; D1–D9; contrast; CSP) | ACCEPT WITH QUALIFICATIONS | RFC §16; DESIGN-SYSTEM (normative) | G-UI | CSP controls; repaired-control qualification; contrast; screen reader; bundle budgets | TD-UI-001..004 |
| A17 | §13 | MEMORY-AND-RESOURCE-BUDGET; `timing-environment.txt` (load) | ACCEPT PROVISIONALLY | RFC §17, §11.3–11.4; C9 | All, sign-off in G-R1 | Benchmarks per C9 with recorded load; lower-end runs | TD-PLATFORM-003; TD-PERF-003 |
| A18 | §14 | REVISED-P1-SEQUENCE | ACCEPT | RFC §19; Plan | G-0 | Acyclic graph; per-gate criteria | — |
| A19 | §11, §15 R8 | ARCHITECTURE-CRITIQUE (R8) | ACCEPT | RFC §15.2 | Post-core (before any online adapter) | Variant CSP and `_headers` tests | — |
| A20 | §3, R9 | ARCHITECTURE-CRITIQUE (R9) | ACCEPT | RFC §8.7; C8 | G-R0 | Architectural import test | — |

## 2. Requirements → decisions → debt → gates
| Requirement (source) | Decision(s) | Debt item(s) | Gate(s) | Acceptance evidence required |
|---|---|---|---|---|
| Editable document, IDs, layers, history (PRD-002 VS-01/02) | D01, D02 | TD-ARCH-002, TD-ARCH-005 | G-DOC, G-JOB | Invariant fuzzing; termination tests |
| Responsive large scenes (TD-PERF-001; RFC §17) | D04 | TD-PERF-001, TD-REN-001..004 | G-R0, G-R1 | Budgets per C9 on reference and lower-end devices |
| Packet transport and storage (TD-ARCH-003) | D03 | TD-ARCH-003 | G-ENG, G-DOC | C3 conformance |
| Worker lifecycle and offline (P0 approval; D10) | D05, D10 | TD-ARCH-006, TD-PLATFORM-006 | G-JOB | Production-build lifecycle and update tests; Safari |
| Early budget decisions (TD-PERF-002) | D05 (A10) | TD-PERF-002 | G-ENG, G-TRACE | Reserved-corpus FP/FN |
| Memory budgets (TD-PERF-003) | D01 ledger; A17 profiles | TD-PERF-003 | G-DOC, G-R1 | Ledger tests; lower-end measurements |
| Clean circles (P0 owner rejection of v1 04/05) | D06 (A11) | TD-GEO-002/003/004 | G-GEO | Curve metrics plus visual bundle |
| Shared colour boundaries (TD-GEO-001/009) | D06 (A11) | TD-GEO-001, 009, 010 | G-SB | §12.4 metrics; fresh holdout |
| Save and reopen editable work (PRD-002 VS-12) | D08 (A14, A15) | — | G-DOC, G-PRJ | Round trip; adversarial loads |
| Accessible, CSP-strict UI (PRD-002 layout; DESIGN-SYSTEM) | D09 (A16) | TD-UI-001..004 | G-UI | Repaired-control qualification; CSP controls |
| Creative Lab extensibility (CREATIVE-LAB CL-01..08) | D07 (A12) | — | P2-B, P2-C | CL gates |
| Genuine vector export, no raster (RFC-001; principle 7) | D03, D04 (caches display-only) | — | G-EXP | `verify-exports.mjs` (vector-only) |
| Determinism (R7; VS-10) | D03, D07 | TD-GEO-007, TD-PLATFORM-005 | G-ENG, P2-C | native = WASM; seed stability |
| Online isolation (IMAGE-SOURCES) | D10 (A19) | — | post-core | Variant CSP |
| Preset order (PRD, PRESETS) | RFC §18 | TD-GEO-005 | G-TRACE; P2-A | Preset fixture tests |
| CI policy (TD-PROCESS-001) | Plan P-CI | TD-PROCESS-001 | P-CI | Required check exists and fails closed |
| Linux release builds (TD-PLATFORM-001/005) | Decision 9 | TD-PLATFORM-001, 005 | release | Native amd64 run recorded |
| Real Safari (TD-PLATFORM-002) | Decision 7 | TD-PLATFORM-002 | G-JOB, G-UI, G-R1 | Safari runs (maintainer-authorised) |

## 3. Debt register → gate (summary)
All 37 items with closure criteria are in [TECHNICAL-DEBT](../../TECHNICAL-DEBT.md) ("G-0 disposition" lines and the "Added at G-0" section).

| Gate | Items it can close or advance |
|---|---|
| G-ENG | TD-ARCH-001 (check), TD-ARCH-003, TD-ARCH-004, TD-PERF-002 (API) |
| G-DOC | TD-ARCH-002 (document side), TD-ARCH-003, TD-ARCH-005, TD-PERF-003 (ledger) |
| G-JOB | TD-ARCH-002, TD-ARCH-006, TD-PERF-004 (scheduler), TD-PLATFORM-006 |
| G-R0 | TD-PERF-001 (first part), TD-REN-001, TD-REN-002 (measurement), TD-REN-004 |
| G-UI | TD-UI-001, 002, 003, 004 |
| G-R1 | TD-PERF-001, TD-PERF-003 (budget), TD-REN-002, TD-REN-003, TD-PLATFORM-002, TD-PLATFORM-003 |
| G-TRACE | TD-PERF-002, TD-PERF-004 |
| G-GEO | TD-GEO-002 (partial), TD-GEO-003, TD-GEO-004 |
| G-SB | TD-GEO-001, TD-GEO-009, TD-GEO-010 |
| P-CI | TD-PROCESS-001 |
| Later or release | TD-GEO-005 (P2-A), 006, 007 (P2-C), 008; TD-PERF-005 (P2-C), 006; TD-PLATFORM-001, 004, 005 |
