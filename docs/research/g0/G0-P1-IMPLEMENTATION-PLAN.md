# G-0 — P1 implementation plan (dependency-aware)

**Basis.**
- [RFC-002](../../RFC-002.md) §19, with contracts in [G0-ARCHITECTURE-CONTRACTS](G0-ARCHITECTURE-CONTRACTS.md).
- It supersedes the review's [REVISED-P1-SEQUENCE](../rfc-002-review/REVISED-P1-SEQUENCE.md), which is kept as historical evidence.
- The 13 gates are the review's, including G-0. One engineering prerequisite (**P-CI**) is added. Owner prerequisites are attached to the specific gates that need them, so no unrelated owner action blocks an independent engineering gate.

**Rules for every gate:**
- **Branch and evidence.** One review branch and PR per gate, with a gate report under `docs/research/<gate>/`. Commands, versions, machine load and NOT RUN items are recorded.
- **Regression obligations:**
  - the 326 regression hashes and 72 bundle-v2 hashes stay byte-identical unless the gate is explicitly versioned (C6);
  - `vp check`, `vp test`, `cargo fmt --check`, `cargo clippy` and `cargo test` pass;
  - Playwright runs in 3 engines wherever UI or workers are touched.
- **Approval.** Maintainer acceptance is required before a dependent gate merges.
- **Claims.** No claim of production performance, browser support, accessibility or geometric quality beyond what the gate measured.

## Dependency graph
```text
G-0 (owner approval)
 ├── P-CI (required check, before P1-A merges)
 ├── G-ENG ───────────┬──────────────┬───────────────┬── G-GEO ── G-SB (may defer to P2)
 ├── G-DOC ──┬────────┤              │               │
 │           │        ▼              │               │
 │           │      G-JOB ───────────┼───────┐       │
 │           ▼                       │       │       │
 │         G-R0 (needs G-DOC; uses G-ENG packets as fixtures)
 │           │                       │       │
 │         G-UI (needs G-DOC)        │       │
 │           ▼                       ▼       ▼
 │         G-R1 (G-R0 + G-UI) ──► G-TRACE (G-JOB + G-R1 + G-ENG estimator)
 │                              ► G-EDIT  (G-ENG + G-DOC + G-R1)
 │         G-EXP (G-ENG + G-DOC + G-JOB; UI hook after G-UI)
 │         G-PRJ (G-DOC serializer + G-UI)
```
The graph has no cycles:
- the renderer is validated in G-R0 before product UI depends on it;
- the serializer lands with the model in G-DOC;
- the geometry gates never block editor gates.

## P-CI — minimal required CI (engineering prerequisite; specification only at G-0)
**When.** Configured **before the first P1-A implementation PR merges**. No workflow is created, no runner provisioned and no paid infrastructure configured during G-0.

**The job:** one required check, `ci`, on GitHub-hosted `ubuntu-24.04` (native amd64; free for public repositories).

| Aspect | Specification |
|---|---|
| Trigger | `pull_request` to `main` and to active long-lived doc branches; `push` to `main` |
| Path filter (in-job, fail-closed) | A first step computes the changed paths. Docs-only changes finish the job **successfully as a no-op**, so the required check always reports. Code paths run the full job: `crates/`, `packages/`, `src/`, `public/`, `scripts/`, `tests/unit/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `Cargo.*`, `rust-toolchain.toml`, `vite.config.ts`, `tsconfig*.json`, `.github/workflows/` |
| Toolchain | Rust from `rust-toolchain.toml` (1.96.0, rustfmt, clippy, wasm32); Node 24.22.1 (`.node-version`); pnpm 12.23.0 via `devEngines`; `wasm-bindgen-cli` 0.2.130 (locked) |
| Steps | `cargo fmt --all --check` → `cargo clippy --workspace --all-targets --locked -- -D warnings` → `cargo test --workspace --locked` → `pnpm install --frozen-lockfile` → `pnpm exec vp check` → `pnpm exec vp test` → `pnpm run build` |
| Caching | Cargo registry and target (keyed on `Cargo.lock` + toolchain); pnpm store (keyed on `pnpm-lock.yaml`); `wasm-bindgen-cli` binary |
| Concurrency | `group: ci-${{ github.ref }}`, `cancel-in-progress: true` |
| Timeouts | 25 min per job; no retries that hide failures |
| Security | `permissions: contents: read`; third-party actions pinned by commit SHA; no secrets |
| Matrix | **None** |
| Required-check behaviour | Fail-closed: any step failure fails the check; the path filter never skips the check itself |

**Explicitly local or gate-specific**, never recurring in CI:
- full Playwright browser suites;
- geometry corpus qualification;
- renderer and performance benchmarks;
- memory tests;
- real Safari;
- Docker Linux verification (`scripts/linux-verify.sh`).

**Release builds.**
- Approved: a canonical pinned Linux build environment for future published artefacts and hashes.
- Prefer native amd64 over QEMU.
- **Linux amd64 stays unqualified** (TD-PLATFORM-001) until a successful run is recorded. A `ci` run is build evidence, not release qualification.

**Baseline:** `cargo clippy --workspace --all-targets --locked -- -D warnings` exits 0 at the G-0 head (verified locally; G0-FINAL-REPORT).

## Platform qualification prerequisites
**Real Safari** (approved in principle; TD-PLATFORM-002).
- **Maintainer-only local step:**
  ```bash
  sudo safaridriver --enable
  ```
  Never executed by an agent without the maintainer's explicit local authorisation.
- **Safari settings:**
  - Settings → Advanced → "Show features for web developers";
  - Develop → "Allow Remote Automation".
- **Practical constraints:** use the installed Safari version (26.x at G-0; record the exact build). Only one automation session at a time. Automation windows use an isolated profile.
- **Harness.** A WebDriver client (pinned dev-only dependency added in the gate that first needs it). Playwright WebKit is **not** Safari.
- **Coverage:**
  - worker start-up and termination;
  - offline recovery;
  - service-worker updates;
  - OffscreenCanvas presentation and first meaningful frame;
  - main-thread fallback;
  - Save/Open;
  - strict CSP;
  - core design-system interactions.
- **To verify during qualification:** service-worker behaviour under WebDriver sessions in the installed Safari.
- iOS, Android and mobile interaction are separate future gates.

**Lower-end hardware** (TD-PLATFORM-003).
- Required: an M1-class Mac with 8 GB, and a mainstream 4c/8t Intel or AMD laptop with ~8 GB. Borrowing is acceptable.
- Needed for **G-R1 sign-off** and before any broad performance claim. **Not** needed for G-ENG, G-DOC, G-JOB, G-R0 or G-UI engineering work.

## Gates
Each gate below lists: objective and scope; exclusions; dependencies; contracts; deliverables; automated tests; performance; owner acceptance; stop conditions; regressions; debt; prerequisites.

### G-0 — Architecture reconciliation (current)
- **Scope:** reconcile RFC-002 with the review; decisions; contracts; this plan; the debt register; consistency.
- **Excludes:** any implementation.
- **Exit:** maintainer approval of the reconciled RFC. G-0 is **not closed** until then.

### G-ENG — Engine API and GeometryPacket (P1-A)
- **Objective.** The engine produces, validates and consumes GeometryPacket v1; it offers a staged estimate API; diagnostics are gated.
- **Excludes:** UI, document, scheduler and renderer work; any geometry-algorithm change.
- **Depends on:** G-0 (and P-CI before merge).
- **Contracts:** C3, C4, C6.
- **Deliverables:**
  - Rust `GeometryPacket` with `from_scene`, `Scene::from_packet` and `validate_packet`;
  - WASM `vectorizePacket`, `validatePacket`, `packetToSvg` and `packetToPdf`;
  - `segment → estimate → fit` (bw and colour) plus explicit handling for limited and halftone;
  - `diagnostics` cargo feature (TD-ARCH-004);
  - the shared adversarial fixture directory (≥ the 27 review cases);
  - a TS validator conforming to C3, shared with G-DOC.
- **Automated tests:**
  - 326 and 72 hashes identical;
  - `fit(segment())` byte-identical to `vectorize`;
  - lossless Scene ↔ Packet round trip over the whole regression corpus;
  - SVG and PDF from the packet route byte-identical to direct export;
  - TS and Rust validators agree on every adversarial case;
  - native = WASM packet bytes;
  - no VTracer or visioncortex type in the public API (doc and API check).
- **Performance:** trace time within noise of baseline; packet copy-out ≤ 2 ms at 1M anchors (reference machine, load recorded).
- **Owner acceptance:** none required beyond PR approval.
- **Stop if:** any frozen hash changes; a VTracer type leaks; the packet route cannot reproduce the scene v1 exports.
- **Debt:** TD-ARCH-003 (implementation), TD-ARCH-004, TD-ARCH-001 (boundary), TD-PERF-002 (API part).
- **Regressions:** global rule (326 + 72 hashes; all local checks).
- **Prerequisites:** none beyond G-0 approval.

### G-DOC — Document, GeometryStore, commands, history, serializer (P1-A)
- **Objective.** An authoritative document model that is correct under every command, undo and redo, and that round-trips through container v1.
- **Excludes:** renderer, workers, product UI, Save/Open UI.
- **Depends on:** G-0. It is **independent of G-ENG**: it consumes C3 packets (fixture packets are generated from the regression scenes with the review's JS encoder until G-ENG lands).
- **Contracts:** C1, C2, C3 (TS validator), C6, C7.
- **Deliverables:**
  - a framework-neutral TS store;
  - the GeometryStore (C2);
  - the RFC §7 command set with history (chunk-byte accounting, keyboard coalescing API);
  - the resource ledger skeleton;
  - the container v1 serializer and strict loader;
  - the `vectra-dump` utility;
  - document invariant validators.
- **Automated tests:**
  - property and fuzz tests of invariants over random command, undo and redo sequences;
  - every command undoable;
  - zero geometry copies for structural commands;
  - committed buffers never detached;
  - save → load → save byte-identical;
  - the container adversarial suite (truncation, bad magic, oversize header, overlapping or out-of-range sections, duplicate IDs, decompression bomb, SHA mismatch, unknown kind, fields or version, invalid packets, dangling references, ID cycles, non-finite transform, bad source signature): typed error, document unchanged;
  - history cap and visible truncation.
- **Performance:** committing a 1M-anchor result ≤ 50 ms on the main thread; structural undo and redo ≤ 16 ms (reference machine).
- **Owner acceptance:** none beyond PR approval.
- **Stop if:** the document needs renderer types or worker handles; a structural command copies geometry.
- **Debt:** TD-ARCH-002 and TD-ARCH-003 (document side), TD-PERF-003 (ledger skeleton), TD-ARCH-005.
- **Regressions:** global rule; no change to the existing workbench behaviour.
- **Prerequisites:** none.

### G-JOB — Scheduler, protocol v2, worker lifecycle (P1-A)
- **Objective.** A production compute-worker client that implements RFC §10.3 and C5, and replaces `client.ts` behind the workbench. Single-build service-worker sessions (RFC §15.3).
- **Excludes:** renderer worker, product UI.
- **Depends on:** G-ENG (packet output, handshake fields) and G-DOC (revisions, commit path).
- **Contracts:** C5, C1, C2.
- **Deliverables:**
  - the scheduler (only previews pre-emptible; never terminate before posting; start-up timeout and requeue-once);
  - the protocol v2 handshake;
  - diagnostics counters;
  - revision-checked commits;
  - frozen export snapshots;
  - single-build service-worker behaviour.
- **Automated tests**, against the **production build** in 3 engines, online, offline and across a service-worker update:
  - the R03 scenarios 1–12;
  - the **WebKit start-up-churn reproduction**;
  - stale result and error drops counted;
  - an old tab after a new deploy;
  - an interrupted install;
  - a mixed-version refusal.
- **Performance:** cancel acknowledgement ≤ 200 ms; no attributable main-thread gap > 50 ms in job handling.
- **Owner acceptance:** a real Safari run (needs `safaridriver` authorisation), **or** a documented Safari restriction until it is run.
- **Stop if:** a preview can cancel an apply or export; committed state is lost on any termination; a mixed-version session can occur.
- **Debt:** TD-ARCH-002, TD-PERF-004 (scheduler part), TD-ARCH-006, TD-PLATFORM-006.
- **Regressions:** the existing P0 browser suites (`offline-recovery`, `smoke`, `csp`, `privacy`) still pass in 3 engines.
- **Prerequisites:** Safari authorisation for the owner part only.

### G-R0 — Minimal renderer with worker host (P1-A, engineering workbench)
- **Objective.** Prove the D04 architecture end to end in the engineering workbench and replace the SVG `<img>` preview.
- **Excludes:** the product UI; layered drag caches (G-R1); transform handles.
- **Depends on:** G-DOC (snapshots, store). It uses G-ENG packets, or the G-DOC fixture packets.
- **Contracts:** C8, C3, C9.
- **Deliverables:**
  - the Canvas 2D renderer with linear path construction;
  - the OffscreenCanvas render-worker host with the disclosed main-thread fallback;
  - the gesture display cache;
  - progressive first frame;
  - DPR handling;
  - interaction vs exact frame states;
  - the hit-test service (grid, subpath and band indexes, pre-flattened typed arrays);
  - a selection overlay;
  - the read-only import rule as an architectural test;
  - the SVG `<img>` kept behind a debug toggle.
- **Automated tests:**
  - correctness against resvg: 0 geometry-error pixels on the correctness fixtures in 3 engines, for the worker host and the fallback;
  - hit checks (holes, evenodd, clips);
  - Path2D scaling regression;
  - render-worker loss and recreation without document loss;
  - architectural import test.
- **Performance:** main-thread gaps ≤ 50 ms during load, gestures and settle in 3 engines (reference; review measured ≤ 24 ms). Other metrics are recorded as baselines.
- **Owner acceptance:** none beyond PR approval.
- **Stop if:** a correctness failure in any engine; the worker host cannot present in an engine and the fallback is not disclosed.
- **Debt:** TD-PERF-001 (first part), TD-REN-001, TD-REN-002 (measured), TD-REN-004.
- **Regressions:** the P0 preview measurements stay reproducible behind the debug toggle; no export change.
- **Prerequisites:** none. Real Safari presentation is checked in G-R1.

### G-UI — Design-system shell (P1-B)
- **Objective.** The production editor shell on the qualified D09 stack with the A16 fixes.
- **Excludes:** renderer internals; tools beyond selection and transform bindings.
- **Depends on:** G-DOC (commands to bind). It can run in parallel with G-JOB, G-R0 and G-R1.
- **Contracts:** DESIGN-SYSTEM (pins, tokens, CSP), RFC §7 coalescing.
- **Deliverables:**
  - root integration (exact pins, Tailwind plugin, alias, `CSPProvider disableStyleElements` plus the owned rule);
  - tool rail, inspector, layers with keyboard reordering;
  - dialogs and popovers;
  - an accessible slider and an owned or patched colour picker with commit/cancel;
  - corrected tokens with the dual focus ring;
  - extended notices for copied sources and CSS;
  - bundle measurement against the fixed baseline.
- **Automated tests:**
  - the R05-A suite promoted into the repo, 3 engines, 0 CSP violations (violation log drained before screenshots), zero network;
  - explicit qualification of the repaired slider and colour picker (names, values, keyboard, commit/cancel, coalesced history);
  - contrast table;
  - reduced motion;
  - screen-reader smoke test (VoiceOver).
- **Performance:** bundle ≤ provisional budgets (DESIGN-SYSTEM), with lazy chunks measured separately.
- **Owner acceptance:** visual review of the charcoal/lime shell against the mockups.
- **Stop if:** `unsafe-inline` is needed; a Radix primitive appears; an accessibility gap is unresolved without an approved exception.
- **Debt:** TD-UI-001 to TD-UI-004.
- **Regressions:** P0 CSP, privacy and offline suites; notices build check.
- **Prerequisites:** none for engineering. Real Safari for the owner sign-off.

### G-R1 — Production rendering and interactions (P1-B)
- **Objective.** Interactive editing at the interactive target, with correct compositing.
- **Excludes:** new renderer backends (WebGL stays a revisit path).
- **Depends on:** G-R0 and G-UI.
- **Contracts:** C8, C9, RFC §8.4.
- **Deliverables:**
  - **layered drag caches** that preserve compositing;
  - transform handles;
  - visibility and lock;
  - palette edits;
  - revision-aware invalidation;
  - bounded cache memory in the ledger.
- **Automated tests:** RFC §8.4 qualification against exact frames:
  - arbitrary and non-contiguous selections;
  - opaque and translucent overlaps;
  - clips and nested groups;
  - visibility and lock;
  - handles and palette changes;
  - invalidation during edits;
  - the R02 scenario suite as a repeatable benchmark.
- **Performance:** RFC §17 interaction and preview budgets on the reference machine **and the lower-end devices**. The preview ≤ 100 ms target is optimised here (progressive first frame); a miss goes to an owner decision.
- **Owner acceptance:** hands-on review; **lower-end hardware qualification**; **real Safari** qualification, or a documented restriction.
- **Stop if:** any compositing error versus exact frames; a budget miss at 250k without an owner decision.
- **Debt:** TD-PERF-001 (closure candidate), TD-PERF-004, TD-REN-002, TD-REN-003, TD-PLATFORM-002, TD-PLATFORM-003.
- **Regressions:** G-R0 correctness and hit-test suites; main-thread gap budget.
- **Prerequisites:** lower-end hardware access; Safari authorisation.

### G-TRACE — Artistic and Precision tracing in the product (P1-C)
- **Objective.** Trace tools with preview-resolution forecast, early fail, commit or replace, and the P1 core presets.
- **Excludes:** P2 presets.
- **Depends on:** G-JOB, G-R1 and G-ENG (estimator).
- **Contracts:** C4, C5, RFC §11.1, §18.
- **Deliverables:**
  - preview-resolution tracing;
  - forecast range with choices;
  - post-segmentation decision;
  - no import debounce;
  - P1 core presets: B&W, Full Colour, Limited Palette, Grayscale, Silhouette (Grayscale and Silhouette qualified here);
  - Artistic/Precision selection (precision v1 unless a newer version has been allocated).
- **Automated tests:**
  - estimator false-positive and false-negative rates on a **separately reserved corpus**;
  - no stale results;
  - replace is undoable;
  - preset fixture tests with vector-only checks.
- **Performance:** import → visible ≤ 500 ms at ~1 MP B&W; forecast within 2 s on qualified workloads (a qualification requirement).
- **Owner acceptance:** artistic review on licensed photographs.
- **Stop if:** silent downsampling or auto-rejection on a forecast.
- **Debt:** TD-PERF-002 (closure candidate), TD-PERF-004.
- **Regressions:** Artistic default and Precision v1 outputs byte-identical (326 + 72).
- **Prerequisites:** none.

### G-EDIT — Geometry operations (P1-C)
- **Objective.** Smooth, Simplify, Cleanup and Recolor, as Rust operations producing new chunks.
- **Excludes:** nodes, booleans, offset (P2-A).
- **Depends on:** G-ENG, G-DOC and G-R1.
- **Contracts:** C2, C4, RFC §13.
- **Deliverables:** the operations with deviation and node-count reports; operation descriptors.
- **Automated tests:** the PRD-002 acceptance scenarios (holes preserved; tolerance reported; exact undo).
- **Performance:** operations on a 30k-path layer within budget, with progress.
- **Owner acceptance:** review.
- **Stop if:** any topology change without explicit authorisation.
- **Debt:** none closed.
- **Regressions:** global rule; no trace-output change.
- **Prerequisites:** none.

### G-EXP — Frozen-snapshot vector export (P1-C)
- **Objective.** Export SVG and PDF from frozen snapshots via the packet route and draw-list baking (C3.1, C4).
- **Excludes:** CMYK, PDF/X, spot colours, print certification; raster output of any kind.
- **Depends on:** G-ENG, G-DOC and G-JOB; UI hook after G-UI.
- **Contracts:** C3, C4, C5.
- **Deliverables:** the export job; physical size; background option.
- **Automated tests:**
  - unedited P0 bytes identical;
  - `verify-exports.mjs` (vector-only; qpdf and poppler);
  - export unaffected by concurrent edits.
- **Performance:** exporting 1M anchors does not block interaction.
- **Owner acceptance:** the owner opens the SVG and PDF in external tools.
- **Stop if:** any raster appears in an export.
- **Debt:** none; preserves the P0 export approvals.
- **Regressions:** P0 export verification (`verify-exports.mjs`, qpdf and poppler) unchanged.
- **Prerequisites:** none.

### G-PRJ — Save/Open UI (P1-C)
- **Objective.** User-facing Save/Open on the container v1 from G-DOC.
- **Excludes:** autosave, libraries, recent files, OPFS/IndexedDB, cloud.
- **Depends on:** G-DOC and G-UI.
- **Contracts:** C7.
- **Deliverables:**
  - file input and download (save off the main thread: 0.8–2.0 s compression measured for 1M anchors);
  - source-inclusion opt-in;
  - missing-source UI with digest-verified relinking.
- **Automated tests:** round trip in 3 engines; the container adversarial suite through the UI path; atomic failure.
- **Performance:** opening a 1M-anchor project ≤ 1 s (review primitives ≈ 0.1–0.15 s).
- **Owner acceptance:** scope as approved at G-0.
- **Stop if:** any automatic persistence of artwork.
- **Debt:** none.
- **Regressions:** the G-DOC container suites.
- **Prerequisites:** none.

### G-GEO — Geometric fidelity (curve fitting) (P1-C, geometry track)
- **Objective.** Fix curve-fitting defects (TD-GEO-003/004, plus TD-GEO-002 where in scope) behind a **provisional** identifier (`precision-next-geo`).
- **Excludes:** shared-boundary graph; editor work.
- **Depends on:** G-ENG.
- **Contracts:** C6.
- **Deliverables:**
  - first, a **byte-neutral** refactor of the precision fitter API (the end-constrained open-section fitter), proven by hashes;
  - then the fixes on the provisional path.
- **Automated tests:**
  - pre-registered tiers on the existing corpus;
  - curve metrics;
  - no Artistic or Precision v1 regressions.
- **Performance:** fitter time and memory against the precision v1 PERFORMANCE-REGRESSION baseline, reported.
- **Owner acceptance:** a visual bundle (clean circles, 04, 05, rings, real artwork). **No version is allocated at G-GEO acceptance** (C6). The fixes stay on `precision-next-geo` until the joint v2 qualification.
- **Stop if:** a threshold change after seeing results; a v1 hash change.
- **Debt:** TD-GEO-003, TD-GEO-004, TD-GEO-002 (partial).
- **Regressions:** 326 + 72 hashes byte-identical (Artistic and v1 untouched).
- **Prerequisites:** none.

### G-SB — Shared-boundary graph (P1-C → may defer to P2)
- **Objective.** The trace-local graph (RFC §12.3) behind `precision-next-sb`, qualified with G-GEO for the planned v2. The **joint v2 release qualification**, which spends the fresh holdout once.
- **Excludes:** editor integration beyond materialisation at commit; global linked edges; plate coupling.
- **Contracts:** C6 (version allocation), C3 (outputs are standard packets), RFC §12.4 metrics.
- **Depends on:** G-GEO (fitter API), the restated metric (ratified at G-0), and a **fresh, untouched holdout corpus**.
- **Deliverables:** the graph, junction-local correction and junction estimator; stacked and mosaic output; emitted-geometry validators.
- **Automated tests:** the RFC §12.4 metrics table plus validators, run on:
  - the existing corpus;
  - then the **pre-registered** fresh holdout, **once**, after an implementation freeze;
  - negative controls (0 substitutions);
  - real artwork.
- **Performance:** edge, junction and face counts, time and memory versus precision v1, with budget rejection before fitting.
- **Owner acceptance:** the visual bundle; **v2 allocation** (C6).
- **Stop if:** an Artistic or v1 byte change; post-hoc threshold changes or fixture removal.
- **Deferral:** allowed to P2. It must stay **visible** in reports and must not be presented as a precision-quality qualification. The maintainer decides v2 allocation (RFC §12.2).
- **Debt:** TD-GEO-001, TD-GEO-009, TD-GEO-010.
- **Regressions:** 326 + 72 hashes byte-identical; negative controls unchanged.
- **Prerequisites:** metric restatement (decided at G-0); a fresh holdout corpus assembled and pre-registered before the freeze.

## Sequencing summary
1. **G-0 approval**, then **P-CI**, then **G-ENG ‖ G-DOC**.
2. **G-JOB** and **G-R0**, with **G-UI** starting once G-DOC is merged.
3. **G-R1**, then **G-TRACE**, **G-EDIT**, **G-EXP** and **G-PRJ**.
4. The geometry track **G-GEO → G-SB** runs in parallel after G-ENG.
