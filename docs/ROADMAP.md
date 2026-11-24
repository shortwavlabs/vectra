# Roadmap
Documentation review precedes implementation. P0 status (2026-11-23, branch `p0/technical-feasibility`, awaiting maintainer review): G0 PASS (macOS; Linux NOT RUN), G1 PASS, G2 PASS, G3 PASS (owner viewer checks pending), G4 PARTIAL (deploy OWNER TEST PENDING), G5 PARTIAL (WebKit offline cancel-recovery defect; mobile and Safari NOT RUN). See docs/research/p0/FINAL-REPORT.md.

| Phase | Deliverables | Exit |
|---|---|---|
| P0-G0 | Pin Vite+, TS, Rust, wasm-bindgen; clean dev/check/test/build | reproducible Linux/macOS build, lockfiles |
| P0-G1 | VTracer stable and candidate comparison, browser WASM adapter | binary/color/alpha fixtures trace; exact revision and license audit |
| P0-G2 | Worker protocol, transfer, cancel, memory | stale-result and responsiveness tests |
| P0-G3 | canonical scene, SVG and PDF proof | independent vector-only and page-size verification |
| P0-G4 | Pages preview deploy | clean static build, MIME/headers/assets confirmed |
| P0-G5 | privacy and initial benchmark | network/offline test, performance report |
| P1 | polished workspace, six core presets, export | core PRD and validation gates |
| P2 | Old Print, halftone, screen print, poster, comic | deterministic vector styles and owner art review |
| P3 | woodcut, engraving, blueprint, stencil, batch/PWA | per-feature qualification, no silent raster fallback |

P0 may use a disposable harness; no polished UI before engine proof. Each gate has its own report and reviewable commit. Stop and report if a dependency fails instead of silently substituting it. Scope changes require RFC update. After P0, pick a release version and actual browser support from evidence.
