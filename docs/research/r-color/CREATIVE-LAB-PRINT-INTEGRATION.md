# R-COLOR-07 — Creative Lab and physical printing

Status: research and design proposal, 2026-11-25. Inputs:

- [Creative Lab](../../CREATIVE-LAB.md) (CL-01 Virtual Printing Press, CL-03 patterns, CL-08 print preview);
- RFC-002 §13 (InkPlates composite outputs, seeds, overprint only through a qualified vector representation);
- the measurements in [VECTOR-PDF-COLOR-OUTPUT](VECTOR-PDF-COLOR-OUTPUT.md).

**Provenance of desk research.** The desk-research claims in this document were gathered on 2026-11-25 by delegated research agents. They worked from public pages under this gate's rules: no logins, no personal data. Their full notes, with quotations, are kept outside the repository in the gate's shared notes folder (`r-color-research-*.md`).

The author re-read these primary sources directly:

- the veraPDF validation scope;
- the ICC-registry licence for PSO Coated v3;
- NVD CVE-2026-41254 and CVE-2026-42798;
- Gelato's PDF requirements (which corrected "required" to "should" for PDF/X-4);
- IngramSpark's file-creation guide;
- Firefox's `StaticPrefList.yaml` colour-management defaults.

Every other desk claim is agent-gathered and was not re-read. Measured results come from the prototypes and are reproducible ([REPRODUCING](REPRODUCING.md)).

## 1. Four different things that are all called "ink"

| | **A. Artistic ink simulation** | **B. Process CMYK separation** | **C. Spot-colour separation** | **D. Vector ink plates for screen printing** |
|---|---|---|---|---|
| What the artist means | "make it look printed": Risograph, DIY Underground, misregistration, overprint look | "print this on a four-colour press" | "print these regions in my named ink" | "give me one film positive per ink" |
| Who makes the plates | nobody: it is a picture of printing | the printer's RIP, from CMYK values | the RIP, one plate per named Separation | **Vectra**: one plate per ink, as files or pages |
| Colour meaning | sRGB display colours | output-profile device values (export-time conversion) | ink name + alternate (display or CMYK) | black = ink, transparent = no ink |
| Output | ordinary sRGB vector fills (SVG, RGB PDF, PNG) | CMYK PDF or TIFF with an output intent | PDF with Separation (or DeviceN) colour spaces | per-plate PDF pages or SVG files, with registration marks |
| Overprint | simulated in geometry (qualified vector intersections, RFC-002 §13) | knockout unless set; OPM rules apply to DeviceCMYK | `op`/`OP` flags, executed by the RIP | physical: plates are printed on top of each other |
| Already in scope | CL-01 (P2-C), visual only | no | no | CL-01 says "optional per-plate SVG exports are valuable experiments" |
| Claims allowed | none about print accuracy | "converted with profile X, intent Y" | "named Separation inks" (no Pantone accuracy claim) | "vector plates"; no claims about trapping or registration accuracy |

**The Creative Lab specification already forbids presenting A as B, C or D.** The current wording: "Simulated overprint must not be marketed as true spot-color separations, trapping certification, CMYK or PDF/X." This research keeps that boundary and gives B, C and D their own, later gates.

## 2. How they share one model without complicating Document v1

**Document v1 stays unchanged.** It has no effect stacks and no plates (C10). The seams are already in RFC-002 §13:

```text
InkPlates[{ plateId, colour, geometry }]       // composite recipe output (A12), stable IDs
Selection / provenance address (nodeId, plateId)
```

Proposed refinement, at the P2-B/P2-C recipe gate, as a Document v2 additive field:

```text
PaletteEntry v2 { id, name, color /* sRGB u32: display and proof colour, always present */,
                  ink?: { kind: "process" | "spot",
                          inkName /* 1–127 printable chars; written as the PDF Separation name */,
                          alternate?: { cmyk: [c,m,y,k] /* 0–1 */ } | { lab: [L,a,b] },
                          exportOverride?: { cmyk: [c,m,y,k] } | { kOnly: true } | { noInk: true } } }
InkPlate.colour → paletteRef                   // a plate prints with a palette entry's ink
```

- **Migration v1 → v2:** absent `ink` = process colour. It is deterministic and lossless, and no v1 file changes meaning.
- **One table serves B, C and D.** The export resolves each draw-list item's `paletteId` to an ink:
  - **B:** no `ink`, or `kind: process` → profile conversion table, then overrides (K-only black, no-ink white, exact CMYK).
  - **C:** `kind: spot` → PDF Separation `inkName` with `alternate`. Its tint is 1 for a solid fill. Tint percentages would be a later, explicit field.
  - **D:** for each spot ink, select the items with that `paletteId` and write them in black on their own page or file.
- **A needs nothing new.** It produces ordinary fills, so its colours go through B like any other artwork.

## 3. Overprint, knockout and the preview

- **Artistic overprint (A)** is a *look*. RFC-002 §13 already requires it to be represented as qualified vector geometry (intersections with their own display colours) or excluded from export. There is no raster blend fallback.
- **Physical overprint (C, D)** is an *instruction*. The PDF sets `op`/`OP` (and `OPM` for DeviceCMYK) on Separation paints. The RIP keeps the ink beneath instead of knocking it out.
- **Viewer support is uneven** (desk research):
  - pdf.js has no overprint simulation;
  - MuPDF simulates by default;
  - Acrobat has an Overprint Preview preference;
  - poppler needs a special build;
  - Chrome and Apple Preview are UNVERIFIED.

  A Vectra soft proof of overprint must therefore compute it itself. For flat inks that means a per-region subtractive approximation: a proof, not a guarantee.
- **Conversion changes meaning.** Converting a spot to CMYK turns its overprints into knockouts (PDF Association). An export that falls back from C to B must warn about that.

## 4. Screen-printing plates (D) in more detail

Every item below is geometry or export work that Vectra can do deterministically and locally:

| Requirement (from screen printers' public guides) | Vectra mechanism | Phase |
|---|---|---|
| One plate per ink, black on transparent, registration marks | per-ink page or file from `paletteId` (prototype variant E) | P3 |
| Knock-outs: lower inks removed under upper inks | boolean subtraction of upper-ink geometry from lower plates (P2-A booleans), explicit and undoable | P3 |
| Trap or choke: small overlaps against misregistration | offset paths (P2-A) per plate, a user parameter in document units | P3 |
| Minimum line ≥ 1 pt (reverse ≥ 2 pt), fonts ≥ 8 pt | preflight minimum-feature check (CL-08) | P3/P4 |
| Halftones ≤ 55 LPI | vector halftone pitch in physical units; warn above the plate's LPI limit | P2-C (Old Print) + P3 |
| Underbase (white ink on dark garments) | an explicit "underbase" plate = the union of the ink areas, optionally choked | later |
| Pantone and named inks | user-entered `inkName` + alternate. **Vectra ships no Pantone library** (proprietary data); no accuracy claim | P3 |

**Deterministic procedural generation is preserved:**

- Plates are recipe outputs with stable operation-instance seeds (RFC-002 §13).
- Export reads committed or baked plate geometry and adds no randomness.
- Misregistration *effects* are committed transforms, not export-time jitter.
- A real plate export is registered by default, and any artistic offset is shown as such.

## 5. Future colour spaces

- **Separation:** one named ink per space, with an alternate (prototype D: Type 2 tint transform to the ink's CMYK). Sufficient for spot inks and plates.
- **DeviceN:** needed only when one object mixes several named inks with partial tints, as in duotones or spot halftone blends. PDF/X-4 then requires a `Colorants` entry for every spot. This comes after Separation is qualified.
- **`/All` and `/None`:** registration marks use `/All`; `/None` is never needed.

## 6. Phasing

| Gate | Content | Claims allowed |
|---|---|---|
| CL-G1 (existing) | Press: two ink plates, artistic, sRGB export | visual simulation only |
| **CL-G1S** (proposed) | spot inks as PDF Separations; per-ink plate export (D) with registration marks | "named Separation inks", "vector plates" (structurally verified, rendered per channel) |
| **CL-G1T** (proposed) | knock-outs and trap or choke via booleans and offsets | "plates with explicit knock-out/trap of N mm" (geometry verified) |
| CL-G7 (existing) | print preview and preflight | warnings; no certification |

**Physical qualification** of C and D means a test print by a screen printer, with the patch sheet of [PRINT-QUALIFICATION-PLAN](PRINT-QUALIFICATION-PLAN.md). It precedes any provider-named preset.
