# R-COLOR — Final report: colour management and professional print output

| | |
|---|---|
| Date | 2026-11-25 |
| Branch | `research/r-color`, from `main` `7f57dd716bdbec0a6160da3585b445852f464859` (G-JOB, G-R0, G-UI merged) |
| Owner requirement | [shortwavlabs/vectra#5](https://github.com/shortwavlabs/vectra/issues/5) |
| Type | research and architectural design gate. **No production implementation.** Stops for owner review |

**Deliverables:**

- audit: [CURRENT-COLOR-ARCHITECTURE](CURRENT-COLOR-ARCHITECTURE.md);
- research: [ICC-ENGINE-EVALUATION](ICC-ENGINE-EVALUATION.md), [ICC-PROFILE-LIFECYCLE](ICC-PROFILE-LIFECYCLE.md), [VECTOR-PDF-COLOR-OUTPUT](VECTOR-PDF-COLOR-OUTPUT.md), [PDFX-FEASIBILITY](PDFX-FEASIBILITY.md), [RASTER-EXPORT-RESEARCH](RASTER-EXPORT-RESEARCH.md), [PRINT-PROVIDER-REQUIREMENTS](PRINT-PROVIDER-REQUIREMENTS.md), [CREATIVE-LAB-PRINT-INTEGRATION](CREATIVE-LAB-PRINT-INTEGRATION.md);
- proposals: [EXPORT-UX-PROPOSAL](EXPORT-UX-PROPOSAL.md) (with [mockup](mockups/export-dialog.svg)), [COLOR-ARCHITECTURE-PROPOSAL](COLOR-ARCHITECTURE-PROPOSAL.md), [PRINT-QUALIFICATION-PLAN](PRINT-QUALIFICATION-PLAN.md), [PROPOSED-RFC-AMENDMENTS](PROPOSED-RFC-AMENDMENTS.md), [IMPLEMENTATION-ROADMAP](IMPLEMENTATION-ROADMAP.md);
- reproduction: [REPRODUCING](REPRODUCING.md).

**Provenance of desk research.** The desk-research claims in this document were gathered on 2026-11-25 by delegated research agents. They worked from public pages under this gate's rules: no logins, no personal data. Their full notes, with quotations, are kept outside the repository in the gate's shared notes folder (`r-color-research-*.md`).

The author re-read these primary sources directly:

- the veraPDF validation scope;
- the ICC-registry licence for PSO Coated v3;
- NVD CVE-2026-41254 and CVE-2026-42798;
- Gelato's PDF requirements (which corrected "required" to "should" for PDF/X-4);
- IngramSpark's file-creation guide;
- Firefox's `StaticPrefList.yaml` colour-management defaults.

Every other desk claim is agent-gathered and was not re-read. Measured results come from the prototypes and are reproducible ([REPRODUCING](REPRODUCING.md)).

## 1. Current architecture compatibility

**Every colour is 8-bit sRGB with straight alpha**, from decode to export. It is explicit in the engine (`color.rs:10`) and the UI, and implicit in C3, C8 and C10. The assumption is consistent, so it is safe to keep. Of the 17 assumptions audited:

- **9 are safe:** packet styles, engine colour arithmetic, renderer, export draw list, scene v1, SVG writer, UI picker, frozen hashes, and the halftone ink colour as a display colour.
- **The rest need either a text clarification** (document colours, background, `decodePolicy`, export contract), **an extension point** (PDF writer, intake, recipes and inks), **or a future migration** (ink descriptors, container profile section).

**None needs a Document v1 schema change.**

**Gaps found by measurement:**

1. **Decode.** Embedded profiles are handled by the browser, and the result depends on engine, platform and preferences:
   - Chromium 159, WebKit 27.2 and Firefox 159 (default colour-management preferences restored) agree on macOS;
   - Playwright's Firefox disables colour management;
   - gAMA differs by up to 2 levels;
   - Firefox on Windows and Linux uses the display profile (source-derived).
2. **Today's RGB PDFs.** Translucent fills already composite differently in macOS Quartz than in poppler: 4.5–8.1 ΔE00. An explicit page group does not change it.

## 2. Recommended working colour model

**sRGB working document (approach A),** declared normatively (AM-C1). Every print colour space is an export-time product of an explicit profile, intent and `paletteId`-keyed overrides:

- K-only black;
- paper white;
- exact CMYK;
- later, spot inks.

An optional palette-entry **ink descriptor** arrives in Document v2 with spot inks. A document working space (B) and a generalised colour type (C) are not recommended. **Native CMYK document editing is not required for CMYK export.**

## 3. ICC engine

**Shortlist, final choice at the P2 dependency gate.**

- **moxcms 0.9.2** (pure Rust, BSD-3-Clause/Apache-2.0) is the in-browser candidate:
  - it builds for `wasm32-unknown-unknown`;
  - it agrees with Little CMS on sRGB → CMYK to a mean of 0.046 and a max of 0.673 ΔE00 (0.031 / 0.281 with tetrahedral interpolation);
  - **but** it lacks BPC for CMYK, proofing, gamut check, K preservation and ink limiting, and its absolute colorimetric does not adapt to media white.
- **Little CMS 2.20** (MIT core) is the independent reference. It needs a C-to-WASM toolchain to ship in the browser.
- **ColorSync** was used as a second independent reference.

## 4. Native and WASM feasibility

**moxcms runs in WASM:**

- 458,048 B raw, about 119 KB brotli (prototype with all paths; the empty baseline is 16,650 B);
- 1 MP sRGB → CMYK in 35–38 ms in Node (three runs, load 2.0–2.5).

**Determinism is per target:**

- the 8-bit path is bit-identical between native (NEON and scalar) and WASM on 1,028 values;
- the 16-bit path differs in 2 of 1,028 values by 1 LSB;
- the f32 path differs by up to 4.8e-7. Root cause: fused multiply-add on aarch64 but not on wasm32.

Export conversion must therefore run in the WASM worker and be quantised to an integer grid. Little CMS in WASM: **NOT RUN**.

## 5. Dependency and profile licensing

- **Engines:** moxcms (BSD-3-Clause OR Apache-2.0) and Little CMS core (MIT) are compatible with an MIT app, with notices. Little CMS's plug-ins are GPL-3, and ArgyllCMS is AGPL; both are excluded.
- **Encoders:** `png`, `tiff` and `resvg`/`tiny-skia` are MIT/Apache/BSD. `jpeg-encoder` additionally needs an IJG acknowledgement.
- **No CMYK reference profile can be relicensed under MIT.** ECI, Idealliance, VIGC and JPMA all forbid alteration, several forbid sale, and ECI requires permission. **Ship no CMYK profile; users import their printer's.**
- **sRGB:** a generated sRGB profile (Vectra's own bytes) avoids third-party terms.
- **This research:** Apple system profiles were used locally only, and never committed.

## 6. PDF writer capability

**The existing `pdf-writer` 0.15.0 writer can express every needed structure without replacement:**

- ICCBased RGB and CMYK, DeviceCMYK;
- output intents with embedded profiles;
- Trim, Bleed and Crop boxes, and `/All` crop marks;
- Separation with a tint transform;
- page transparency groups;
- the APIs for DeviceN, overprint, rendering intent and XMP.

**Prototype results:**

- 7 variants pass `qpdf --check`, with 0 images and 0 fonts.
- Geometry operators are identical to the production writer, except the 4 operands of the deliberately bled background.
- Colour emission sits at three call sites.
- **CMYK export composites translucency in CMYK.** 11.9–19.1 ΔE00 from the sRGB preview on saturated 50 % overlaps, confirmed by renders. That needs a preflight warning and proof now, and vector flattening later.

## 7. Print-provider requirements

20 providers were surveyed (sources dated 2026-11-25).

- **Garment and poster POD wants RGB raster, not CMYK.** Printful, Printify, TeePublic, Threadless, Spoonflower, Prodigi and Redbubble take PNG or JPEG, and several convert to CMYK themselves.
- **CMYK PDF/X comes from commercial and book printers.** IngramSpark *requires* X-1a or X-3 (colour interiors and covers). Gelato asks for X-4 ("should be exported as") and requires a 4 mm bleed. FLYERALARM, SAXOPRINT and MOO recommend it.
- **Named conditions differ** (GRACoL 2006, FOGRA39, FOGRA51/52), and so do ink limits (240–300 %) and rich-black recipes.
- **Most PDF printers ask for no crop marks.**

Nearly every colour statement is a recommendation, not a requirement.

## 8. Proposed Document v1 amendments

**Text only; no schema, golden or hash change:**

- **AM-C1:** document colours are sRGB (IEC 61966-2-1), 8-bit, straight alpha.
- **AM-C2:** `browser-canvas-v1` delegates profile handling to the browser; untagged sources are assumed sRGB.

**Deferred to v2,** with deterministic migrations: ink descriptors, export presets, profile references.

## 9. Export contract changes

- **AM-C3 now:** output colour is an export-request parameter; the default stays portable RGB and byte-identical; `paletteId` stays in the export draw list. **G-EXP adds nothing else.**
- **P2:** `ExportRequest.color` (`portable-rgb` | `icc-rgb` | `cmyk{profile digest, intent, overrides}` | `plates`), `page.bleed`/`marks`, `raster{ppi, alpha}`, and an `ExportResult.report`. The protocol is internal, so only `protocolVersion` increments.

## 10. Proposed export UX

A progressive dialog:

- Digital (SVG in two clicks) or Print;
- format, size with pixel feedback, colour, marks, transparency;
- preflight with Error, Warning, Recommendation and (external-only) Verified-failure classes;
- presets as data with a source and a verified date.

The static mockup uses the DESIGN-SYSTEM tokens, and unsupported options are drawn disabled. The soft proof substitutes proof colours in the snapshot, with no renderer change, and states its limits: display gamut, CMYK translucency, overprint.

## 11. Independent qualification strategy

**Three separate levels:**

1. structural (qpdf, object inspection);
2. colour accuracy (Little CMS and ColorSync reference tables; a CMYK-aware renderer such as Ghostscript or pdfToolbox; spectrophotometer patches);
3. conformance (two independent PDF/X validators).

**Plus provider acceptance by test order.** A 16-item corpus, and 14 acceptance criteria with thresholds derived from measured margins (for example engine agreement mean ≤ 0.5, p95 ≤ 1.0, max ≤ 2.0 ΔE00; K-only black and paper white exact; native and WASM identical at 8-bit).

**veraPDF does not validate PDF/X.** poppler links Little CMS and ignores output intents, so it is unsuitable for CMYK accuracy.

## 12. Staged implementation roadmap

1. **R0 (now):** text amendments.
2. **G-EXP:** unchanged scope plus guardrails.
3. **P2-R1:** intentional sRGB PNG raster (the first print feature).
4. **P2-R2:** ICC sRGB PDF (optional).
5. **P2-C:** WASM decoder with explicit profiles.
6. **P2-R3:** CMM gate with registered profiles.
7. **P2-R4/P3:** profile-managed CMYK PDF and TIFF with overrides and preflight.
8. **P3:** spot inks, plates, knock-out and trap, soft proof v2.
9. **P4:** qualified PDF/X-4 and provider presets.

Spot plates can move ahead of CMYK if the owner prioritises screen printing.

## 13. Security and resource risks

- **Untrusted ICC profiles.**
  - **Measured:** 4,000 seeded corruptions produced 0 crashes or panics in moxcms and Little CMS, but both accepted and *used* many corrupt profiles.
  - **Desk research:** Little CMS had 2026 CVEs in 2.16–2.18 (fixed in 2.19), and iccDEV has 100+ advisories.
  - **Mitigation:** Vectra-owned structural, allowlist and semantic validation; a 4 MiB cap; work done in the compute worker.
- **Large raster exports.** About 4 MB per megapixel per copy; a 24 × 36 in poster at 300 ppi is about 311 MB per buffer. Mitigation: banded rendering and a pre-allocation estimate, never silent downsampling.
- **Determinism drift.** Across targets (FMA) and across encoder versions (`png` Deflate). Mitigation: exact pins and integer quantisation.
- **Profile redistribution** (§5).
- **Over-claiming.** Mitigation: the wording rules C-7 and §5 of the amendments.

## 14. Unresolved owner decisions

1. Accept, amend or reject AM-C1, AM-C2 and AM-C3 before G-EXP and the Document v1 release.
2. Priority: intentional sRGB raster first (recommended), or screen-printing plates, or CMYK PDF.
3. Approve a production rasteriser dependency (resvg/tiny-skia) for raster export.
4. CMM direction at the P2 gate: moxcms with Vectra-owned checks, or invest in Little CMS for WASM. This needs registered profiles: permission to download FOGRA51 and GRACoL2013 for testing, under their terms.
5. Procurement of a PDF/X validator (callas pdfToolbox or PitStop; trial or licence), and whether Acrobat counts as independent.
6. PDF/X timestamp policy: XMP dates are required, but RFC-002 forbids clocks in exports.
7. Budget and process for provider test orders and physical measurement.
8. Whether to add TD-COLOR-001/002/003 to the register and extend TD-GEO-007.
9. Real-Safari and Windows/Linux Firefox decode runs (they need `safaridriver` authorisation and other hosts).

## 15. PR and head SHA

Recorded in the pull-request description and the gate hand-back. A file cannot contain the SHA of the commit that adds it.

## 16. Confirmation

**No production implementation has started.**

- The branch changes only `docs/research/r-color/**` and `experiments/r-color/**`. That was verified with a path-scoped `git diff --name-only` against `7f57dd7`, which listed no production file.
- No production dependency, schema, lockfile, `src/`, `crates/`, `packages/`, `tests/`, `public/`, `scripts/` or `docs/TECHNICAL-DEBT.md` file was modified.
- The frozen 326 + 72 and 636 regressions were **not re-run** (NOT RUN). They are unaffected by construction, because no production file changed. Re-running them would also process private regression inputs.
- No dependency was installed system-wide.

## Appendix — NOT RUN (consolidated)

**Validation and rendering**

- PDF/X validation of any kind. No validator was available; veraPDF does not cover PDF/X.
- CMYK-aware PDF rendering with Ghostscript, MuPDF or pdfToolbox. Acrobat, pdf.js and Chrome PDF rendering.

**Colour engines and profiles**

- Rendering-intent differences on CMYK. The only local CMYK profile shares one table across all intents.
- Registered characterisation profiles (FOGRA51, GRACoL2013) and v4 LUT CMYK profiles.
- Little CMS built for WASM, and its cross-target determinism.

**Platforms and browsers**

- Real Safari. Firefox on Windows or Linux (the display-profile path).
- x86_64 hosts. WASM in browsers; the bit comparison ran in Node on aarch64.

**Raster export**

- Banded-raster identity against a full-surface render.
- tiny-skia cross-target determinism.

**Physical and provider**

- Physical prints, spectrophotometer measurements and provider test orders.

**Repository regressions**

- The frozen 326 + 72 and 636 regressions. Production code is unchanged.
- `vp test` and the production build. No source file they cover changed.
