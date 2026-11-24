# Owner acceptance checklist (P0-R-GEO)

Decisions and visual checks that only the maintainer can make. The earlier checklist (`../p0-r/OWNER-ACCEPTANCE-CHECKLIST.md`) records the decisions already confirmed:
- photographic quality and speed;
- SVG editability, PDF dimensions and sharpness;
- the service worker;
- Workers Static Assets;
- MIT, Stephane Pericat;
- Linux arm64.

Record results in PR #3.

> **P0 closure (2026-11-24).** The maintainer reviewed the corrected geometric output and is satisfied with the improvements.
> - **Approved:** the corrected circular geometry, for the P0 baseline; precision as an explicit opt-in mode, with spline as the default; the future terms Artistic and Precision.
> - **Accepted as technical debt, not fixed:** the remaining limitations.
> - The individual visual checks below were not recorded item by item, so their boxes stay unticked. See [P0-ACCEPTANCE](../P0-ACCEPTANCE.md).

## A. Visual geometry in Inkscape and macOS Preview (bundle v2)
Bundle: [`owner-acceptance-bundle-v2/`](owner-acceptance-bundle-v2/).
- **Per case:** `<case>-p0-spline.{svg,pdf}`, as bundle v1, and `<case>-corrected-precision.{svg,pdf}`, plus the source PNG in `sources/`.
- **Manifest:** [`MANIFEST.json`](owner-acceptance-bundle-v2/MANIFEST.json) gives each case's exact settings, algorithm version, scene counts, geometric metrics and SHA-256 hashes.
- **Navigation:**
  - `contact-sheet.html`: labelled; columns are source · P0 · corrected · 16× details.
  - `contact-sheet.png`: the same in one image, without labels.
- The PDFs are 200 mm wide; all 36 pass qpdf, pdfimages (0 images) and the poppler-vs-resvg comparison.

- [ ] **05 transparent hole** (`05-color-transparent-hole-corrected-precision`). The hole is a clean, symmetric circle with no flat sections or irregular joins. In Inkscape's node tool it has 4 nodes with smooth handles. It is still see-through.
- [ ] **04 discs** (`04-color-discs-corrected-precision`).
  - The three discs read as circles, with even curvature along every arc and no flats.
  - The junctions where the discs meet are clean at normal zoom.
  - Known: at ≥ 16× zoom a junction may show a small notch (≤ 0.3 px) or closely spaced nodes from overlapping stacked layers.
  - Known: two **yellow hairline slivers** of the lower stacked layer, each about 0.5 × 3 px, at the red disc's extreme left (x ≈ 36, y ≈ 102–106) and top (x ≈ 88–91, y ≈ 50). Judge whether they are visible at normal zoom (GEOMETRY-VALIDATION).
- [ ] **Circles, ring, ellipses** (`10`–`15`). Round and smooth; ellipse ends are not kinked.
- [ ] **Rounded rectangles, stars, overlaps** (`16`–`22`).
  - Straight sides are straight (lines, not curves); corners are crisp; round corners are round.
  - Overlapping shapes show no gaps or slivers.
  - Known: `22-discs-deep` has one 16° kink near a junction and blue slivers at (63, 124–132) and (113–117, 78).
- [ ] **Negative controls** (`30`–`32`). The hand-drawn wobble, rough edge and organic silhouette are **kept**, not turned into circles.
- [ ] **Unchanged approved cases.** Bundle v1's `01`, `03`, `06` and `07` (Talbot B&W, Hokusai limited, both Old Print) still represent the approved artistic and Old Print output. The current engine reproduces them byte-for-byte (EXPORT-REGRESSION).
- [ ] Record the Inkscape version, the Preview / macOS version, and any case that still looks wrong.

## B. Decisions
- [x] **Precision as an explicit, opt-in fit mode** (APPROVED at P0 closure; future user-facing terms: Artistic / Precision). Named `precision` in the settings and "Fit: precision" in the workbench. It requires stacked compositing. The artistic default (`spline`) is unchanged. Accept the naming and the opt-in design (SELECTED-CORRECTION).
- [x] **Remaining geometric deviations** (ACCEPTED FOR P0 as documented technical debt, TD-GEO-001 to TD-GEO-004 and TD-GEO-009; not as final behaviour) (GEOMETRY-VALIDATION, "What is still missed"). Accept each for P0, or reject:
  - curvature uniformity within 2–6 px of three-colour junctions, plus 2 lower-layer specks (the P1 fix is a shared junction graph or label-level blend correction);
  - binary (non-antialiased) edges: position limit only (tier C);
  - thin bars (2–3 px) and acute tips: corner position 1.5–2.3 px; slight curvature on straight edges near rebuilt corners.
- [ ] **Metric amendments and tiers** (recorded; not explicitly approved at P0 closure) (GEOMETRIC-FIDELITY-METRICS):
  - three measurement corrections made during evaluation;
  - the tier B/C and acute-corner allowances.
- [x] **Earlier P0-R geometry items**, revisited (accepted for P0 as technical debt: TD-GEO-005 to TD-GEO-008):
  - Star/ring IoU: ≥ 0.98 in precision mode (0.996/0.996). Spline unchanged (0.977/0.975) as the artistic mode.
  - 1-px diagonal strokes (measured):
    - precision with speckle 0 keeps 56/56 diagonal pixels, as separate tiny shapes, like the `pixel` workaround;
    - at the default speckle 16 it keeps 0/56; spline keeps 0/56 even at speckle 0;
    - a connected stroke needs P1 Line Art. Defer?
  - Partial alpha binarisation: unchanged, documented, warned.
  - Residual transparency leak: the ring leak is gone. The hole shows pixel-rounding flips within 0.12 px of an exact boundary. Accept?
  - Browser decoding differences: unchanged; in-WASM decoding stays a P1 candidate.

## C. Merge
- [x] Review FINAL-REPORT's gate matrix. Merge PR #3 only if satisfied; there is no release tag. RFC-002 and P1 have not been started. (Merge authorised by the maintainer at P0 closure.)
