# Preset system
Status: proposed. Every preset outputs vector paths or vector primitives, never raster texture. Presets are versioned declarative recipes over allowlisted operations; user parameters validated by schema. Defaults below are starting hypotheses.

| ID | Pipeline | Controls | Phase |
|---|---|---|---|
| bw | linear luminance -> threshold -> components -> contours -> fit | threshold 0–255 (128), invert, speckle area, smoothing | P1 |
| gray | luminance -> 4–16 level quantization -> trace layers | levels (8), contrast, detail | P1 |
| color | alpha-aware segmentation -> region tracing | palette precision, detail, smoothing | P1 |
| limited | Lab quantization -> masks -> shared boundaries | colors 2–32 (8), custom palette | P1 |
| silhouette | alpha mask or threshold -> contour with holes | threshold, invert, hole retention | P1 |
| line-art | gradient/edge response -> threshold -> thin-region tracing | sensitivity, width, speckle | P1 |
| old-print | tonal contrast -> vector halftone and contour ink -> optional seeded edge distress | ink/paper, pitch, angle, contrast, distress, seed | P2 |
| halftone | local tonal sampling -> variable-size vector dots | pitch, angle, dot shape, min/max radius | P2 |
| screen-print | limited palette -> region paths -> optional clipped dot shading | inks 2–8, palette, registration offset | P2 |
| poster | strong quantization -> large region cleanup -> corner-aware fit | colors, detail, contrast | P2 |
| comic-ink | color regions + traced edge mask | ink width, palette, threshold | P2 |
| woodcut | tonal bands + direction-aware clipped hatch shapes | spacing, angle, ink width | P3 |
| engraving | crosshatch bands with adaptive line density | pitch, angle pairs, tone curve | P3 |
| blueprint | edge extraction -> recolor | ink/background, width | P3 |
| stencil | binary tracing -> explicit topology bridges | minimum bridge width, hole policy | P3 |

## Old Print implementation
Use perceptual luminance with documented color conversion. Sample darkness on a rotated grid; map darkness to area coverage (for circular dots radius proportional to sqrt(coverage), not coverage). Bound radius by pitch; handle near-solid areas as traced ink regions or alternate dot geometry to avoid unintended gaps. Clip to subject alpha and desired artwork bounds using vector clip paths or boolean geometry. Optional deterministic edge irregularity on contours must preserve winding, holes and minimum feature size. Paper is optional solid vector fill; transparent output must stay transparent. Aged paper is a palette choice, not an embedded texture. Offer warm ivory/black and monochrome defaults. No random unseeded noise.

## Quality rules
Area-based speckle removal in source units; scale parameters consistently for preview/final. Protect thin strokes and small holes with tests. Centerline output is distinct from filled edge regions and deferred. Silhouette does not imply AI background removal. Stencil bridges need connectivity validation before claiming cut readiness. Registration effects intentionally shift ink only when enabled. Bound primitive count with explicit warning and adjustable pitch; never silently rasterize.

Each recipe declares id, version, label, parameter schema, ordered stages, capabilities, fixture set and expected limits. Contributor adds deterministic tests, sample output, runtime measurements, accessibility labels and license provenance. User presets store settings not executable code.
