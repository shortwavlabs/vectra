# Vectra design system

**Status:** APPROVED (G-0 closure, 2026-11-25); normative for G-UI.

| | |
|---|---|
| Parent | [RFC-002 §16](RFC-002.md) |
| Evidence | Independent review [R05-A](research/rfc-002-review/DESIGN-SYSTEM-FEASIBILITY.md), a disposable harness (42/42 Playwright tests in 3 engines; reproduced by the lead reviewer) |
| Visual references | [PRD-002](PRD-002-VECTOR-STUDIO.md), [workspace mockup](mockups/vectra-workspace.svg), [interactive mockup](mockups/vectra-workspace.html) |

The R05-A harness **qualified the direction**. It did **not** qualify the production UI. The accessibility gaps below stay open until G-UI qualifies the repaired controls.

## 1. Foundation (approved)
**Stack:**
- Vite+, React, TypeScript;
- Tailwind CSS 4 (build-time);
- **shadcn/ui** (style `base-nova`) as the owned base registry;
- **Dice UI** (`diceui/base`) as the complementary registry;
- **Base UI** as the single primitive foundation;
- **Lucide** for icons.

**Rules:**
- **No Radix primitives:** the review's lockfile had 0 `@radix-ui` packages, and this must stay so.
- Registry sources are **copied into the repository and owned by Vectra**; there are no runtime registry or CDN requests.
- **Owned patches to copied sources are accepted** and recorded in the copied-source manifest (§6).

## 2. Initial pins (from R05-A; exact, no ranges)
| Package | Version | Licence | Role |
|---|---|---|---|
| react / react-dom | 19.3.1 | MIT | unchanged root baseline |
| @base-ui/react | 1.9.0 | MIT | primitives |
| @base-ui/utils | 0.5.0 | MIT | used by Dice sources |
| @dnd-kit/core · sortable · modifiers · utilities | 6.3.1 · 10.0.0 · 9.0.0 · 3.2.2 | MIT | Dice Sortable |
| react-resizable-panels | 4.24.1 | MIT | shadcn Resizable |
| lucide-react | 1.79.0 | ISC (+ MIT for Feather-derived icons) | icons |
| class-variance-authority | 0.7.1 | Apache-2.0 | variants |
| cn | 0.5.2 | MIT | shadcn class merging |
| tailwindcss / @tailwindcss/vite | 4.3.5 | MIT | build-time CSS |

- Transitive runtime packages are as recorded in R05-A §2 (Floating UI, use-sync-external-store, reselect, tslib 0BSD, among others).
- The shadcn CLI (4.23.0) is a copy tool only. It writes caret ranges, so those must be re-pinned. It omits `lucide-react` and `cva`, so those must be added.
- Upgrades go through a deliberate PR with the CSP, accessibility and bundle suites re-run.

## 3. Component assignment
| Area | Implementation | Primitive | Required fixes |
|---|---|---|---|
| Buttons, icon buttons, inputs, tabs, select, menus, dialog, popover | shadcn `base-nova` | Base UI | Dialog focus trap and return verified; menus to be exercised in G-UI |
| Tooltip | shadcn `tooltip` | Base UI | Tooltips are not associated with their triggers (R05-A D9). Accessible names and shortcuts go on the **trigger** (`aria-label`, `aria-keyshortcuts`) |
| Slider and numeric input | shadcn `slider` (**patched**) + owned numeric input | Base UI | Forward `aria-label` to thumbs (D1); array values only (D2); keyboard commits coalesced in history (D7, RFC §7) |
| Colour picker | Dice `color-picker` **patched**, or an owned picker built from Base UI sliders | Base UI | Named thumbs (D3); a draft hex input committing on Enter or blur (D4); a keyboard-operable saturation/value area as a 2-D slider (D5); de-duplicated changes plus explicit **commit/cancel** (D6) |
| Layer and effect order | Dice `sortable` | dnd-kit + Base UI | Name-based announcements (D8); explicit Move up/down commands; keyboard reorder already works; locked layers disabled |
| Resizable panels | shadcn `resizable` | react-resizable-panels | Keyboard and pointer resize verified; cursor uses a constructable stylesheet (CSP-safe) |
| Scroll areas | shadcn `scroll-area` | Base UI | Needs the CSP mitigation (§5) |
| Import / dropzone | Dice `file-upload` | Base UI `useRender` | Local `File` only; no `onUpload`; zero network |
| Tool rail | Owned buttons on shadcn `button` + `tooltip`, Lucide icons | Base UI | `aria-pressed`, shortcuts, keyboard |
| Canvas, camera, hit testing, overlays, handles | **Custom Vectra renderer** (RFC §8) | — | Independent of UI libraries |
| Domain tools, inspectors, ink plates, recipe controls | Vectra composition | — | Commands, units, scope, validation, undo |

No component mutates geometry. Components use controlled values and domain commands, with transient previews and **one** commit per gesture or Apply. Long node lists are never rendered as DOM inspector items; virtualise only after profiling, keeping keyboard access.

## 4. Semantic tokens (corrected; validation in G-UI)
| Token | Value | Role and contrast (R05-A) |
|---|---|---|
| background | #191a1c | app chrome |
| panel | #212224 | inspector, rail |
| elevated | #292a2c | menus, popovers |
| canvas-surround | #303134 | around the artboard |
| foreground | #eeeef0 | text: 11.2–15.0:1 on all surfaces |
| muted-foreground | #a9abad | secondary text: 5.65–7.56:1 |
| primary | #b9e87b | accent and selected state |
| primary-foreground | #20251a | on primary: 11.11:1 |
| border | #414347 | **decorative dividers only** (1.31–1.76:1) |
| **control-border** | **#787a7e** | input outlines, slider tracks, resize handles: 3.02–4.05:1 |
| **destructive** | **#ff8f85** | errors: 5.90–7.89:1 as text |
| **warning** | **#f2c14e** | warnings: 7.75–10.38:1 as text |
| paper | #eee8d8 | artwork surface, **display only** |
| **focus ring** | **dual**: lime #b9e87b outer + dark (#191a1c) inner ring or offset | lime alone fails on paper (1.15:1) and on lime fills (1.00:1); with the dark inner ring, 14.24:1 on paper |

**Rules:**
- Semantic CSS variables are mapped to Tailwind and shadcn tokens; no hard-coded vendor colours in domain components.
- No colour-only statuses.
- Artwork colours are never themed.
- Checkerboard, paper display, grid, guides and overlays never enter exports.

## 5. CSP (strict; no relaxation)
- **Policy.** The production CSP in `public/_headers` is unchanged: `style-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, no `unsafe-inline`, no `unsafe-eval`.
- **Mitigation.** Wrap the root in `<CSPProvider disableStyleElements>` and ship the owned rule for `.base-ui-disable-scrollbar`. Without it, Base UI's ScrollArea injects an inline `<style>` and violates `style-src-elem` in all three engines (R05-A).
- **Rejected alternative.** A hash-based `style-src` for Base UI's fixed CSS string: it couples deployment to library internals and breaks silently on upgrade.
- **Regression test** (G-UI):
  - a positive control (without the provider, the violation is detected);
  - a negative control (an injected `<style>` is detected);
  - the violation log drained before screenshots, because Playwright's WebKit screenshot injects a `<style>`.
- **Network.** Zero off-host requests during interaction; tests route all non-local requests to fail.

## 6. Provenance, licences and notices
- **Copied-source manifest:** source URL, registry item, SHA-256 at copy time, and local patches (covering shadcn MIT © 2023 shadcn, Dice UI MIT © 2024 Sadman Sakib, and shadcn `tailwind.css` MIT).
- **Notices.** `scripts/generate-notices.mjs` must be extended to include:
  - copied registry sources;
  - Tailwind's emitted CSS (MIT banner retained);
  - lucide-react's ISC and MIT texts;
  - cva's Apache-2.0 licence.

  The build check fails if the notices are stale (TD-UI-004).
- System font stack; no fonts, images or remote assets.

## 7. Bundle budgets (provisional until G-UI measurement)
| Component (gzip) | Budget | R05-A measurement |
|---|---|---|
| Additional design-system JS | ≤ 150 KiB | +121.9 KiB |
| Additional design-system CSS | ≤ 15 KiB | +8.3 KiB |
| Total initial UI JS | ≤ 250 KiB | harness 188.1 KiB |

**Fixed comparison baseline.** A minimal React 19.3.1 app built with the same pinned toolchain (`vp build`, gzip -9), as in R05-A (66.2 KiB gzip JS). It is re-measured whenever the toolchain changes.

**Reporting.**
- WASM, worker assets and the total initial payload are reported **separately** and excluded from the UI JS budget.
- Lazy-loaded chunks are measured independently.
- Lazy-load rarely used surfaces (colour picker, export dialog, settings) where it shows a measured benefit.

## 8. Accessibility (mandatory)
- WCAG 2.x AA contrast (§4).
- Accessible names, values and states.
- Full keyboard navigation, including **keyboard layer reordering** and Move up/down commands.
- Visible focus with the dual ring.
- `prefers-reduced-motion` respected.
- Accessible sliders, plus an accessible colour picker with **commit/cancel**.
- Modal focus trap and return.
- Global shortcuts never fire in inputs, contenteditable or dialogs.
- Live status for processing.
- **Screen-reader smoke tests** (VoiceOver on macOS at minimum).
- **Keyboard parameter changes coalesced in undo history** (RFC §7).

**G-UI qualification:**
- The R05-A suite is promoted into the repo, in 3 engines.
- The repaired slider and colour picker are qualified explicitly (D1–D7).
- Contrast table, reduced motion and a screen-reader pass.
- Real Safari is required for owner sign-off (Playwright WebKit is not Safari).

## 9. Workspace and visual identity (preserved)
The approved charcoal/lime studio direction stays; it must not become a generic dashboard.
- **Layout:**
  - top bar: app mark, import, open/save (P1-C), undo/redo, view mode, export;
  - left contextual tool rail: 48–56 px;
  - central viewport with an **ivory artwork surface**: Artwork, Paths and Compare views; pan, zoom, fit;
  - right inspector and layers: 288–336 px;
  - bottom status: zoom, dimensions, complexity, processing, offline, renderer fallback disclosure.
- Context-sensitive controls with explicit Apply/Cancel/Reset, warnings and scopes.
- No inaccessible fake controls for future features; meaningful empty and error states.
- Unsplash, Press and Variation dialogs are later slices.
- The mockups are visual references; this document and RFC-002 are normative. Compared at G-0: the mockups use the palette tokens, but show foreground `#e5e6e7` (normative `#eeeef0`; both pass contrast), and predate `control-border` and the dual focus ring. The `#e6ddc6` family is placeholder artwork, not theme. The mockups are unchanged.

## 10. Root integration changes (G-UI; none made at G-0)
1. Runtime dependencies plus `tailwindcss` and `@tailwindcss/vite` as exact pins.
2. `tailwindcss()` in `lazyPlugins`.
3. `@` → `src` alias, `paths` in tsconfig (TS 7 rejects `baseUrl`), and `components.json` (`base-nova`, Lucide).
4. A CSS entry with `@import "tailwindcss"`, the shadcn custom variants, the tokens and the owned scrollbar rule.
5. `<CSPProvider disableStyleElements>`.
6. Notices extension.
7. A decision on root `vp check` coverage of `src/components/ui/**`.

## 11. Implementation rules
- `src/components/ui/` holds the owned registry sources and `src/components/editor/` the domain wrappers. Workspace tools, command store, renderer and workers stay independent of UI libraries.
- Use semantic tokens and build-time Tailwind; artwork rendering never depends on utility classes.
- Keyboard and reorder actions are offered even when drag and drop fails.
- No production UI before G-UI. The R05-A harness stays a disposable experiment.

## 12. G-UI implementation record (2026-11-25; review branch, not yet accepted)
The G-UI shell follows §1–§11 with these recorded deviations ([G-UI report](research/g-ui/G-UI-REPORT.md) §3):
- **Locations:** copied registry sources in `src/ui/registry/` with the manifest `PROVENANCE.json`; owned components in `src/ui/`; the shell in `src/shell/` (instead of `src/components/ui` and `src/components/editor`, per the parallel-development file ownership).
- **No `@` alias, no `components.json`:** the two copied files that used `@/…` imports were patched to relative imports (recorded in the manifest); the shadcn CLI was not re-run (sources copied from the hash-verified R05-A harness).
- **Colour picker:** the owned picker of §3 (Base UI sliders), not the patched Dice picker.
- **Import:** a native file input and a canvas drop target instead of Dice `file-upload` (local `File` only, zero network, as §3 requires).
- **Copied sources** are excluded from formatting (kept byte-identical for hash provenance) but linted and type-checked by the root `vp check` (§10.7).
- **Dark only, deterministic:** registry `dark:` styles follow a `dark` class on `<html>`, never the OS colour scheme.

## 13. G-UI-R design refinement (2026-11-25; review branch, not yet accepted)
A refinement of the integrated workspace, not a redesign: the §4 palette, the §9 layout regions and the §8 accessibility rules are unchanged. Report and evidence: [G-UI-R report](research/g-ui-r/G-UI-R-REPORT.md); the maintainer's review decisions are applied as recorded in its §14 and below.

**Decisions:**
- **Docked panels.** Rail, canvas, inspector and layers are docked and separated by `border` hairlines; there are no floating rounded panels or outer gutter. Resize handles are the hairlines themselves, with a `control-border` grip and an 8 px hit area.
- **§9 placement, applied.** Zoom, fit and artboard size are in the status bar. The view strip above the canvas and the canvas footer are gone. Chrome at 768 px high is 72 px (top bar 44, status bar 28).
- **Only what works is shown (maintainer review).** Smooth, Simplify and Cleanup are not in the rail, and Paths and Compare are not offered, until each is implemented. While Artwork is the only view there is no view switch; §9's view mode returns to the top bar, centred, when a second view exists. The rail is Select, Trace | Recolor (Tab order Select → Trace → Recolor).
- **Top bar:** the wordmark (mark and "vectra"), a hairline, the document title; history; Import (outline) and Export (lime). No "Studio" label.
- **Side column:** starts at 296 px below 1440 px of viewport width and at 320 px above; the 288–336 px range is unchanged. Layers start at 30 % of the column (was 40 %). They never collapse by themselves (no viewport-height breakpoint): the Layers title is a disclosure button (name "Layers", `aria-expanded`) that collapses them to their 36 px header and restores their size, and a drag of the split past the minimum collapses them too. The split stays resizable. Layers keep their pixel height when the window resizes (the inspector absorbs the change), so a shorter window never takes them below their 120 px minimum.
- **Type scale** (system font stack, unchanged): `text-2xs` 11 px (meta, section titles, units), `text-xs` 12 px (controls and values), `text-ui` 13 px (body, panel titles, layer names), `text-title` 15 px (the selection name). Section titles are 11 px uppercase, `muted-foreground`, tracking 0.06 em; panel titles are 13 px semibold. Numbers are `tabular-nums` and grouped (1,613).
- **Inspector = property sheet:** sections of rows with a 3.25 rem label column (Position, Size, Scale, Rotate). One field style for every value: 28 px high, `background` well, `control-border` outline, 12 px tabular text, a short visible label inside the field (X, Y, Hex) and the unit at the right. The registry input's `md:text-sm` is overridden at the call site, not patched.
- **Colour picker:** opens below its trigger, over the inspector column, so it does not cover the artwork; offers the document's palette as 24 px swatches that set the draft only; Hex label inside the field. Commit/cancel semantics (D3–D6) are unchanged.
- **Mixed fills (maintainer review).** When the selected paths' fills differ, the Fill trigger shows a neutral hatched swatch and "Mixed", and is named "Fill colour: mixed. Edit colour"; the picker reads "Current mixed". It never shows or names one of the colours before the artist applies one. Apply still commits once (always, in this state, since any colour makes the fills uniform); Cancel and Escape commit nothing.
- **Palette names (maintainer review).** The engine names a trace's colours by preset and number (`p0`… Limited Palette, `c0`… Full Colour, `ink`, `ink1`… Black & White and halftone, `x0`… a Limited fallback). The UI shows them as "Colour N+1", N being the number in the name and never the list position, in Recolor, the Fill note and the picker's swatch names. Any other name is shown as it is. Display only: palette IDs, names and SVG/PDF output are unchanged. No sorting by lightness; no "ink" terminology.
- **Recolor:** the panel states that a palette edit recolours every path using that colour, locked paths included: locks prevent transforms and deletion, not palette edits.
- **Layers:** two-line rows (name, then state and count); a row that contains the selected path is tinted and reads "Contains selection" (never colour alone); eye, lock and menu are `muted-foreground` until toggled.
- **Empty canvas:** the canvas surround with a blank ivory sheet as the drop target. The sheet is an **onboarding surface** (maintainer decision): it is not committed artwork and not an exported artboard. Text on the sheet uses `background` (14.24:1) and the new `ink-muted` (5.6:1). A lime button on the sheet carries a `background` ink outline (lime on paper alone is 1.15:1).
- **Modal scrim:** a flat `rgb(10 10 12 / 0.6)` without backdrop blur (owned unlayered rule on `[data-slot="dialog-overlay"]`; the registry file is not patched).
- **Status bar:** activity icon, the message truncated with its full text as a `title`, then document size and complexity, zoom, renderer and offline state, each a fixed item separated by hairlines. With no document, the document items are hidden but stay mounted (their test IDs are part of the contract).
- **Quiet when idle and healthy (maintainer review).** No idle "Ready": the status live region stays mounted, empty, and speaks when something happens; errors stay visible as alerts. A healthy renderer (the render worker, starting or drawing) shows nothing. The main-thread fallback (with its reason), a recovery and a failure are shown in words with an icon, in `warning` or `destructive`. `canvas-state` stays mounted as a live region (`status`, `alert` on failure) with `data-state` and `data-host` for tests and diagnostics. Messages have no timed lifetime.
- **Focus on the canvas:** the frame around the canvas draws the dual ring (lime outer, dark inner) above the canvas layers while the canvas has keyboard focus, because Chromium paints the canvas's own inset outline under its layers.
- **Browser surfaces:** text selection and the caret use the lime accent; scroll thumbs use `control-border`; a scrolling panel fades at its lower edge while more content is below.

**Token additions:**

| Token | Value | Role and contrast (measured in the running build) |
|---|---|---|
| ink-muted | #5c5a54 | secondary text printed on `paper` (the empty-state sheet): 5.6:1 |
| text-2xs / text-ui / text-title | 11 / 13 / 15 px | the type scale above (`text-xs` 12 px is Tailwind's) |

**Deviations from §3 and §9 (recorded):**
- **Paper as a UI surface (approved).** `paper` was "artwork surface, display only". The empty-state sheet uses it as an onboarding surface; it is display only, is not committed artwork and is never exported.
- **Unavailable controls are hidden (maintainer decision, reversing the G-UI-R proposal).** §9 lists "Artwork, Paths and Compare views": Paths and Compare, and the path-refinement tools, are hidden until they exist rather than shown disabled (§9: "no inaccessible fake controls for future features"). The rail groups tools with a divider (selection and tracing | colour).
- **Copy (approved).** Preset descriptions: Black & White "Bold shapes and high-contrast artwork.", Full Colour "Preserve the richness of the original image.", Limited Palette "Reduce artwork to a curated set of colours."; "Contains selection"; the empty-state text, "Nothing to inspect yet" and the Fill note as proposed.
