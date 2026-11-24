# Creative Lab — procedural printmaking and vector effects
Status: proposed for review | 2026-11-23 | post-P0 scope
Parent: [PRD-002](PRD-002-VECTOR-STUDIO.md)
Related: [Tools and style catalog](VECTOR-STUDIO-TOOLS.md), [Image sources and community](IMAGE-SOURCES-AND-COMMUNITY.md), [RFC-001](RFC-001.md).

## Product identity: an instrument, not an image generator
Vectra is a local-first, open-source digital printmaking laboratory. The artist supplies or deliberately imports source artwork, chooses tools and makes creative decisions. Vectra transforms and synthesizes editable vector geometry using conventional image processing, computational geometry and procedural algorithms.

**No AI required.** No generative models, prompt-to-image features, neural inference, model downloads, inference APIs, hidden AI assistance or AI credits in the creative engine. Deterministic seeded variation is not AI. Conventional segmentation, morphology and image processing remain in scope; any proposal to introduce ML later requires a separate product decision and RFC, not a silent dependency. This direction supersedes earlier speculative ML background removal suggestions for the approved scope. AI-assisted software development is unrelated to runtime functionality. Optional image search/community catalog access are ordinary network services, never inference or artwork processing.

Suggested positioning: From pixels to paths. From paths to art. A creative tool for artists, musicians, zine makers, printmakers and independent designers; not a replacement for the artist or a full publishing suite.

## CL-01 — Virtual Printing Press
Priority: high; candidate P2-C/P3-A. Extend DIY Underground, Old Print and Screen Print with an editable ink-plate model. User chooses a process and sees a composite preview; each ink plate is a named ordered vector group. Controls: ink color, coverage, registration X/Y, rotation, spread, minimum mark size, distress, seed, visibility and optional paper tone. All offsets use document units; show physical size where known.

| Process | Procedural approach | Distinctive controls |
|---|---|---|
| Risograph | quantize or separate tone into limited ink masks, screened vector coverage, deliberate registration shifts | ink count, density, angle, overprint preview, registration |
| Screen print | flat regions, halftone shading, offset/trap, seeded erosion | palette, mesh-inspired pitch, spread, choke/trap |
| Letterpress | contour expansion, local seeded wear, coverage variation | ink spread, edge wear, impression approximation |
| Photocopy | bounded repeated blur/morphology/threshold drift and seeded noise before tracing | copy generations, density, burn, dirt |
| Newspaper | rotated dot/line halftones, solid dark regions, ink spread | pitch, angle, tone, dot gain approximation |
| Linocut | clipped carved hatch shapes and ink subtraction | direction, width, spacing, carving density |

These are visual simulations, not calibrated physical press models. Start with 1–3 RGB ink plates, ordinary vector fills and explicit stacking. Simulated overprint must not be marketed as true spot-color separations, trapping certification, CMYK or PDF/X. Any preview compositing unsupported by vector PDF must be represented with validated vector intersections/colors or clearly excluded from export; never silently rasterize or export a different appearance. Plate solo/isolate and optional per-plate SVG exports are valuable experiments. Paper preview is not printable geometry unless explicitly enabled.

## CL-02 — Variation Lab
Priority: high; candidate P2-C after effect recipes. User selects recipe, identifies parameter locks and allowable variation ranges, then generates a small contact sheet (default six). Each tile is evaluated from the same immutable source/revision with a distinct deterministic seed and bounded parameter sample. Lockable controls include palette, tone, dot pitch, density, distress and registration; structural/source changes are excluded from randomization unless explicitly allowed.

Workflow: Generate/Remix → inspect thumbnails → compare with baseline → favorite/keep candidate → apply selected variation as undoable edit → save recipe or export preset file. Show seed and parameter differences; reroll is explicit. No random mutation of committed artwork. Derive candidate seeds from stable base seed/index/algorithm version; store actual sampled parameters, not only seed. Version PRNG and distributions; determinism scoped to tested engine/runtime with cross-platform tolerances. Provide keyboard selection, cancellation and progress. Cap concurrency and thumbnails; use existing worker lifecycle; stale results discarded; final evaluation at approved resolution. Thumbnails may be raster previews, not exported art. No model or prompt input.

## CL-03 — Procedural Pattern Lab
Priority: high; candidate P3-A. Map local source luminance, gradient or selected vector region to generated geometry. Explicit input domain and tonal source; a retained raster can drive tone, while geometry-only shapes can use a defined constant or local tone map. Use bounded sampling and clipping; protect alpha and holes. Initial patterns: halftone, crosshatch, contour lines, then Voronoi cells, concentric rings, flow fields, geometric mosaics, guilloché and outlined glyph/ASCII-inspired marks.

| Pattern | Candidate method | Parameters |
|---|---|---|
| Crosshatch | clipped parallel strokes in tonal bands | spacing, angle pair, width, tone curve |
| Contours | scalar-field isolines with controlled simplification | interval, line width, smoothing, minimum length |
| Voronoi | seeded sites, bounded cells, local tone palette | density, jitter, seed, inset |
| Concentric | ring/arc primitives modulated by tone | center, pitch, amplitude |
| Flow fields | seeded streamlines in bounded gradient/vector field | step, length, spacing, curvature |
| Mosaic | adaptive or fixed partition, per-cell sampled color | size, shape, palette |
| Guilloché | parametric curves clipped to target | frequency, phase, amplitude |
| Glyph marks | fixed licensed outline glyph set mapped to tone | grid, palette, contrast |

All algorithms are candidate designs, not verified libraries. Use numerical tolerances, document-space units, minimum feature size, deterministic ordering and max complexity. Expand strokes only when needed for boolean/print semantics. No hidden bitmap pattern fills. Licensed fonts/glyph sources only; do not redistribute fonts without permission.

## CL-04 — Artistic geometry brushes
Priority: medium/high; P3-B after node editing, hit testing and booleans. Interactive pointer samples create a transient stroke preview, then commit a single undoable geometry operation. Resample in document space with fixed spacing to avoid dependence on pointer event rate. Optional pressure mapping is deterministic from recorded samples; mouse and keyboard-compatible alternatives. Explicit selection target, clipping scope and stroke behavior; cancel clears preview. 
- Distress brush: seeded small cutouts/negative marks subtracted from selected ink; intensity, size, spacing and seed.
- Carving brush: swept paths or hatch cuts into ink; width, direction, taper and depth/density.
- Stipple brush: seeded dot placements as editable marks; radius, density, spacing and jitter.
- Ink splatter brush: bounded vector droplets; spread, droplet size, quantity, seed; additive layer or selected ink.
Do not imply physical stylus support until tested. Large brush strokes must use worker evaluation and geometry budgets; coalesce gesture history into one command. Respect locked/hidden layers and preserve base objects for non-destructive mode.

## CL-05 — Vector Glitch Lab
Priority: medium/high; P3-A. Visual equivalents of signal manipulation: slice-and-shift (clip into bands, translate), coordinate displacement (bounded parametric field), path fragmentation (explicitly split), geometric repetition, ink-channel separation (plate shifts), wave distortion, and seeded shape dropout. Controls: axis, frequency/pitch, amplitude, phase, repeat count, amount, seed. No audio input or AI. Preserve closure/fill rules by default; topology-changing modes explicit. Geometry clipping/transform tolerances and output caps mandatory.

## CL-06 — Modular Recipe Builder
Priority: high; builds on P2-B stack, candidate P2-C/P3-A. DAW-style effect chain: add, enable/disable, reorder allowed operations, edit parameters, compare, reset, bake, save and remix. Support core trace/source operations, tone processing, halftone, distress, palette, offset and misregistration. Preset recipes are strictly declarative, never executable scripts.

Each operation declares ID/version, accepted input domain (raster/tonal field/vector/ink plates), output domain, parameter schema, units, defaults, dependencies, seed policy, resource estimate and cancellation behavior. Type-check pipeline and reorder constraints; do not move raster-only effects after vector-only stages without explicit conversion. No invisible rasterization in exported artwork. Preserve immutable base/source and scene revision, cache bounded intermediate results, invalidate affected downstream steps. History commits parameter gestures atomically; evaluate derived scene shared by preview and export. Bake only on explicit command, retain undo path. Reuse existing community preset format; a recipe contains settings, not artwork, credentials, code or network URLs.

## CL-07 — Collage
Priority: later; P3-B/P4. Multiple independently imported sources, each with local provenance, crop/mask, trace settings and editable group. Transform, stack, duplicate and combine groups; support cutout outlines, layer order, clipping and independent effect stacks. Start with one artboard; optional basic text-to-outline only after font licensing and geometry/export validation. No full typography engine, automatic layout generator or remote assets embedded in export. Existing per-document source budgets extend to total source pixels, layer count and memory. Respect image-provider restrictions and user opt-in for local project storage.

## CL-08 — Physical print preview and preflight
Priority: later; P4. Non-export preview templates for poster, zine, T-shirt, sticker, tote and vinyl sleeve; use original/rights-cleared backgrounds. Render artwork placement, size and approximate substrate/ink appearance. Mockup preview is separate from production SVG/PDF and may use local raster rendering; do not imply color proof or printing guarantee. Preflight: minimum feature thickness, isolated shapes, tiny holes, ink coverage estimate, path complexity, physical dimensions and warnings. Thresholds configurable by print process and provider; no automatic changes or unsupported print certification. Actual print compliance only after independent tests.

## Workspace integration
Keep the approved narrow Lucide tool rail, central canvas and contextual right panel. Group Press (Printer), Patterns (Grid3X3), Glitch (Waves), Brush (Brush), Recipe (Layers), Variation (Shuffle) as contextual tools or tabs; exact icons verified with pinned lucide-react. Do not crowd rail: progressive disclosure under Style/Effects. Press inspector has named ink plates, swatches, visibility/solo, independent settings. Variation Lab opens a bounded gallery dialog with locks, ranges, seed, Remix, compare and Apply. Recipe Builder is a reorderable inspector with type constraints and explicit bake. Brushes show pointer/target preview and status; keyboard access to effect equivalents. Print preview is a separate view, not an export mode. UI specifications are proposals; no change to approved P0 workbench.

## Cross-cutting quality and business requirements
- Genuine vector SVG/PDF; preview may use raster caches but never raster fallback in exported art.
- Reproducibility: stable seeds, versioned parameters, source/revision, deterministic serialization; document numerical tolerances.
- Local-only conventional algorithms; no AI inference dependencies, prompts, accounts, paid APIs, or model downloads.
- Explicit undo, cancellation, selection scope, resource caps, minimum feature warnings and failure recovery.
- Open-source extensibility through allowlisted recipes and reviewed engine operations. New algorithm code is contributed through normal code review; user presets cannot execute code.
- Community discovery remains optional; never send local artwork or variation thumbnails to a service without explicit user submission.
- Do not claim market demand, visual quality, performance or press accuracy from this proposal.

## Acceptance/evidence gates (all NOT RUN)
| Gate | Required evidence |
|---|---|
| CL-G0 | Dependency/runtime audit: no AI inference; offline import, trace, procedural edit and export; optional online adapters isolated |
| CL-G1 | Press: two ink plates with independently adjusted registration, seed, visibility and vector export; independent render comparison and plate-order checks |
| CL-G2 | Variations: fixed seed/contact sheet reproducibility; parameter locks honored; selection/undo; cancel and stale jobs; bounded memory |
| CL-G3 | Patterns/glitch: synthetic tonal ramps, alpha/hole masks, geometry counts and clipping/topology tests; visual fixture contact sheets |
| CL-G4 | Recipes: typed stage validation, reject unsafe/unknown operations, deterministic round trip, reorder/bake/undo and vector-only exports |
| CL-G5 | Brushes: gesture resampling, scope/lock checks, cancellation, pressure if implemented, atomic undo, geometry caps |
| CL-G6 | Collage: source isolation, provenance, transform/stack/mask, aggregate memory limits, no raster objects in export |
| CL-G7 | Mockups/preflight: preview never contaminates vector export; measurements verified against synthetic fixtures; clear approximate-print warnings |

For artistic gates use same licensed portrait, concert photo, line drawing and gradient across presets; record seed, operation versions, counts, file size, performance, independent vector-export inspection and maintainer aesthetic review. No gate pass from mockups or documentation. Set budgets using P0 evidence.

## Priority and sequence
P0 remains unchanged; do not interrupt current implementation. After P0, review editor architecture and qualify P1 document model, history, workspace, core edits and exports. P2-A geometry then P2-B effect stack. P2-C flagship DIY Underground plus initial press (limited inks/registration), recipe sharing and small Variation Lab spike. P3-A extend press, procedural patterns and glitch tools; P3-B brushes/collage; P4 persistence, print preview and preflight. Community catalog and image providers stay separate optional post-core work. Exact scope and order subject to evidence and maintainer approval. Prioritize a few excellent creative tools before widening the catalog.
