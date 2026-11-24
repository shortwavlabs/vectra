# P0 acceptance record

**Decision:** P0 is **accepted as an engineering baseline** and approved for closure and merge (P0 final acceptance brief, 2026-11-24). This is **not a production release**: there is no release tag and no deployment.

| | |
|---|---|
| Final reviewed head (PR #3) | `4a119b95823d2f582b1b53102bffce8b59088aec` |
| Final engine and application implementation | `a4cf172` (no engine or app source change after it; verified in `docs/research/p0-r-geo/artifacts/regression/head-checks.txt`) |
| Branch / PR | `p0/technical-feasibility` / https://github.com/shortwavlabs/vectra/pull/3 |
| Phases | P0 (`37b6c02`), P0-R (`f5b7768`), P0-R-GEO (`4a119b9`) |

**Not every P0 target passed.** The final gate matrices, including PARTIAL, NOT RUN and OWNER TEST PENDING results, are preserved unchanged:
- [P0](p0/FINAL-REPORT.md);
- [P0-R](p0-r/FINAL-REPORT.md);
- [P0-R-GEO](p0-r-geo/FINAL-REPORT.md).

Maintainer acceptance of a limitation does not mean it is fixed. Open items are in the [technical debt register](../TECHNICAL-DEBT.md).

## Maintainer decisions
| Topic | Decision | Notes |
|---|---|---|
| Photographic vectorization quality and responsiveness | **APPROVED** | Spline (artistic) output is byte-identical to the approved baseline: 326/326 regression files ([PHOTOGRAPHIC-REGRESSION](p0-r-geo/PHOTOGRAPHIC-REGRESSION.md)) |
| Circular geometry in owner bundle v1 (`04-color-discs`, `05-color-transparent-hole`) | Originally **REJECTED** (DEF-GEO-002, DEF-GEO-001: flattened sections, uneven curvature, irregular joins, asymmetric hole) | [DEFECT-REPRODUCTION](p0-r-geo/DEFECT-REPRODUCTION.md) |
| Corrected circular geometry (precision mode, owner bundle v2) | **APPROVED for the P0 baseline** | The maintainer reviewed the corrected geometric output and is satisfied with the improvements |
| Precision fit mode | **APPROVED**; stays **explicitly opt-in** | `fit.mode = "precision"`, `PRECISION_FIT_VERSION` 1 |
| Default fitting | Existing spline fitting **remains the default** | |
| Future user-facing terminology | **Artistic** (spline) and **Precision** (precision); internal identifiers kept | Applies to the future product UI |
| SVG compatibility and editability | **APPROVED** | As confirmed: SVG files open and are editable |
| PDF dimensions and sharpness | **APPROVED** | As confirmed: dimensions correct, output stays sharp |
| Rust/WASM architecture | **APPROVED** | |
| VTracer 1.0 alpha behind the pinned adapter | **APPROVED provisionally** | Reconsideration conditions: RFC-001; TD-ARCH-001 |
| Direct Rust PDF generation | **APPROVED** | |
| Versioned service worker | **APPROVED** | |
| Cloudflare Workers Static Assets (assets-only) | **APPROVED** | |
| MIT license | **APPROVED**: `Copyright (c) 2026 Stephane Pericat` | `LICENSE` and generated `THIRD-PARTY-NOTICES.txt` intact |
| Domains | Tentative: `vectrapress.ink`, `vectrapress.com` | None registered; no DNS |
| Deployment | **DEFERRED** until an appropriate application UI exists | TD-PLATFORM-004 |
| Remaining geometric limitations | **ACCEPTED FOR P0 as documented technical debt**, not as satisfactory final product behaviour | TD-GEO-001 to TD-GEO-009 |

## What the owner acceptance covers, and what it does not
- **Confirmed by the maintainer:**
  - photographic tracing quality and responsiveness;
  - SVG files open and are editable;
  - PDF dimensions are correct and the output stays sharp;
  - after reviewing the corrected geometric output, satisfaction with the improvements.
- **Not individually recorded:** the per-item checks in the owner checklists (Inkscape and Preview versions; node counts; each bundle-v2 case; real Safari; deployment). Those boxes stay unticked; this record does not claim them.
  - [P0-R checklist](p0-r/OWNER-ACCEPTANCE-CHECKLIST.md)
  - [P0-R-GEO checklist](p0-r-geo/OWNER-ACCEPTANCE-CHECKLIST.md)
- **Not approved or decided:** the proposed P1 performance budget and lower-end target; canonical Linux builds for published hashes; the P0-R-GEO metric amendments and tier B/C allowances, which were recorded but not explicitly approved.

## Precision mode: implementation and acceptance
- **Problem.** VTracer's spline stage fits through binary-mask lattice corners, smooths outward, and fits noise-split slices at a 10 px tolerance with no tangent continuity. The discs additionally have misclassified blend pixels ([ROOT-CAUSE-ANALYSIS](p0-r-geo/ROOT-CAUSE-ANALYSIS.md)).
- **Correction.** Selected after evaluation against pre-registered thresholds ([ALGORITHM-EVALUATION](p0-r-geo/ALGORITHM-EVALUATION.md), [SELECTED-CORRECTION](p0-r-geo/SELECTED-CORRECTION.md)):
  - Vectra-owned sub-pixel boundary recovery;
  - G1 cubic fitting with rebuilt corners;
  - conservative circle and arc recognition.
- **Result on the rejected cases** ([GEOMETRY-VALIDATION](p0-r-geo/GEOMETRY-VALIDATION.md)):

  | Case | Measure | Bundle v1 (spline) | Corrected (precision) |
  |---|---|---|---|
  | 05 hole | radial RMS / max | 0.315 / 0.640 px | 0.016 / 0.045 px |
  | 05 hole | tangent breaks | 7 | 0 |
  | 04 discs | centre error | up to 0.60 px | ≤ 0.05 px |
  | 04 discs | radial RMS | up to 0.53 px | ≤ 0.057 px |
  | 04 discs | tangent breaks | 19 | 0 |
- **Across the corpus:** 34 of 44 analytic fixtures pass every pre-registered target (spline: 0), including 10 of 12 held-out fixtures and all 7 negative controls (0 recognised substitutions).

## Accepted limitations (open technical debt)
| ID | Limitation |
|---|---|
| TD-GEO-001 | Lower-layer hairline slivers and curvature irregularity near three-colour junctions. Corrected 04: yellow hairlines of 1.50 and 1.25 px² at the red disc's left and top edges |
| TD-GEO-002 | Non-antialiased (binary) shapes: position within tier C only; extra anchors and tangent breaks |
| TD-GEO-003 | Thin-bar ends (corner up to 2.32 px) and acute corners |
| TD-GEO-004 | Slight straight-edge curvature next to rebuilt corners |
| TD-GEO-005 | 1-px diagonal strokes (deferred to P1 Line Art) |
| TD-GEO-006 | Partial source transparency binarised (warned) |
| TD-GEO-007 | Browser-dependent image decoding (determinism is per decoded RGBA) |
| TD-GEO-008 | Residual pixel-rounding at exact transparent boundaries (≤ 0.12 px) |
| TD-GEO-009 | Precision requires stacked compositing; simplify must be 0 |
| TD-PERF-001 to 006, TD-ARCH-001 to 004, TD-PROCESS-001 | Performance, architecture and process items in the register |

## Deferred validation (NOT RUN)
| Item | Status |
|---|---|
| Linux amd64 | NOT RUN: emulation fails; needs a native amd64 host (TD-PLATFORM-001) |
| Real Safari, iOS, Android | NOT RUN: Playwright WebKit only (TD-PLATFORM-002) |
| Lower-end desktop hardware | NOT RUN (TD-PLATFORM-003) |
| Real HTTPS deployment | DEFERRED; local `wrangler dev` verification only (TD-PLATFORM-004) |
| Linux-built precision WASM comparison | NOT RUN (TD-PLATFORM-005) |

## Evidence index
- **Phase reports:** [P0](p0/FINAL-REPORT.md) · [P0-R](p0-r/FINAL-REPORT.md) · [P0-R-GEO](p0-r-geo/FINAL-REPORT.md).
- **Owner bundles:**
  - v1: [`p0-r/owner-acceptance-bundle/`](p0-r/owner-acceptance-bundle/);
  - v2: [`p0-r-geo/owner-acceptance-bundle-v2/`](p0-r-geo/owner-acceptance-bundle-v2/).
- **Measurements:**
  - fixture manifests: `tests/fixtures/MANIFEST.json`, `tests/fixtures/native-corpus.json`, `p0-r-geo/artifacts/corpus/corpus.json`;
  - baseline and regression hashes: `p0-r-geo/artifacts/regression/`;
  - algorithm evaluation: `p0-r-geo/artifacts/evaluation/`;
  - held-out results: `p0-r-geo/artifacts/validation/`;
  - export verification: `p0-r-geo/artifacts/export/`, `p0-r/artifacts/regression/`;
  - performance: `p0-r/artifacts/native-bench/`, `p0-r-geo/artifacts/performance/`.
- **Synthesis:** [P0 postmortem](P0-POSTMORTEM.md) · [technical debt register](../TECHNICAL-DEBT.md) · [P1 handoff](../P1-HANDOFF.md).

**Next phase:** RFC-002 (Vector Studio architecture). Neither RFC-002 nor P1 has been started.
