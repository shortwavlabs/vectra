# R-COLOR-08 / R-COLOR-09 — Export dialog, soft proof and preflight (design proposal)

Status: **design proposal**, 2026-11-25. It does not modify the active G-UI or G-UI-R implementation. Static mockup: [mockups/export-dialog.svg](mockups/export-dialog.svg). It uses the tokens of [DESIGN-SYSTEM](../../DESIGN-SYSTEM.md): background `#191a1c`, panel `#212224`, elevated `#292a2c`, foreground `#eeeef0`, muted `#a9abad`, primary lime `#b9e87b`, control-border `#787a7e`, warning `#f2c14e`, destructive `#ff8f85`, paper `#eee8d8`.

**Screen A shows only what exists today; everything else in it is disabled and labelled "planned" or "Not available yet".** Screen B is explicitly labelled as the proposed P2-R1 state (raster export does not exist today), and options beyond P2-R1 are disabled within it. No control implies that a capability exists before it does.

## 1. Principles

1. **SVG in two clicks.** Choose Export, then Export SVG. Nothing about print appears unless the user asks for it.
2. **Progressive disclosure:** Destination (Digital or Print) → Format → Size → Colour → Advanced. Each level opens only when the one above needs it.
3. **Say what will happen** before writing the file:
   - pixel dimensions for raster output;
   - physical size and units;
   - colour conversion (profile name, digest prefix, intent);
   - which objects are affected by overrides.
4. **No unearned words.** "PDF/X", "print-ready", "CMYK-accurate" and provider names appear only for qualified configurations ([PROPOSED-RFC-AMENDMENTS §5](PROPOSED-RFC-AMENDMENTS.md)).
5. **Warnings are not failures,** and recommendations are not requirements (§5.3).
6. **Accessible.** Every option is keyboard-reachable, with visible labels and the dual focus ring. Statuses use icon + text, never colour alone (DESIGN-SYSTEM).

## 2. Information architecture

```text
Export ─┬─ Destination:  ( Digital )  ( Print )
        ├─ Format:       Digital → SVG · PDF (RGB) · PNG
        │                Print   → PNG for print services · PDF · TIFF · Ink plates
        ├─ Size:         width × height (linked) · unit (mm, in, px, pt) · ppi (raster only)
        │                → "2,362 × 1,575 px at 300 ppi = 200.0 × 133.4 mm"
        ├─ Colour:       Portable RGB (default) · sRGB with embedded profile ·
        │                CMYK with printer profile [Import profile…] · intent (Relative / Perceptual)
        │                → overrides: black = K only ☐ · white = paper ☐ · per-palette table…
        ├─ Print marks:  bleed (mm) · extend background into bleed ☐ · crop marks ☐ (off by default)
        ├─ Transparency: raster: keep alpha / flatten on paper colour · CMYK: proof shown
        ├─ Ink plates:   one page per ink · registration marks · knock-out/trap (later)
        └─ Preflight:    results list (§5) · [Soft proof] toggle · [Export]
```

**Presets** are data, never code. Each preset sets the fields above and carries:

- its source URL;
- a "verified on" date;
- the note "requirements may change; check with the provider".

Initial preset candidates follow [PRINT-PROVIDER-REQUIREMENTS](PRINT-PROVIDER-REQUIREMENTS.md). Example: "Garment print-on-demand: sRGB PNG, transparent, 300 ppi, partial-alpha warning". **No preset names a provider until that provider has accepted a test file.**

## 3. Screens (see mockup)

- **A. Digital (default; today's capabilities).**
  - Format SVG is selected; PDF (RGB) is available; PNG is drawn disabled ("planned").
  - Size is shown in px and in physical units for information only.
  - One "Export SVG" button.
  - A collapsed "Print settings" row reads "Preparing for a printer? Switch to Print".
- **B. Print → PNG for print services** (proposed P2-R1 state, labelled as such in the mockup).
  - Physical size and ppi, with the resulting pixel dimensions.
  - Colour: sRGB with embedded profile (fixed for PNG).
  - Transparency: keep, or flatten on paper colour.
  - Preflight lists a partial-alpha warning (garments) and "Resolution OK: 300 ppi at 200 mm".
- **C. Print → PDF, CMYK.** Shown in the mockup as **disabled** (P2, unqualified):
  - profile picker (empty until the user imports a profile; no bundled CMYK profile);
  - intent;
  - overrides;
  - bleed and marks;
  - a preflight preview listing translucency, gamut and TAC findings.
- **D. Ink plates** (disabled, P3): a per-ink list with ink names, plate preview thumbnails (vector), registration-marks checkbox.

## 4. Field behaviour

| Field | Rule |
|---|---|
| Width / height | linked to the artboard aspect ratio (scene v1 has no independent height); limits from `pdf.rs` (1–14,400 pt) and the raster memory estimate |
| Unit | mm, in, pt, px. px requires ppi, as `PdfOptions` already does (`dpi` 1–2,400) |
| ppi | raster only; shows the resulting pixels and the estimated memory; refuses sizes beyond the banded-render limit, with a typed message (no silent downsampling) |
| Profile | import a local `.icc`/`.icm` → validation ([ICC-PROFILE-LIFECYCLE §4.4](ICC-PROFILE-LIFECYCLE.md)) → shows description, class, colour space, version and the SHA-256 prefix. A monitor or RGB profile cannot be chosen as a CMYK output |
| Intent | Relative colorimetric (default) or Perceptual. Saturation and Absolute are hidden (proofing-only, or engine-dependent: measured) |
| BPC | not shown with the moxcms candidate (unsupported); if Little CMS is adopted, shown as a checkbox, default as the gate decides |
| Overrides | per palette entry: Profile (default) · K only · No ink (paper) · Exact CMYK (four numeric fields, 0–100 %) · Spot ink (P3) |
| Bleed | 0, 2, 3 or 4 mm, or 0.125 in, or custom. Extending the background into the bleed is an explicit checkbox |
| Crop marks | off by default; tooltip "Many printers ask for files without marks" |

## 5. Soft proof and preflight panel

### 5.1 What a soft proof can show on Canvas 2D

| Can be shown | How |
|---|---|
| Converted flat colours | substitute each palette and effective colour in the render snapshot with its proof colour: sRGB → device → Lab → sRGB through the output profile, relative colorimetric. **No renderer change:** the snapshot already carries per-item colours (C8). The cost is one table per proof toggle |
| K-only black and no-ink white overrides | same table; K-only black visibly lighter than rich black (measured `#1a1919` vs `#0f0d0d` in Quartz) |
| Out-of-gamut items | an overlay pattern (hatching) on items whose round-trip ΔE00 > 2, plus a count. This needs a small renderer overlay feature (like the selection overlay) |
| Paper colour | an optional "simulate paper" mode (absolute colorimetric proof). Engine-dependent (measured), so it is labelled approximate |

| Cannot be shown accurately | Why |
|---|---|
| Colours outside the display's gamut | an sRGB canvas cannot display them. A `display-p3` canvas could on some displays, but Firefox ignored the option (measured) |
| The user's real display | the page does not know the display's calibration. The browser maps sRGB to the display profile it knows |
| Translucent overlaps in CMYK | Canvas 2D blends in sRGB. The CMYK composite differs by up to 19 ΔE00 (measured). A correct proof needs per-overlap geometry (booleans, P2-A) or a raster proof composited in CMYK in the worker (a disposable display cache, never exported). It is shown as "approximate" until then |
| Overprint, dot gain, ink spread, substrate texture | not modelled; CL-08 print preview is an artistic mockup, not a proof |

**The panel states:** "Soft proof approximates the printed colour on this screen. It cannot show colours your display cannot reproduce, and it is not a contract proof."

### 5.2 Preflight checks (proposed)

| Check | Applies to | Result class |
|---|---|---|
| Output profile missing, invalid, or not a `prtr` CMYK profile | CMYK | **Error** (export of that kind blocked) |
| Translucent items present (count) | CMYK PDF | **Warning**: requires acknowledgement; proof shows the composite |
| Out-of-gamut colours (count, worst ΔE00) | CMYK | **Warning** |
| TAC above the preset limit (max %, affected palette entries) | CMYK | **Warning** with a suggested override |
| Rich black on thin features (below 1 pt) | CMYK | **Warning** (suggest K only) |
| White printed as ink | CMYK | **Recommendation** (suggest "white = paper") |
| Raster ppi below the preset minimum at the chosen size | raster | **Warning** |
| Partial alpha in a garment preset | PNG | **Warning** (providers document problems) |
| No bleed on a trimmed product preset | PDF/TIFF | **Recommendation** |
| Minimum line or feature below the preset's value | plates, CMYK | **Warning** |
| Validator report imported (later) with errors | PDF/X | **Verified conformance failure**: shown only when an external validator report says so; Vectra never asserts conformance itself |

### 5.3 Wording rules

| Class | Meaning | Visual |
|---|---|---|
| **Error** | this export cannot be produced as configured | destructive icon + text |
| **Warning** | it can be produced; the result may differ from the preview or the provider's expectations; acknowledge to continue | warning icon + text |
| **Recommendation** | a suggestion from a preset or common practice; no acknowledgement needed | info icon + text |
| **Verified failure** | an independent validator, identified by name and version, reported it | destructive icon + the tool name |

## 6. Not exposed until qualified

The following are drawn disabled or not shown:

- the PDF/X option;
- provider-named presets;
- spot-ink accuracy;
- trapping;
- the "print-ready" badge;
- absolute colorimetric;
- BPC with an engine that lacks it.

The mockup shows CMYK and Ink plates disabled, and PNG disabled in screen A, because none exists today. Screen B is a labelled proposal. When P2 delivers CMYK PDF, it is enabled with the "unqualified" wording of §5.3. PDF/X stays absent until [PDFX-FEASIBILITY §6](PDFX-FEASIBILITY.md) passes.
