# P0-G3: Canonical vector document and exports

**Gate status: PASS** for RGB vector SVG and PDF generated from one validated scene, verified with independent tools.

No PDF/X, CMYK or print-provider compliance is claimed. Inkscape round-trip and owner viewer checks are **OWNER TEST PENDING**.

## Objective
Define a minimal, versioned canonical scene. Generate SVG and PDF from the same validated scene. Prove with independent tooling that both contain only vector geometry.

## Canonical scene v1 (`crates/vector-engine/src/scene.rs`)
- **Document:** `version` (1), `width` and `height` in source-pixel units, `background` (optional RGBA), `palette[] {id, color}`, ordered `groups[] {id, clip?, paths[]}`, and `metadata`.
  - Metadata fields: generator, engineVersion, mode, presetVersion, seed, source size, and the validated settings. No filenames or user data.
- **Path:** `fill? {color, paletteId?}`, `stroke? {color, width}`, `fillRule` (nonzero/evenodd), `verbs` (a string over `M L C Z`), and `coords` (absolute; 2 per M/L, 6 per C).
  - Colours are straight sRGB `#rrggbb[aa]`, so alpha means transparency.
  - Clipping: an optional axis-aligned rectangle per group.
- **Deviation from RFC-001:** no `Q` and no transforms. Quadratics must be converted to cubics and transforms baked in before entering the scene. PDF has no quadratic operator, and absolute coordinates keep the serializers trivial. RFC-001 is updated to match.
- **Validation (`Scene::validate`):**
  - Version and dimensions; unique, well-formed ids (`[A-Za-z0-9_-]{1,64}`).
  - Palette references, with the colour required to match the referenced entry.
  - Verb grammar: M first, no segment after Z without M, exact coordinate counts.
  - Every coordinate finite and |v| ≤ 10⁶; stroke width bounds.
  - An anchor budget.
  - Deserialisation uses `deny_unknown_fields`, so unknown keys are rejected.
- **Determinism:** scene JSON → SVG is byte-identical across runs (tested on 13 fixtures × 5 modes). JSON round-trips losslessly.

## SVG export (`svg.rs`)
- Elements: `svg`, `desc`, `defs`, `clipPath`, `rect`, `g`, `path`.
- Root: `viewBox="0 0 W H"` with explicit `width` and `height`.
- Each path carries `fill`, `fill-opacity` (when alpha < 255), `fill-rule` and `class=<paletteId>`.
- Clip paths are referenced only as internal `url(#clip-<group>)`.
- Numbers: up to 3 decimals, trailing zeros trimmed, never `-0`, locale-independent.
- **Verified:**
  - Rust test: roxmltree parse, an element and attribute allowlist, no `<image>`, `<script>`, `foreignObject`, `href`, `<style>`, `data:` or xlink. Run on 13 fixtures × 4 modes.
  - Browsers: DOMParser parse plus the allowlist in Chromium, Firefox and WebKit on 13 fixture/mode cases, including both public-domain fixtures.
- **Geometry:** resvg renders of the SVG are what the G1 IoU, hole and transparency tests score.
- SVGO is **not** used. Its default preset rounds to 3 decimals, merges paths and converts curves to arcs, which conflicts with fidelity. It could be revisited with an explicit plugin list.

## PDF export: evaluation and decision
| Candidate | Version (license) | Result |
|---|---|---|
| **A. Direct `pdf-writer` from the scene (selected)** | pdf-writer 0.15.0 + miniz_oxide 0.9.1 (MIT OR Apache-2.0; Zlib option) | Runs inside the worker (no DOM). It has no code path that can embed images, fonts or XObjects. Output is deterministic: no dates or IDs. Producer string only. |
| B. jsPDF + svg2pdf.js | jspdf 4.2.1, svg2pdf.js 2.9.0 (MIT) | **Evaluated in all three browsers, not adopted.** It needs a live DOM, so it must run on the main thread. Output is raster-free on our SVGs, but 2–3.5× larger for simple scenes (1.27× for halftones). Every file carries 14 standard-font references, an empty `/XObject` resource dict and image ProcSets. `CreationDate` includes the local time and timezone, so output is non-deterministic and leaks that metadata. The agent research report adds: masks and filters are silently dropped, and jsPDF had 12 security advisories in 2025–26 (fixed in 4.2.1); `addSvgAsImage` rasterises. |
| C. Rust `svg2pdf` / krilla-svg | svg2pdf 0.13.0 (archived repo); krilla-svg 0.8.1 | Rejected without building it. svg2pdf is unmaintained. krilla-svg always links resvg and tiny-skia and rasterises SVG filters, which risks silent rasterisation. It is about 84 crates. |
| D. jsPDF native path API in the worker | — | A viable pure-TypeScript fallback. Not needed. |

Sources:
- https://github.com/typst/pdf-writer and https://docs.rs/pdf-writer/0.15.0
- https://github.com/yWorks/svg2pdf.js#purpose-and-security
- https://github.com/parallax/jsPDF/security/advisories
- https://github.com/typst/svg2pdf (archived)

npm and crates.io versions were re-verified on 2026-11-23.

### PDF writer details (`pdf.rs`)
- One page.
- `MediaBox` = physical size in points:
  - `mm × 72/25.4`, `in × 72`, `pt`, or `px × 72/dpi`.
  - Height follows the scene's aspect ratio.
  - Sides must be 1–14,400 pt (the PDF user-space limit). Out of range is an explicit error.
- Content stream:
  - `q`, then `cm` with scale s and a y-flip.
  - Optional background: `rg … re f`.
  - Per group: `q`, clip `re W n`, then paths using `m l c h` with `f`, `f*`, `S`, `B` or `B*`.
  - Fill and stroke alpha via ExtGState `/ca` and `/CA` (`gs`).
- Coordinates are emitted as f32. Error is below 0.001 px for scenes up to 16k px.
- The content stream is FlateDecode-compressed (miniz_oxide level 6).
- DeviceRGB only.

## Independent verification
`node scripts/verify-exports.mjs <dir> --dpi <n> --report <tsv>` checks:
- `qpdf --check`.
- A **`qpdf --json` scan of every object**, which covers nested resources. It fails on `/Image`, `/XObject`, `/Pattern`, `/Shading`, `/Font`, `/JavaScript`, `/JS`, `/EmbeddedFile` and `/URI`.
- `pdfimages -list` must report zero rows.
- Single page; `MediaBox` within 0.1 pt of the expected size.
- Content-stream operator inventory (from `qpdf --qdf`).
- A **poppler `pdftoppm` render compared with a resvg render of the sibling SVG**. These are two independent rasterisers. Comparison is per pixel and by 32×32-pixel block averages; only the block average is gated (≤ 2/255).

| Set | PDFs | qpdf --check | Forbidden objects | pdfimages | MediaBox | Render diff (block-32 mean, /255) |
|---|---|---|---|---|---|---|
| Engine, native build (`export_samples`, 13 fixtures × 6 modes), 300 dpi | 78 | 78 OK | 0 | 0 images in all | all within 0.1 pt | median 0.08, **max 0.93**: all pass |
| Same set, 150 dpi | 78 | – | – | – | – | median 0.10. **1 above 2**: `gradient-halftone-transparent` at 4.9. Its ~10 px dots are dominated by renderer anti-aliasing; the same file is 0.8 at 300 dpi. |
| Browser downloads (Chromium, Firefox, WebKit; 4 files each, 150 mm) | 12 | checked by Playwright: `%PDF-`, no `/Image`, `/XObject`, `/Font` or `/JavaScript`; MediaBox ±0.1 pt | | | | |
| jsPDF + svg2pdf.js (6 samples × 3 browsers), 300 dpi | 18 | OK | **`/XObject` (empty dict) and `/Font` (14 standard fonts) present** | 0 images | OK | 0.21–1.02 |

Raw reports:
- `artifacts/export-verification-native-300dpi.tsv`
- `artifacts/export-verification-native-150dpi.tsv`
- `artifacts/export-verification-svg2pdfjs-{chromium,firefox,webkit}-300dpi.tsv`
- `artifacts/pdf-eval/*-summary.json`

Engine content-stream operators observed across all 78 files: `q Q cm rg re W n m l c h f f*`. The inventory also lists PDF structure tokens such as `obj` and `endobj`, which come from the qdf dump.

Why per-pixel diffs differ: poppler and tiny-skia anti-alias differently. On dense overlapping halftone dots, the per-pixel mean difference reaches 1.4–9/255 depending on resolution, while tone in 1/10-image bands matches within about 0.3/255. Investigation: `render_compare` at 72/150/300/600 dpi, plus band profiles.

**Transparency behaviour:**
- Transparent backgrounds stay transparent in both formats: no background rect unless the scene has one.
- `fill-opacity` / `/ca` is implemented and unit-covered.
- Partially transparent *source* pixels are binarised at the alpha threshold (see G1), so no current preset emits alpha < 255.
- How different PDF viewers treat `/ca` was **not** compared beyond poppler.

## Known limitations
- No `Q` or transforms in the scene (by design). Strokes are supported by the scene and both serializers, but no P0 preset emits them.
- PDF `CreationDate`, title and XMP metadata are intentionally absent. Add them only with a privacy review.
- No PDF/A, PDF/X, CMYK, ICC output intents or spot colours.
- Inkscape round-trip, Acrobat and Preview viewing, and print-provider preflight: **OWNER TEST PENDING**.

## Reproduction
```text
cargo run --release -p vector-engine --example export_samples -- tests/output/native
cargo build --release -p vector-engine --example render_compare
node scripts/verify-exports.mjs tests/output/native --dpi 300 --report /tmp/verify.tsv
pnpm exec playwright test tests/browser/pdf-eval.spec.ts   # jsPDF + svg2pdf.js comparison
node scripts/verify-exports.mjs tests/output/pdf-eval/chromium --dpi 300
```
Tools: qpdf 12.4.2 (Apache-2.0), poppler 26.11.0 (GPL; used as an external tool only), resvg 0.50.0 (dev dependency).
