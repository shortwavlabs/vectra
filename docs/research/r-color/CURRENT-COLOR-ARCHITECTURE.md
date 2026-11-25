# R-COLOR-01 — Current colour architecture audit

Status: research, 2026-11-25. Baseline `main` `7f57dd7` (G-JOB, G-R0, G-UI merged). Source-inspected; nothing here changes production code.

Issue: [#5](https://github.com/shortwavlabs/vectra/issues/5). Companion documents: [proposal](COLOR-ARCHITECTURE-PROPOSAL.md), [amendments](PROPOSED-RFC-AMENDMENTS.md).

## 1. Summary

**Every colour in Vectra today is 8-bit sRGB with straight alpha.** That is true in the decoder, the engine, the packet, the document, the renderer, both writers and the project file. It is explicit in the engine and the UI, and implicit everywhere else:

- `crates/vector-engine/src/color.rs:10` says "Straight (non-premultiplied) sRGB colour with 8-bit alpha".
- `src/ui/color.ts:1` says "sRGB hex ↔ HSV … the document stores RGBA8888".
- RFC-001 says "fill/stroke (sRGB + alpha)".
- C3, C8 and C10 say only `u32 RGBA8888` and never name a colour space.

**The assumption is consistent, so it is safe to keep.** No component interprets the same number in two different spaces. Colour enters through one decode step and leaves through two writers.

Three things are real gaps, all at the edges:

1. **Decode.** The browser decides what an embedded profile means. Engines agree on macOS when Firefox has its default colour-management preferences, but platform, preferences and automation builds change the result (measured and source-derived, §4).
2. **PDF output.** It is DeviceRGB only. That is portable, but it is not colour-managed and it cannot carry print intent.
3. **No sRGB statement.** Nothing normative says the document's numbers *are* sRGB. A reader of C10 cannot tell sRGB from "whatever the source was".

**No Document v1 schema change is needed** (see [COLOR-ARCHITECTURE-PROPOSAL](COLOR-ARCHITECTURE-PROPOSAL.md)). The gaps close with:

- one normative text clarification;
- an export-contract rule;
- decoder and export work in later phases.

## 2. Classification key

| Code | Meaning |
|---|---|
| **S** | Safe to retain as is |
| **E** | Requires an extension point. It is additive and changes no saved format |
| **M** | Requires a future schema migration (a `documentSchemaVersion`, container or scene bump, with a deterministic migration) |
| **A** | Requires an architectural amendment before G-EXP. Here every **A** item is text-only: no schema, golden-file or hash change |

## 3. Assumption register

| # | Where (source) | What is assumed | Class | Reasoning |
|---|---|---|---|---|
| 1 | GeometryPacket style table, C3 (`packet.rs:127–137`, `rgba_to_u32` `packet.rs:651`) | `fill`, `stroke.color` = u32 `r<<24\|g<<16\|b<<8\|a`, sRGB trace output | **S** | Packet styles are commit-time inputs and provenance only (C3.1). The document is the colour authority after commit, and no print feature needs packet colours. |
| 2 | Document `Style.fill`, `stroke.color`, `PaletteEntry.color` (C10; `src/document/model.ts:65–76`) | u32 RGBA8888 with no declared space | **A** (text) now; **M** later for inks | Declare sRGB (IEC 61966-2-1), 8-bit encoded, straight alpha. Spot or ink identity later needs an optional palette-entry descriptor (v2, migration "absent → process colour"). |
| 3 | `artboard.background` (C10; `model.ts:91`) | An sRGB fill painted under the artwork; `null` = transparent | **A** (text) + **E** | Same sRGB clarification. In print it is *ink*, not paper. "Background is paper, don't print it" and "extend the background into the bleed" are export options ([VECTOR-PDF-COLOR-OUTPUT §4.2](VECTOR-PDF-COLOR-OUTPUT.md)). |
| 4 | `SourceAsset.digest`, `decodePolicy`, TraceProvenance (C10; `src/shell/jobs.ts:98,112`, `src/document/provenance.ts:11`) | `browser-canvas-v1`: the browser decodes to straight RGBA through a default (sRGB) canvas. The digest covers the **original file bytes**, embedded profile included | **A** (text) + **E** | The digest keeps the source profile recoverable whenever the original bytes are relinked. What `browser-canvas-v1` does with profiles depends on the engine (§4), and C10 should say so. A deterministic WASM decoder is a new enum value (already the C10 rule). |
| 5 | Intake `decodeImage` (`src/vectorization/intake.ts:146–187`) | `createImageBitmap(…, colorSpaceConversion: "default")`, `getContext("2d")` with no `colorSpace`, `getImageData` | **E** | The sniffer (`:40–121`) reads no colour chunks (iCCP, cICP, sRGB, gAMA; JPEG APP2; WebP ICCP). Untagged sources are silently treated as sRGB, and tagged ones are browser-dependent. The proposal is explicit signalling plus a WASM decoder policy ([ICC-PROFILE-LIFECYCLE](ICC-PROFILE-LIFECYCLE.md)). |
| 6 | Engine colour arithmetic (`color.rs:59–117` luminance; `:119–171` OKLab; `:173+` k-means; `trace.rs:47,100,107–160` keying and VTracer clustering; `precision.rs:109–323` edge projection; `halftone.rs:66–98` tone→coverage) | sRGB transfer curve and Rec. 709 primaries hard-coded; colour edges projected in encoded sRGB | **S** | These define how tracing *interprets* decoded sRGB values. They are correct exactly when the decode policy delivers sRGB. Generalising them would change the 326 frozen hashes for no print benefit. |
| 7 | Renderer (`src/renderer/core.ts:36–37,80,182–188,229–236`) | CSS `rgba()` strings on a Canvas 2D context with the default `srgb` colour space; `alpha: false` | **S**; soft proof **E** | Editing preview is sRGB by definition. A soft proof of flat colours can be a substituted colour table in the snapshot, with no renderer change. CMYK-space compositing of translucent overlaps is not reproducible that way ([SOFT-PROOF section](EXPORT-UX-PROPOSAL.md#5-soft-proof-and-preflight-panel)). |
| 8 | Export draw list (C8, AM-1: `fill`, `paletteId`, `stroke` per item) | Effective sRGB colours, each with its palette identity | **S** (the seam exists) | `paletteId` per export item is exactly what an export-time ink override needs ("this palette entry prints as 0/0/0/100" or "as spot ink X"). Keep it through G-EXP. |
| 9 | Rust scene v1 (`scene.rs:21–102`; `Rgba` in `color.rs:10–57`) | `background`, `palette`, `fill`, `stroke` are sRGB `#rrggbb[aa]` | **S** | The scene is the evaluated export input. Conversion belongs in the writer stage, not the scene (prototype: geometry tokens unchanged, [VECTOR-PDF-COLOR-OUTPUT §2.2](VECTOR-PDF-COLOR-OUTPUT.md)). Scene v2 is not needed for colour. |
| 10 | SVG writer (`svg.rs:35–40`) | `fill="#rrggbb"` plus `fill-opacity` | **S** | SVG stays portable sRGB, the de-facto web meaning. No CMYK in SVG. |
| 11 | PDF writer (`pdf.rs:5,70–72,119–166,186`) | DeviceRGB `rg`/`RG`; constant alpha via ExtGState `ca`/`CA`; no page group, no output intent; MediaBox only | **E** | Colour emission sits in three places (background, fill, stroke). ICCBased RGB, DeviceCMYK, Separation, output intents and page boxes are all expressible with the pinned `pdf-writer` 0.15.0 (prototype). The default path must stay byte-identical. |
| 12 | `PdfOptions { width, unit, dpi }` (`pdf.rs:28–34`, `deny_unknown_fields`; `src/vectorization/types.ts:99–103`; protocol `src/jobs/protocol.ts:70–78`) | Export carries only the physical size | **A** (contract rule) + **E** | The protocol is internal (single-build sessions, §15.3), so adding fields is cheap. The decision to record before G-EXP: output colour is a property of the **export request**, never of the document. |
| 13 | `.vectra` container (`src/persistence/container.ts:117–120`) | Section kinds closed: `manifest`, `document`, `geometry`, `source` | **M** (only if profiles are embedded) | Embedding a printer profile in a project needs a new section kind (or a v2 container). Referencing a profile by digest needs only document v2 fields. Neither is needed for the first CMYK export, where the profile is chosen at export time. |
| 14 | Recipes and Creative Lab seams (RFC-002 §13: `InkPlates[{plateId, colour, geometry}]`) | A plate "colour" is a display colour | **E** | Physical inks need a name and an alternate (sRGB display, optional CMYK or Lab) to become PDF Separations. Define the ink descriptor at the P2-B/P2-C recipe gate ([CREATIVE-LAB-PRINT-INTEGRATION](CREATIVE-LAB-PRINT-INTEGRATION.md)). |
| 15 | Halftone and B&W `ink: Rgba` (`params.rs:115,200`; `halftone.rs:96–98`) | Ink is a display colour; black = `#000000` | **S** + **E** | Under ICC conversion `#000000` becomes a four-colour rich black, which is wrong for line art (§5). Needs an export-time "K only" override, keyed by `paletteId` (row 8). |
| 16 | UI colour picker (`src/ui/color.ts`) | sRGB hex and HSV | **S** | CMYK or ink entry fields later are UI only and write overrides, not document colours. |
| 17 | Golden files and frozen hashes (326 + 72 bundle; 636 document exports) | Default export bytes | **S** | Every proposal here keeps the default export path byte-identical. Verified for this branch by an empty diff on production paths (FINAL-REPORT §16). |

## 4. Measured: what the decode path does with profiles

The exact production options from `intake.ts` were run in Playwright Chromium 159, Firefox 159 and WebKit 27.2 (headless, macOS 26.6.2) on synthetic inputs. All inputs had the same pixel values and different colour signalling. Raw data: [artifacts/decode/browser-decode.json](artifacts/decode/browser-decode.json). Expected values come from Little CMS 2.20.

**Playwright's Firefox build disables colour management.** Its `playwright.cfg` sets `pref("gfx.color_management.mode", 0)` and `pref("gfx.color_management.rendering_intent", 3)`; these are its only colour-management overrides. Firefox was therefore run twice:

- with Playwright's settings (`firefox-playwright-default`);
- with both preferences restored to Firefox's `StaticPrefList.yaml` defaults (`firefox-cm2`): mode 2 (tagged images only) and rendering intent 0. The defaults were checked against the source on 2026-11-25.

**The repository's Playwright configuration sets no Firefox preferences.** That was checked in `playwright.config.ts`, `tests/` and their history. So its Firefox runs use Playwright's mode 0. The P0 decode evidence (TD-GEO-007) was most likely gathered the same way. That makes no difference for untagged sources, but it does for tagged ones.

| Input | Chromium (production options) | Firefox, default colour prefs (mode 2) | Firefox, Playwright mode 0 | WebKit |
|---|---|---|---|---|
| Untagged PNG | unchanged (treated as sRGB) | unchanged | unchanged | unchanged |
| PNG `sRGB` chunk | unchanged | unchanged | unchanged | unchanged |
| PNG iCCP Display P3 | **converted to sRGB**; matches Little CMS exactly (`#b9e87b` → `#acea6a`, `#c86432` → `#d75d1f`) | converted; matches Little CMS | **ignored** | converted; matches Little CMS |
| PNG iCCP Adobe RGB (1998) | converted; matches Little CMS | converted; matches | ignored | converted, ±1 |
| PNG cICP (P3, sRGB transfer) | converted | converted | ignored | converted |
| PNG gAMA 1.0 | converted (`#808080` → `#bcbcbc`) | converted, **±2 from Chromium** (`#bababa`) | ignored | converted (`#bcbcbc`) |
| JPEG with a Display P3 ICC | converted (±1, JPEG) | converted | ignored | converted |
| `colorSpaceConversion: "none"` | returns the stored values | returns the stored values | (same as default) | **ignored: still converts** |

Consequences:

1. **Convergence is narrow.** On macOS, all three engines (Firefox with default colour prefs) convert ICC- and cICP-tagged PNG and JPEG to sRGB identically. Untagged sources pass through and are assumed to be sRGB. That convergence covers one platform and these signals only:
   - **gAMA** handling differs by up to 2 levels.
   - **Display profile.** Desk research of Firefox source says that, on Windows and Linux/X11, Firefox decodes tagged images to the **display** profile, not sRGB. `getImageData` would then depend on the user's monitor. This is source-derived and not reproduced here ([ICC-PROFILE-LIFECYCLE §2](ICC-PROFILE-LIFECYCLE.md)).
   - **CMYK JPEGs** decode differently in each engine (source-derived).
2. **The decode policy is browser behaviour, not a Vectra rule.** It is undocumented in Vectra and partly implementation-defined in the HTML specification. A tagged photo can trace to different palette colours depending on browser, platform and user preferences: up to `#c86432` vs `#d75d1f` on these patches when a profile is ignored.
3. **`"none"` cannot be a portable source-pixel path,** because WebKit ignores it (consistent with WebKit failing the wpt test for it).
4. **Not Safari or Firefox as users run them.** These are Playwright engine builds. Real Safari and Firefox on Windows and Linux are **NOT RUN**.

## 5. Measured: what sRGB black becomes in CMYK

Through a LUT-based CMYK output profile (the macOS Generic CMYK Profile, v2.2, used locally only), relative colorimetric, Little CMS and moxcms agree:

- `#000000` → C 72.5 M 70.5 Y 64.4 K 86.6 (total ink 294 %).
- `#808080` → C 50.7 M 43.1 Y 39.7 K 2.1.
- `#ffffff` → C 0.0 M 0.4 Y 0.4 K 0 under both Little CMS and moxcms. ColorSync gives 0/0/0/0.

Source: [artifacts/cmm/cmm-comparison.json](artifacts/cmm/cmm-comparison.json).

This is correct ICC behaviour, and it is exactly why a black-and-white trace, a halftone or line art cannot simply be "converted":

- **Black.** A one-ink design would print on four plates with registration risk.
- **White.** "Paper" would carry a faint tint.

Per-palette-entry export overrides (row 8) and white and black rules are therefore part of the minimum CMYK design, not polish.

## 6. Approaches compared

| Criterion | **A. RGB working document, ICC conversion at export** | **B. Explicit working colour space and profile references** | **C. Generalised colour (RGB / CMYK / spot per colour)** |
|---|---|---|---|
| What changes | Export request gains output-colour fields; writer gains a paint mapping; text clarification | Document gains `workingSpace` + profile refs; renderer, picker, decoder and exporters convert from it | Every colour becomes `{space, components, alpha, ink?}` in packet, document, scene and writers |
| Complexity | Low. The prototype needed about 40 changed lines in a copy of the writer and no geometry change | Medium. Every consumer becomes profile-aware; Firefox ignored `colorSpace: "display-p3"` in both runs (`p3Canvas` in [artifacts/decode/browser-decode.json](artifacts/decode/browser-decode.json)) | High. Schema, scene v2, renderer and picker, migrations, dual-format regression |
| Reproducibility | High. One deterministic table per export: effective colour → device values, integer quantised. Native and WASM bit-identical on the 8-bit path (measured) | Needs profile identity (digest) everywhere; the decode and preview chain must also be qualified | Device values are exact, but compositing and recolouring semantics need new rules |
| Editing semantics | Unchanged. Artists pick sRGB colours; print values come from profile plus overrides | Users must understand working spaces; recolour and HSV mean different things per space | Exact ink values, but "recolour", "blend" and "palette reduce" across spaces are undefined |
| Memory | Negligible: a few KB per export (the prototype scene had 11 distinct colours) plus the profile bytes | Small | 2–3× per colour record; packet style tables grow |
| Backward compatibility | Full. Default export byte-identical; no schema change | v2 migration "absent → sRGB"; all consumers touched | v2 migration; packet, scene and container versions; golden files regenerated |
| Creative Lab fit | Good for process CMYK and K-only line art; spot inks need a palette-entry ink descriptor (narrow v2 field) | Little benefit: inks are flat named colours, not wide-gamut RGB | Best fit for spot and screen printing, at the highest cost |

**Recommendation: A**, plus one narrow slice of C later.

- **Now:** declare that the document is sRGB.
- **Later:** add an optional **ink descriptor on palette entries** (name, display sRGB, optional alternate) when spot separations arrive (P2-C/P3). That is an additive v2 field with the migration "absent → process colour".
- **Deferred:** B, until a wide-gamut digital-output feature is actually requested.

Native CMYK document editing is **not** needed for CMYK export. The provider survey ([PRINT-PROVIDER-REQUIREMENTS](PRINT-PROVIDER-REQUIREMENTS.md)) found that most garment and poster services ask for sRGB raster files anyway.
