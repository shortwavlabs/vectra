# R-COLOR-06 — Intentional raster export

Status: research, 2026-11-25. Prototype: the `raster` part of `experiments/r-color/cmm/src/bin/pdf_proto.rs`. Results: [artifacts/pdf/pdf-proto.json](artifacts/pdf/pdf-proto.json) (`raster`). Desk sources are listed at the end.

**Provenance of desk research.** The desk-research claims in this document were gathered on 2026-11-25 by delegated research agents. They worked from public pages under this gate's rules: no logins, no personal data. Their full notes, with quotations, are kept outside the repository in the gate's shared notes folder (`r-color-research-*.md`).

The author re-read these primary sources directly:

- the veraPDF validation scope;
- the ICC-registry licence for PSO Coated v3;
- NVD CVE-2026-41254 and CVE-2026-42798;
- Gelato's PDF requirements (which corrected "required" to "should" for PDF/X-4);
- IngramSpark's file-creation guide;
- Firefox's `StaticPrefList.yaml` colour-management defaults.

Every other desk claim is agent-gathered and was not re-read. Measured results come from the prototypes and are reproducible ([REPRODUCING](REPRODUCING.md)).

## 1. Principle

Raster export is a **separate, explicitly chosen format**:

- It is never produced when an SVG or PDF export fails.
- It is never placed inside an SVG or PDF.
- It is never presented as "vector".

The export dialog puts it under its own heading ("Raster image for print services"). It states the pixel dimensions before anything is written. That keeps RFC-002 principle 7 and the PRD non-goals intact.

**Why Vectra needs it at all.** The provider survey ([PRINT-PROVIDER-REQUIREMENTS](PRINT-PROVIDER-REQUIREMENTS.md)) shows that the services closest to Vectra's audience accept **only** PNG or JPEG: Redbubble, Spoonflower, Spring, Threadless, TeePublic, and Printful's preferred path. Without raster export, those users must rasterise elsewhere.

## 2. Candidate formats

| Format | Use | Colour | Alpha | DPI metadata | Notes |
|---|---|---|---|---|---|
| **RGB PNG, straight alpha** | garment and poster POD (most common request) | sRGB, embedded profile (iCCP) | yes | pHYs (px/m) | lossless; deterministic for a pinned encoder |
| RGB TIFF | photo labs, some printers | sRGB, tag 34675 | optional (ExtraSamples = 2, unassociated) | X/YResolution + unit | Deflate or LZW |
| **CMYK TIFF** | commercial printers that accept TIFF (FLYERALARM, SAXOPRINT) | device CMYK + embedded output profile | **no**: flatten on an explicit paper colour (FLYERALARM forbids alpha in TIFF) | X/YResolution | conversion of the flattened sRGB pixels |
| RGB JPEG | services that accept only JPEG | sRGB, APP2 ICC | no | JFIF density | lossy, poor for flat-colour line art; ≤ 65,535 px per side |

## 3. Measured prototype

The scene is the synthetic test scene of [VECTOR-PDF-COLOR-OUTPUT](VECTOR-PDF-COLOR-OUTPUT.md) (600 × 400 units; 15 paths; translucent overlaps; a clip). It was rendered from the **production SVG** (`vector_engine::svg::to_svg`) with resvg/tiny-skia 0.50.0 (the same pin as the production test-only renderer). The target was 200 mm wide at 300 ppi. Native aarch64, two runs (12:42 and 13:00), load average 2.1–3.6.

| Step | Result |
|---|---|
| Pixel size | 2,362 × 1,575 px (3.72 MP). 200 mm × 300/25.4 = 2,362.2, rounded; the physical size is 199.98 mm at exactly 300 ppi |
| Parse and render | 32–38 ms |
| RGBA PNG encode (iCCP Little CMS sRGB, pHYs 11,811 px/m) | 35–36 ms, 42,329–42,330 B. `sips` reports 300 × 300 dpi, profile "sRGB built-in", alpha yes |
| Flatten on white (encoded sRGB) + moxcms sRGB → CMYK, 8-bit | 29–31 ms |
| CMYK TIFF encode (Deflate, ICC tag, 300 ppi) | 10–12 ms, 102,037 B. `tiffinfo`: Photometric separated, 4 samples, 300 pixels/inch, ICC profile present (55,280 B). `sips`: space CMYK, profile read |
| Byte determinism | Within a process: PNG and TIFF **identical**. **Across runs:** TIFF identical (it embeds a fixed profile file); **PNG differs**, because the sRGB profile generated at run time by Little CMS carries the current time in its header (bytes 24–35). moxcms `encode()` does the same (measured). A generated profile must be generated once and committed as an asset, or have its header date normalised |
| Memory | premultiplied RGBA pixmap 14.9 MB (4 B/px), plus a CMYK buffer of the same size, plus the straight-RGBA and RGB copies |

**Compositing.** A raster export composites translucent objects in encoded sRGB, like the editor preview (tiny-skia and Canvas 2D both blend in the sRGB-encoded space), and *then* converts to CMYK. **A CMYK raster therefore matches the RGB preview's compositing; a CMYK vector PDF does not** ([VECTOR-PDF-COLOR-OUTPUT §5](VECTOR-PDF-COLOR-OUTPUT.md)).

## 4. Sizes, limits and memory

| Item | Value |
|---|---|
| Memory per megapixel | 4 MB RGBA8 (tiny-skia premultiplied); 4 MB CMYK8; 8 MB RGBA16 |
| A2 poster at 300 ppi (4,961 × 7,016 = 34.8 MP) | about 139 MB pixmap, plus about 139 MB CMYK |
| 24 × 36 in poster at 300 ppi (7,200 × 10,800 = 77.8 MP) | about 311 MB pixmap per copy: beyond a comfortable single buffer in a worker that recycles above 1 GiB (RFC-002 §3) |
| PNG | 2³¹−1 px per side (spec) |
| JPEG | encoders use u16 sizes (65,535 px); libjpeg-turbo `JPEG_MAX_DIMENSION` is 65,500 |
| Classic TIFF | 4 GiB file (BigTIFF beyond); the `tiff` crate writes BigTIFF, in strips, not tiles |
| Browser canvas (for comparison) | Chromium area ≤ 268,435,456 px; Safari 268 MP on macOS, 67 MP on iOS |
| Provider caps | Printful 20,000 px, 200 MB; Redbubble 13,500 px, 300 MB; Printify 100 MB |

**Large exports must stream in bands.**

- **How:** render N rows at a time into a band pixmap with a translated transform. Write PNG rows through `png::StreamWriter` and TIFF strips, so memory is O(width × band height).
- **Not yet tested:** whether band-rendered output is pixel-identical to a full-surface render, especially antialiasing at band seams. This must be a qualification test (NOT RUN).
- **Ceilings:** set by a memory estimate before allocation, with a typed error. Never fall back to silent down-sampling.

## 5. Antialiasing, determinism and renderer choice

| Option | Assessment |
|---|---|
| **resvg / tiny-skia** (Rust, in the engine worker) | Already pinned as a test-only renderer (=0.50.0). Supersampled antialiasing. Upstream claims identical pixels on all platforms and WASM support; cross-target identity is **not verified here** (NOT RUN). Licences MIT/Apache-2.0 (resvg), BSD-3-Clause (tiny-skia). Promoting it to production is a new production dependency that needs approval. Rendering from the scene directly, instead of through SVG text, would avoid the SVG round trip |
| vello_cpu 0.4.0 | u16 dimensions (≤ 65,535 px); u8 and f32 pipelines give different pixels; cross-platform determinism not claimed. Not preferred |
| Browser Canvas 2D (`OffscreenCanvas.convertToBlob`) | Browser-dependent antialiasing and limits. The canvas spec says exported files record **96 dpi** when the format supports resolution, so it cannot write 300 ppi metadata. Not suitable for print output |

**Raster ≠ preview.** The preview antialiasing (Canvas 2D) and the export antialiasing (tiny-skia) differ by renderer. Raster export must be qualified against its own reference, not against screenshots of the canvas.

## 6. Encoders

| Crate | Licence | ICC | Alpha | DPI | Notes |
|---|---|---|---|---|---|
| `png` 0.18.1 (pinned in production dev-dependencies) | MIT/Apache-2.0 | iCCP via `Info.icc_profile` or a raw chunk (measured: raw chunk) | straight | pHYs | Deflate output may change between versions without a semver break: **pin exactly** |
| `tiff` 0.11.3 | MIT | tag 34675 written as BYTE, where the spec expects UNDEFINED; libtiff and `sips` read it (measured) | RGBA8 writes **no ExtraSamples** unless set explicitly (issue #426) | X/YResolution (measured) | Deflate, LZW, PackBits; BigTIFF; strips only |
| `jpeg-encoder` 0.7.1 | MIT/Apache-2.0 **and IJG** (the DCT is derived from IJG code, so documentation must acknowledge it) | APP2 | no | JFIF | CMYK via Adobe APP14 |
| `image` 0.25.10 | MIT/Apache-2.0 | `set_icc_profile` | yes | JPEG only | weak for TIFF (no compression, DPI or CMYK). Not preferred |

## 7. Recommendation

1. **First print-relevant capability (P2):** sRGB PNG with straight alpha, embedded sRGB profile, explicit physical size and ppi, pixel dimensions shown before export, banded rendering. It serves the largest provider group and needs no CMYK engine.
2. **Then:** RGB TIFF, and **CMYK TIFF without alpha** on an explicit paper colour, using the export-time conversion table of [COLOR-ARCHITECTURE-PROPOSAL](COLOR-ARCHITECTURE-PROPOSAL.md).
3. **JPEG** only if a target provider requires it, with the IJG acknowledgement.
4. **Partial alpha warnings** for garment presets: Printful, Threadless and Zazzle all document problems with semi-transparent pixels on DTG and DTF.

## Sources (accessed 2026-11-25)

- WHATWG canvas (exported file resolution, colour conversion): <https://html.spec.whatwg.org/multipage/canvas.html>. PNG 3rd edition: <https://www.w3.org/TR/png-3/>.
- BigTIFF: <https://libtiff.gitlab.io/libtiff/specification/bigtiff.html>. libjpeg-turbo limits: <https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/main/src/jmorecfg.h>.
- Crates: <https://crates.io/api/v1/crates/png>, <https://docs.rs/crate/png/0.18.1/source/>, tiff (image-tiff v0.11.3, issue #426), jpeg-encoder v0.7.1, image v0.25.10, tiny-skia v0.12.0, resvg 0.50.0, <https://docs.rs/vello_cpu/0.4.0>.
- WebAssembly numerics (NaN and relaxed-SIMD non-determinism): <https://webassembly.github.io/spec/core/exec/numerics.html>.
- Provider limits: [PRINT-PROVIDER-REQUIREMENTS](PRINT-PROVIDER-REQUIREMENTS.md).
