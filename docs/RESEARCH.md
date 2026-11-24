# Research and evidence register
2026-11-23 | desk research baseline, followed by P0 experiments (docs/research/p0). Rows E1–E6 remain as written; P0 corrections are in "P0 evidence" below.

## Primary-source findings
| ID | Evidence | Implication |
|---|---|---|
| E1 | [Vite+ guide](https://www.viteplus.dev/guide/), [check](https://viteplus.dev/guide/check), [build](https://viteplus.dev/guide/build), [CI](https://viteplus.dev/guide/ci) | Unified dev/check/test/build is documented. Pin a tested release; verify clean Linux build rather than assume global vp exists. |
| E2 | [VTracer repository](https://github.com/visioncortex/vtracer), [web demo source](https://github.com/visioncortex/vtracer/tree/master/webapp), [releases](https://github.com/visioncortex/vtracer/releases) | Color and binary tracing with curve fitting are plausible; browser demo exists. Recent 1.0 architecture has pluggable stages, but release maturity and browser packaging require verification. Node WASM package is not proof of browser compatibility. |
| E3 | [VTracer Cargo manifest](https://github.com/visioncortex/vtracer/blob/master/Cargo.toml), [license](https://github.com/visioncortex/vtracer/blob/master/LICENSE) | Upstream metadata indicates permissive licensing; audit exact pinned revision and transitive dependencies. |
| E4 | [svg2pdf.js](https://github.com/yWorks/svg2pdf.js/), [license](https://github.com/yWorks/svg2pdf.js/blob/master/LICENSE) | Browser PDF conversion via jsPDF is documented; supported subset and vector-only behavior require inspection. |
| E5 | [MDN workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [transferables](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects), [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) | Worker processing and ownership transfer are viable; feature-detect canvas APIs and provide fallback. |
| E6 | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [headers](https://developers.cloudflare.com/pages/configuration/headers/) | 25 MiB per static asset; configure security headers via public/_headers. Actual deploy and response headers must be tested. |

## P0 evidence (2026-11-23)
| ID | Evidence | Implication |
|---|---|---|
| E2 (correction) | The VTracer `webapp/` demo is excluded from the upstream workspace and was removed in 1.0. 0.6.5 and 1.0.0-alpha.4 both compile to wasm32 and run in Chromium, Firefox and WebKit. | E2's browser-demo evidence is stale. Our own build is the evidence (P0-G1). |
| E7 | VTracer keys transparency only when ≥20 % of five sampled rows are transparent, so an off-row transparent hole is filled (leak 1.0 in both versions). | Alpha policy belongs in Vectra (P0-G1). |
| E8 | svg2pdf.js 2.9.0 requires a live DOM. jsPDF 4.2.1 + svg2pdf.js PDFs carry 14 font references, an empty /XObject and a CreationDate with timezone. pdf-writer 0.15.0 output passes qpdf/pdfimages with zero image or font objects. | Direct PDF writer selected (P0-G3). |
| E9 | Cloudflare Pages build image v3: no Rust, pnpm 10, 20-minute limit. `wrangler pages dev` applies `_headers` and serves `.wasm` as `application/wasm`. Cloudflare recommends Workers Static Assets for new projects. | Local or CI build + direct upload. Real deploy pending (P0-G4). |
| E10 | Browser decoders produce different RGBA for the same JPEG (WebKit vs Chromium/Firefox) and for semi-transparent PNG pixels (premultiplied canvas). | Cross-browser determinism needs in-WASM decoding (P1 option). |
| E11 | Desktop measurements (M5 Max): 24 MP colour 2.4–3.3 s, limited colour 5–6 s, up to 913 MiB WASM memory. Main thread stays at one-frame gaps. | BENCHMARKS.md. Mobile not measured. |

## Candidate experiments
A: VTracer stable release with custom wasm-bindgen wrapper (baseline). B: newer pluggable VTracer revision only if it beats A and passes licensing/build gates. C: independent binary contour extraction + curve fitting for controlled comparison. Potrace is a useful external monochrome comparator; do not bundle until GPL/commercial terms reviewed. ImageTracerJS and AutoTrace are exploratory alternatives, not selected dependencies. Compare with Illustrator Image Trace and Inkscape Trace Bitmap using owner-provided results, not proprietary code or redistributed screenshots.

PDF candidates: jsPDF + svg2pdf.js first; Rust svg2pdf as alternative if WASM build and output tests pass; direct path writer as fallback. Raster conversion is prohibited. Compare geometry, alpha, fill rule, clipping, physical units and export size.

## Algorithm research
Binary thresholding: global Otsu vs manual vs local adaptive; compare noisy scans and thin lines. Color segmentation: deterministic Lab clustering or quantization, alpha-aware masks, hierarchical vs disjoint regions; evaluate shared-edge seams. Contour tracing: closed boundaries, nested holes, curve fitting and corner preservation. Artistic synthesis: vector dot grids, clipped hatch strokes, deterministic boundary perturbation, controlled ink palettes. Do not promise true engravings from arbitrary photographs; evaluate against style references.

## Open questions
- Which exact VTracer version builds in browser-target WASM and supports needed alpha/hole semantics?
- Does final export preserve the same scene as preview? How do different PDF renderers treat transparency?
- What are safe browser memory limits on mobile Safari? Establish via measurement.
- Can Vite+ install/build reproducibly in Pages without custom CI? Test direct-upload fallback.
- Can the product name coexist with existing software marks? No clearance performed.

All candidate decisions provisional until P0 reports contain pinned source revisions, commands, machine/browser metadata and raw results. No benchmark claims from documentation alone.
