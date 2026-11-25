# Print-provider file requirements (survey)

Status: desk research, 2026-11-25. Public help and specification pages only. Nothing was logged into, uploaded or submitted. Several pages were served from a crawler cache dated 2026-11-23 to 2026-11-25. Every source is listed in §5.

**Provider pages change without notice, so re-verify before any export preset ships.**

**Legend:**

| Mark | Meaning |
|---|---|
| **R** | stated as required or a hard limit |
| r | recommended |
| (unmarked) | instruction with no stated strength |
| U | UNVERIFIED (not on a fetched page) |
| n/a | not applicable |

**Provenance of desk research.** The desk-research claims in this document were gathered on 2026-11-25 by delegated research agents. They worked from public pages under this gate's rules: no logins, no personal data. Their full notes, with quotations, are kept outside the repository in the gate's shared notes folder (`r-color-research-*.md`).

The author re-read these primary sources directly:

- the veraPDF validation scope;
- the ICC-registry licence for PSO Coated v3;
- NVD CVE-2026-41254 and CVE-2026-42798;
- Gelato's PDF requirements (which corrected "required" to "should" for PDF/X-4);
- IngramSpark's file-creation guide;
- Firefox's `StaticPrefList.yaml` colour-management defaults.

Every other desk claim is agent-gathered and was not re-read. Measured results come from the prototypes and are reproducible ([REPRODUCING](REPRODUCING.md)).

## 1. Survey

| Provider | Formats | Colour / profile | Resolution / limits | Transparency | Bleed | PDF/X |
|---|---|---|---|---|---|---|
| Printful (POD) [P1–P3] | PNG or JPEG r; PDF accepted if flattened | **sRGB IEC 61966-2.1, embedded**, r; Printful converts to CMYK itself | ≥ 150 DPI **R** (300 for stickers and phone cases), ≤ 300 r; 20,000 px, 200 MB **R** | PNG alpha r; avoid semi-transparency for DTG/DTF | per-product templates | none |
| Printify (POD) [Y1–Y2] | JPEG, PNG, SVG **R** | RGB r (CMYK uploads converted to RGB); sRGB not named | 300 r; 120–150 **R** for large items; 100 MB raster, 20 MB SVG **R** | U | U | none |
| Gelato (POD) [G1–G2] | PDF or image | PDF output intent GRACoL 2006 (stated); sRGB images r (posters); CMYK r (stationery) | 150–300 dpi | flatten in PDF r | 4 mm **R** | PDF/X-4 ("should be exported as") |
| Prodigi (POD) [D1–D2] | JPG, PNG or PDF r; foil and glow prints PNG only **R** | RGB r; do not embed Prodigi's own ICC profiles | 300 r | PNG alpha respected | about 3 mm (photo prints) | none |
| Redbubble [R1–R3] | JPEG and PNG only **R** | design in CMYK, upload RGB r | per-product minimum pixels **R**; ≤ 13,500 px, 300 MB **R** | PNG needed for alpha **R** | n/a | n/a |
| Spoonflower (fabric) [S1] | JPG or PNG **R**; no PDF or TIFF | sRGB r | 150 dpi; < 40 MB **R** | U | U | n/a |
| Spring [SP1] | PNG r; EPS rejected **R** | CMYK r (no profile named) | ≥ 120 DPI **R**; 300 r; 50 MB **R** | transparent background r | U | n/a |
| Threadless [T1–T2] (pages dated 2020/2021) | transparent PNG r | RGB | 4200 × 4800 at 300 r | white underbase shows through partial opacity | U | n/a |
| TeePublic [TP1–TP2] | transparent PNG | **RGB R**; converted to CMYK | ≥ 1500 × 1995 **R** | transparent PNG | U | n/a |
| Zazzle [Z1] | JPEG, PNG, PDF, SVG, AI, GIF, TIFF | CMYK preferred r; no profile required | 150/200/300 ppi by product | alpha OK; partial alpha unsupported on dark apparel | U | U |
| Vistaprint [V1–V2] (V1 is an editorial article) | PDF, AI, PSD r; also BMP, GIF, JPG, PNG, TIF, HEIC | CMYK r; no profile mandated | 300 r | U | 0.125 in (example) | not mandated |
| MOO [M1] | vector PDF r | CMYK, Coated GRACoL 2006; no spot colours | ≥ 300 | flatten r; opacity > 40 % r | 2 mm | PDF/X-1a:2001 r |
| Mixam [MX1–MX2] | PDF r | CMYK, GRACoL2006_Coated1v2; total ink 150–250 % r | U | U | 0.125 in | U |
| Lulu (books) [L1] | PDF | sRGB r + GRACoL; CMYK OK; total ink ≤ 270 % | 300; cover 300–600 | flatten; rasterise cover vectors | 0.125 in | none stated |
| IngramSpark (books) [I1] | PDF **R** | **CMYK R** (RGB converted); spot → CMYK; total ink ≤ 240 %; no ICC profiles on black-and-white interiors | 300; < 72 rejected | U | 0.125 in on 3 edges | **PDF/X-1a:2001 or X-3:2002 R** |
| FLYERALARM (DE) [FA1–FA2] | PDF, TIF or JPG only **R** | **CMYK R**; ISO Coated v2 300 % / FOGRA39 as output intent; total ink 300 % | ≥ 300 | no alpha in JPG or TIF **R** | per product datasheet (U) | PDF/X-4 r (X-3 accepted) |
| SAXOPRINT (DE) [SX1] | PDF r; JPG, TIFF | CMYK; PSO Coated v3 FOGRA51 / PSO Uncoated v3 FOGRA52; named HKS or Pantone channels | 250; line art 1200 | keep live transparency r | 2 mm **R** | PDF/X-4 r |
| High Desert Print (screen) [HD1] | AI, EPS, PDF r | Pantone Coated | raster 300 | U | n/a | n/a; halftones ≤ 55 LPI; lines ≥ 1 pt (reverse ≥ 2 pt) |
| Real Thread (screen) [RT1] | AI, EPS, SVG, PDF; PSD, PNG, TIFF | RGB r, converted to Pantone Coated | 300 | U | n/a | n/a |
| Oregon Screen (screen) [OS1] | AI, PDF, EPS, SVG; PSD, PNG, JPG | U | 300 ppi | U | n/a | n/a; fonts ≥ 8 pt, lines ≥ 1 pt |

**Not reached:**

- Society6: no official specification page found.
- Bandcamp merch: no published artwork specification.
- Everpress: DNS failure.
- WIRmachenDRUCK and Onlineprinters: search excerpts only, not used.
- A UK online printer: none fetched.

## 2. What is common, what differs

- **Garment and poster POD wants RGB raster, not CMYK.**
  - Printful, Printify, TeePublic, Threadless, Spoonflower, Prodigi and Redbubble all ask for RGB, mostly PNG.
  - Only Printful (embedded IEC 61966-2.1), Spoonflower and Gelato (posters) name sRGB.
  - Printful and TeePublic state that they convert to CMYK themselves.
  - Printify converts CMYK uploads *to RGB*.

  **The assumption "print = CMYK" is wrong for most of Vectra's stated audience** (T-shirts, merch, posters).
- **CMYK PDF/X is a commercial-printing requirement.**
  - Strictly required: IngramSpark (X-1a or X-3).
  - Asked for ("should"), mixed-colour: Gelato (X-4 with a GRACoL 2006 output intent; sRGB and CMYK objects supported; 4 mm bleed required).
  - Recommended: MOO (X-1a), FLYERALARM (X-4) and SAXOPRINT (X-4).

  The named conditions differ: GRACoL 2006 (US-oriented services), FOGRA39 (FLYERALARM), FOGRA51/52 (SAXOPRINT). **No single bundled CMYK profile could serve them all.**
- **Total ink limits differ** (240 %, 250 %, 270 %, 300 %), and so do rich-black recipes:

  | Provider | Rich black (C/M/Y/K) |
  |---|---|
  | Gelato | 60/60/60/100 |
  | IngramSpark | 60/40/40/100 |
  | FLYERALARM | 60/40/20/100 |

  Most ask for 100 % K for text. The measured sRGB black under a generic profile is 72/70/64/87 (294 %), which already exceeds two of these limits ([ICC-ENGINE-EVALUATION §4.1](ICC-ENGINE-EVALUATION.md)).
- **Bleed** is 2 mm, 3 mm, 4 mm or 0.125 in (3.175 mm). Most PDF printers (Gelato, MOO, Lulu, IngramSpark, FLYERALARM) say **not** to include crop marks.
- **Transparency.**
  - Partial alpha is a problem on garments: it causes white underbase show-through (Threadless), prints opaque on dark apparel (Zazzle), and Printful says to avoid it.
  - Some PDF printers want transparency flattened (Gelato, MOO, Lulu); X-4 printers keep it live (FLYERALARM, SAXOPRINT).
- **Spot colours.**
  - Refused (convert to CMYK) by IngramSpark, MOO and FLYERALARM four-colour products.
  - Accepted as named channels by SAXOPRINT.
  - Screen printers work in Pantone and want vector separations, minimum line weights (≥ 1 pt) and coarse halftones (≤ 55 LPI).
- **Vector acceptance.**
  - Screen printers, Zazzle and MOO take vector PDF or SVG; Printify takes SVG.
  - Redbubble, Spoonflower and Spring take no vector format.

## 3. Recommendations versus universal requirements

**Treat nothing in §1 as a universal printing requirement.** Three things are both common and well founded:

1. Pixels at print size of 150–300 ppi for raster.
2. An embedded profile, or a declared output intent, so values are unambiguous.
3. Bleed for anything trimmed.

Everything else is provider-specific: colour space, named characterisation, ink limit, rich black, PDF/X level, marks, and transparency handling.

**This argues for export presets as data, not code** (see [EXPORT-UX-PROPOSAL](EXPORT-UX-PROPOSAL.md)):

- each with a verified source URL, a verification date and a "requirements may have changed" note;
- no preset claiming acceptance until the provider has accepted a test file ([PRINT-QUALIFICATION-PLAN](PRINT-QUALIFICATION-PLAN.md) Q-P).

## 4. Implications for the roadmap

| Need | Covered by | Phase |
|---|---|---|
| sRGB PNG with alpha, embedded sRGB profile, chosen ppi at a physical size | intentional raster export ([RASTER-EXPORT-RESEARCH](RASTER-EXPORT-RESEARCH.md)) | **first print-relevant capability** (P2) |
| Vector PDF/SVG for screen printers, with separated plates per ink | spot or ink plates ([CREATIVE-LAB-PRINT-INTEGRATION](CREATIVE-LAB-PRINT-INTEGRATION.md)) | P2-C/P3 |
| CMYK PDF with an output intent, bleed and trim, provider profile, ink-limit check | profile-managed CMYK PDF ([VECTOR-PDF-COLOR-OUTPUT](VECTOR-PDF-COLOR-OUTPUT.md)) | P2/P3 |
| PDF/X-1a, X-3 or X-4 conformance | qualified PDF/X ([PDFX-FEASIBILITY](PDFX-FEASIBILITY.md)) | later; needs an independent validator |

## 5. Sources (all accessed 2026-11-25)

- **P1** <https://help.printful.com/hc/en-us/articles/50264019148177-How-should-I-prepare-my-print-file-for-the-best-results>
- **P2** <https://help.printful.com/hc/en-us/articles/50264003313041-Should-I-use-RGB-or-CMYK-for-Printful-print-files>
- **P3** <https://www.printful.com/creating-dtg-file>
- **Y1** <https://help.printify.com/hc/en-us/articles/4483617936657-What-type-of-print-files-does-Printify-require>
- **Y2** <https://help.printify.com/hc/en-us/articles/4483625994513-Which-color-profile-should-I-use-for-my-files>
- **G1** <https://support.gelato.com/en/articles/8996349-what-are-the-design-requirements-for-pdf-uploads>
- **G2** <https://support.gelato.com/en/articles/8996346-in-what-format-can-i-upload-my-files>
- **D1** <https://www.prodigi.com/faq/images/>
- **D2** <https://www.prodigi.com/blog/create-print-on-demand-wall-art/>
- **R1** <https://help.redbubble.com/hc/en-us/articles/202270679-Dimensions-Format>
- **R2** <https://help.redbubble.com/hc/en-us/articles/4409617155220-Which-Graphics-Software-should-I-use>
- **R3** <https://help.redbubble.com/hc/en-us/articles/4412586947348-How-do-I-upload-my-art-to-Redbubble>
- **S1** <https://support.spoonflower.com/hc/en-us/articles/204600314-Uploading-Images>
- **SP1** <https://kb.spri.ng/creators/articles/design-requirements-file-formatting-tips-faq.html>
- **T1** <https://artistshopshelp.threadless.com/article/204-how-do-i-set-up-my-design-files-for-my-artist-shop>
- **T2** <https://artistshopshelp.threadless.com/article/800-optimization-101>
- **TP1** <https://teepublic.zendesk.com/hc/en-us/articles/4409831531031-Designing-for-Specific-Product-Dimensions>
- **TP2** <https://teepublic.zendesk.com/hc/en-us/articles/115013698627-Does-my-design-have-to-be-in-RGB-or-CMYK>
- **Z1** <https://www.zazzle.com/hc/article/creating_and_uploading_images_to_zazzle-219861927>
- **V1** <https://www.vistaprint.com/hub/business-card-file-prep>
- **V2** <https://www.vistaprint.com/customer-care/help-center/360051218811>
- **M1** <https://support.moo.com/hc/en-us/articles/202834204-How-to-Use-Downloadable-Sizing-Templates>
- **MX1** <https://mixam.com/support/filesetup>
- **MX2** <https://mixam.com/support/ink>
- **L1** <https://help.lulu.com/en/support/solutions/articles/64000255519-pdf-creation-settings>
- **I1** <https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf>
- **FA1** <https://www.flyeralarm.com/de/i/druckdaten/dateitypen-und-pdf-anforderungen/>
- **FA2** <https://www.flyeralarm.com/de/i/druckdaten/farbe/>
- **SX1** <https://www.saxoprint.de/service-und-hilfe/druckdatenanleitung>
- **HD1** <https://highdesertprint.com/pages/artwork-info>
- **RT1** <https://www.realthread.com/help-center/what-file-format-should-i-submit-my-design-in>
- **OS1** <https://oregonscreen.com/screen-printing-art-guidelines/>
