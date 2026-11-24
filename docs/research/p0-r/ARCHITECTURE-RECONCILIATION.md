# P0-R architectural reconciliation

Date: 2026-11-24.

Inputs: P0 implementation (PR #3) and the product documentation merged in PR #2:
- PRD-002
- VECTOR-STUDIO-TOOLS
- CREATIVE-LAB
- IMAGE-SOURCES-AND-COMMUNITY
- BRAND-AND-BUSINESS
- `docs/mockups/`

This document reconciles the two; it resolves nothing by implementation. Requirements for RFC-002 are in [P1-ARCHITECTURAL-INPUTS](P1-ARCHITECTURAL-INPUTS.md).

## 1. P0 decisions that already support the expanded vision
| P0 decision (evidence) | Supports |
|---|---|
| Local Rust/WASM engine in a module worker; no server, no inference (P0-G1/G2) | VS-15 and CL "instrument, not generator"; offline core (IMAGE-SOURCES gate 1) |
| Vectra-owned pre-processing: luminance, threshold, alpha, palette, speckle (P0-G1) | DIY Underground raster-domain recipes (Xerox, Copy of a Copy, Bootleg quantise-to-inks) as deterministic stages ahead of tracing |
| VTracer behind one adapter; its stage API accepts our own segmentation | Custom frontends (masks, ink separation) without forking the tracer. Replaceable if VTracer changes. |
| Canonical *evaluated* scene: palette ids, ordered groups, explicit fill rules, rectangle clips, validation, version field (P0-G3) | The "derived render scene shared by preview and export" in VECTOR-STUDIO-TOOLS/CL-06. Ink plates can be named groups with palette entries. |
| One validated scene → SVG and direct PDF (pdf-writer), deterministic bytes, no raster code path | VS-06 and the CL rule "never raster fallback". Bake/export can be verified independently (qpdf/pdfimages/poppler suite). |
| Seed plumbing (`seed: u32`, SplitMix64) and seeded k-means; byte-identical output across runs and hosts (P0-R-G0 fingerprint: 65/65 cases identical macOS vs Linux) | VS-10, CL-02 Variation Lab (stable seeds, versioned PRNG) |
| Jobs carry `jobId` + source `revision`; stale results dropped; latest-wins (P0-G2) | CL "stale results discarded" for effect stacks and variations |
| Terminate-and-recreate cancellation, now offline-safe via a versioned service worker (P0-R-G2) | Cancellation of long evaluations without shared memory |
| Strict CSP; no remote origins at runtime; check-dist rejects remote URLs | IMAGE-SOURCES "offline core keeps its restrictive policy; provider origins only in online builds" |
| Explicit limits (pixels, anchors, file size) with typed, recoverable errors | CL "resource caps mandatory", PRD-002 "stop with a recoverable warning; no silent downsampling" |
| Static `dist/`, relative asset base, no hostnames in code or CSP | BRAND "do not hardcode either domain". Workers Static Assets with an optional `/api/*` Worker (P0-R-G4). |
| Generated THIRD-PARTY-NOTICES shipped in `dist/` (P0-R-G6) | Distribution of an MIT core with permissive dependencies. Premium preset packs are content, not engine code. |

## 2. Extensions required in P1 and P2
**P1 (editor foundation):**
- **Editable document ≠ evaluated scene.** An editable document is needed: objects with stable ids, layers and groups, reversible transforms, visibility and lock, source-asset references. The evaluated scene stays a derived artefact (VS-01, VS-02).
- **Command history.** Atomic, undoable commands, including "replace trace" vs "new layer" (VS-02, PRD-002 interaction model).
- **Interactive renderer.** The P0 preview is an `<img>` of an SVG blob: no hit testing, no selection highlight, no partial updates. P1 needs an interactive canvas (VS-03/04).
- **Selection and hit testing.** Needs geometry access on the main thread, or queries into WASM.
- **Geometry transport.** P0 sends the scene as JSON strings and the SVG as text. At 555k anchors (24 MP limited colour) that is 22 MB of SVG. A typed-array or handle-based transport is needed.
- **Scene v2.** Per-object identity; group transforms in the editable model (the evaluated scene can stay absolute); arbitrary path clips (needed for halftone-in-shape, PRESETS Old Print); strokes exercised by presets.
- **Worker scheduling.** Several job kinds: preview vs final, export, later variation thumbnails. Priorities, bounded concurrency and memory budgets.
- **Persistence.** Unsaved-change warning (P1); a local `.vectra` project archive later (VS-12).

**P2:**
- Typed effect pipeline (CL-06): raster, tonal-field, vector and ink-plate domains; reorder constraints; bake.
- Geometry operations: booleans, offset, simplify with deviation reporting (VS-07; candidates Kurbo/Clipper2, unselected).
- Ink-plate model with registration offsets (CL-01).
- Variation Lab with parameter locks and contact sheets (CL-02).
- Declarative `.vectra-preset` schema with allowlisted, versioned operations (VS-13, VS-22). The P0 `TraceRequest { presetVersion, seed, settings }` with `deny_unknown_fields` is a precursor, not the schema.

## 3. Decisions that could become limitations
1. **Flat traced output.** P0 emits one compound path per traced colour region, with no per-object identity. Editing needs ids assigned at commit time and preserved through re-evaluation. Do not let the P0 scene become the document.
2. **0.01 px coordinate quantisation.** VTracer's `QuantizePass(2)` and the halftone rounding are fine for export but would accumulate error under repeated edits. Keep f64 in the document and round only at serialisation.
3. **JSON scene transport and SVG-blob preview.** These do not scale to interactive editing of large scenes. Dense halftones and limited colour at 12–24 MP produce 3–22 MB SVGs (BENCHMARKS, PERFORMANCE-BASELINE).
4. **Terminate-to-cancel discards the WASM instance and every cache.** That makes VTracer's segmentation cache (`Session`) unusable across cancellations. It is acceptable for coarse jobs. For slider-rate re-evaluation, RFC-002 should weigh cooperative cancellation (SharedArrayBuffer, which needs COOP+COEP) against chunked jobs.
5. **Alpha is binarised in tracing modes.** No soft edges or gradients in the scene. Vector "soft" edges would need explicit geometry (feathered bands), which is not planned.
6. **Browser decoding.** RGBA differs across engines (WebKit JPEG decoder; premultiplied canvas alpha). Recipe reproducibility "within a declared runtime" (VS-10, CL-02) is per browser until decoding moves into WASM.
7. **VTracer 1.0.0-alpha.4.** Single maintainer, alpha API (see RFC-001 reconsideration conditions).
8. **4-connected ink.** Loses 1-px diagonals. Line Art (PRESETS P1) needs a centerline or thin-feature strategy.
9. **Service worker scope.** It precaches same-origin build files only, which is correct for the core. Online features must not cache provider images in it (IMAGE-SOURCES: no offline caching of Unsplash images until permitted).

## 4. Inconsistencies between the baseline and the merged specifications
| # | Inconsistency | Where | Suggested resolution (maintainer) |
|---|---|---|---|
| R1 | PRD-002 and DEPLOYMENT name **Cloudflare Pages**. P0-R recommends **Workers Static Assets**: Cloudflare's current recommendation, static requests free and unlimited, `_headers` supported, optional `/api/*` Worker. | PRD-002 §summary, DEPLOYMENT.md | Choose at preview-deploy time. Both serve the same `dist/`. |
| R2 | PRD.md puts six core presets in P1. PRD-002 puts the document, selection and history in P1-A/B/C, with presets largely in P1-C/P2-C. | PRD.md vs PRD-002 | PRD-002 supersedes once approved; update PRD.md and ROADMAP then. |
| R3 | DESIGN.md proposes a charcoal/ivory UI. PRD-002 proposes dark charcoal with a lime accent and a Lucide rail. | DESIGN.md vs PRD-002 | PRD-002 supersedes on approval. The P0 workbench is temporary and unaffected. |
| R4 | PRESETS lists Grayscale, Silhouette and Line Art for P1; P0 implemented bw, colour, limited colour and the halftone spike only. VECTOR-STUDIO-TOOLS renames families (Core/Print/DIY Underground/Advanced). | PRESETS vs VECTOR-STUDIO-TOOLS | Align the taxonomy in RFC-002 or the preset spec. |
| R5 | RFC-001 lists Tailwind, shadcn and Zustand as candidates; VECTOR-STUDIO-TOOLS names lucide-react. None is evaluated or pinned. | RFC-001, VECTOR-STUDIO-TOOLS | Dependency decisions belong to RFC-002 with license audit and notices regeneration. |
| R6 | VALIDATION's IoU ≥ 0.98 target for "simple synthetic shapes" is not met by default spline fitting (star 0.977, rings 0.975). PRD-002 asks for "node counts and deviation" metrics instead. | VALIDATION vs PRD-002 | See GEOMETRY-QUALITY-DISPOSITION: proposed metric revision plus a P1 sub-pixel contour stage. |
| R7 | CL-02 assumes a deterministic runtime "with cross-platform tolerances". P0-R measured WASM output as **identical** across macOS and Linux hosts, but browser decoding differs. | CREATIVE-LAB | Determinism statements should say "for identical decoded RGBA". |
| R8 | IMAGE-SOURCES requires online CSP changes "only in online builds". The current single build has one CSP. | IMAGE-SOURCES | RFC-002 should define build variants (offline core vs online-enabled) and how `_headers` differs. |
| R9 | The original RFC-001 repo structure lists `src/{workspace,components,…}`. PRD-002 implies a much larger editor surface. | RFC-001 | RFC-002 owns the module structure. |

No inconsistency was found with the privacy, no-AI, no-raster-export or free-core principles. P0/P0-R complies with all of them (see FINAL-REPORT).
