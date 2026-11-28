# Roadmap
Documentation review precedes implementation.

**P0 is accepted and complete** (2026-11-24) as an engineering baseline: P0, P0-R and P0-R-GEO were merged via PR #3. Records: docs/research/P0-ACCEPTANCE.md, docs/TECHNICAL-DEBT.md, docs/P1-HANDOFF.md.

**Next** (RFC-002 reconciled and **approved** at G-0, 2026-11-25; gates in [G0-P1-IMPLEMENTATION-PLAN](research/g0/G0-P1-IMPLEMENTATION-PLAN.md)):
1. **G-0** — approved (closes on merge). Then **P-CI**, the minimal required CI job.
2. **P1-A** — G-ENG (engine API, GeometryPacket) ‖ G-DOC (document, GeometryStore, history, `.vectra` serializer); then G-JOB (scheduler, worker lifecycle) and G-R0 (minimal renderer).
3. **P1-B** — G-UI (design-system shell) and G-R1 (production rendering; lower-end and real Safari qualification).
4. **P1-C** — G-TRACE (Artistic and Precision tracing; P1 core presets B&W, Full Colour, Limited Palette, Grayscale, Silhouette), G-EDIT, G-EXP, G-PRJ (project management and persistence; **the next product milestone after G-DOC-R**, see below), G-GEO, G-SB (may defer to P2).
5. **P2-A** — Line Art and advanced geometry. **P2-B** — effects. **P2-C** — Old Print, DIY Underground, Virtual Printing Press, initial Variation Lab. Later phases per [CREATIVE-LAB](CREATIVE-LAB.md).

P1 has not started.

Historical status before acceptance. P0 (2026-11-23): G0 PARTIAL (macOS PASS; Linux NOT RUN), G1 PASS, G2 PASS, G3 PASS (owner viewer checks pending), G4 PARTIAL (deploy OWNER TEST PENDING), G5 PARTIAL (WebKit offline cancel-recovery defect; mobile and Safari NOT RUN). See docs/research/p0/FINAL-REPORT.md. P0-R engineering closure (2026-11-24): see docs/research/p0-r/FINAL-REPORT.md for the updated gate matrix (Linux arm64 PASS, offline worker recovery PASS, notices PASS, deployment and LICENSE holder pending owner).

| Phase | Deliverables | Exit |
|---|---|---|
| P0-G0 | Pin Vite+, TS, Rust, wasm-bindgen; clean dev/check/test/build | reproducible Linux/macOS build, lockfiles |
| P0-G1 | VTracer stable and candidate comparison, browser WASM adapter | binary/color/alpha fixtures trace; exact revision and license audit |
| P0-G2 | Worker protocol, transfer, cancel, memory | stale-result and responsiveness tests |
| P0-G3 | canonical scene, SVG and PDF proof | independent vector-only and page-size verification |
| P0-G4 | Pages preview deploy | clean static build, MIME/headers/assets confirmed |
| P0-G5 | privacy and initial benchmark | network/offline test, performance report |
| P1 | *(superseded at G-0: see the gate plan above)* workspace, five core presets, export, Save/Open | gate reports and owner acceptance |
| P2 | *(superseded at G-0)* Line Art (P2-A); flagship Old Print, DIY Underground, Virtual Printing Press, initial Variation Lab (P2-C); the other Print presets (Halftone, Screen Print, Poster, Comic Ink) after the flagship within P2 | deterministic vector styles and owner art review |
| P3 | woodcut, engraving, blueprint, stencil, batch, full PWA qualification | per-feature qualification, no silent raster fallback |

**PWA scope (maintainer, 2026-11-26).** G-BRAND ships **basic installability** early: a web app manifest (`display: standalone`, local icons) on top of the existing build-aware offline service worker, so Chromium-based browsers may offer to install Vectra. This is not the P3 PWA deliverable. **Full P3 PWA qualification stays open:** install, update and uninstall across browsers and platforms, offline-first behaviour, file handling, and mobile and touch. P3 is not complete.

**Next product milestone: G-PRJ — Project Management and Persistence** (maintainer, 2026-11-26, G-DOC-R closure brief §5). The next user-facing gate after G-DOC-R. **G-PRJ-R (research and design) accepted on 2026-11-27**, with AM-3.1–3.5 approved and AM-3.6 deferred ([G-PRJ-DECISIONS](research/g-prj/G-PRJ-DECISIONS.md)); **G-PRJ-0 (persistence foundations) authorized and implemented, awaiting acceptance** ([G-PRJ-0 report](research/g-prj-0/G-PRJ-0-REPORT.md)); later stages follow the approved sequence, each after acceptance of the one before ([implementation plan](research/g-prj/G-PRJ-IMPLEMENTATION-PLAN.md)).
- **Scope:**
  - Save, Save As and Open for portable `.vectra` projects;
  - complete restoration of the artwork and the editable document;
  - unsaved-change tracking;
  - local autosave and crash recovery;
  - recent projects;
  - browser storage quotas and eviction handling;
  - safe, atomic file writes where the platform supports them;
  - a download/upload fallback for browsers without direct filesystem access;
  - version compatibility and rejection of malformed files;
  - project replacement and recovery from a failed save;
  - integration with the oversized-edit confirmation (TD-UI-006, M-8: authorised; it discloses that committing without history clears the existing undo and redo history, Cancel is the safe default, and the user may save a project copy first).
- **Constraints:**
  - The existing `.vectra` format is the starting point, not a reason to invent another format.
  - Local-first operation, offline support and no-account-required use are preserved.
  - Autosave is not a substitute for portable project files.
- **Persistence limits** (maintainer, G-DOC-R final acceptance, 2026-11-26). The 330k-path, 996k-anchor G-DOC-R workload exceeds C7's 64 MiB document-section cap (72.7 MB), so it cannot be saved today. G-PRJ investigates how these relate to each other:
  - supported document complexity;
  - canonical serialization size;
  - container section limits;
  - compressed and uncompressed project size;
  - browser memory requirements;
  - save and restore reliability;
  - security limits for untrusted files.
- **Requirements:**
  - every successfully saved project must be reopenable;
  - users must never get a successful-save indication for an invalid or unreopenable project.
  - Compact serialization, including the previously identified default-valued node encoding (TD-PERF-009), is investigated **before** higher limits or format changes are proposed.
  - Any C7 amendment requires explicit change control.
- **Inputs found so far:**
  - TD-PERF-009 (open ≤ 1 s) and its approved compact Document v1 serialization follow-up;
  - TD-PERF-010 (responsive opening);
  - the G-DOC-R finding that the 330k-path (996k-anchor) benchmark workload's document section (72.7 MB) exceeds C7's 64 MiB document cap, so that workload cannot be saved. It depends on serialized size per node, not path count alone: the 250k-path workload saves ([G-DOC-R report](research/g-doc-r/G-DOC-R-REPORT.md) §11.1).

**Approved later gate: G-COLOR-UI** (maintainer, 2026-11-26, M-9). It follows G-PRJ. Incremental `paletteLabels()` together with Recolor virtualisation. Strict provenance and palette semantics are preserved, and any retained usage index is accounted under AM-2 (C3.2 r3). Not started; not part of G-DOC-R.

P0 may use a disposable harness; no polished UI before engine proof. Each gate has its own report and reviewable commit. Stop and report if a dependency fails instead of silently substituting it. Scope changes require RFC update. After P0, pick a release version and actual browser support from evidence.
