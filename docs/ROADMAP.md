# Roadmap
Documentation review precedes implementation.

**P0 is accepted and complete** (2026-11-24) as an engineering baseline: P0, P0-R and P0-R-GEO were merged via PR #3. Records: docs/research/P0-ACCEPTANCE.md, docs/TECHNICAL-DEBT.md, docs/P1-HANDOFF.md.

**Next** (RFC-002 reconciled at G-0, 2026-11-25; **pending maintainer approval**; gates in [G0-P1-IMPLEMENTATION-PLAN](research/g0/G0-P1-IMPLEMENTATION-PLAN.md)):
1. **G-0** — maintainer approval of the reconciled RFC-002. Then **P-CI**, the minimal required CI job.
2. **P1-A** — G-ENG (engine API, GeometryPacket) ‖ G-DOC (document, GeometryStore, history, `.vectra` serializer); then G-JOB (scheduler, worker lifecycle) and G-R0 (minimal renderer).
3. **P1-B** — G-UI (design-system shell) and G-R1 (production rendering; lower-end and real Safari qualification).
4. **P1-C** — G-TRACE (Artistic and Precision tracing; P1 core presets B&W, Full Colour, Limited Palette, Grayscale, Silhouette), G-EDIT, G-EXP, G-PRJ (Save/Open), G-GEO, G-SB (may defer to P2).
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
| P3 | woodcut, engraving, blueprint, stencil, batch/PWA | per-feature qualification, no silent raster fallback |

P0 may use a disposable harness; no polished UI before engine proof. Each gate has its own report and reviewable commit. Stop and report if a dependency fails instead of silently substituting it. Scope changes require RFC update. After P0, pick a release version and actual browser support from evidence.
