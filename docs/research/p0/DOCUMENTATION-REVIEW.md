# P0 documentation review (pre-implementation)

Date: 2026-11-23 · Branch: `p0/technical-feasibility` · Baseline commit: `15f9e00` (in sync with `origin/main`)

Reviewed: README, AGENTS, CONTRIBUTING, docs/PRD, RESEARCH, RFC-001, PRESETS, VALIDATION, ROADMAP, DESIGN, DEPLOYMENT.
This review was written **before** any implementation. The baseline is treated as approved intent, not as evidence.

## Contradictions and ambiguities

| # | Finding | Where | Proposed resolution for P0 |
|---|---|---|---|
| D1 | `bw` says "linear luminance", Old Print says "perceptual luminance". A threshold of 128 on *linear* Y is visually light (L\* ≈ 76), which surprises users used to Inkscape/Potrace. | PRESETS | One documented formula for every preset: linearise sRGB, compute Rec.709 relative luminance Y, re-encode with the sRGB transfer curve to 0–255. Neutral greys map to their own value, so 128 stays mid-grey. Recorded in P0-G1. |
| D2 | The canonical scene lists `M/L/C/Q/Z` and transforms, but the P0 brief requires absolute coordinates, and PDF has no quadratic operator. | RFC-001 | P0 scene stores only absolute `M/L/C/Z`. Quadratics are converted to cubics on input; transforms are baked into the coordinates. Group clip rectangles are the only clipping primitive. Deviation recorded in RFC-001. |
| D3 | The input cap is "20 MiB / 12 MP desktop", but the benchmark plan asks for 24 MP. | VALIDATION | Keep the 12 MP default product cap (provisional). Benchmark 24 MP through an explicit engineering override to find the real ceiling, and report it as such. |
| D4 | AGENTS asks for "one gate at a time on review branches", while the P0 brief asks for one branch and one PR with per-gate commits. | AGENTS vs brief | Follow the brief (the maintainer's latest instruction): one branch, focused per-gate commits, one PR. |
| D5 | The ROADMAP G4 exit is a "Pages preview deploy", but the brief forbids deploying or requesting credentials without approval. | ROADMAP vs brief | Validate the build locally (`wrangler pages dev`, header/MIME checks, asset sizes). The real deploy is OWNER TEST PENDING. |
| D6 | RESEARCH E2 cites the VTracer web demo (`webapp/`) as evidence of browser viability. Upstream now excludes `webapp/` from the workspace, and the 1.0 changelog removes the demo GUI. | RESEARCH | E2 is stale. Browser viability must be shown by our own wasm32 build in a real browser. |
| D7 | ROADMAP says "stop and report if a dependency fails instead of silently substituting it". The baseline names VTracer *stable* as the baseline candidate, but 0.6.5 has defects that matter here (D8). | ROADMAP / RESEARCH | Compare candidates by experiment and report the selection explicitly. Any move away from a named candidate is recorded as a decision, not done silently. |
| D8 | VTracer 0.6.5 library defects found by source reading: binary mode thresholds on the **red channel only** (`x.r < 128`, fixed); transparency keying searches for a key colour with an **unseeded RNG** (`fastrand::Rng::new()`); keying only triggers if ≥20 % of pixels on five sampled rows have `a == 0`; `clap 2` and `image 0.23` are non-optional library dependencies. | upstream `vtracer-0.6.5/src/converter.rs` | Luminance, threshold, invert and alpha policy must live in `vector-engine`, whichever tracer is chosen. |
| D9 | RFC lists Tailwind/shadcn/Zustand as candidates. | RFC-001 | Not needed for a temporary workbench. Not added in P0. |
| D10 | DEPLOYMENT says "do not assume Pages has Rust or vp preinstalled". This is correct. Research confirms that the v3 build image has no Rust and runs Node 22 by default. | DEPLOYMENT | Recommend a local or pinned-CI build plus Wrangler direct upload. See P0-G4. |
| D11 | RFC-001's "SVGO optional" and the baseline's "SVGO" mention: SVGO's default preset rounds coordinates, merges paths and can turn curves into arcs. | RFC-001 | Not adopted in P0. The engine already writes fixed-precision absolute paths. Revisit only with a constrained plugin list and regression tests. |
| D12 | Cloudflare now recommends Workers Static Assets for new projects (blog, 2025-04-08). Pages remains supported. | DEPLOYMENT | Keep the static `dist/` output portable to both. Recorded as an open question for the maintainer. |

## Licensing observations

- There is no `LICENSE` file. README/CONTRIBUTING say "proposed MIT". P0 does **not** add a LICENSE file; the decision stays with the maintainer.
- `flo_curves` (a transitive dependency of VTracer 1.0 and of `visioncortex`) is **Apache-2.0 only**. That is compatible with distributing an MIT-licensed application, but the shipped bundle needs Apache-2.0 attribution and NOTICE handling. See DEPENDENCY-LICENSE-AUDIT.
- Poppler (`pdfimages`, `pdftoppm`) is GPL. It is used only as an external inspection tool and is never linked or distributed.

## Technical risks identified before coding

1. Synchronous WASM in a single-threaded worker cannot observe a JS cancel request (no shared memory without `SharedArrayBuffer`). Cancellation must be implemented as terminate-and-recreate. VTracer 1.0's `CancelToken` is **not** an advantage in the browser.
2. A strict CSP (`script-src 'self'`) blocks WebAssembly compilation unless `'wasm-unsafe-eval'` is present. This must be tested in all three engines.
3. A halftone made of non-overlapping circles on a square grid tops out at π/4 ≈ 78.5 % coverage. Area-proportional tone mapping saturates in the shadows unless dots are allowed to overlap.
4. Large scenes (halftones) can produce multi-MB SVG/PDF. The size and primitive-count guards must be measured.
