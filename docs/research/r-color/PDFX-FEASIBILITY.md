# R-COLOR-05 — PDF/X feasibility

Status: desk research, 2026-11-25. The ISO texts are paywalled: claims below rest on the ISO abstract and preview pages, the PDF Association, Ghostscript, PDFlib and vendor documentation, and the ICC registry, each cited. Claims drawn from print-portal help centres explaining preflight messages are marked **(KB)**. Anything unconfirmed is marked UNVERIFIED.

**Conclusion first.** The existing writer can emit every structure PDF/X-4 needs ([VECTOR-PDF-COLOR-OUTPUT §1.1](VECTOR-PDF-COLOR-OUTPUT.md)). **No Vectra PDF is PDF/X today, and adding an ICC profile or an output-intent dictionary does not make one.** Conformance is a property shown by an independent validator on the actual file. Acceptance by a printer is a further, separate test.

**Provenance of desk research.** The desk-research claims in this document were gathered on 2026-11-25 by delegated research agents. They worked from public pages under this gate's rules: no logins, no personal data. Their full notes, with quotations, are kept outside the repository in the gate's shared notes folder (`r-color-research-*.md`).

The author re-read these primary sources directly:

- the veraPDF validation scope;
- the ICC-registry licence for PSO Coated v3;
- NVD CVE-2026-41254 and CVE-2026-42798;
- Gelato's PDF requirements (which corrected "required" to "should" for PDF/X-4);
- IngramSpark's file-creation guide;
- Firefox's `StaticPrefList.yaml` colour-management defaults.

Every other desk claim is agent-gathered and was not re-read. Measured results come from the prototypes and are reproducible ([REPRODUCING](REPRODUCING.md)).

## 1. Applicable standards

| Standard | Base PDF | Colour | Transparency | Notes |
|---|---|---|---|---|
| **PDF/X-4**: ISO 15930-7:2010 (2nd edition, reconfirmed 2026; replaces 2008) | 1.6 | CMYK, spot, ICC-based, Lab; device colour only when it matches the output intent | **allowed** | 2010 corrected metadata encoding, font-width validation and blend-mode algorithms |
| PDF/X-4p | 1.6 | as X-4 | allowed | output-intent profile external (by reference) |
| PDF/X-6 (ISO 15930-9:2020; X-6, X-6p, X-6n) | 2.0 | as X-4, plus page-level output intents | allowed | BPC by default (secondary source) |
| PDF/X-1a | 1.3/1.4 | CMYK and spot only | no | still *required* by IngramSpark; recommended by MOO |
| PDF/X-3 | 1.3/1.4 | adds ICC, Lab, CalRGB | no | accepted by IngramSpark and FLYERALARM |

X-4 is the right target: it keeps live transparency and accepts ICC-based RGB. X-1a and X-3 would require flattening transparency, which for vectors means the boolean flattening of [VECTOR-PDF-COLOR-OUTPUT §5.1](VECTOR-PDF-COLOR-OUTPUT.md). Whether a `%PDF-1.7` header is acceptable for X-4 is UNVERIFIED. The current writer emits 1.7.

## 2. PDF/X-4 requirements (checklist)

| Area | Requirement (source) | Vectra writer today | Gap |
|---|---|---|---|
| Metadata | XMP stream required: `pdfxid:GTS_PDFXVersion` = `PDF/X-4` (no year); `xmp:CreateDate`, `ModifyDate`, `MetadataDate`; `dc:title`; `xmpMM:DocumentID`, `VersionID` (`RenditionClass` checked (KB)) | none | XMP writer. **Clocks:** RFC-002 forbids clocks in exports, so dates must come from an explicit, user-visible export timestamp or a fixed policy. That is an owner decision |
| Trapped | `pdf:Trapped` True or False (the Info dictionary must match if present) | none | add `False` unless trapping is done |
| Info `GTS_PDFXVersion` | sources conflict: XMP-only vs "must match Info" vs RIPs that read Info (UNVERIFIED) | none | settle with the validator |
| Metadata stream compression | preflights check for an *uncompressed* metadata stream (KB; ISO text UNVERIFIED) | n/a | do not Flate the XMP stream |
| Output intent | `/S /GTS_PDFX`, `OutputConditionIdentifier`; a registered name where one applies (FOGRA39, FOGRA51, FOGRA52, CGATS21-2-CRPC6, …); **`DestOutputProfile` embedded for X-4** (X-4p references it externally); must be an output (`prtr`) profile | prototype only (C, D) | needs a user-supplied, validated profile (§3) |
| Colour spaces | DeviceCMYK needs a CMYK intent; DeviceRGB needs an RGB intent; DeviceGray needs a Gray or CMYK intent; Separation and DeviceN alternates follow the same rule; ICCBased, Lab, Separation, DeviceN allowed; every spot name has one alternate and tint transform everywhere; DeviceN needs `Colorants` for each spot; no transfer functions | production is DeviceRGB, **not allowed under a CMYK intent** | class-3 writer path (DeviceCMYK, or ICCBased sRGB objects with a CMYK intent) |
| ICC profile versions | normative references cover v2 (ICC.1:1998-09) and v4 (ICC.1:2003-09, ISO 15076-1:2005); iccMAX not referenced (inference) | n/a | validate the version on import |
| Transparency | allowed. A device-colour group space must match the intent (KB). The Ghent Workgroup flags ICC-based blend spaces as problematic. A printer rejected `/CS /DeviceRGB` groups under a CMYK intent | production has constant alpha, no group | write `/Group /S /Transparency /CS /DeviceCMYK` on pages with translucency (inference, to confirm in a validator) |
| Fonts | all embedded | Vectra emits no text | none |
| Page boxes | TrimBox (or ArtBox, **not both**) on every page; BleedBox encloses TrimBox; BleedBox within MediaBox | MediaBox only | prototype C has Trim and Bleed |
| Prohibited | encryption, external content, embedded files, JavaScript, actions, forms, LZW, alternate images, annotations in the print area (except TrapNet and PrinterMark) | none of these present | none |
| Optional content | allowed; every OCG needs a Name | none | none |
| Trailer `/ID` | UNVERIFIED | pdf-writer writes none by default | add a deterministic ID derived from content (no clock) |

Sources for this table: R2, R3, R5–R9, R11, R13–R15, R24, R27, R35–R37 in §7.

## 3. Output profiles and licensing

PDF/X-4 needs an **embedded** output profile, so a CMYK profile file must be at hand when exporting.

| Profile family | Embed in output | Redistribute in an MIT app | Source |
|---|---|---|---|
| ECI PSO Coated v3 (FOGRA51) / Uncoated v3 (FOGRA52) | yes | **no**, without ECI's written permission (registry wording forbids distribution, sale and alteration; a Debian record conflicts, so treat it as "ask ECI") | color.org registry; Debian `icc-profiles` copyright |
| ECI ISO Coated v2 (FOGRA39) | UNVERIFIED | UNVERIFIED (archived) | eci.org |
| Idealliance GRACoL2013 CRPC6, SWOP2013 CRPC5, CGATS21 (© X-Rite) | yes | sharing allowed; **no alteration or sale** without permission | color.org registry |
| VIGC Coated Fogra39L (© X-Rite) | yes | same terms (VIGC) | color.org registry |
| JPMA JapanColor2011Coated | yes | sharing allowed; no alteration; **no sale, alone or in commercial products** | color.org registry |
| Adobe ICC profiles | in image files | only under Adobe's bundling agreement (EULA acceptance, indemnity) | adobe.com |
| Fogra | publishes characterisation data, not profiles | UNVERIFIED | fogra.org |

**No candidate CMYK profile can be relicensed under MIT.** Several forbid sale, which conflicts with MIT's grant to downstream users.

**Recommendation:**

- Vectra ships **no** CMYK profile.
- Users import the profile their printer names.
- Documentation links to the official download pages.
- Bundling any profile needs a separate, written licence review by the maintainer.

## 4. Independent validation tools

| Tool | Licence / cost | Validates PDF/X | Notes |
|---|---|---|---|
| callas pdfToolbox | commercial (14-day trial) | yes: X-1a, X-3, X-4, X-4p, X-5, X-6 | industry reference |
| Adobe Acrobat Pro Preflight | commercial | yes: X-1a to X-5 (X-4:2008, X-4p) | whether it shares callas's engine is UNVERIFIED; if it does, it is not a second independent opinion |
| Enfocus PitStop Pro | commercial | yes: X-1a, X-3, X-4, X-4p | — |
| **veraPDF** | open source (MPL-2.0 / GPL-3.0) | **no**: PDF/A, PDF/UA and WTPDF only | the session brief listed it; it does not apply to PDF/X |
| Ghostscript `pdfwrite` | AGPL / commercial | **produces** PDF/X; no documented validation | useful as a CMYK-aware renderer (`-sUseOutputIntent`), not as a validator |
| `pdf-compliance` (Rust crate) | AGPL-3.0 / commercial | claims X-1a, X-3, X-4; coverage UNVERIFIED | AGPL: test use only |
| Ghent PDF Output Suite 5.0 | free download; licence not stated | tests RIPs and viewers, not files | do not commit to git |
| Altona Test Suite (ECI) | download, or Application Kit EUR 480; no redistribution without permission | tests X-3/X-4 output devices | do not commit to git |

**Available on this machine:** qpdf 12.4.2 and poppler 26.11.0 (structure only). veraPDF, Ghostscript, MuPDF and every PDF/X validator are **not installed, and none was installed** (the brief requires the owner's permission for system installs). **PDF/X validation: NOT RUN.**

## 5. Conformance versus acceptance

PDF/X sets no quality rules: no minimum resolution, no mandatory bleed, no ink limit.

- **Ghent Workgroup specifications.** GWG2015 and GWG2022, both built on PDF/X-4, add per-segment limits: text size, line widths, spot use, total ink, image resolution, overprint rules, a required output intent.
- **Printers and portals** add their own rules on top: the TAC limits of 240–300 %, rich-black recipes, "no crop marks", bleed sizes ([PRINT-PROVIDER-REQUIREMENTS](PRINT-PROVIDER-REQUIREMENTS.md)).

**A file that passes PDF/X-4 verification can still be rejected by a printer.**

Vectra's wording must keep the three levels apart:

1. "**Structurally valid PDF**" (qpdf).
2. "**PDF/X-4 verified by <tool, version, profile>**" (an independent validator report).
3. "**Accepted by <provider> on <date> for <product>**" (a provider test order).

## 6. Proposed qualification procedure

The release gate for any "PDF/X-4" option, and the only basis for using the term in the UI:

1. **Corpus.** The qualification corpus of [PRINT-QUALIFICATION-PLAN](PRINT-QUALIFICATION-PLAN.md), exported for each candidate output condition (at least FOGRA51 and GRACoL2013 CRPC6, using user-supplied profile files).
2. **Structure.** `qpdf --check` has no errors. Object inspection confirms one output intent, an embedded `prtr` profile, Trim and Bleed boxes on each page, no DeviceRGB under a CMYK intent, an uncompressed XMP stream, and no images or fonts.
3. **Conformance.** callas pdfToolbox *and* one other validator (PitStop, or Acrobat if it is shown to be independent), each with the predefined "PDF/X-4" profile.
   - Zero errors in both.
   - Every warning listed and dispositioned.
   - Reports stored with tool versions.
4. **Rendering.** Render with a CMYK-aware engine that honours the output intent (Ghostscript `-sUseOutputIntent`, or pdfToolbox). Compare against the conversion table:
   - opaque patches ΔE00 ≤ 1.0;
   - overprint and Separation plates checked per channel.
5. **Geometry.** Path-operator comparison against the RGB export of the same document: identical except colour operators and the declared bleed extension.
6. **Acceptance.** For each provider preset, at least one paid test order with a known patch sheet and a photographed or measured result. Results are recorded per provider, product and date. Physical results are never extrapolated to other providers.

Only after steps 1–5 pass may the export write `GTS_PDFXVersion`, and only after step 6 may a preset name a provider.

## 7. Sources (all accessed 2026-11-25)

- R1 <https://www.iso.org/standard/55843.html>
- R2 <https://cdn.standards.iteh.ai/samples/55843/22387ef2259840d4a53f02edbd4faf30/ISO-15930-7-2010.pdf> (ISO 15930-7:2010 sample pages)
- R3 <https://webstore.ansi.org/preview-pages/NPES/preview_ANSI+CGATS+ISO+15930-7-2008.pdf>
- R4 <https://www.iso.org/standard/77103.html>
- R5 <https://printtechnologies.org/standards/files/gts-registry.pdf>
- R6 <https://pdfa.org/pdfx-the-key-facts/>
- R7 <https://pdfa.org/technical-side-and-requirements-of-pdfx/>
- R8 <https://loc.gov/preservation/digital/formats/fdd/fdd000124.shtml>
- R9 <https://www.pdflib.com/pdf-knowledge-base/pdfx-output-intents/>
- R10 <https://www.pdflib.com/pdf-knowledge-base/pdfx-6/>
- R11 <https://ghostscript.readthedocs.io/en/latest/VectorDevices.html>
- R12 <https://ghostscript.readthedocs.io/en/latest/Use.html>
- R13 <https://specle.freshdesk.com/en/support/solutions/articles/103000242898> (KB)
- R14 <https://duon.zendesk.com/hc/en-us/sections/17025906605852-All-Error-Warnings> (KB)
- R15 <https://community.adobe.com/questions-9/verify-compliance-with-pdf-x-4-1315437>
- R16 <https://opensource.adobe.com/dc-acrobat-sdk-docs/library/jsapiref/preflight.html>
- R17 <https://helpx.adobe.com/acrobat/using/preflight-profiles-acrobat-pro.html>
- R18 <https://help.callassoftware.com/m/pdftoolbox/l/1573764-predefined-profiles>, <https://callassoftware.com/products/pdftoolbox/>
- R19 <https://pdfa.org/product/enfocus-pitstop-pro-13/>, <https://www.enfocus.com/en/pitstop-pro>
- R20 <https://docs.verapdf.org/validation/>, <https://verapdf.org/home/>
- R21 <https://docs.rs/pdf-compliance/latest/src/pdf_compliance/lib.rs.html>
- R22 <https://gwg.org/resources/ghent-pdf-output-suite/>, <https://gwg.org/resources/specifications-2/>
- R23 <https://eci.org/doku.php?id=en:projects:ats>, <https://eci.org/doku.php?id=en:downloads>
- R24 <https://www.color.org/registry/index.xalter> and the profile-registry pages for PSOcoated_v3, PSOuncoated_v3_FOGRA52, GRACoL2013_CRPC6, SWOP2013C3_CRPC5, CGATS21_CRPC6, Coated_Fogra39L_VIGC_300, JapanColor2011Coated
- R25 <https://sources.debian.org/src/icc-profiles/2.6/debian/copyright/>
- R26 <https://www.adobe.com/support/downloads/iccprofiles/icc_eula_mac_dist.html>
- R27 <https://www.color.org/whyusev4.xalter>
- R29 <https://artifex.com/blog/pdf-transparency-and-color>
- R35 <https://pdfa.org/further-quality-requirements-pdfx-plus/>
- R36 <https://github.com/Kozea/WeasyPrint/issues/2723>
- R37 <http://documentation.hybridhelix.com/hqnc/information-about-pdf-x-files>
- R39 <https://registry.color.org/cmyk-registry/fogra39>
- R40 <https://fogra.org/en/downloads/work-tools/characterisation-data>
