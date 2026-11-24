# Roadmap
Documentation review precedes implementation. No gates passed yet.

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
