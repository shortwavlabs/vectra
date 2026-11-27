# R-COLOR — Staged implementation roadmap (proposal)

Status: **provisional**, 2026-11-25. This research authorises nothing: each phase needs the owner's approval, its own gate report and its own qualification. Phases refer to the RFC-002 §19 gate plan and to [PRD-002](../../PRD-002-VECTOR-STUDIO.md).

## 1. Sequence

| Step | When | Content | Dependencies | Exit evidence |
|---|---|---|---|---|
| **R0: text decisions** | **now**, before G-EXP and before the Document v1 release | AM-C1 (document colours are sRGB, straight alpha), AM-C2 (`browser-canvas-v1` semantics), AM-C3 (output colour is an export parameter; default byte-identical; keep `paletteId` in the export draw list) | none | owner decision recorded; **no code, schema, golden or hash change** |
| **G-EXP (unchanged scope)** | P1-C | packet-route export as planned. Guardrails only: the default PDF path stays DeviceRGB/MediaBox and byte-identical (326 + 72, 636); the three colour call sites stay isolated; `paletteId` stays in the draw list | R0 | existing G-EXP regressions |
| **P2-R1: intentional sRGB raster** | early P2: the first print-relevant feature, because most garment and poster services want sRGB PNG | PNG with straight alpha, embedded sRGB profile, physical size + ppi, banded rendering, memory estimate, partial-alpha warning; preset data model (source URL + verified date) | owner approval of a production rasteriser (resvg/tiny-skia, already pinned for tests) and `png` | A11 of [PRINT-QUALIFICATION-PLAN](PRINT-QUALIFICATION-PLAN.md); band-vs-full identity; WASM memory measured at A2/A1 sizes |
| **P2-R2: ICC-managed RGB PDF** (optional) | P2 | ICCBased sRGB with a generated sRGB profile; same geometry | R0 | A7, A8 |
| **P2-C: decoder** (already planned, TD-GEO-007) | P2-C | WASM decode with explicit profile handling (`wasm-icc-srgb-v1`), import colour-signal summary, untagged → "assumed sRGB" message | CMM selection (next row) or a decode-only subset | identical RGBA across Chromium, Firefox (mode 2) and Safari for Q-12 |
| **P2-R3: CMM dependency gate** | P2 | choose moxcms (candidate) vs Little CMS-in-WASM. Re-run [ICC-ENGINE-EVALUATION](ICC-ENGINE-EVALUATION.md) with registered profiles (FOGRA51, GRACoL2013 CRPC6) that have distinct per-intent tables | owner decision to obtain those profiles (download and licence terms) | A1, A2, A12 |
| **P2-R4: profile-managed CMYK** | P2 (end) or P3 | output-profile import and validation; conversion table with overrides (K-only, paper white, exact CMYK); CMYK PDF with output intent, Trim/Bleed, optional marks; CMYK TIFF; export report; preflight (gamut, TAC, translucency); soft proof by colour substitution | P2-R3; export dialog (G-UI-R successor) | A1–A10 with a CMYK-aware renderer (Ghostscript or pdfToolbox: owner procurement) |
| **P3-S1: spot inks and plates** | P3 | Document v2 `PaletteEntry.ink`; Separation export; per-ink plate pages with registration marks (CL-G1S) | P2-B effect stacks; Document v2 | Q-15; per-channel renders; one screen-printer test |
| **P3-S2: knock-out and trap** | P3 | boolean knock-outs, offset trap or choke, underbase (CL-G1T) | P2-A booleans and offsets | geometry metrics; screen-printer test |
| **P3-P1: soft proof v2** | P3 | gamut overlay; CMYK composite for translucent overlaps (per-overlap geometry, or worker raster proof as a disposable display cache) | P2-A booleans | A10 tightened |
| **P4-X: qualified PDF/X-4** | P4 or later | XMP, Trapped, uncompressed metadata, deterministic `/ID`, page group policy; validator-driven qualification; `GTS_PDFXVersion` only after it passes | validator licence (owner); timestamp policy decision (RFC-002 forbids clocks) | A13 with two validators |
| **P4-A: provider presets** | P4 | presets naming providers, each after a paid test order | P2-R1, P2-R4, P4-X as relevant | A14 records |
| Later | — | DeviceN, profiles embedded in projects (container `profile` section), a profile library in OPFS (opt-in), wide-gamut working space (approach B) if a digital wide-gamut output is requested | — | — |

## 2. Alternatives considered

- **CMYK before raster.** Rejected as the first step. Most of the stated audience (T-shirts, merchandise, posters) is served by sRGB PNG. CMYK carries the heaviest qualification load and depends on profile licensing.
- **Spot plates before process CMYK.** Viable for screen-printing users: plates need no CMM, only Separations, booleans and offsets. If the owner prioritises screen printing, P3-S1 can move ahead of P2-R4, because P2-R3 is not a prerequisite for spot plates.
- **Schema fields now** (working space, output profile, ink descriptors in Document v1). Rejected: additive v2 fields with deterministic migrations cost the same later, and v1 would carry fields with no consumer.
- **Little CMS from the start.** Better features (BPC, proofing, ink limiting), but it needs a C-to-WASM toolchain. Revisit at P2-R3 if provider qualification shows those features matter.

## 3. What must be decided now, and what can wait

| Now | Can wait |
|---|---|
| AM-C1, AM-C2, AM-C3 (text only) | CMM choice; raster dependency; validator procurement |
| G-EXP keeps the default path byte-identical and keeps `paletteId` | Document v2 ink descriptors, export presets, container profile section |
| — | PDF/X timestamp policy; provider test orders; physical measurement equipment |

## 4. Unresolved owner decisions

See [FINAL-REPORT §14](FINAL-REPORT.md).
