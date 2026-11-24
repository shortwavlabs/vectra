# Research and evidence register
2026-11-23 | desk research only; no prototype or benchmark executed.

## Primary-source findings
| ID | Evidence | Implication |
|---|---|---|
| E1 | [Vite+ guide](https://www.viteplus.dev/guide/), [check](https://viteplus.dev/guide/check), [build](https://viteplus.dev/guide/build), [CI](https://viteplus.dev/guide/ci) | Unified dev/check/test/build is documented. Pin a tested release; verify clean Linux build rather than assume global vp exists. |
| E2 | [VTracer repository](https://github.com/visioncortex/vtracer), [web demo source](https://github.com/visioncortex/vtracer/tree/master/webapp), [releases](https://github.com/visioncortex/vtracer/releases) | Color and binary tracing with curve fitting are plausible; browser demo exists. Recent 1.0 architecture has pluggable stages, but release maturity and browser packaging require verification. Node WASM package is not proof of browser compatibility. |
| E3 | [VTracer Cargo manifest](https://github.com/visioncortex/vtracer/blob/master/Cargo.toml), [license](https://github.com/visioncortex/vtracer/blob/master/LICENSE) | Upstream metadata indicates permissive licensing; audit exact pinned revision and transitive dependencies. |
| E4 | [svg2pdf.js](https://github.com/yWorks/svg2pdf.js/), [license](https://github.com/yWorks/svg2pdf.js/blob/master/LICENSE) | Browser PDF conversion via jsPDF is documented; supported subset and vector-only behavior require inspection. |
| E5 | [MDN workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [transferables](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects), [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) | Worker processing and ownership transfer are viable; feature-detect canvas APIs and provide fallback. |
| E6 | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [headers](https://developers.cloudflare.com/pages/configuration/headers/) | 25 MiB per static asset; configure security headers via public/_headers. Actual deploy and response headers must be tested. |

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
