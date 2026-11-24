# Vectra design system — proposed for RFC-002

Status: draft; product owner proposed shadcn/ui + Dice UI, integration not yet tested. Parent [RFC-002](RFC-002.md). Visual reference [PRD-002](PRD-002-VECTOR-STUDIO.md), [workspace mockup](mockups/vectra-workspace.svg), [interactive mockup](mockups/vectra-workspace.html).

## Approach
Use shadcn/ui as the base owned component registry, Dice UI as complementary advanced component registry, Tailwind CSS for token-backed styling, and Lucide for icons. Prefer compatible Base UI variants of both registries where available; verify each chosen component's actual primitive and dependencies. Do not assume every Dice component has a Base UI counterpart. If a required component is Radix-only, either defer it, implement a small accessible wrapper, or explicitly qualify coexistence; do not silently mix focus/overlay primitives. React/Vite+ baseline remains pinned pending compatibility evidence. Registry sources are copied into the repository and maintained by Vectra, not runtime remote downloads. No registry install or dependency version is selected by this document.

References for engineering verification: [shadcn/ui documentation](https://ui.shadcn.com/docs), [Dice UI documentation](https://www.diceui.com/docs), [Base UI](https://base-ui.com/), [Tailwind CSS](https://tailwindcss.com/docs), [Lucide](https://lucide.dev/). Verify current registry paths, package versions, source provenance and actual licenses at integration; do not rely on marketing compatibility claims.

## Component ownership
| Area | Candidate | Qualification |
|---|---|---|
| Buttons, inputs, switches, checkbox, tabs, select, menus, tooltip, popover, dialog | shadcn/ui | Keyboard, controlled state, focus return, numeric entry |
| Resizable panels, scroll areas | shadcn/ui or small owned layout | Canvas sizing, drag keyboard alternative, min widths |
| Color picker | Dice UI candidate | RGB/hex/alpha, cancel/commit, keyboard, no unsupported colour-space promises |
| Layer and effect order | Dice UI Sortable candidate | Nested tree semantics not assumed; keyboard reorder, explicit drop target, locked layers |
| Import/dropzone | Dice UI file input/upload candidate | Local File object only; no uploader, no network or remote storage |
| Status, errors, progress | shadcn/ui primitives | Indeterminate progress when engine cannot measure |
| Tool rail | Lucide + owned accessible button wrappers | Tooltip, accessible name, selected state, shortcuts |
| Canvas, camera, hit testing, path/selection overlays, handles, rulers | Custom Vectra renderer | Renderer isolated from React component internals |
| Domain tools, inspector, ink plate and recipe controls | Vectra composition | Commands, units, scope, validation, undo; not generic vendor state |

Check current component names, availability and implementation before adoption. Layer hierarchy, recipe semantics, selection and drag-and-drop business rules belong to Vectra, not to a UI package. No component directly mutates geometry. Use controlled values and domain commands; slider drag preview transient, single commit on release/Apply. Color picker similarly. Do not render thousands of path nodes as DOM inspector items; virtualize long lists only after profiling and maintain keyboard access.

## Semantic tokens
Initial dark theme, not a stock shadcn screenshot. Values below are starting design tokens; test WCAG AA contrast, focus and state visibility in actual combinations.

| Token | Initial value / role |
|---|---|
| background | #191a1c app chrome |
| panel | #212224 |
| elevated | #292a2c |
| canvas surround | #303134 |
| foreground | #eeeef0 |
| muted foreground | #a9abad |
| border | #414347 |
| primary | #b9e87b |
| primary foreground | #20251a |
| paper preview | #eee8d8 (display only) |
| destructive/warning | choose accessible contrast during spike |
| focus ring | lime or higher contrast where needed |

Use semantic CSS variables mapped to Tailwind theme and shadcn tokens; no hardcoded vendor colors in domain components. Density compact but usable: 48–56 px rail, 288–336 px inspector, 32–40 px controls as starting points, sufficient keyboard/touch targets; adaptive panels not blanket tiny UI. System font stack, no remote fonts. Typography compact hierarchy; tabular numbers for dimensions and metrics. Respect reduced motion. Artwork colors untouched by theme. Checkerboard, display paper, grid, guides and overlays never enter export.

## Workspace
Top: app mark, import/open/save (when qualified), undo/redo, view mode, export. Left: tool icons. Center: flexible viewport with Artwork/Paths/Compare, pan/zoom/fit, selection. Right: selected-tool inspector, layer panel, later effects and palette. Footer: zoom, dimensions, complexity, processing and offline status. Context-sensitive controls, explicit Apply/Cancel/Reset, warnings and available scopes. Layer reorder changes document through one atomic undoable command, never through mutation of display array. Source layer locked/reference-only. Show meaningful empty/error states. Do not add inaccessible fake controls for future features. Unsplash, press and variation dialogs are later slices.

## Implementation rules
- src/components/ui contains locally owned registry sources; src/components/editor holds domain wrappers; workspace tools, command store, renderer and worker remain independent.
- Pin exact package versions and registry revision/source hashes; audit licenses and regenerate notices for distributed packages and copied code. No uncontrolled latest installs, runtime CDN or remote registry requests.
- Retain strict CSP; test actual production build including style attributes, positioning/portal behavior and generated CSS rather than weakening script/style policy indiscriminately. No unsafe-eval.
- Use Tailwind build-time generation and semantic tokens; keep artwork rendering independent of utility classes. Test tree shaking and CSS/JS size. No dependency on external fonts or tracking.
- Keyboard shortcuts must not fire while typing in inputs/dialogs; focus trapped/restored correctly, aria names and live status, accessible numeric controls, reduced motion and contrast. Keyboard reorder/move actions must be offered even if drag-and-drop fails.
- No real deployment or dependency installation in RFC PR. Integration proof in R05, production shell in P1-B only after approval.

## R05 acceptance
A small isolated representative shell proves pinned Vite+/React/Tailwind build, dialog + popover + tooltip focus, slider/numeric input transaction, sortable list with keyboard path, local file input, color picker, resize and canvas dimensions, and offline/CSP behavior in three Playwright engines. Measure bundle delta, verify license/notices, check no network during local interaction, test keyboard/contrast. Real Safari when available; do not claim it from WebKit. Report which registry variant was used and alternatives for missing components. No full UI implementation until RFC approved.
