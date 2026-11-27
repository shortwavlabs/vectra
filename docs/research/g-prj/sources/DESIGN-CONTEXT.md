# G-PRJ design-context digest: project home and workspace project controls

Source tree: `/Users/shortwavlabs/Workspace/shortwavlabs/vectra/.claude/worktrees/g-prj-r`, branch `gate/g-prj-r`, HEAD `276c1ec` (merge of PR #22). Read-only survey, 2026-11-26. No build was run and nothing was measured in a browser. Every "rendered" value below is derived from source classes and the Tailwind 4.3.5 theme file, so it is **unconfirmed** until measured. File references are `path:line` at this HEAD.

## 0. Findings that correct the brief's premises

- **There is no `src/design-system/`.** Tokens live in `src/ui/styles.css`. Copied registry components are in `src/ui/registry/`, with hashes and patches in `src/ui/registry/PROVENANCE.json`. Owned components are in `src/ui/`, and the shell is in `src/shell/`. This layout is a recorded deviation, DESIGN-SYSTEM.md:169.
- **`/` is not a branded landing page.** `index.html` is the light-themed **P0 engineering workbench**: `<title>Vectra · P0 engineering workbench</title>` (index.html:11), with `src/main.tsx` → `src/App.tsx` and its own `src/index.css` (`background: #f6f4ee; color: #1d1d1b`, index.css:1-6). It has no brand mark (G-BRAND-REPORT.md:105). Evidence screenshot: `docs/research/g-brand/landing-1366x768.png`.
- **No project home or "home" screen exists.** The nearest is the **empty-state ivory sheet** on the canvas (Workspace.tsx:717-755), approved as an "onboarding surface" (DESIGN-SYSTEM.md:193, :208).
- **No File menu, Save, Open, New, Close or project name exists.** The document title is hard-coded: `"Untitled artwork"`, or `"No document"`, plus `" · Edited"` when dirty (Workspace.tsx:586-593). `DocState` has no title or name field (src/document/model.ts:95-103). RFC-002.md:783 lists **file names** under "Not stored". A project name can only come from the file the user opened or saved, never from the document.
- **No tabs, toast, menubar, alert/confirm dialog, select, list/listbox, card, badge or kbd component exists.** The export dialog uses a native `<select>` (Workspace.tsx:1130-1138). `kbd` styling is written inline in three places (Workspace.tsx:197, :778, :1022).
- **The shell helpers are private to `Workspace.tsx` and not exported:** `IconAction` (:159-204), `Divider` (:207-212), `BrandMark` (:219-242), `ExportDialog` (:1040-1152), `SPLITTER` (:113-114) and `SHORTCUTS` (:244-255).
- **Scope conflict (surface it; do not resolve it here).** See §7.

## 1. Brand and tokens

### 1.1 Colour tokens (src/ui/styles.css:14-45; dark only)
| Token | Value | Role (source) |
|---|---|---|
| `--background` | `#191a1c` | app chrome, field wells; **brand "Charcoal"** (styles.css:15; BRAND.md:25) |
| `--panel` | `#212224` | inspector, rail, top bar, status bar (:16) |
| `--elevated` | `#292a2c` | menus, popovers, dialog surface (`--popover`) (:17) |
| `--canvas-surround` | `#303134` | around the artboard (:18) |
| `--paper` | `#eee8d8` | artwork surface and empty-state sheet; **brand "Ivory"** (:19; BRAND.md:27) |
| `--foreground` | `#eeeef0` | text, 11.2–15.0:1 (:20; DESIGN-SYSTEM.md:68) |
| `--muted-foreground` | `#a9abad` | secondary text, 5.65–7.56:1 (:21) |
| `--border` | `#414347` | **decorative dividers only**, 1.31–1.76:1 (:23) |
| `--control-border` | `#787a7e` | input outlines, slider tracks, resize grips, ≥ 3:1 (:25) |
| `--primary` | `#b9e87b` | state and the one primary action; **brand "Lime"** (:26; BRAND.md:26) |
| `--primary-foreground` | `#20251a` | text on lime, 11.11:1 (:27) |
| `--destructive` | `#ff8f85` | errors, 5.90–7.89:1 (:28) |
| `--warning` | `#f2c14e` | warnings and disclosures, 7.75–10.38:1 (:29) |
| `--ink-muted` | `#5c5a54` | secondary text on paper, 5.6:1 (:31) |
| `--accent` | `#36383b` | menu-item focus/hover background (shadcn alias) (:39) |
| `--radius` | `0.375rem` | 6 px base radius (:43) |

**Aliases** (styles.css:32-42): `--card`→panel, `--card-foreground`→foreground, `--popover`→elevated, `--popover-foreground`→foreground, `--secondary`→elevated, `--secondary-foreground`→foreground, `--muted`→elevated, `--accent-foreground`→foreground, `--input`→control-border, `--ring`→primary.

**Tailwind colour utilities** (`@theme inline`, styles.css:56-80) cover every token above as `bg-*`, `text-*`, `border-*` and `ring-*`: `background, foreground, panel, elevated, canvas-surround, paper, card, popover, primary, secondary, muted, muted-foreground, accent, destructive, warning, ink-muted, border, control-border, input, ring`.

**Values outside the token list:**
- Modal scrim `rgb(10 10 12 / 0.6)` with no blur (styles.css:141-146). It is documented in DESIGN-SYSTEM.md:194 and design-full.md:101, but is not a DESIGN.md frontmatter token (FINAL-AUDIT P3-4, still open).
- Selection `color-mix(in srgb, var(--primary) 32%, transparent)`; caret lime (styles.css:149-155).
- Canvas focus variables `--vx-focus` (default `#b9e87b`) and `--vx-focus-halo` (default `#191a1c`) (canvas-host.css:24-26).
- Picker gradients and the "None" and "Mixed" swatches (styles.css:167-205).
- Tonal brand tints `#8c8d8e` and `#84817a`, used in brand files only (BRAND.md:57).
- No-fill picker draft `#808080` (DESIGN-SYSTEM.md:189).

**Brand colour rule.** The mark uses literal hex, never tokens: "The mark uses these brand values directly, not themed tokens" (BRAND.md:29; approved, DESIGN-SYSTEM.md:214). Lime on light backgrounds is an accent, not structure: "On light backgrounds, lime is an accent, not structure: charcoal carries the form." (BRAND.md:43). Lime on ivory is 1.15:1 (BRAND.md:41), so a lime button on paper needs a `background` ink outline (DESIGN-SYSTEM.md:193; Workspace.tsx:738 `ring-1 ring-background`).

### 1.2 Typography
- **Family:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (styles.css:48). No web fonts (PRODUCT.md:34; DESIGN-SYSTEM.md:104). Inter 4.1 is **generation-only** for social banners and must never reach `dist` (BRAND.md:93-96; `scripts/check-dist.mjs` fails the build on any font file).
- **Body default:** 13 px, antialiased (styles.css:97-98).
- **Documented role scale** (DESIGN-SYSTEM.md:185; design-full.md:84):

| Utility | Size / line height | Role |
|---|---|---|
| `text-2xs` | 11 / 16 px (styles.css:50-51) | meta, units, section titles (uppercase, `muted-foreground`, tracking 0.06 em, semibold; Inspector.tsx:49) |
| `text-xs` | 12 / 16 px (Tailwind `calc(1/0.75)`) | controls, values, row labels, status bar |
| `text-ui` | 13 / 18 px (styles.css:52-53) | body, panel titles (semibold), layer names, document title |
| `text-title` | 15 / 20 px, 600 (styles.css:54-55) | the selection name (Inspector.tsx:178) |

- **Sizes the code uses outside that scale** (registry defaults; derived, unconfirmed):
  - Buttons: `text-sm` 14 / 20 px, `font-medium` 500 (button.tsx:6). Import and Export are therefore 14 px; Export adds `font-semibold` (Workspace.tsx:651).
  - Dialogs: content `text-sm` 14 px (dialog.tsx:54); title `text-base` 16 px, `font-medium`, `leading-none` (dialog.tsx:123); description `text-sm` 14 px muted (dialog.tsx:139).
  - Export dialog: radio labels `text-sm font-medium` (Workspace.tsx:1083); fields `h-8 … text-sm` (:1052); legend, labels and summary `text-xs` (:1077, :1100, :1063).
  - Menu items: `text-sm` 14 px (dropdown-menu.tsx:88); menu label `text-xs` (:65).
  - Wordmark "vectra": `text-[15px] font-bold tracking-tight` (700, −0.025 em) (Workspace.tsx:583). The weight differs from the 600 title role, and the literal is FINAL-AUDIT P3-4, still open.
  - Empty-state heading: `text-lg` 18 / 28 px `font-semibold tracking-tight` (Workspace.tsx:723); body `text-xs text-ink-muted` (:726).
  - Tooltip: `text-xs`, inverted (`bg-foreground text-background`), `px-3 py-1.5 rounded-md` (tooltip.tsx:50); tooltip kbd `text-[11px]` (Workspace.tsx:197; literal, P3-4 open).
- **Numbers:** `tabular-nums`, grouped with `toLocaleString("en")` ("1,613 paths") (DESIGN-SYSTEM.md:185; Workspace.tsx:875).

### 1.3 Spacing
Stock Tailwind 4 spacing, `--spacing: 0.25rem` = 4 px (node_modules/tailwindcss/theme.css:325). styles.css does not override it. There is no custom spacing scale. Recurring values in the shell:
- `px-3`, 12 px: bar and panel padding (Workspace.tsx:579, :774; Inspector.tsx:47).
- `gap-1.5`, 6 px: mark-to-wordmark gap and right-cluster gap (:581, :595).
- `gap-2.5`, 10 px: left cluster (:580).
- `gap-3`, 12 px: header grid and footer (:579, :829).
- Rail: `py-2 gap-1` (:664). Sections: `pt-2.5 pb-3 gap-2` (Inspector.tsx:47).
- Dialog: `p-4 gap-4` (dialog.tsx:54); footer `p-4 gap-2` (:103).

**Fixed sizes:**
| Element | Size | Source |
|---|---|---|
| Top bar | 44 px | Workspace.tsx:576 |
| Status bar | 28 px | Workspace.tsx:576 |
| Rail | `w-12`, 48 px | Workspace.tsx:664 |
| Rail buttons | `icon-lg`, 36 px | button.tsx:32 |
| Top-bar icon buttons | `icon`, 32 px | button.tsx:27; Workspace.tsx:604 |
| Import / Export | `h-8`, 32 px | Workspace.tsx:644, :651 |
| Panel headers | `h-9`, 36 px | Workspace.tsx:774; LayersPanel.tsx:52 |
| Layer rows | `h-10`, 40 px | LayersPanel.tsx:155 |
| Fields | `h-7`, 28 px | numeric-field.tsx:30 |
| Splitter strips | `w-6` / `h-6`, 24 px | Workspace.tsx:765, :789 |
| Minimum target | 24 px | G-UI-R-REPORT.md:177 |

### 1.4 Radii (styles.css:43, :81-84)
`--radius-sm` 4 px, `--radius-md` 6 px, `--radius-lg` 8 px, `--radius-xl` 12 px. DESIGN.md:37-40 documents only sm/md/lg. Use in code:
- Default-size buttons: **`rounded-lg`, 8 px** (button.tsx:6). This covers Import, Export and the dialog buttons, although design-full.md:92 says "Radius `md` (6 px) for controls" and DESIGN.md:45 gives `button-primary` `rounded.md`. The doc/code discrepancy is unconfirmed visually.
- `xs`, `sm`, `icon-xs` and `icon-sm` buttons: `min(radius-md, 10–12px)`, which is 6 px (button.tsx:24-31).
- Fields: `rounded-md` 6 px, overriding the registry's `rounded-lg` at the call site (numeric-field.tsx:30; Workspace.tsx:1052).
- Dialog: `rounded-xl` 12 px (dialog.tsx:54). Popover and menu: `rounded-lg` 8 px (popover.tsx:39; dropdown-menu.tsx:41).
- Menu items, tooltip and layer rows: `rounded-md`.
- Paper sheet `rounded-[3px]` (Workspace.tsx:720); swatches 3–4 px (color-picker.tsx:128, :189).
- `kbd` uses bare `rounded` (Tailwind default 0.25rem; not verified in this repo).

### 1.5 Borders
- Every element defaults to the `border` colour (styles.css:88-90).
- Panels are separated by 1 px `border` hairlines: header `border-b` (Workspace.tsx:579), rail `border-r` (:664), footer `border-t` (:829), panel headers `border-b`, sections `border-t` (Inspector.tsx:47).
- **Control boundaries use `control-border`, never `border`** (DESIGN.md:73; design-full.md:78): outline buttons get `border-control-border` (Workspace.tsx:539, :644), fields, radio cards (:1081), the dialog kbd (:1022) and resize grips.
- The selected export card uses `has-checked:border-primary has-checked:bg-primary/10` (:1081). The selected preset row uses `has-checked:border-control-border has-checked:bg-elevated` (:513).
- Group dividers are `Divider`: 1×16 px `bg-border` vertical, or 24×1 px horizontal in the rail (:207-212).

### 1.6 Shadows and elevation
- Docked panels have **no shadow** and no outer gutter: "Docked panels … no floating cards or outer gutter" (design-full.md:88).
- Dialog: `ring-1 ring-foreground/10`, no shadow class (dialog.tsx:54).
- Popover and menu: `shadow-md` (`0 4px 6px -1px rgb(0 0 0/.1), 0 2px 4px -2px rgb(0 0 0/.1)`, theme.css:409) plus `ring-1 ring-foreground/10`. Submenu: `shadow-lg`.
- Empty sheet: `shadow-2xl shadow-black/40` (Workspace.tsx:720; literal, P3-4 open).

### 1.7 Focus ring (dual ring; DESIGN-SYSTEM.md:77; design-full.md:80)
- **Global** (styles.css:107-111): `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; box-shadow: 0 0 0 2px var(--background); }`. These rules are unlayered, so they win over the registry's `focus-visible:ring-3 ring-ring/50` utilities (inferred from cascade layers). Tests assert `solid 2px rgb(185, 232, 123)`, offset 2 px and a dark inner shadow (G-UI-R-REPORT.md:173).
- **Splitters** (styles.css:115-118): `outline-offset: -2px; box-shadow: inset 0 0 0 4px var(--background)`. The ring is drawn inside the strip.
- **Canvas** (canvas-host.css:18-29): the host draws its own ring as its last layer (`outline 2px` lime, offset −2 px, inset 4 px halo).
- **Why dual:** "lime alone fails on paper at 1.15:1" (design-full.md:80).

### 1.8 Motion
- Default transition 150 ms `cubic-bezier(0.4, 0, 0.2, 1)` (theme.css:492-493; "0.15 s", G-UI-REPORT.md:255).
- Buttons `transition-all` and `active:not-aria-[haspopup]:translate-y-px` (button.tsx:6). Inputs `transition-colors`. Chevrons `transition-transform` rotate-90 (LayersPanel.tsx:77). Spinner `animate-spin` (Workspace.tsx:732, :833).
- The registry's enter/exit classes are **inferred to be inert**: `animate-in`, `fade-in-0`, `zoom-in-95` and `slide-in-from-*` on dialog, popover, menu and tooltip. No `tw-animate-css` dependency (package.json) and no definition in the CSS sources were found. Dialogs and menus therefore appear without animation (not verified in a build). `duration-100` is set on them.
- **Reduced motion:** a global rule (styles.css:207-216) sets 0.01 ms durations and one iteration, and the spinner stops (G-UI-R-REPORT.md:176).
- **Precedent:** "No motion was added" in G-UI-R (G-UI-R-REPORT.md:33).

### 1.9 Light and dark
- The workspace is **dark only and deterministic**: `<html lang="en" class="dark">` and `<meta name="color-scheme" content="dark">` (workspace.html:2, :11); `color-scheme: dark` (styles.css:44); `@custom-variant dark (&:where(.dark, .dark *))` (styles.css:11).
- "Dark only and deterministic: the OS colour scheme never changes the UI. Artwork colours are never themed." (design-full.md:72; DESIGN-SYSTEM.md:174).
- The P0 workbench at `/` is light, with its own stylesheet outside the design system.
- **Brand variants by background** (BRAND.md:45-52): dark (charcoal, app chrome) → `vectra-symbol-ivory.svg`, `-mono-ivory` or `-tonal-ivory`; light (white, ivory, paper) → canonical `vectra-symbol.svg`, `-mono-charcoal` or `-tonal-charcoal`. Mid-tones and photos need a solid charcoal or ivory field first.

### 1.10 Symbol and wordmark usage
- **Top bar:** `BrandMark` (Workspace.tsx:219-242) inlines the ivory + lime master verbatim: viewBox `0 13 453 343`, `className="h-6 w-8"` (32×24 px), `aria-hidden="true"`. Beside it, the text "vectra" (:582-583) carries the single announcement (DESIGN-SYSTEM.md:214).
- **Pinned by** `src/shell/brand-mark.test.ts`, which reads `branding/vectra-symbol.svg`, `branding/vectra-symbol-ivory.svg`, `src/shell/Workspace.tsx` and `scripts/generate-sw.mjs`. Any new copy of the mark would need the same drift guard.
- **Other uses:** the service worker's offline recovery page inlines the canonical symbol at 64×48 (scripts/generate-sw.mjs:64, :140-163; G-BRAND-REPORT.md:93). The README uses a `<picture>`. Favicons and PWA icons are in `public/`. Social banners are in `branding/social/`.
- **Rules:**
  - Never redraw or re-path: "Never edit the geometry. Do not redraw, retrace, simplify, re-path or optimise it." (BRAND.md:20).
  - Minimum screen width 32 px; below that use the favicon tile only (BRAND.md:66-70, :124).
  - Clear space 1 A, which is ≥ 0.03 W outside a master file's edges (BRAND.md:61-63).
  - No effects: "Do not add effects: no gradients, shadows, glows, strokes around the symbol or textures." (BRAND.md:121).
  - No other colours (BRAND.md:120).
  - "The symbol has no wordmark." The name is typeset separately (BRAND.md:5).
- **Tagline:** "From pixels to paths." is a commitment (PRODUCT.md:40). "From paths to art." and "Vectra Press" are provisional (docs/BRAND-AND-BUSINESS.md:2, :8-9). Banners use one lime accent, the tagline's full stop (BRAND.md:83).

## 2. Approved principles and explicit prohibitions

**Authority order.** "Normative: docs/DESIGN-SYSTEM.md (§4, §8, §9, §13) and docs/RFC-002.md §16 win over this map and over .impeccable/design-full.md. docs/DESIGN.md is the superseded P0 baseline, not a design authority." (DESIGN.md:65). PRODUCT.md:5: the approved project documents win over it.

**Product principles** (PRODUCT.md:46-51):
1. "Local and private by construction: the artwork never leaves the device."
2. "Honest output: real vectors, real engine results, no pretend controls."
3. "The artwork leads; the chrome recedes."
4. "Every edit is a command: undoable, with explicit Apply and Cancel."

**Constraints** (PRODUCT.md):
- :32 "No account, upload, server processing, subscription or telemetry; the core is free and open source."
- :33 No AI or generative models in the creative runtime.
- :34 "A strict Content Security Policy (no inline styles or scripts, no remote assets or fonts)."
- :35 "Features ship only when implemented: unavailable tools and views are not shown."
- :44 "No testimonials, customers, benchmarks or pricing exist; none may be invented."
- :55 WCAG 2.x AA; full keyboard operation; visible dual focus ring; reduced motion; live status; VoiceOver smoke test.

**Design map Do/Don't** (DESIGN.md:71-79 = design-full.md:105-113):
- Don't: "Show controls for features that do not exist yet." / "Use `border` for control boundaries, or colour alone for status." / "Use print-trade "ink" terminology for palette colours, or put raster imagery in a vector export."
- Do: "Keep lime for state and the primary action; keep the artwork the brightest element." / "Put names, states and shortcuts on the control itself; keep statuses in words." / "Keep the strict CSP: no inline `<style>`, no remote fonts or assets." / "Use the symbol only as supplied: one of its four colour variants, never redrawn or re-pathed."

**Character:**
- design-full.md:68: "The workspace (`workspace.html`) is an **Operate** surface: a docked creative editor … The ivory artwork is the brightest thing on screen; chrome recedes. It must not become a generic dashboard."
- DESIGN-SYSTEM.md:140: "The approved charcoal/lime studio direction stays; it must not become a generic dashboard."
- RFC-002.md:870-877: "Preserved and not redesigned into a dashboard" (dark charcoal workspace, lime accent, ivory artwork surface, left tool rail, central canvas, right inspector and layers, **"top project and export bar"**, bottom status bar).

**Honesty and empty states:**
- DESIGN-SYSTEM.md:148: "No inaccessible fake controls for future features; meaningful empty and error states."
- RFC-002.md:883: "Unavailable tools are hidden or explained; no fake controls." The maintainer chose **hidden** (DESIGN-SYSTEM.md:182, :209).

**Status:**
- DESIGN-SYSTEM.md:196: "Quiet when idle and healthy … No idle "Ready" … errors stay visible as alerts … Messages have no timed lifetime."
- DESIGN-SYSTEM.md:81: "No colour-only statuses."

**Shortcuts:** "Global shortcuts never fire in inputs, contenteditable or dialogs." (DESIGN-SYSTEM.md:128).

**Modal:** "a flat 60 % scrim without blur" (design-full.md:101). "Modal focus trap and return." (DESIGN-SYSTEM.md:127).

**Stack:** "No Radix primitives" (DESIGN-SYSTEM.md:23). Registry sources are copied and owned, and patches are recorded in the manifest (:24-25). Base UI is the single primitive layer. Icons are Lucide.

**Bundle budgets** (DESIGN-SYSTEM.md:107-111): design-system JS ≤ 150 KiB, CSS ≤ 15 KiB, total initial UI JS ≤ 250 KiB gzip. Last measured: 114.3 / 9.5 / 231.2 (G-BRAND-REPORT.md:376), which leaves about 18.8 KiB of initial JS headroom. "Lazy-load rarely used surfaces (colour picker, export dialog, settings) where it shows a measured benefit." (DESIGN-SYSTEM.md:118).

**Repository rules** (AGENTS.md): no server or telemetry; work one gate at a time on review branches; no large binary assets; update docs and the gate report with every implementation PR. Screenshots: milestone screenshots only (user memory).

## 3. Component inventory

### 3.1 Registry (`src/ui/registry/`, copied, byte-identical, hash-tracked in PROVENANCE.json; patch only with a manifest entry)
| File | Exports and variants | Used where |
|---|---|---|
| `button.tsx` | `Button`, `buttonVariants`. **variant:** `default` (lime), `outline`, `secondary`, `ghost`, `destructive`, `link`. **size:** `default` (h-8), `xs` (h-6), `sm` (h-7), `lg` (h-9), `icon` (32), `icon-xs` (24), `icon-sm` (28), `icon-lg` (36) (button.tsx:9-33). Leading icon: `data-icon="inline-start"` | everywhere |
| `dialog.tsx` | `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent` (`showCloseButton` defaults to true: a ghost `icon-sm` X at top-right with sr-only "Close", :60-75), `DialogHeader`, `DialogFooter` (`showCloseButton`), `DialogTitle`, `DialogDescription` | Export and Shortcuts dialogs |
| `dropdown-menu.tsx` | `DropdownMenu`, `…Portal`, `…Trigger`, `…Content` (align, side, sideOffset 4, `min-w-32`, `w-(--anchor-width)`), `…Group`, `…Label`(inset), `…Item`(inset, variant `default`/`destructive`), `…CheckboxItem`, `…RadioGroup`, `…RadioItem`, `…Separator`, `…Shortcut`, `…Sub`, `…SubTrigger`, `…SubContent` | only the Layers row "More actions" menu (LayersPanel.tsx:248-292: Rename, Move up, Move down, separator, Duplicate, Delete as `destructive`). `DropdownMenuShortcut` is not used yet |
| `input.tsx` | `Input` (registry h-8, rounded-lg, `md:text-sm`, `dark:bg-input/30`; call sites override these, numeric-field.tsx:29-30) | fields |
| `popover.tsx` | `Popover`, `PopoverTrigger`, `PopoverContent` (`w-72 p-2.5 gap-2.5 rounded-lg shadow-md`), `PopoverHeader`, `PopoverTitle`, `PopoverDescription` | colour picker |
| `tooltip.tsx` | `TooltipProvider` (registry default delay 0; the workspace sets `delay={300}`, Workspace.tsx:575), `Tooltip`, `TooltipTrigger`, `TooltipContent` (side, sideOffset 4) | rail, bar, zoom, layers |
| `resizable.tsx` | `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`(`withHandle`) | layout |
| `scroll-area.tsx` | `ScrollArea`, `ScrollBar` (thumb overridden to `control-border`; fades at the lower edge, styles.css:125-137) | inspector, layers |
| `slider.tsx` (patched D1/D2) | `Slider` | Scale |
| `sortable.tsx` (Dice) | `Sortable`, `SortableContent`, `SortableItem`, `SortableItemHandle` | layer reorder |

### 3.2 Owned (`src/ui/`)
- `tip.tsx`: `Tip({label, render, children, side})`, a visual-only tooltip. The trigger keeps its own `aria-label` (tip.tsx:1-3).
- `numeric-field.tsx`: `NumericField` (draft, commit on Enter or blur, Escape reverts, arrows step with Shift ×10) and `FIELD` = `"h-7 rounded-md border-control-border bg-background text-xs tabular-nums md:text-xs dark:bg-background"` (:29-30), the one field look.
- `color-picker.tsx`: `ColorPicker` (popover below its trigger, `align="end"`, `w-64`; footer of equal halves Cancel (`outline sm`) and Apply (`default sm`), color-picker.tsx:245-252).

### 3.3 Shell-level patterns (private; copy or extract)
- **`IconAction`** (Workspace.tsx:159-204): ghost icon button. Name, `aria-pressed` and `aria-keyshortcuts` are on the trigger. Disabled uses `aria-disabled` and stays focusable at `opacity-40`. Pressed is `bg-primary text-primary-foreground … dark:hover:bg-primary/90` (:183). The tooltip shows the label plus a kbd.
- **`Divider`** (:207-212).
- **`Section`** (exported) and `Row` (Inspector.tsx:45-72): an 11 px uppercase section title with optional right-aligned meta, then rows with a `3.25rem` label column.
- **Empty inspector, panel empty state and Layers empty state:** icon plus one sentence (Inspector.tsx:75-85; LayersPanel.tsx:84-99).
- **Option rows:**
  - Preset radio rows: native radio with `accent-primary`, a description attached by `aria-describedby` (Workspace.tsx:509-535).
  - Export format radio cards (:1076-1099).
- **Lists:**
  - Layers: a sortable `ul`/`li` of two-line rows. The selected row is `bg-primary/15 ring-1 ring-primary/60 ring-inset`; a row that contains the selection is `bg-primary/5 ring-primary/25` and reads "Contains selection". Hover is `bg-elevated` (LayersPanel.tsx:155).
  - Shortcuts: a `dl` grid with `border-t` rows (Workspace.tsx:1017-1028).
  - Recolor: a `ul` of picker triggers (Inspector.tsx:405-423).
- **Notes and warnings:**
  - Locked note: `rounded-md border border-warning/50 px-2 py-1.5 text-xs text-warning`, `role="note"` (Inspector.tsx:186-191).
  - Errors: `text-destructive` plus a `CircleAlert` icon.
- **`kbd` styles in use:** tooltip `ml-1 rounded bg-background/15 px-1 font-sans text-[11px]` (:197); inspector header `rounded border border-border px-1.5 text-2xs text-muted-foreground` (:778); dialog `rounded border border-control-border bg-background px-1.5 py-0.5 text-2xs tabular-nums` (:1022).

### 3.4 Not available (would be new, or copied from the registry with provenance)
Tabs, menubar, alert-dialog/confirm, toast/sonner, select, combobox, list/listbox, card, badge, progress, separator component, file drop component (Import uses a native hidden input plus canvas drop; DESIGN-SYSTEM.md:172).

### 3.5 Lucide conventions
- **Version:** `lucide-react` 1.79.0, exact pin (package.json:28). Named imports only.
- **Icons in use:**
  - Workspace.tsx:7-23: `CircleAlert, Download, Keyboard, LoaderCircle, Maximize, Minus, MousePointer2, Palette, Plus, Redo2, ScanLine, Undo2, Upload, X`.
  - LayersPanel.tsx:6-17: `ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, GripVertical, Layers, Lock, LockOpen, MoreHorizontal`.
  - Inspector.tsx:6: `RotateCcw, RotateCw`.
  - Registry: `XIcon, ChevronRightIcon, CheckIcon`.
- **Sizes:**
  - Default 16 px (`[&_svg:not([class*='size-'])]:size-4`, button.tsx:6).
  - `xs` and `icon-xs` buttons 12 px.
  - Rail icons `size-[18px]` (Workspace.tsx:671).
  - Status and inspector-header icons `size-3.5`, 14 px (:775, :833, :838).
  - Empty-sheet `Upload` `size-6` (:722); Layers empty icon `size-5` (LayersPanel.tsx:93).
- **Accessibility:**
  - Decorative icons carry `aria-hidden="true"`.
  - Icon-only buttons are named on the button (`aria-label`, and `aria-keyshortcuts` where a shortcut exists). Tooltips are visual only (R05-A D9; DESIGN-SYSTEM.md:48).
- **Colour:**
  - Active-tool icon in the inspector header is `text-primary` (:775).
  - Idle row icons are `muted-foreground` until toggled (DESIGN-SYSTEM.md:192). Lock on is `text-warning` (LayersPanel.tsx:243).

## 4. Workspace layout at desktop sizes

### 4.1 Grid (Workspace.tsx:576)
- `grid h-full grid-rows-[44px_minmax(0,1fr)_28px] bg-background`. Chrome is 72 px at 768 px high (DESIGN-SYSTEM.md:181; it was 176 px before G-UI-R, and that reduction is a recorded achievement).
- **Middle row, left to right:**
  1. Rail 48 px.
  2. Canvas panel (`minSize={360}`, :682).
  3. Inspector splitter, a 24 px strip.
  4. Side column: `defaultSize` 296 px below 1440 px of viewport width, otherwise 320 px; min 288, max 336 (:118, :767).
- **Side column, vertically:** inspector (`minSize` 160) / 24 px Layers splitter / Layers (`defaultSize "30"`%, min 120, collapsible to its 36 px header, `preserve-pixel-size`) (:769-806).

### 4.2 Canvas space (derived from those numbers; 1366×768 is measured, the rest unconfirmed)
| Viewport | Canvas region (w × h) | Note |
|---|---|---|
| 1366×768 | **998 × 696** | measured: G-UI-R-REPORT.md:450, :112 |
| 1920×1080 | ≈1528 × 1008 | derived |
| 1440×900 | ≈1048 × 828 | derived |
| 1280×720 | ≈912 × 648 | derived |
| 1024×640 | ≈656 × 568 | derived; the layout holds here and at 200 % zoom with no page scroll (FINAL-AUDIT.md:25) |

### 4.3 Top bar today (Workspace.tsx:579-657)
- **Container:** `<header>` (the banner landmark), `grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-panel px-3`.
- **Left cluster** (`flex min-w-0 items-center gap-2.5`):
  1. `BrandMark` and "vectra" (`gap-1.5`, shrink-0).
  2. `Divider`.
  3. `<p data-testid="document-title" class="min-w-0 truncate text-ui">`: "Untitled artwork" | muted "No document", followed by muted " · Edited" when `snap.dirty` (:586-593). `dirty` is state identity against the last saved state (src/document/session.ts:204).
- **Right cluster** (`flex min-w-0 items-center justify-end gap-1.5`):
  1. `role="group" aria-label="History"`: Undo, Redo and Keyboard shortcuts (`IconAction`, `size="icon"`, tooltips below).
  2. `Divider`.
  3. A hidden file input (`data-testid="import-input"`, `sr-only`, `tabIndex=-1`, `aria-hidden`).
  4. **Import:** `outline`, `h-8 border-control-border`, Upload icon. Disabled while busy.
  5. **Export:** default (lime), `h-8 px-3.5 font-semibold`; disabled state `bg-elevated text-muted-foreground opacity-100`. Disabled with no session.
- **Reserved centre:** "§9's view mode returns to the top bar, centred, when a second view exists" (DESIGN-SYSTEM.md:182).
- **Approved placement for open/save:** "top bar: app mark, import, open/save (P1-C), undo/redo, view mode, export" (DESIGN-SYSTEM.md:142). RFC-002.md:876 calls it the "top project and export bar". No layout, order or menu form for open/save has been approved beyond these two lines.

**Candidate slots (observations only, not decisions):**
- **Project name:** the `document-title` slot already shows the name state plus "· Edited". Tests pin its texts: `"Untitled artwork · Edited"` (ui-document.spec.ts:52) and `"No document"` (ui-document.spec.ts:530, :541; workspace-offline.spec.ts:108).
- **Save status:** the same slot, which is quiet when idle. Save and Open outcomes would announce through the footer `status` live region, the established channel.
- **File menu or Open/Save buttons:** a `DropdownMenu` (the only menu primitive on hand) or buttons between History and Import. Space is tight at 1024 px. Measure before choosing.

### 4.4 Status bar (Workspace.tsx:829-977)
`<footer>` (contentinfo), `text-xs text-muted-foreground`. Left to right:
- Activity icon: spinner while busy, `CircleAlert` on error.
- **`status` live region:** `role="status"`, or `role="alert"` on error; `data-testid="status"`; truncated, with the full text in `title`; empty when idle (:841-849).
- `import-refused` (`role=status`, `text-warning`).
- "Cancel import" (`outline xs`).
- Document items, hidden but mounted while there is no document (:872-932): complexity, artboard size, and a Zoom group (−, %, +, fit).
- `canvas-state` live region: empty while the renderer is healthy (:937-951).
- `update-waiting` (:952-956).
- `offline-status` with a dot: "Offline ready" (lime dot), "Offline not ready" (`control-border` dot) or the mismatch warning (:957-976).

There are no toasts, and messages have no timed lifetime. Current message vocabulary is at :338-373, :386-389, :454-462 and :990-1003, for example "Exported {name}.{format} (N KB)", "Export failed: …", "Import failed: …", "Edit rejected: …".

### 4.5 Other announcement regions
- Colour picker `aria-live="polite"` (color-picker.tsx:234).
- dnd-kit reorder announcements (LayersPanel.tsx:103-115).
- Canvas keyboard announcements via `describe()` (Workspace.tsx:433-446).

### 4.6 Keyboard shortcut registry
There is no central registry. It is two hand-kept lists plus attributes:
- **Display list** `SHORTCUTS` (Workspace.tsx:244-255): V, T, R, ⌘Z/Ctrl+Z, ⇧⌘Z/Ctrl+Shift+Z, Esc, Delete, "+ / −", Shift+1, ?. It feeds the Shortcuts dialog.
- **Handler** on `window` keydown (Workspace.tsx:469-495):
  - Skips `defaultPrevented`.
  - Skips targets inside `input, textarea, select, [role=dialog], [role=menu], [role=listbox]` or contenteditable (:150-153). Undo and redo are still allowed from a range input (:155, :472).
  - `mod` is Meta on Mac and Ctrl elsewhere (:146-147, :473). Mod+Z / Shift+Mod+Z and Ctrl+Y (not on Mac) call `preventDefault`.
  - **Every other modifier combination returns early (:482)**, so Mod+S and Mod+O currently fall through to the browser's own Save Page and Open File.
- **On triggers:** `aria-keyshortcuts` uses the `${MOD}+Z` form ("Meta+Z" / "Control+Z", "Shift+?"). Visual labels use ⌘ and ⇧ glyphs on Mac and "Ctrl+" elsewhere (:600-601).
- A new shortcut needs all three places updated (display list, handler, trigger attribute) and the dialog-guard behaviour considered (DESIGN-SYSTEM.md:128).

### 4.7 Dialog structure (Export :1040-1152; Shortcuts :1009-1030)
- **`DialogContent`:** portal with a flat scrim (styles.css:141-146). The popup is centred, `rounded-xl bg-popover p-4 gap-4 text-sm ring-1 ring-foreground/10`, with registry width `sm:max-w-sm`, overridden to **`sm:max-w-md`** (28 rem) in both dialogs. It has a top-right ghost X with sr-only "Close".
- **`DialogHeader`:** `DialogTitle` (the dialog's accessible name: "Export artwork", "Keyboard shortcuts") and `DialogDescription`, one sentence.
  - Export: "Vector paths only, generated on this device by the engine. Nothing is uploaded."
  - Shortcuts: "Shortcuts are ignored while typing in a field, in dialogs and in open menus."
- **Body:**
  - Optional summary chip `rounded-md bg-background px-3 py-2 text-xs text-muted-foreground tabular-nums` (:1063).
  - `<form className="grid gap-4">` with `fieldset`/`legend` radio cards and labelled fields.
  - Labels are `grid gap-1 text-xs text-muted-foreground`; fields `h-8 rounded-md border-control-border bg-background text-sm`. A suffix sits inside the field (".svg").
- **`DialogFooter`:** a full-bleed band (`-mx-4 -mb-4 border-t bg-muted/50 p-4`), `flex-col-reverse` → `sm:flex-row sm:justify-end gap-2`. Secondary first: `<DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>`. Primary second: `<Button type="submit" className="font-semibold"><Download data-icon="inline-start" /> Export SVG</Button>`, disabled while the form is invalid.
- **Behaviour:**
  - Submit closes the dialog first, then runs the export. Outcomes go to the footer status region (:1069-1074, :990-1003).
  - The export dialog mounts only when a session exists (:980).
- **Focus** (Base UI, tested in ui-shell.spec.ts:253-283): initial focus inside the dialog; Tab and Shift+Tab trapped; global shortcuts inert inside it; Escape closes and returns focus to the trigger. Which element takes initial focus is **unconfirmed**.
- **No confirm/alert dialog pattern exists yet.** The TD-UI-006 confirmation (G-PRJ follow-up) has fixed requirements (TECHNICAL-DEBT.md:866-869): it must disclose that the undo and redo history is cleared; "**Cancel is the safe default**"; and the user must get "an opportunity to **save a project copy**" first.

### 4.8 Contracts a redesign must keep, or change deliberately with the tests
- **ui-shell.spec.ts:203-241:**
  - title exactly "Vectra";
  - the banner contains "vectra" and not "Studio";
  - no `View` group and no Artwork/Paths/Compare buttons;
  - the mark `svg[viewBox="0 13 453 343"]` is `aria-hidden`, vertically centred on the word within 1 px and before it, at 1024×640 and 1920×1080;
  - `status` is empty with `role=status`; `canvas-state` is empty; the footer has no "Renderer".
- **ui-shell.spec.ts:253-283:** Shortcuts dialog name, Shift+? opens it, focus trap, Escape returns focus to the "Keyboard shortcuts" button.
- **ui-shell.spec.ts:59-95:** rail names and order Select → Trace → Recolor.
- **Test IDs:** `document-title`, `status`, `import-refused`, `import-input`, `complexity`, `zoom`, `canvas-state`, `offline-status`, `update-waiting`. Button names "Import" and "Export" (exact) and dialog name "Export artwork" (ui-document.spec.ts:43, :423-426).
- **`tests/safari/gui.mjs`** (real Safari, run by the lead): rail names and Tab order, splitter geometry.
- **Behaviour:** Import into an open document adds a layer (Workspace.tsx:545-546). There is no New, Close or return-to-empty path today.

## 5. Impeccable in G-UI-R: what ran, findings, outcomes, report format

### 5.1 Runs
Skill and engine 0.1.30, detector 4.11.0, invoked through the Skill tool (`impeccable`). Every run had telemetry and network features off: `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1 IMPECCABLE_NO_UPDATE_CHECK=1 IMPECCABLE_NO_TASTE=1 IMPECCABLE_NO_SWITCH_SYNC=1`. Not signed in (IMPECCABLE-SETUP.md:3-5).

| Run | Commands | Source |
|---|---|---|
| Refinement (BEFORE `ee72fb3`) | **critique** (dual-agent: A design review with `critique-rubric.md`; B detector plus browser; isolated, in parallel), **audit**, **polish**, then one manual `impeccable detect`. References loaded: `critique.md`, `critique-rubric.md`, `audit.md`, `polish.md`, `craft-floor.md`, `operate.md`, the opening of `typeset.md`. Mode **Operate**. The interview was replaced by the maintainer's words ("Questions skipped: delegated run") | G-UI-R-REPORT.md:21-33 |
| Not run then | layout, typeset `--scope type`, onboard, clarify, adapt, harden, animate, colorize. `.impeccable/critique/` persistence was not written | G-UI-R-REPORT.md:31, :33 |
| Setup (§B) | `impeccable doctor --json` before and after; `impeccable context --target src/shell/Workspace.tsx`. Created root `DESIGN.md` and `PRODUCT.md`. Later `design-compact` preview, then `--write`, which moved the full text to `.impeccable/design-full.md` | IMPECCABLE-SETUP.md:7-14, :28-35, :53-57 |
| Not run in setup | `doctor --fix`, `hooks on/off`, `document`, `init`, `detect`. The design hook stays **uninstalled by maintainer decision**, so a manual detector run is due at the end of UI work (`MANUAL_DETECTOR_REQUIRED`) | IMPECCABLE-SETUP.md:11-14, :43, :49 |
| Final audit (`2303e18`) | **audit** only. `impeccable detect --json workspace.html src/shell src/ui`; live `detect --json --viewport W×H <url>` at 1920×1080, 1366×768 and 1024×640; `detect --json --cdp` on 7 document states × 2 sizes. `audit-storage` was not run. Nothing was fixed in that branch | FINAL-AUDIT.md:5, :18-20 |

### 5.2 Scores
- **Critique (Nielsen, BEFORE): 23/40, "Acceptable"** (G-UI-R-REPORT.md:39-51). Lowest heuristics, at 2: match to the real world, consistency, recognition, flexibility, minimalism, error recovery, help.
- **Audit BEFORE: 14/20, "Good"**: A11y 3, Perf 3, Theming 3, Responsive 2, Integrity 3 (G-UI-R-REPORT.md:74-81).
- **Final audit: 15/20, "Good"**: A11y 3, Perf 3, Theming 3, Responsive 3, Integrity 3. Findings: 0 P0, 0 P1, 2 P2, 6 P3 (FINAL-AUDIT.md:32-40, :53-55).

### 5.3 Final-audit findings and their status at this HEAD
| ID | Finding (FINAL-AUDIT lines refer to `2303e18`) | Status now |
|---|---|---|
| P2-1 | Pressed rail tool icon vanishes on hover (registry `dark:hover:bg-muted/50`) | **Fixed** (`30b2d60`): `dark:hover:bg-primary/90`, Workspace.tsx:183 |
| P2-2 | Inspector splitter 8 px target | Fixed first with a 24 px overlay (`30b2d60`). **The maintainer rejected the overlay**, so both splitters are now 24 px strips of their own (G-UI-R-REPORT.md:443-458; Workspace.tsx:113-114, :762-766, :786-790; cost −23 px canvas width) |
| P3-1 | Multi-line guidance at 11 px | **Open (reported, not fixed)**: `text-2xs` at Inspector.tsx:355 and Workspace.tsx:544, :529 |
| P3-2 | No `main` landmark or `h1` | **Open**: the middle row is a `div` (Workspace.tsx:660); the title is a `<p>` (:586) |
| P3-3 | Plain Tab in WebKit skips native `<button>`s in Layers | **Open, unconfirmed in real Safari**: LayersPanel.tsx:69-81, :207-218 are still native buttons |
| P3-4 | Token literals | **Open**: `text-[11px]` (Workspace.tsx:197), `text-[15px]` (:583), `shadow-black/40` (:720); the scrim is not a DESIGN.md token |
| P3-5 | No fill shown as black | **Fixed**: "None" state (DESIGN-SYSTEM.md:189; G-UI-R-REPORT.md:430) |
| P3-6 | Tab title "Vectra · Studio"; "this colour" in the mixed note | **Fixed**: `<title>Vectra</title>` (workspace.html:12); note "Apply assigns one colour to all unlocked selected paths." (Inspector.tsx:358) |

### 5.4 Changed by G-UI-R (highlights; G-UI-R-REPORT.md §3, §14, §16; DESIGN-SYSTEM.md §13)
Docked panels and hairlines; zoom moved to the status bar; chrome 176 → 72 px; property-sheet inspector; one 28 px field style; the 11/12/13/15 type scale; two-line Layers rows with "Contains selection"; colour picker below its trigger with document swatches; ivory empty-state sheet; flat scrim; status bar restructured and quiet when idle; healthy renderer silent; Layers disclosure that never collapses on its own; palette names shown as "Colour N"; Mixed and None fill states; 24 px splitter strips; `ink-muted` token; tab title "Vectra".

### 5.5 Rejected or reversed by the maintainer (keep separate from "not run")
- Proposal to keep unavailable tools and views dimmed and explained → **hide them** (§14 #1; DESIGN-SYSTEM.md:209).
- "Studio" label next to the wordmark → removed (§14 #6).
- Agent's preset copy ("One ink on paper"…) → replaced with the maintainer's copy; "Selection inside" → "Contains selection" (§14 #7).
- Palette names as inks ("Ink 1") or sorted by lightness → "Colour N", no "ink" wording, no sorting (§14 #4; DESIGN.md:74).
- Side column collapse below 720 px of height → never auto-collapse (§14 #5).
- Idle "Ready" and healthy renderer text → removed (§14 #3, #9).
- 24 px splitter overlay over the canvas → own strips (§16).
- Out of scope, not rejected: W/H fields, canvas colour preview, fill relink, message lifetime (§11, §14 #11).

### 5.6 Report formats to reuse
- **Audit record** (FINAL-AUDIT.md):
  1. Header: date, target build or commit, branch, the exact command, flags off, nothing fixed.
  2. "Context the loader resolved".
  3. Environment, with load averages and a note that the machine is shared.
  4. **Evidence** table (Evidence | Method | Result).
  5. **Audit health score** table (# | Dimension | Score 0–4 | Key finding), with total and band.
  6. Implementation integrity verdict, with detector findings verified in context (real / false positive / accepted advisory).
  7. Executive summary: counts by severity and top issues.
  8. **Findings by severity**, each with Location (`file:line`), Category, Cause or Impact, Standard (WCAG ref), Recommendation and Suggested command (`$impeccable polish|adapt|typeset|harden|document|clarify`).
  9. Patterns and systemic issues; Positive findings; Recommended actions; **Not run**; where raw outputs are kept (gitignored `tests/output/...`).
- **Gate report** (G-UI-R-REPORT.md):
  1. Status and scope header, then a brief-item → result table.
  2. §1 Impeccable passes (Pass | How it ran | Output; interview substitution).
  3. §2 BEFORE findings: heuristic table, priority issues with what the gate did, persona red flags, detector, cognitive load, audit table.
  4. §3 changes by priority; §4 files.
  5. §5 before/after evidence: states `01-empty … 08-export-dialog`; sizes 1920×1080, 1440×900, 1366×768, plus 1280×720 and 1024×640; committed pairs `<state>-before.png` / `<state>-after.png` at 1366×768, palette-quantised; the full set gitignored; a reproduce command.
  6. §6 accessibility (contrast from the running build); §7 CSP; §8 bundle; §9 tests (command | result | load average; earlier runs "for honesty"; NOT RUN).
  7. §10 deviations; §11 requests; §12 open questions for the maintainer.
  8. Then appended sections of maintainer decisions (Decision | Change | Covered by).
- **Setup record** (IMPECCABLE-SETUP.md): commands run and not run; doctor findings (Finding | Severity | Summary/Disposition); diagnosis; what changed and why; side effects checked (`git status` of `.claude/`, nothing new in `~/.impeccable`).

## 6. Landing page, workspace and PWA

- **Pages.** Two Vite inputs: `index: "index.html", workspace: "workspace.html"` (vite.config.ts:137-138), `base: "./"` (:131). Both HTML files feed the build ID (vite.config.ts:67-68).
  - `/` → `index.html` → `src/main.tsx` → `App` (P0 workbench, light, `index.css`).
  - `/workspace.html` → `src/shell/main.tsx` → `<CSPProvider disableStyleElements><Workspace/></CSPProvider>` with `../ui/styles.css` (src/shell/main.tsx:1-34). `?csp=default` is a test-only diagnostic (:16-20). `?debug=1` and `?renderer=main` are query flags (Workspace.tsx:120-121).
  - The two pages share the favicon, apple-touch-icon and manifest links (index.html:5-8; workspace.html:4-8). Neither page links to the other (unconfirmed for App.tsx beyond its notices link, App.tsx:76).
- **No client-side routing:** "The app has no client-side routes; unknown paths return 404 instead of index.html" (wrangler.jsonc:10). `not_found_handling: "none"`, `html_handling: "auto-trailing-slash"` (:12-13). Cloudflare's resolution of `/workspace` under that setting is unconfirmed.
- **Service worker:** a navigation to the scope root is served the precached `./index.html`. Other precached `.html` files are served as their own shells (scripts/generate-sw.mjs:98, :191). If a shell is missing, the static recovery page (no script, no inline style) shows the canonical symbol (:140-163).
- **Manifest** (public/manifest.webmanifest:1-19):
  - `"name": "Vectra"`, `"short_name": "Vectra"`;
  - `"start_url": "./workspace.html"`, `"scope": "./"`, `"display": "standalone"`;
  - `"background_color": "#191a1c"`, `"theme_color": "#191a1c"`;
  - icons `icon-192.png` (192×192), `icon-512.png` (512×512), `icon-maskable-512.png` (512×512, `purpose: maskable`).
  - Approved as early installability, not the P3 PWA deliverable (DESIGN-SYSTEM.md:216; BRAND.md:133; ROADMAP.md:29).
- **CSP** (public/_headers:4):
  - `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
  - React `style` props are allowed (CSSOM); inline `<style>` is not (G-UI-R-REPORT.md:180).
- **Implications for a new home page (unconfirmed, for the design brief):**
  - A third HTML entry changes the build inputs, the build-ID list, the precache and `check-dist`.
  - A home state inside `workspace.html` keeps `start_url` and the offline shell unchanged.
  - Either way, `/` is still the engineering workbench unless the maintainer decides otherwise.

## 7. Scope conflict for G-PRJ (quote both; maintainer to resolve)

- **ROADMAP.md:31-37** (maintainer, 2026-11-26), also G0-DECISION-REGISTER.md:385-399: scope includes "Save, Save As and Open for portable `.vectra` projects", "unsaved-change tracking", "**local autosave and crash recovery**", "**recent projects**", "browser storage quotas and eviction handling", "safe, atomic file writes where the platform supports them", "a download/upload fallback".
- **RFC-002.md:815:** "**Excluded from P1:** autosave, persistent undo history, project libraries, recent-file databases, automatic OPFS or IndexedDB artwork persistence, cloud storage."
- **RFC-002.md:797:** "Saving never overwrites the original file automatically; each save is a new download."
- **RFC-002.md:40** (D08) and **PRD-002-VECTOR-STUDIO.md:43** (VS-12): "no autosave".
- **G0-P1-IMPLEMENTATION-PLAN.md:335, :345:** "Excludes: autosave, libraries, recent files, OPFS/IndexedDB, cloud." It lists "Stop if: any automatic persistence of artwork."
- **ROADMAP.md:68:** "Scope changes require RFC update." A project home with a recent-projects list, an autosave indicator or a Save As that overwrites in place depends on an RFC-002 §14 amendment that has not been made.
- **Related fixed requirements** (ROADMAP.md:57-58): "every successfully saved project must be reopenable" and "users must never get a successful-save indication for an invalid or unreopenable project".
- **Persistence limit to show honestly:** the 64 MiB document-section cap (ROADMAP.md:48).
- **History on reopen:** "History is not persisted, and the user is told so on reopen." (RFC-002.md:796).

## 8. Unconfirmed or not measured in this survey
- Every rendered pixel value: no build, no browser.
- Which element takes initial focus in a dialog.
- That the `animate-in`, `fade-in-0` and `zoom-in-95` classes are inert (inferred).
- Bare `rounded` = 4 px.
- Canvas sizes other than 1366×768.
- Cloudflare's `/workspace` resolution.
- Real-Safari plain-Tab behaviour (P3-3).
- How top-bar space divides at 1024 px once project controls are added.
