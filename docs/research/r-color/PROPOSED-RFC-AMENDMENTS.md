# R-COLOR — Proposed RFC, PRD and register amendments

Status: **proposals only**, 2026-11-25. No normative document, the technical-debt register or any production file has been edited. Under RFC-002 change control, each item needs the maintainer's decision.

**Requirement status labels:**

| Label | Meaning |
|---|---|
| **CONFIRMED REQUIREMENT** | the owner's issue [#5](https://github.com/shortwavlabs/vectra/issues/5) or an accepted document states it |
| **PROPOSAL** | this research recommends it |
| **UNQUALIFIED** | a capability that must not be claimed until a qualification step passes |

## 1. Confirmed requirements (from #5 and accepted documents)

- RGB and CMYK export for digital use and physical products (#5, "future product requirement").
- Editable vector geometry in SVG and PDF; no raster fallback (#5; RFC-002 principle 7).
- SVG remains portable RGB (#5).
- ICC-managed RGB and CMYK PDF output qualified independently (#5).
- Accepted P0 RGB pipeline and regression hashes retained (#5; RFC-002 §2).
- Local, offline processing; no AI; MIT core (#5; RFC-002 §2).
- Raster export only as a separate, intentional format (#5).
- No unqualified compliance claims: no CMYK, PDF/X or spot certification claims (RFC-002 §6.1; RFC-001 Export).

## 2. Amendments to make before G-EXP and before the Document v1 release (text only)

### AM-C1 — Colour semantics (contracts C3, C8, C10; RFC-002 §5.1) — PROPOSAL

**Add to C10 "Document section", after "Styles":**

> **Colour values.** Every colour in Document v1 is packed `r<<24 | g<<16 | b<<8 | a`. Its RGB is **sRGB (IEC 61966-2-1), 8-bit encoded**, and its alpha is **straight (not premultiplied)** opacity. This covers `Style.fill`, `Style.stroke.color`, `PaletteEntry.color`, `artboard.background` and the TraceProvenance colours (`originalScene.background`, `originalScene.palette[].color`, and any colour inside `traceRequest.settings` such as `ink` or `palette`). The same meaning applies to GeometryPacket style tables (C3), render and export draw lists (C8), and scene v1 (`#rrggbb[aa]`). Device colour values, profiles and print settings are not document data in v1; they are export parameters (RFC-002 §6.1).
>
> *Informative:* the editor preview composites alpha source-over in the encoded sRGB space. Exported files carry alpha as constant opacity, and their compositing space is chosen by the viewer or output device; R-COLOR measured differences between viewers. v1 therefore makes no normative promise about how exported translucency composites.

**Effect:** no schema, golden-file or hash change. `documentSchemaVersion` stays 1.

**Forward compatibility:** a future v2 colour-space or ink field migrates as "absent → sRGB / process".

### AM-C2 — `browser-canvas-v1` decode semantics (C10; TD-GEO-007) — PROPOSAL

**Add to C10 `decodePolicy`:**

> `"browser-canvas-v1"` delegates colour-profile handling to the browser. Embedded ICC, cICP and gAMA signalling is converted to sRGB or ignored, depending on engine, platform and user preferences (measured: Chromium 159, WebKit 27.2 and Firefox 159 with its default colour-management preferences convert ICC/cICP-tagged PNG and JPEG to sRGB on macOS; Playwright's Firefox build ignores them; gAMA differs by up to 2 levels). Untagged sources are interpreted as sRGB. A Vectra-owned decoder that converts profiles itself is a new enum value.

**TD-GEO-007** (proposed text for the maintainer to add; the register is not edited here):

> Add colour-profile handling to "User-visible impact" and "Numerical evidence". Note that the repository's Playwright Firefox runs, and most likely the P0 cross-browser evidence, used Playwright's `gfx.color_management.mode` 0 (no `firefoxUserPrefs` in `playwright.config.ts` or its history). Extend the acceptance criteria: "identical decoded RGBA for ICC-, cICP- and gAMA-tagged inputs across Chromium, Firefox and Safari with default preferences".

### AM-C3 — Export colour contract (RFC-002 §6.1 Writers) — PROPOSAL

**Add to RFC-002 §6.1:**

> **Output colour.** Output colour space, profile, rendering intent, ink overrides and page boxes are export-request parameters. The default request is portable RGB: SVG as today; PDF DeviceRGB with a MediaBox only. It is byte-identical to the frozen hashes. Scene v1 stays sRGB. Any profile-managed conversion happens after `bake_draw_list`, in the writer stage, per distinct effective colour, with `paletteId`-keyed overrides applied first. It runs in the compute worker and is quantised to an integer grid. The export draw list keeps `paletteId` (C8) for this purpose. No export writes a PDF/X version key or names a print provider until the qualification in R-COLOR PDFX-FEASIBILITY §6 passes for that configuration.

**G-EXP scope note:** G-EXP adds no colour field and no colour dependency. It only preserves:

1. the isolation of the three colour call sites in `pdf.rs`;
2. `paletteId` in the export draw list.

## 3. Amendments that come with later phases

| ID | Document | Change | Phase | Status |
|---|---|---|---|---|
| AM-C4 | PRD "Should/Could" | Replace "Could: … print separations, CMYK/PDF/X after dedicated validation" with the staged list: intentional sRGB raster → profile-managed CMYK PDF/TIFF → spot inks and plates → qualified PDF/X-4. Each is UNQUALIFIED until its gate passes | P2 planning | PROPOSAL |
| AM-C5 | RFC-001 Export | Keep "RGB only initially; no PDF/X or CMYK claim", with a pointer to AM-C3. No other change | with AM-C3 | PROPOSAL |
| AM-C6 | Document v2 (P2-B/P2-C) | `PaletteEntry.ink?` descriptor (process or spot, ink name, alternate, export override); `InkPlate.colour` → palette reference. Migration: absent → process | with spot inks | PROPOSAL |
| AM-C7 | Document v2 | Optional export presets (format, size, unit, ppi, bleed, colour kind, profile digest, intent, overrides) as data; relink by digest | P2/P3 | PROPOSAL |
| AM-C8 | `.vectra` container | `profile` section kind (opt-in embedding of user-imported profiles), subject to the profile's licence | later | PROPOSAL |
| AM-C9 | Creative Lab gates | Add CL-G1S (Separation inks and per-ink plates) and CL-G1T (knock-out and trap) ([CREATIVE-LAB-PRINT-INTEGRATION §6](CREATIVE-LAB-PRINT-INTEGRATION.md)) | P3 | PROPOSAL |
| AM-C10 | Worker protocol (C5) | `ExportRequest.color`, `page.bleed`, `page.marks`, `raster` ([COLOR-ARCHITECTURE-PROPOSAL §4](COLOR-ARCHITECTURE-PROPOSAL.md)); `protocolVersion` increment | P2 | PROPOSAL |

## 4. Proposed technical-debt entries

These are proposed for the maintainer to add; the register is not edited here.

### TD-COLOR-001 — Translucent compositing in RGB PDF exports is viewer-dependent

- **Category / severity:** Limitation · Low–Medium.
- **Impact:** a translucent fill exported to PDF (the accepted P0 pipeline) looks different in macOS Quartz than in poppler.
- **Evidence:**
  - Quartz (`sips`, macOS 26.6.2) composited in its Display P3 output space: 4.5–8.1 ΔE00 from the sRGB composite on 50 % saturated overlaps.
  - An explicit page group `/CS` did not change Quartz.
  - poppler matched the sRGB composite (≤ 0.24).
  - Opaque colours agree (≤ 0.31).
- **Approach:** vector flattening of overlaps (after P2-A booleans), or disclosure. A page group alone did not help.
- **Acceptance:** overlaps within 1 ΔE00 across the qualified viewer set, or a documented limitation.
- **Reference:** [VECTOR-PDF-COLOR-OUTPUT §5.2](VECTOR-PDF-COLOR-OUTPUT.md).

### TD-COLOR-002 — Automated Firefox runs disable colour management

- **Category / severity:** Test environment · Low.
- **Impact:** Playwright's Firefox build sets `gfx.color_management.mode` 0 and `rendering_intent` 3, and `playwright.config.ts` sets no Firefox preferences. Tests with tagged images therefore do not represent a default Firefox.
- **Approach:** set the preference explicitly in the tests that use tagged sources.
- **Acceptance:** documented preference; the tagged-source fixtures run under mode 2.

### TD-COLOR-003 — Untagged and tagged sources are not signalled to the user

- **Category / severity:** Limitation · Medium.
- **Impact:** a P3- or Adobe-RGB-tagged photo is silently converted (or not) by the browser. An untagged photo is silently assumed sRGB.
- **Approach:** header colour-signal classification at intake, plus import-summary wording ([ICC-PROFILE-LIFECYCLE §3](ICC-PROFILE-LIFECYCLE.md)). The deterministic conversion itself comes with the WASM decoder (TD-GEO-007).
- **Acceptance:** each class shows the documented message; the classifier is tested against the synthetic inputs.

## 5. Explicitly UNQUALIFIED until gates pass

None of the following may be claimed until it has passed qualification:

- CMYK output accuracy (any profile);
- PDF/X-1a, X-3, X-4 or X-6 conformance;
- acceptance by any named provider;
- spot-colour (Pantone or other) accuracy;
- trapping;
- soft-proof accuracy on any display.

The UI must not show these as functional controls before qualification ([EXPORT-UX-PROPOSAL](EXPORT-UX-PROPOSAL.md)).
