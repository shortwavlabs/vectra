# Vectra editor tools and creative style catalog
Status: proposed | companion to [PRD-002](PRD-002-VECTOR-STUDIO.md)

## Tool rail and right inspector
Use lucide-react in implementation; confirm exact exports in pinned package. Icon names below are intended names, not a dependency audit. Group primary tools visually and keep labels in accessible tooltips. Clicking selects a tool, opens its options, and never implicitly mutates artwork. Numeric controls use document units or explicit normalized ranges; show defaults, reset, preview and apply/cancel.

| Tool / Lucide candidate | Contextual inspector | Semantics |
|---|---|---|
| Select / MousePointer2 | Position, size, rotation, opacity, arrange, group | Select/multi-select, move/resize/rotate/duplicate; locked layers excluded |
| Trace / Scan | Preset, threshold, colors, detail, smoothing, alpha, compare | Generate preview; commit to new or explicitly replaced layer |
| Node Editor / PenTool | Anchor type, coordinates, handle alignment | Move/add/delete anchors, corner/smooth handles; preserve closed contours |
| Smooth / Spline | Strength, corner preservation, iterations | Curvature refinement; report deviation; preserve topology by default |
| Simplify / Minimize2 | Error tolerance, detail preservation, node counts | Reduce anchors under geometric tolerance; protect corners and holes |
| Recolor / Palette | Fill, stroke, palette, replacement scope, saturation/contrast | Edit selected objects or matching fills; maintain alpha |
| Offset / Layers | Signed distance, join, miter limit | Grow/shrink outlines; warn when holes collapse |
| Distress / SprayCan | Intensity, scale, frequency, erosion, seed | Seeded vector perturbation and cutouts |
| Halftone / Grid3X3 | Pitch, angle, dot shape, tone curve | Vector marks sampled from retained raster/tonal source or selected geometry |
| Engrave / PencilRuler | Spacing, angle, width, crosshatch | Clipped vector hatching; explicit tone source |
| Shape Builder / Combine | Union, subtract, intersect, exclude | Deterministic boolean results; preserve explicit fill rule |
| Cleanup / Eraser | Minimum area, hole policy, scope | Remove unwanted fragments with preview; do not delete intentional distress |
| Style / WandSparkles | Core / Print / DIY Underground recipe gallery | Apply recipe to raster source or compatible vector selection |
| Layers / Layers | Visibility, lock, order, names, grouping | Keep reference source distinct from exportable shapes |
| Export / Download | SVG/PDF, physical units, background, complexity warnings | Evaluate committed scene; no raster fallback |

Additional artistic tools: Carve (Brush), Stipple (CircleDot), Geometrize (Triangle); P3 candidates. Keep these inside the Style inspector until rail usability is tested.

## Preset taxonomy
Core: Black & White, Grayscale, Full Color, Limited Color, Line Art, Silhouette.
Print: Old Print, Halftone, Screen Print, Poster, Comic Ink.
DIY Underground: Xerox (working label; trademark review before public naming), Newsprint, Hardcore, Cut & Paste, Copy of a Copy, Bootleg.
Advanced: Woodcut, Engraving, Blueprint, Stencil, Stipple, Geometrize.

## DIY Underground — flagship family
Design references: late-1970s/1980s DIY punk fanzines (Sniffin' Glue), hardcore flyers, cheap black-and-white copy shops, cut-and-paste concert posters and underground music graphics. Aim for harsh tonal loss, uneven ink, visibly imperfect reproduction, not a polished sepia filter. Historical references are inspiration, not assets to redistribute. Use procedural or rights-cleared fixtures and original examples.

All ranges are provisional UI/algorithm hypotheses, not measured optimal values. Normalize sliders 0–100 unless specified. Ink/paper colors are editable RGB; paper defaults to transparent or warm ivory preview, with explicit export inclusion. Seed is an integer, stable across rerenders, and reroll is an explicit command. Every preset has a reset and user-saveable recipe.

| ID / label | Visual target | Starting recipe and controls | Output |
|---|---|---|---|
| underground-xerox / Xerox | Harsh black/white, burned edges, copier specks | Tone curve → threshold → seeded grain/morphology → trace → debris/erosion. Threshold 0–255 (128), contrast 75, noise 25, speckle 20, edge burn 15, black crush 30, white clip 30 | Black ink compound paths, positive debris and negative holes |
| underground-newsprint / Newsprint | Coarse dots, uneven ink, newspaper photo | Tone curve → rotated halftone grid → optional ink spread and distress. Pitch 4–32 source px (8), angle 0–180° (45), ink spread 10, contrast 60, distress 15, ink/paper | Editable dot/line geometry, solid dark regions, optional paper |
| underground-hardcore / Hardcore | Heavy silhouettes, jagged edges, aggressive contrast | High-contrast threshold → trace → corner-aware simplification → edge distress/erosion. Threshold 135, simplify 55, roughness 35, distress 30, speckle 15, fill erosion 20 | Bold paths, seeded roughened contours and cutouts |
| underground-cut-paste / Cut & Paste | Torn-paper boundaries and chunky cutout layers | Foreground mask → simplified shapes → jagged contour → optional outline/backing and offset. Cutout threshold 128, jaggedness 30, outline 0–20 px (3), offset 0–30 px (4), fill simplification 35, shadow block 20 | Separate foreground, outline, shadow and backing vector groups |
| underground-copy-of-copy / Copy of a Copy | Progressive copy-generation detail loss, edge bloom and dirt | Repeated bounded blur/threshold drift/morphology/seeded noise → final trace + debris. Generations 1–20 (5), noise buildup 30, detail loss 35, spread 25, distortion 10, dirt 20 | Vector ink regions and accumulated artifacts; source retained |
| underground-bootleg / Bootleg | One-/two-color cheap gig poster, misregistered inks | Quantize to custom ink palette → trace plates → deterministic registration shifts → offset/trap/distress. Inks 1–3 (2), shift 0–20 px (2), spread 15, distress 25, trap 0–5 px (0) | Editable, named RGB ink layers; no spot-color compliance claim |

Avoid implying Cut & Paste automatically segments any subject: use source alpha/explicit mask or threshold and warn if unavailable. Raster-domain preprocessing is allowed; final artwork must be vector. When applying to an existing vector selection, geometry-native variants operate on selected fills or a local temporary tone map; indicate source and avoid invisible re-tracing. Repeated copy degradation should recompute from original and deterministic per-generation sub-seeds, not repeatedly degrade current preview. The result is a creative simulation, not a physical copier model. Make degradation visually meaningful, not merely additive random noise.

## Geometry and effects architecture research
Candidate sources for follow-up, not pinned dependencies or verified benchmarks:
- [Illustrator Image Trace](https://helpx.adobe.com/illustrator/using/image-trace.html), [Simplify](https://helpx.adobe.com/illustrator/using/simplify_paths.html): trace then edit; simplification is a distinct operation.
- [Inkscape Live Path Effects](https://inkscape.org/doc/tutorials/advanced/tutorial-advanced.html): evaluate non-destructive geometry workflows; verify exact effect behavior against installed version.
- [Paper.js Path API](https://paperjs.org/reference/path/): path editing, smooth, simplify, hit testing and booleans; compare browser interaction adapter against native SVG renderer; avoid competing document models.
- [Kurbo](https://docs.rs/kurbo/latest/kurbo/): Rust Bézier mathematics and geometry candidate; verify exact APIs for simplification and error bounds.
- [Clipper2](https://github.com/AngusJohnson/Clipper2): clipping, offset and polygon booleans; compare Rust-compatible alternatives and WASM packaging. Flatten curves with explicit tolerances, preserve winding and holes.
- [Lucide](https://lucide.dev/): icon system and accessibility integration.
- [SVG 2 paths](https://www.w3.org/TR/SVG2/paths.html): interchange semantics.

Propose RFC-002 after P0: editable document (stable IDs, layers, groups, source asset references), command history (atomic edits), versioned effect recipes, derived render scene shared by preview/export. Source raster stays local and excluded from export. Separate source-dependent effects from vector-only modifiers; reordering must respect input type/dependency. Bake produces new editable geometry, preserves history, and warns if complexity cap approached. Project format candidate: bounded archive containing manifest, local source blobs, document JSON and effect recipes; schema migrations, path traversal/size limits, explicit local saves. No arbitrary executable recipes.

## Validation extensions
- Smooth vs simplify: compare curvature changes and point counts separately; enforce max deviation for simplify, protect holes/corners.
- Boolean/offset: rings, overlapping paths, self intersections, fill rules, tiny islands, negative offsets; report unsupported topology.
- Halftone: sampled tone-to-area mapping, alpha clipping, density limits, full-black handling, seed consistency.
- Distress: vector positive/negative marks, no holes outside target ink, deterministic seed; report primitive cap and minimum print feature warnings.
- Copy of a Copy: fixed-seed generations 1/5/10/20 contact sheet from same input; assess detail loss and ink spread; no promise of monotonic change for every pixel.
- Bootleg: separation and registration test with two overlapping colors; verify visibility and actual export order; no simulated spot-color claims.
- UI: selection scope, Apply/Cancel, undo/redo, inspector changes, keyboard focus, accessible icon names, stale result prevention, layer locking, view/export equivalence.
- Use same licensed portrait, logo, line drawing, gradient, transparent source and gig-style illustration across presets. Record versions, seed, parameters, path/node count, render/export time, file size and owner aesthetic review. Reject raster image resources in SVG/PDF. No gate status claimed by this document.
