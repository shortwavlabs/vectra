# RFC-002 review — Creative Lab and effects extensibility (§12, D07)

Scope: whether RFC-002 §10 (D07, typed linear recipes with domains `Raster → TonalField/LabelField → VectorGeometry → InkPlates`) can carry the [Creative Lab](../../CREATIVE-LAB.md) and [tool catalogue](../../VECTOR-STUDIO-TOOLS.md) features without a graph runtime or a plugin framework. **This is analysis; nothing here was executed**, except where a gate report is cited.

## Verdict
**ACCEPT WITH AMENDMENTS.** A typed linear pipeline is sufficient for every catalogued feature if three seams are added now, as contracts, not code:
1. **References to other nodes or sources as side inputs.**
2. **Composite multi-output values** (named plates and named groups).
3. **Seeds derived from stable operation-instance IDs**, not stack positions.

No feature examined needs a general DAG, cycles, user scripting or dynamic code loading.

## Feature walk-through
| Feature | Pipeline shape | Fits a linear chain? | Seam needed |
|---|---|---|---|
| Old Print halftone (P0 spike) | Raster → TonalField → VectorGeometry (synthesize) | Yes | Halftone *inside a selected shape* needs the shape as a **side input** (clip) |
| Xerox / Hardcore | Raster ops (tone, threshold, grain, morphology) → trace → vector ops (debris, erosion) | Yes | — |
| Copy of a Copy | One op with an internal generation loop and per-generation sub-seeds; always recomputed from the original | Yes | Seed derivation (below) |
| Cut & Paste | Mask → shapes → outline / shadow / backing | Yes, if the op emits a **composite value** (named groups) | Multi-output |
| Bootleg / Virtual Printing Press | Quantize → InkPlates{plate: geometry} → per-plate registration, spread, distress | Yes: InkPlates is one typed composite value; per-plate parameters are a keyed map inside the op | Multi-output plus stable plate IDs |
| Variation Lab | N evaluations of one recipe on one immutable snapshot with sampled parameters | Yes (batch of chains) | Scheduler class "thumbnail" (lowest priority); store sampled parameters |
| Recipe Builder | Reorderable chain with domain checks and explicit conversions | Yes | Reorder validation only across compatible domains |
| Pattern Lab (crosshatch, contours, Voronoi, flow) | TonalField (+ optional region) → VectorGeometry | Yes | Region as **side input** |
| Glitch Lab | VectorGeometry → VectorGeometry | Yes | Explicit topology-impact flag (already in RFC) |
| Geometry brushes | Not recipe-driven: gesture → resampled stroke record → boolean subtract or add on a target | Yes, as a parameterised geometry op (stroke list) or a baked command | Boolean engine (P2-A); bounded stroke-record size; gesture coalescing |
| Collage | Several SourceReferences, each with its own chain; composition is document structure | Yes (per source) | Aggregate source budget (R03 memory model) |

## Seams to add to RFC-002 §10 (contracts only; no P1 implementation)
1. **Side inputs by reference.** An operation may declare typed references: `{ nodeId | sourceAssetId, expectedDomain, digest }`.
   - References are resolved from the frozen evaluation snapshot. Missing or locked references are reported as typed errors.
   - Cache keys include the referenced digest. Cycles are impossible because a reference may target only another node's committed or baked geometry, never its evaluated stack.
2. **Composite outputs.** Typed values such as `InkPlates[{plateId, colour, geometry}]` and `Groups[{role, geometry}]`, with stable IDs that ops preserve.
   - Selection and provenance map to `(nodeId, plateId)`.
   - A plate is a value inside one node until the user explicitly bakes or splits it into document groups.
3. **Seed derivation.** `seed = H(documentSeed, nodeId, opInstanceId, opId, opVersion, variationIndex)` with a versioned hash and PRNG implemented in Rust. `opInstanceId` is assigned at insertion, so reordering does not reshuffle randomness.
   - Store the sampled parameters, not just the seed (CL-02).
   - Determinism is promised per identical decoded RGBA **and** the same WASM build, consistent with TD-GEO-007 and TD-PLATFORM-005.
4. **Where intermediates live.**
   - Raster and tonal intermediates (a 12 MP f32 field is 48 MB) stay inside the compute worker and are disposable.
   - Only vector outputs cross to the main thread as GeometryPackets.
   - Worker caches are lost on termination by design (TD-ARCH-002). The main-thread cache holds evaluated packets only, keyed as RFC §10 proposes and counted in the aggregate memory budget (MEMORY-AND-RESOURCE-BUDGET).
5. **Parameter history.**
   - Slider drags commit once on release, but Base UI keyboard sliders commit on every arrow key (5 commits for 5 keys, [R05-A](DESIGN-SYSTEM-FEASIBILITY.md)). The command layer must therefore coalesce consecutive commits to the same parameter within a short window, or on focus change, into one history entry.
   - Without this, history fills with per-keystroke entries.
6. **Resource estimate before evaluation.**
   - Each op declares a cheap cost estimate from its input statistics; the scheduler rejects or asks before it starts. This is the generalisation of TD-PERF-002.
   - R03 shows that a segmentation-stage estimate is feasible for traced modes ([WORKER-SCHEDULING-AND-RECOVERY §4](WORKER-SCHEDULING-AND-RECOVERY.md)).
7. **Export capability.** Ops whose preview semantics cannot be represented as vector SVG/PDF (simulated overprint) declare `exportable: false`. Export then refuses with an explanation instead of rasterising. RFC §10 already says this; keep it as a validated field, not prose.

## What not to build
- No graph editor or general DAG evaluator.
- No plugin host, and no user-supplied code (recipes are declarative; unknown op IDs are rejected).
- No speculative op registry framework beyond a Rust enum plus a generated TS descriptor table. The first P2-B ops should be added by normal code review.

## Preset and recipe versioning
`.vectra-preset` (RFC §10):
- each op is `{ id, version, params }`;
- per-op migrations live in Rust and are deterministic;
- an unknown op or version is rejected with a typed error naming the op;
- presets carry no artwork, URLs or code;
- the same format serves free and paid presets.

Keep it separate from the project format. A project may embed recipe values, but never as a different schema.

## Gate proposals (for P2-B/P2-C, not P1)
The CL-G4 recipe gate should additionally test:
- reorder stability of seeds (above);
- side-input digest invalidation;
- composite-output identity across re-evaluation;
- keyboard-commit coalescing in history.
