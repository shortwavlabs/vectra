# Owner acceptance checklist (P0-R)

Items that need the maintainer's hands, eyes, credentials or decisions. Engineering evidence for each is linked. Tick and record results in PR #3.

## A. Decisions
- [ ] **Copyright holder** for the MIT `LICENSE`: the exact line, e.g. `Copyright (c) 2026 <holder>`, choosing between the organisation "Shortwav Labs" (if it is a legal entity) and the individual maintainer. The file is added as soon as this is confirmed ([LICENSING-AND-DISTRIBUTION](LICENSING-AND-DISTRIBUTION.md)).
- [ ] **Geometry dispositions** ([GEOMETRY-QUALITY-DISPOSITION](GEOMETRY-QUALITY-DISPOSITION.md)): accept or reject each item.
  - Star/ring IoU below 0.98: proposed for acceptance, plus a P1 sub-pixel contour stage and a deviation-based metric.
  - Partial alpha binarised: proposed for acceptance.
  - Residual edge leak ≤ 0.87 % within 0.81 px: proposed for acceptance.
  - 1-px diagonals: deferred to P1 Line Art.
  - Browser decoding differences: deferred to the P1 WASM-decode evaluation.
- [ ] **Offline mechanism:** accept the versioned service worker ([OFFLINE-WORKER-RECOVERY](OFFLINE-WORKER-RECOVERY.md)).
- [ ] **Hosting target:** Workers Static Assets (recommended) or Pages ([DEPLOYMENT-READINESS](DEPLOYMENT-READINESS.md)).
- [ ] **Performance budget** for P1 and the lower-end validation target ([PERFORMANCE-BASELINE](PERFORMANCE-BASELINE.md)).
- [ ] Optional: make the Linux container the canonical builder for published hashes ([LINUX-REPRODUCIBILITY](LINUX-REPRODUCIBILITY.md)).

## B. Visual compatibility (Inkscape and macOS Preview)
Bundle: [`owner-acceptance-bundle/`](owner-acceptance-bundle/), generated through the workbench UI. `MANIFEST.json` lists source, settings, counts and SHA-256 per file. Every PDF in it passed qpdf, pdfimages and the poppler-vs-resvg render comparison ([EXPORT-COMPATIBILITY](EXPORT-COMPATIBILITY.md)). Inkscape is not installed on the engineering machine, so no GUI test was performed.

For each SVG/PDF pair:
- [ ] Opens without warnings in **Inkscape** (record version) and **macOS Preview**.
- [ ] Inkscape: Edit → Select All shows paths only, with no raster image objects. Path → Node tool edits nodes.
- [ ] Dimensions:
  - SVG: Document Properties shows the source pixel size.
  - PDF: page width is 200 mm (Preview: Tools → Show Inspector).
- [ ] Holes are see-through (`01`, `02`, `05`). Transparent backgrounds have no white rectangle (`02`, `05`, `07`). Old Print `06` has an ivory paper rectangle and dots clipped at the edges.
- [ ] Colours look the same in SVG and PDF. Limited colour (`03`) uses only the 8 palette colours.
- [ ] Preview: zooming in stays sharp (vector), with no pixelation.

## C. Real Safari (not Playwright WebKit)
Safari 26.6.2 is installed but was not automated. That would need `safaridriver --enable` and "Allow Remote Automation", which the maintainer has to authorise.
- [ ] Run `pnpm run build && pnpm exec vp preview`, open http://localhost:4173 in Safari, and record the Safari version.
- [ ] Import `tests/fixtures/external/talbot-scene-in-a-library-640.jpg` → B&W result; download SVG and PDF.
- [ ] Wait for "Offline-ready.", then turn Wi-Fi off (or Develop → Network conditions → Offline).
- [ ] Choose Full Color → Cancel while processing → choose B&W → result appears. Repeat twice.
- [ ] Export SVG and PDF while offline.

## D. Deployment (only with approval)
- [ ] Follow the "Owner checklist for a preview deployment" in [DEPLOYMENT-READINESS](DEPLOYMENT-READINESS.md).
- [ ] Run `scripts/verify-deployment.sh <preview-url>` and attach the output to PR #3.

## E. Merge
- [ ] Review the P0-R final report gate matrix; merge PR #3 only if satisfied. There is no release tag.
