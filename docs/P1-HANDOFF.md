# P1 handoff

The entry point for the next engineering phase.
- **Baseline status.** P0 (with P0-R and P0-R-GEO) is accepted as an engineering baseline, not a production release; see [P0-ACCEPTANCE](research/P0-ACCEPTANCE.md).
- **Next step: RFC-002.** This document does not write RFC-002 or choose its architecture. It hands over what exists, what is decided and what RFC-002 must answer.

## 6.1 Accepted baseline
**What runs today** (`main` after PR #3):
- **Engine** (`crates/vector-engine`, pure Rust, no I/O or clocks):
  - **Modes:** Black & White, Full Color, Limited Color (palette) and Old Print vector halftone.
  - **Fit modes:**
    - `spline` (default): VTracer, the approved **Artistic** behaviour for photographs and organic art;
    - `polygon` and `pixel`;
    - `precision` (opt-in): Vectra's sub-pixel G1 fitter for logos and geometric art, `PRECISION_FIT_VERSION` 1.
  - **Pipeline:** Vectra-owned pre-processing (luminance, threshold, alpha keying, palette) → VTracer segmentation and colour fitting → fitting → one validated **scene v1** (absolute M/L/C/Z, fill rules, rect clips, palette ids; 0.01 px quantisation).
  - **Validation:** explicit resource limits (12 MP default pixels, 1 M anchors, 20 MiB input) with typed, recoverable errors.
- **Exports.** SVG (allowlisted) and PDF (direct `pdf-writer`), both from the same validated scene. Vector-only; physical page size; deterministic bytes.
- **WASM.** `packages/vector-engine-wasm` (wasm-bindgen 0.2.130, `--target web`), running in a module Web Worker.
- **Worker.** Typed protocol, latest-wins jobs, terminate-and-recreate cancellation, stale-result rejection, recycling above 1 GiB WASM memory.
- **Offline.** A content-versioned service worker precaches the build, so cancellation and recovery work offline under the strict CSP.
- **Workbench.** A temporary React engineering workbench (`src/`), not the product UI: mode and fit settings, preview, SVG/PDF download, instrumentation.
- **Distribution.**
  - MIT `LICENSE` (Copyright (c) 2026 Stephane Pericat).
  - Generated `THIRD-PARTY-NOTICES.txt` (35 components), shipped and build-checked.
  - `public/_headers` with CSP (`'wasm-unsafe-eval'`).
  - `wrangler.jsonc` (assets-only; never deployed).
- **Reproducibility.**
  - Pinned toolchain: Node 24.22.1, pnpm 12.23.0, Vite+ 1.7.0, Rust 1.96.0.
  - Linux arm64 container verification: `scripts/linux-verify.sh`.
  - WASM output fingerprints: `scripts/wasm-fingerprint.mjs`.
- **Test and evaluation assets:**
  - Rust tests: engine, geometry metrics, precision.
  - Playwright suites: Chromium, Firefox, WebKit.
  - Procedural and analytic geometry corpora.
  - A byte-level regression corpus (`regression_corpus`, baseline hashes in `docs/research/p0-r-geo/artifacts/regression/`).
  - Export verification (`scripts/verify-exports.mjs`, qpdf and poppler).
  - Geometry tools: `geo_eval`, `geo_inspect`, `geo_bundle`, `geo_perf`.

**Working commands:**
```bash
pnpm install && pnpm run build                 # WASM + app + notices check + service worker + dist check
pnpm exec vp check && pnpm exec vp test && cargo test --workspace --locked
pnpm exec playwright test                      # browser suites (3 engines)
cargo run --release -p vector-engine --example geo_eval -- tests/output/geo-eval rejected,validation,negative spline,selected
```

**Known limitations:** the 25 open items of the [technical debt register](TECHNICAL-DEBT.md).

## 6.2 Architectural decisions (accepted)
| Decision | Status | Source |
|---|---|---|
| Local-first Rust/WASM engine in a module Web Worker; no server processing; no AI in the creative runtime | Approved | [RFC-001](RFC-001.md), [P0 final report](research/p0/FINAL-REPORT.md) |
| Stack: Vite+, React, TypeScript, Rust, wasm-bindgen; exact pins and lockfiles | Approved | RFC-001; [P0-G0](research/p0/P0-G0-TOOLCHAIN.md) |
| `vtracer =1.0.0-alpha.4` behind the `trace.rs` adapter | Approved **provisionally** (reconsideration conditions in RFC-001; TD-ARCH-001) | [P0-G1](research/p0/P0-G1-VECTORIZATION.md) |
| Direct Rust PDF (`pdf-writer`) and SVG from one validated scene; no jsPDF or svg2pdf.js in production | Approved | [P0-G3](research/p0/P0-G3-VECTOR-EXPORT.md) |
| Canonical scene with absolute M/L/C/Z **for the evaluated scene**; the editable document is RFC-002's decision | Approved | RFC-001; [P1-ARCHITECTURAL-INPUTS](research/p0-r/P1-ARCHITECTURAL-INPUTS.md) |
| Vectra-owned alpha, luminance, threshold and palette policy | Approved | RFC-001 |
| Terminate-and-recreate cancellation, with service-worker offline recovery | Approved (lifecycle consequences: TD-ARCH-002) | [OFFLINE-WORKER-RECOVERY](research/p0-r/OFFLINE-WORKER-RECOVERY.md) |
| Versioned service worker | Approved | same |
| Precision fit mode, explicitly opt-in; spline remains the default | Approved | [SELECTED-CORRECTION](research/p0-r-geo/SELECTED-CORRECTION.md) |
| User-facing terminology "Artistic" (spline) and "Precision" (precision); internal identifiers unchanged | Approved (future UI) | [P0-ACCEPTANCE](research/P0-ACCEPTANCE.md) |
| Hosting: Cloudflare Workers Static Assets, assets-only; deployment deferred until a suitable UI exists; tentative domains `vectrapress.ink`, `vectrapress.com` (none registered) | Approved | [DEPLOYMENT](DEPLOYMENT.md), [DEPLOYMENT-READINESS](research/p0-r/DEPLOYMENT-READINESS.md) |
| MIT license, Copyright (c) 2026 Stephane Pericat; generated notices | Approved | [LICENSING-AND-DISTRIBUTION](research/p0-r/LICENSING-AND-DISTRIBUTION.md) |

**Not yet decided (maintainer):**
- the P1 performance budget and lower-end target (proposed in PERFORMANCE-BASELINE; TD-PLATFORM-003);
- canonical Linux container builds for published hashes;
- CI policy (TD-PROCESS-001).

## 6.3 Product documentation
- [PRD-002: Vector Studio](PRD-002-VECTOR-STUDIO.md) (proposed), extending [PRD](PRD.md).
- [Vector Studio tools specification](VECTOR-STUDIO-TOOLS.md).
- [Creative Lab specification](CREATIVE-LAB.md).
- [Image sources and community specification](IMAGE-SOURCES-AND-COMMUNITY.md).
- [Brand and business strategy](BRAND-AND-BUSINESS.md).
- Workspace mockups: [`mockups/vectra-workspace.html`](mockups/vectra-workspace.html), [`mockups/vectra-workspace.svg`](mockups/vectra-workspace.svg), [`mockups/vectra-photo-search.svg`](mockups/vectra-photo-search.svg).
- [Preset algorithms](PRESETS.md), [Design](DESIGN.md), [Validation plan](VALIDATION.md), [Roadmap](ROADMAP.md).
- [Technical debt register](TECHNICAL-DEBT.md).
- [Engineering postmortem](research/P0-POSTMORTEM.md).
- [Architecture reconciliation with PRD-002](research/p0-r/ARCHITECTURE-RECONCILIATION.md) (inconsistencies R1–R9 to resolve).
- [P1 architectural inputs](research/p0-r/P1-ARCHITECTURAL-INPUTS.md) (the requirements table RFC-002 starts from).

## 6.4 What RFC-002 must consider
Start from [P1-ARCHITECTURAL-INPUTS](research/p0-r/P1-ARCHITECTURAL-INPUTS.md), which gives requirements, evidence and open questions per topic. RFC-002 must address at least:

| Topic | Driving evidence or debt |
|---|---|
| Editable document vs evaluated export scene (scene v1 stays an evaluation result) | TD-ARCH-003; postmortem "Editable document state…" |
| Stable object identities across re-evaluation | TD-ARCH-003 |
| Geometry ownership (worker vs main thread; handles vs copies) | TD-ARCH-002, TD-ARCH-003 |
| Layers and groups; locked source reference layer | P1-ARCHITECTURAL-INPUTS |
| Independent ink plates (registration, order, export) | TD-GEO-001 (plates must share boundaries without gaps or overlap) |
| Selection and hit testing on large scenes | TD-PERF-001 |
| Reversible transforms (document) vs baked coordinates (scene) | P1-ARCHITECTURAL-INPUTS |
| Undo/redo with bounded history and gesture coalescing | TD-ARCH-002 (must survive worker termination) |
| Arbitrary path clipping (SVG `clipPath`, PDF `W n`) | TD-ARCH-003, TD-GEO-006 |
| **Shared colour boundaries** (junction graph vs label-level correction; precision with mosaic) | **TD-GEO-001**, TD-GEO-009 |
| Large-scene rendering (Canvas 2D / WebGL / SVG DOM, caches, LOD, spatial index, typed buffers) | **TD-PERF-001**, TD-PERF-004 |
| Worker lifecycle and state recovery; scheduling, priorities, pools | **TD-ARCH-002**, TD-PERF-004 |
| Typed procedural effect pipelines (domains, units, seeds, resource estimates, cancellation) | P1-ARCHITECTURAL-INPUTS; TD-PERF-002 |
| Deterministic recipes (per decoded RGBA today; in-WASM decoding?) | **TD-GEO-007**, TD-PLATFORM-005 |
| Multiple source images and aggregate memory budgets | **TD-PERF-003** |
| Local project persistence (OPFS / downloads; migrations; limits) | P1-ARCHITECTURAL-INPUTS |
| `.vectra-preset` schema compatibility and versioning (presetVersion, `PRECISION_FIT_VERSION`) | SELECTED-CORRECTION "Versioning" |
| Explicit resource budgets with early estimation and recoverable errors | TD-PERF-002, TD-PERF-003, TD-PLATFORM-003 |
| Non-negotiables: local-only, no AI, genuine vector export (no raster fallback), strict CSP, deterministic seeded operations, MIT core | RFC-001; P1-ARCHITECTURAL-INPUTS |

### Technical debt by disposition
| Disposition | Items |
|---|---|
| **Must influence RFC-002** | TD-GEO-001, TD-GEO-007, TD-GEO-009, TD-PERF-001, TD-PERF-003, TD-ARCH-001 (adapter boundary), TD-ARCH-002, TD-ARCH-003 |
| **Address during P1** | TD-GEO-003, TD-GEO-004 (P1-C); TD-PERF-002, TD-PERF-004 (P1-A/B); TD-ARCH-004 (P1-A); TD-GEO-005 (P1 Line Art); TD-PLATFORM-002 (P1-B); TD-PLATFORM-003 (before the budget is ratified) |
| **Can remain deferred** | TD-GEO-002, TD-GEO-006, TD-GEO-008, TD-PERF-005 (P2), TD-PERF-006, TD-PLATFORM-001, TD-PLATFORM-004 (until a UI exists), TD-PLATFORM-005 (next Linux run), TD-PROCESS-001 (maintainer decision) |

## 6.5 Recommended development sequence
1. **RFC-002: Vector Studio architecture.** Document model, scene v2, rendering, worker lifecycle, shared boundaries, persistence, budgets.
2. **P1-A.** Editable document, layers, selection, transforms and history.
3. **P1-B.** Production workspace and rendering architecture.
4. **P1-C.** Core vector editing and tracing tools (Artistic and Precision tracing in the product UI).
5. **Later.** Creative effects and printmaking phases (Old Print, screen print, plates).

The exact implementation sequence is subject to RFC-002 approval.

## Working agreements carried forward
- Read [AGENTS.md](../AGENTS.md).
- Work one gate at a time on review branches. Never merge or deploy without maintainer instruction.
- Record exact commands, versions and failures; never claim untested results.
- Keep the WASM engine independent of the UI. No server and no telemetry. Never embed raster imagery in vector exports.
- Freeze a byte-level baseline before any engine change (`regression_corpus`), and keep spline output byte-identical unless a change is intended and approved.
- Add analytic and held-out fixtures with thresholds **before** evaluating algorithms. Pair numbers with an owner visual bundle.
