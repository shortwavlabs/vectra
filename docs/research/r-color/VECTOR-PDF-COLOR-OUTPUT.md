# R-COLOR-04 — Vector PDF colour output

Status: research, 2026-11-25. Prototype: `experiments/r-color/cmm/src/bin/pdf_proto.rs` and `render_sample.rs`, run by `experiments/r-color/run-pdf.sh`. Results:

- [artifacts/pdf/pdf-proto.json](artifacts/pdf/pdf-proto.json)
- [artifacts/pdf/inspect.txt](artifacts/pdf/inspect.txt)
- [artifacts/pdf/render-samples.json](artifacts/pdf/render-samples.json)

The prototype PDFs embed a third-party profile and are **not committed**; they regenerate from the scripts.

**Provenance of desk research.** The desk-research claims in this document were gathered on 2026-11-25 by delegated research agents. They worked from public pages under this gate's rules: no logins, no personal data. Their full notes, with quotations, are kept outside the repository in the gate's shared notes folder (`r-color-research-*.md`).

The author re-read these primary sources directly:

- the veraPDF validation scope;
- the ICC-registry licence for PSO Coated v3;
- NVD CVE-2026-41254 and CVE-2026-42798;
- Gelato's PDF requirements (which corrected "required" to "should" for PDF/X-4);
- IngramSpark's file-creation guide;
- Firefox's `StaticPrefList.yaml` colour-management defaults.

Every other desk claim is agent-gathered and was not re-read. Measured results come from the prototypes and are reproducible ([REPRODUCING](REPRODUCING.md)).

## 1. The existing writer

`crates/vector-engine/src/pdf.rs` writes one page from a validated scene v1 with `pdf-writer` =0.15.0. Content operators:

| Kind | Operators |
|---|---|
| State | `q Q cm gs` |
| Colour | `rg RG w` |
| Path construction | `m l c h re` |
| Clipping | `W n` |
| Painting | `f f* S B B*` |

Constant alpha comes from one ExtGState per (fill alpha, stroke alpha) pair. There is no page transparency group, no output intent, no ICC profile, and MediaBox only. The page size comes from `PdfOptions { width, unit, dpi }` in points (1 pt = 1/72 in), and the height follows the aspect ratio.

**Colour is emitted in exactly three places:** background fill, path fill and path stroke. Geometry and colour are already separate concerns.

### 1.1 Can it express print structures without being replaced?

Yes. The table below is checked against the pinned crate source (`pdf-writer-0.15.0/src`) and, where marked, the prototype.

| Structure | `pdf-writer` 0.15.0 API | Prototype |
|---|---|---|
| DeviceRGB | `set_fill_rgb` / `set_stroke_rgb` | production (A) |
| ICCBased RGB + embedded profile | `ColorSpace::icc_based`, `Chunk::icc_profile(..).n(3)`, `cs`/`scn` | **B, B2** |
| DeviceCMYK | `set_fill_cmyk` / `set_stroke_cmyk` | **C, D** |
| ICCBased CMYK | same as RGB with `.n(4)` | API only (C uses DeviceCMYK under a CMYK output intent instead) |
| Output intent (`GTS_PDFX`, DestOutputProfile) | `Catalog::output_intents`, `OutputIntent::dest_output_profile` | **C, D, E** |
| Rendering intent (`ri`, ExtGState `RI`) | `types::RenderingIntent` | API only |
| Constant-alpha transparency | `ExtGraphicsState::non_stroking_alpha` / `stroking_alpha` | production |
| Page transparency group (`/Group /S /Transparency /CS`) | `Page::group().transparency().color_space()` | **A2, B2** |
| Vector clipping | `re W n` | production; unchanged in every variant |
| Physical size, MediaBox | `to_points`, `media_box` | production |
| TrimBox, BleedBox, CropBox (ArtBox) | `Page::trim_box` / `bleed_box` / `crop_box` | **C, D, E** |
| Crop and registration marks | ordinary strokes in the `/All` Separation | **C, D, E** |
| Separation (spot) with tint transform | `ColorSpace::separation(..).alternate_color_space().device_cmyk()` + `tint_ref`, `exponential_function` | **D** |
| DeviceN, overprint (`OP`, `op`, `OPM`) | `ColorSpace::device_n`, `ExtGraphicsState::overprint*` | API only |
| XMP metadata stream | `Chunk::metadata` | API only |

`DeviceColorSpace` is not re-exported by `pdf-writer` 0.15.0, so the alternate space is written through `alternate_color_space().device_cmyk()`.

## 2. Prototype

**Scene** (600 × 400 units, page 200 mm wide):

- one clipped group: a `#000000` "line-art" bar, an even-odd square with a hole, three translucent discs at alpha 128/255, a 5-step grey ramp including white, an out-of-gamut blue and a cubic stroke;
- one unclipped "spot ink" rectangle.

The scene validates with `Scene::validate`.

| Variant | Writer | Colour | Page |
|---|---|---|---|
| A-device-rgb | **production `to_pdf`, unmodified** | DeviceRGB | MediaBox |
| A2-device-rgb-group | prototype | DeviceRGB + page group `/CS /DeviceRGB` | MediaBox |
| B-icc-rgb | prototype | ICCBased (embedded sRGB profile) | MediaBox |
| B2-icc-rgb-group | prototype | ICCBased + page group in that space | MediaBox |
| C-cmyk | prototype | DeviceCMYK via moxcms (sRGB → CMYK profile, relative colorimetric, 8-bit); output intent `GTS_PDFX` with the CMYK profile | Trim = artboard, Bleed = +3 mm, Media = +10 mm, crop marks in `/All` |
| D-cmyk-spot | prototype | C, plus palette entry `spot-lime` as Separation "Vectra Lime" (Type 2 tint → its CMYK) and `#000000` as K only | as C |
| E-plate-spot | prototype | one plate: only `spot-lime` paths, DeviceGray 0 (black) | as C |

**No variant writes `GTS_PDFXVersion`, and none claims PDF/X.** The prototype writer's loop is a copy of the production loop with the colour calls replaced by a `Paint` mapping.

### 2.1 Structural checks (qpdf 12.4.2, poppler 26.11.0)

All seven files:

- `qpdf --check`: no syntax or stream errors;
- `pdfimages -list`: 0 images;
- `pdffonts`: 0 fonts;
- 0 `GTS_PDFXVersion` keys.

`pdfinfo -box` shows the C, D and E boxes exactly as designed: MediaBox 623.62 × 434.65 pt; TrimBox 28.35–595.28 × 28.35–406.30; BleedBox 8.50 pt (3 mm) outside the TrimBox.

**A bug that was caught.** The first prototype concatenated content fragments without white space (`cmq`, `QQ`). poppler reported "Unknown operator" while `qpdf --check` passed. **Structural validation is not content validation**; both are needed ([PRINT-QUALIFICATION-PLAN](PRINT-QUALIFICATION-PLAN.md)).

### 2.2 Geometry is preserved

The geometry operator sequence was compared with the production content stream after removing colour operators and their operands (`rg RG k K g G cs CS sc SC scn SCN`).

| Variant | Geometry tokens vs production (311) |
|---|---|
| A2, B, B2 | **identical** |
| C, D | identical except **4 operands**: the background rectangle, extended into the bleed by design |
| E | a strict subset (36 tokens: only the spot paths, with their group clips) |

Transforms (baked into scene coordinates), fill rules, clips and paint order are untouched. Changing output colour does not require touching geometry.

## 3. Output classes compared

| Class | What the numbers mean | Who wants it | Risk |
|---|---|---|---|
| **1. Portable RGB (current)** | DeviceRGB, interpreted by each viewer, in practice as sRGB | screen, web, most POD services (they take PNG anyway) | unmanaged; translucent compositing is viewer-dependent (§5.2) |
| **2. ICC-managed RGB** | ICCBased sRGB: the numbers are unambiguous | archives; printers that convert RGB themselves (Gelato allows sRGB objects in PDF/X-4) | about 3 KB larger (B: 4,598 B vs 1,216 B); not permitted as DeviceRGB under a CMYK output intent in PDF/X |
| **3. Profile-managed process CMYK** | DeviceCMYK meaning the chosen output condition, declared by an output intent | commercial printers (FLYERALARM, SAXOPRINT, MOO, Mixam, IngramSpark) | colour changes are intended (gamut, measured up to 19.5 ΔE00); translucency composites in CMYK (§5); black and white need rules (§4.2) |
| **4. Future PDF/X-4** | class 3 (or mixed) **plus** every PDF/X-4 requirement, verified by an independent validator | printers who require or prefer X-4 (Gelato asks for it) | conformance is a qualification result, not a writer feature ([PDFX-FEASIBILITY](PDFX-FEASIBILITY.md)) |

Classes 1 and 2 need no colour engine: ICCBased sRGB needs only an sRGB profile's bytes. Class 3 needs a CMM, a user-supplied output profile, and the rules below.

## 4. Conversion contract (classes 3 and 4)

### 4.1 Inputs are always explicit

1. **Source space:** sRGB (IEC 61966-2-1). The document's declared working space (AM-C1) is never guessed.
2. **Destination profile:** a validated output profile, identified by SHA-256 ([ICC-PROFILE-LIFECYCLE §4](ICC-PROFILE-LIFECYCLE.md)). There is no default CMYK profile.
3. **Rendering intent:** relative colorimetric by default, perceptual selectable. BPC is stated as "not applied" with the moxcms candidate (§4 of [ICC-ENGINE-EVALUATION](ICC-ENGINE-EVALUATION.md)).
4. **Engine identity:** engine name and version, recorded in the export report. In PDF metadata it is optional.

### 4.2 Per palette entry, or per paint operation?

**For Vectra's paint model they are the same computation.** Every paint operation is one flat colour plus a constant alpha. There are no gradients, images, blend modes or patterns (C10).

- **The table.** Converting each **distinct effective sRGB value** (alpha carried separately) once gives a table. Applying it at every paint operation is exactly per-paint conversion, at the cost of per-colour conversion. The prototype scene had 11 distinct colours.
- **Where it is built.** In the export worker, from the C8 export draw list, *after* document evaluation. Literal fills and palette references are both covered, because the draw list carries effective colours.
- **Integer quantisation.** Device values are quantised to an integer grid before writing: 8-bit or 1/10,000. The f32 path is not bit-identical between native and WASM (measured).

**Overrides are keyed by `paletteId`** (already in the C8 export draw list) and applied before the table:

| Override | Why it is needed (measured) |
|---|---|
| **K-only black** (`#000000` → 0/0/0/100) | ICC conversion gives 72/70/64/87, 294 % TAC. Line art, B&W traces and halftone ink would print on four plates. Several providers' TAC limits are 240–300 % |
| **Unprinted white** (`#ffffff` → no ink) | Little CMS and moxcms give 0/0.4/0.4/0: a faint tint on "paper". Treat white as paper or knock-out, by explicit option |
| **Spot ink** (palette entry → Separation, name and alternate) | screen and spot printing ([CREATIVE-LAB-PRINT-INTEGRATION](CREATIVE-LAB-PRINT-INTEGRATION.md)) |
| **Exact device values** (user-typed CMYK for a palette entry) | brand colours or provider rich-black recipes (Gelato 60/60/60/100, IngramSpark 60/40/40/100) |

**Background.** `artboard.background` is printed ink unless the user chooses "background is paper (don't print)". With bleed enabled, the background is extended to the BleedBox (variant C).

### 4.3 Page geometry

- **Artboard = TrimBox.** Write only a TrimBox; PDF/X preflights flag pages with both TrimBox and ArtBox.
- **BleedBox** = trim + bleed (2, 3 or 4 mm, or 0.125 in, by provider). Artwork outside the artboard is kept up to the bleed. Today it is clipped by the MediaBox.
- **Crop marks** only on request, outside the BleedBox, in `/All`. **Off by default:** Gelato, MOO, Lulu, IngramSpark and FLYERALARM say not to include them. MediaBox and CropBox grow only when marks are on.
- **Physical size** stays an export parameter. The document stores no print size in v1. Remembering it is a v2 export-preset field.

## 5. Transparency and compositing

### 5.1 CMYK export composites in CMYK

The test was the three 50 % discs over ivory, composited three ways:

- in encoded sRGB (the editor preview);
- in CMYK after per-paint conversion (what the PDF expresses);
- as the sRGB composite converted to CMYK (what a pre-flattened export would print).

| Overlap | CMYK composite vs preview, ΔE00 | Converted sRGB composite vs preview | CMYK composite vs converted sRGB composite |
|---|---|---|---|
| red over ivory | 12.52 | 3.30 | 11.08 |
| red + green | 19.08 | 2.30 | 17.60 |
| red + green + blue | 18.40 | 0.84 | 18.26 |
| green + blue | 11.92 | 1.55 | 11.50 |

**Renders agree with the CMYK composite.** poppler and Quartz renders of C were within 1.2–5.9 ΔE00 of the CMYK composite, and 7.9–20.3 from the sRGB preview ([artifacts/pdf/render-samples.json](artifacts/pdf/render-samples.json)). With a CMYK output, a translucent overlap **looks different from the editor**, by far more than gamut mapping alone explains (0.8–3.3).

This is PDF semantics, not a writer bug:

- **Blending space.** A page group with no `/CS` blends in the device's native space.
- **ICC colour.** ICC colours are converted into the group space before blending.

Options, smallest first:

1. **Preflight warning with a soft-proof preview composited in CMYK** (P2). The user sees the real result and accepts it.
2. **Explicit page group `/CS /DeviceCMYK`** when translucency exists, so screen viewers and RIPs blend identically. This is to be confirmed with a PDF/X validator. Desk research found a printer rejecting `/CS /DeviceRGB` pages under a CMYK intent, so the group space must match the intent.
3. **Vector flattening:** split overlaps into opaque vector regions with booleans (P2-A), composite each region in sRGB, then convert. The result matches the preview and stays vector. It depends on qualified boolean operations and is never a raster fallback.

### 5.2 Today's RGB export is already viewer-dependent for translucency

For A, A2, B and B2:

- **poppler** matched the sRGB composite (≤ 0.24 ΔE00).
- **Quartz** (`sips`) composited translucent overlaps in its *output* space. Its renders are tagged Display P3.
  - The difference from poppler was 4.5–8.1 ΔE00.
  - **An explicit page group (A2, B2) made no difference to Quartz.**
  - Hand calculation confirms the mechanism. Composite in P3-encoded space: (235.4, 141.3, 126.1). Rendered: `#eb8e7f` = (235, 142, 127).
- Opaque colours agreed everywhere (≤ 0.31).

This affects the **current, accepted** RGB pipeline, not just a future CMYK one. It is recorded as a finding and proposed as a technical-debt entry ([PROPOSED-RFC-AMENDMENTS](PROPOSED-RFC-AMENDMENTS.md) TD-proposal). Acrobat, pdf.js and Chrome were not tested (NOT RUN).

### 5.3 Viewer colour management of CMYK

| Variant | Renderer | ΔE00 vs the CMYK proof, opaque patches |
|---|---|---|
| C | Quartz | ≤ 1.4 |
| C | poppler | up to 4.5 |

- **Quartz** either honoured the output intent or used its default Generic CMYK, which is the same profile here, so the test cannot tell which.
- **poppler did not use the output intent.**
- **K-only black** rendered lighter than rich black (`#1a1919` Quartz, `#231f20` poppler, vs `#0f0d0d` rich black). That is the correct physical expectation, and the soft proof must show it.

**Independent colour-managed rendering of print PDFs needs a CMYK-aware renderer.** Candidates are Ghostscript with `-sUseOutputIntent`, MuPDF, or callas pdfToolbox; none is installed here (NOT RUN). poppler is unsuitable for CMYK colour-accuracy checks. It is also not independent of Little CMS, because it links liblcms2 (`otool -L`).

## 6. What the existing writer needs (proposal, not implemented)

1. **No change to the default path.** DeviceRGB, MediaBox only, and byte-identical for the 326 + 72 and 636 frozen hashes. That path is the "portable RGB" class.
2. **A paint mapping** in place of the three colour call sites: DeviceRGB, ICCBased sRGB, DeviceCMYK table, Separation or DeviceGray plate. Selected by the export request; default DeviceRGB.
3. **Page-box and marks options** (trim, bleed, marks) and an optional output intent with an embedded, validated profile.
4. **An export report** (JSON, beside the file): engine and version, profile digest, intent, the override list, conversion-table size, TAC maximum, translucent-object count, out-of-gamut count. Owned by preflight.
5. **No PDF/X version key** until an independent validator passes ([PDFX-FEASIBILITY](PDFX-FEASIBILITY.md)).

## Sources (accessed 2026-11-25)

- `pdf-writer` 0.15.0 source (local registry copy).
- PDF 1.7 transparency and colour semantics, via an unofficial reproduction of ISO 32000-1: <https://hellowac.github.io/pdf-std-zh-cn/iso32000/c11/s4>, `/c11/s7`, `/c8/s6`.
- Artifex on PDF transparency: <https://artifex.com/blog/pdf-transparency-and-color>.
- PDF Association: <https://pdfa.org/technical-side-and-requirements-of-pdfx/>, <https://pdfa.org/understanding-overprint/>.
- Ghostscript (`-sUseOutputIntent`): <https://ghostscript.readthedocs.io/en/latest/Use.html>.
- A WeasyPrint issue about `/CS /DeviceRGB` under a CMYK output intent: <https://github.com/Kozea/WeasyPrint/issues/2723>.
- Provider statements: [PRINT-PROVIDER-REQUIREMENTS](PRINT-PROVIDER-REQUIREMENTS.md).
