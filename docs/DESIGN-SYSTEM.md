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
