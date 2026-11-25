# G-UI-R — Design refinement of the integrated workspace

**Status:** ready for review, 2026-11-25. Branch `gate/g-ui-r`, stacked on `gate/g-r1-interactive` at `ee72fb3`. Not pushed, no PR (the lead opens it), nothing merged or deployed.
**Scope:** visual and UX changes to `workspace.html` (via `src/shell/**` and `src/ui/**`) only. No document, renderer, hit-test, job or canvas-host code changed. The charcoal, lime and ivory identity is kept; the §4 palette is unchanged; one token was added (`ink-muted`).

| Brief item | Result |
|---|---|
| Impeccable invoked explicitly; critique, audit, polish | **Done**: dual-agent critique, technical audit, polish (§1) |
| BEFORE screenshots at `ee72fb3`, production build, 3 sizes × 8 states | **Done**: 24 PNGs (§5) |
| Comprehensive refinement across the 10 priorities | **Done** (§3) |
| Inspector Fill section clipped at 1366×768 | **Fixed**, and asserted in a test at 1366×768 and 1280×720 (§3.1) |
| Control discoverability at smaller sizes | Checked at 1280×720 and 1024×640 (§3.4) |
| AFTER screenshots, same states and sizes | **Done**: 24 PNGs + 16 at the two smaller sizes (§5) |
| Strict CSP | **Unchanged**; CSP tests pass (§7) |
| Accessibility not regressed | Contrast measured from the running build, all pass; focus, keyboard, reduced motion and target sizes checked (§6) |
| Bundle budgets | **Pass**: 114.5 / 9.1 / 230.1 KiB against 150 / 15 / 250 (§8) |
| Tests | See §9 |
| VoiceOver, real Safari | **NOT RUN** (the lead's) |

## 1. Impeccable passes
The skill was invoked through the Skill tool (`impeccable`). Its context loader reported: no `PRODUCT.md`; `docs/DESIGN.md` (superseded) mapped to `DESIGN-SYSTEM.md` and RFC-002; the incumbent implementation is the design authority for a refinement; narrow refinement allowed without `init`. The design hook is not installed for this project; it was not changed (configuration is out of scope), so the detector was run manually, as the skill requires.

**Interview substitution.** This ran as a delegated sub-agent with no channel to the maintainer. The maintainer's binding words and the gate brief stood in for Impeccable's interview and its closing questions ("Questions skipped: delegated run"); the questions are in §12 instead. Mode: **Operate** (an editor).

| Pass | How it ran | Output |
|---|---|---|
| **Critique** | `Method: dual-agent (A: afcb487b0fef56288 · B: a6e35d786e95c98c3)`. A (design review, rubric `critique-rubric.md`) and B (detector + browser) ran as isolated sub-agents in parallel against the BEFORE build and screenshots; neither saw the other's output | §2 |
| **Audit** | In this context, after the critique, against the BEFORE build (code + detector + the 24 screenshots) | §2.4 |
| **Polish** | The implementation (§3), then one manual detector run on the changed files and the live page, as the skill's context directive asks (§2.5) | §3 |
| Persistence | Not written: `.impeccable/critique/` is outside this gate's file ownership | — |

**Passes that ran:** critique, audit and polish, with the references they load (`critique.md`, `critique-rubric.md` in Assessment A, `audit.md`, `polish.md`, `craft-floor.md`, `operate.md`, and the opening of `typeset.md`). The other Impeccable commands (layout, typeset with its `--scope type` scan, onboard, clarify, adapt, harden, animate, colorize) were **not** invoked as separate passes; the polish pass covered hierarchy, type roles, empty states, copy and small sizes under `polish.md`'s checklist. No motion was added (the existing transitions and reduced-motion rule are kept).

## 2. Findings (BEFORE, `ee72fb3`)
### 2.1 Critique — design health (Assessment A)
**Design specificity: partly authored.** The identity is held with discipline (lime only for state; the ivory artboard is the brightest thing on screen), but the structure and controls were stock shadcn: floating rounded panels, grey-filled inputs, a dashboard-like layout. The print-studio language did not reach the UI.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Trace progress and cancel are excellent; the selection is not reflected in Layers or the status bar |
| 2 | Match system / real world | 2 | Jargon in the status bar ("Renderer: worker · ready", static "RGB · Vector document"), "Scale value" |
| 3 | User control and freedom | 3 | Undo, Escape, Cancel everywhere; a fill cannot be relinked to the palette |
| 4 | Consistency and standards | 2 | Numeric fields 14 px sans on grey, colour fields 12 px mono on dark; mixed field styles in the export dialog; black empty canvas vs grey surround |
| 5 | Error prevention | 3 | Clamps, refused concurrent imports, locks; the mixed-fill warning is the clipped part at 1366×768 |
| 6 | Recognition rather than recall | 2 | Icon-only zoom, rotate, move up/down with no visible tooltip; preset only inside the Trace tool |
| 7 | Flexibility and efficiency | 2 | No W/H fields; few shortcuts beyond V/T/R |
| 8 | Aesthetic and minimalist design | 2 | 3 of 6 tools and 2 of 3 views dead but styled live; scale shown three times; "No document" six ways |
| 9 | Error recovery | 2 | Errors are small red text far from their source |
| 10 | Help and documentation | 2 | Shortcuts dialog only; disabled views explained by a native `title` |
| | **Total** | **23/40** | **Acceptable** |

**Priority issues (A), and what G-UI-R did:**

| Sev. | Issue | G-UI-R |
|---|---|---|
| P1 | The inspector/Layers split hides Fill at 1366×768 and below (Fill cut at the split; Recolor caption cut mid-sentence; Layers spend ~200 px on one row) | Fixed (§3.1) |
| P1 | Transform has no hierarchy; numeric controls inconsistent (scale ×3, 28 vs 32 px controls, 14 px values) | Fixed, except W/H fields (engineering, §11) |
| P1 | Colour picker covers the artwork, has no document swatches, no in-context preview | Placement and swatches fixed; canvas preview requested (§11) |
| P2 | Dead controls and stacked chrome cost canvas space (176 px of chrome at 768 px) | Chrome now 72 px; dead controls dimmed and explained, kept in place (§10) |
| P2 | Layers do not say where the selected path lives; names truncate even at 1920 | Fixed (§3.2) |
| P2 | The status bar shows engineering data, wraps and clips at 1024 | Restructured, truncates (§3.10) |

**Persona red flags (A), condensed.** *Alex (power user):* no W/H, few shortcuts, 14 Tab stops before the canvas (5 dead). *Sam (accessibility):* 5 `aria-disabled` stops; icon-only buttons without tooltips; errors far from source; 24 px layer icons with no margin. *Jordan (first-timer):* preset applied silently, dead views look clickable, "p0–p7" and "29239 anchors". *Print/merch artist (PRD-002):* no physical size in Transform.

### 2.2 Detector (Assessment B), BEFORE
`impeccable detect` 4.11.0, telemetry off. Files (`workspace.html`, `src/shell`, `src/ui`, 25 files): 0 findings (pattern rules only). Live page at 1366×768, 1440×900 and 1920×1080 (empty state only; a URL scan cannot load a document): 3 findings, identical at all sizes — `nested-cards` (the dashed drop card inside the canvas panel; judged a false positive), `straggler` (a one-word last line in the Layers empty text; real, trivial), `flat-type-hierarchy` (11–14 px roles; normal for a dense editor). Overlay injection skipped: the strict CSP blocks off-origin scripts and no project edits were allowed.

### 2.3 Cognitive load (A)
Failures: chunking (Transform held 9 controls in one block), minimal choices (6 targets in a 324 px layer row; 3 dead rail tools), working memory (the Fill note says "palette colour p4", but the palette list was ordered p5, p6, p7, p4…).

### 2.4 Audit (technical), BEFORE

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | Tokens pass AA; dual ring; named controls. But the canvas's own inset focus outline is painted under its layers in Chromium (not visible in screenshots); icon-only controls without tooltips; disabled views explained by `title` |
| 2 | Performance | 3 | A full-viewport `backdrop-filter` blur over the live canvas behind every dialog |
| 3 | Theming | 3 | Tokens used; registry defaults leak (`md:text-sm` makes fields 14 px; `dark:bg-input/30` grey fills; `rounded-lg` beside owned `rounded-md`); `text-[11px]` literals |
| 4 | Responsive (desktop sizes) | 2 | Fill clipped at 1366×768; status items wrap and clip at 1024; layer names truncate at every size; empty canvas black |
| 5 | Implementation integrity | 3 | Coherent system, drift from registry defaults; detector: 1 warning, 2 advisories |
| | **Total** | **14/20** | **Good** |

P1: Fill clipped (responsive); canvas focus ring not visible (accessibility). P2: field-style drift; status-bar overflow; backdrop blur. P3: `text-[11px]` literals; straggler.

### 2.5 Detector after polish
One manual run, as directed. Changed files: 0 findings. Live page, 1366×768: 1 `nested-cards` warning on the empty-state sheet's dashed inset (the drop guide inside the paper sheet). It is intentional — a print-margin guide, not a container — and was squared off (no radius) to read as a guide; the run was not repeated.

## 3. What changed, by priority
### 3.1 Transform inspector hierarchy (and the clipped Fill)
- The inspector is a **property sheet**: sections (11 px uppercase titles, optional right-aligned meta) of rows with a fixed 3.25 rem label column: **Position** (X, Y), **Size** (read-only), **Scale** (value + Reset, slider beneath), **Rotate** (two buttons with tooltips).
- The selection header is the object name at 15 px and a meta line ("Layer · 1,613 paths", "Path", "Mixed selection · N paths").
- Removed: the duplicate scale readout, the "Scale value" caption, the misaligned 28/32 px control mix.
- **Fill clip fixed** by the compaction plus Layers defaulting to 30 % of the column (was 40 %). New test `small laptops: the inspector shows Fill without scrolling` asserts that the Fill trigger and its note end inside the inspector viewport with a layer and with a path selected: space left below Fill (layer / path selected) is 73 / 89 px at 1366×768 and 39 / 55 px at 1280×720, identical in Chromium, Firefox and WebKit.
- Fill's section meta reads "Mixed · 1,613 paths" when the fills differ (the trigger's accessible name keeps its `Fill colour: #rrggbb.` format).

### 3.2 Layers and object hierarchy
- Two-line rows: the name (13 px), then a meta line (count, "Hidden", "Group"). At 1366×768 the name box is **136 px** (measured in the AFTER build) against about **83 px** BEFORE (read from the BEFORE screenshot), +64 %.
- A row that contains the selected path is tinted and reads **"Selection inside"**: the selection now has a place in Layers (text, not colour alone).
- Eye, lock and menu are `muted-foreground` until toggled (hidden: foreground eye-off; locked: warning lock). The full name is the row's `title`.
- Header: title, layer count, Move up/down with tooltips. Empty state with an icon and wrapped text.

### 3.3 Compact, consistent numerical controls
One field style everywhere (numeric, colour trigger, hex, export inputs): 28 px, `background` well, `control-border` outline (3.7:1 on panel), 12 px tabular figures, the label inside the field (X, Y, Hex) and the unit at the right. Registry defaults are overridden at the call sites (no registry patch).

### 3.4 Small-laptop usability
- Chrome at 768 px high: **72 px** (was 176: top bar 48 + gutters 16 + view strip 44 + canvas footer 40 + status 28).
- The side column starts at 296 px under 1440 px wide (320 above).
- Status items never wrap: fixed items, the message truncates with its full text as a `title`.
- Checked at 1280×720 and 1024×640 (AFTER set): every rail tool, the view switch, history, Import, Export, all Transform rows and the Fill trigger are visible without scrolling at both. At 1024×640 the Fill note is partly below the fold; the new lower-edge fade signals more content.

### 3.5 Canvas prominence
Docked panels (no gutters, no floating cards), the view switch moved to the top bar and zoom/fit/artboard size to the status bar (DESIGN-SYSTEM §9 placement). Canvas region at 1366×768: **1021×696 px** (measured in the AFTER build: top bar 44, status bar 28) against 958×592 px BEFORE (read from the BEFORE screenshot): +25 % area. At 1920×1080 the artboard renders at 223 % zoom (was 199 %).

### 3.6 Typography
A fixed role scale on the system stack: 11 px meta and section titles, 12 px controls and values, 13 px body, panel titles and layer names, 15 px selection name. Numbers use tabular figures and thousands separators (1,613 paths · 29,239 anchors). Detector's `flat-type-hierarchy` and `straggler` advisories no longer fire.

### 3.7 Colour picker
- Opens **below** its trigger, over the inspector column, so it no longer covers the artwork or the selection (BEFORE it opened left, over the selected path).
- **Document colours**: the palette as 24 px swatches (a `control-border` ring, 3.34:1 on the popover) that set the draft; nothing else changes.
- Compacted (fits below the Fill trigger at 1366×768); Hex label inside the field; current/new chips; Cancel and Apply as equal halves.
- Unchanged: D3–D6 (named thumbs, hex draft, 2-D keyboard area, one commit on Apply, none on Cancel/Escape).

### 3.8 Empty states
- **Canvas:** the charcoal surround with a blank **ivory sheet** (the artboard to come) as the drop target, a dashed print-margin guide, "Drop an image to start", the preset named and **Change preset** (opens the Trace tool), lime Choose image with an ink outline (lime on paper alone is 1.15:1; the outline is 14.24:1). BEFORE it was a black void with a dark card.
- **Inspector:** "Nothing to inspect yet" plus one sentence; **Document** state titled with "Nothing selected", Artboard section (size, background, colour mode RGB — moved from the status bar — layers, palette).
- **Layers:** icon and one sentence. **Recolor:** "Palette · 8 colours in this document", rows that show the colour name and value in one full-width trigger.
- **Trace:** presets as option rows with one-line descriptions ("One ink on paper", "Every colour region", "A small palette of inks", attached with `aria-describedby`, so the radio names are unchanged).

### 3.9 Reduced modal backdrop blur
A flat 60 % scrim with **no blur** (owned rule; the registry dialog is not patched). The artwork stays legible behind the export dialog. The export dialog adds a summary ("640 × 430 px artboard · 1,613 paths"), SVG/PDF format cards, the extension inside the file-name field and matching field styles.

### 3.10 Status-bar clarity
Left: an activity icon (spinner while importing, alert on error), the message (truncated, full text in `title`), the refused-import notice and Cancel import. Right, separated by hairlines: complexity, artboard size, zoom (−, %, +, fit, with tooltips), renderer state, update notice, offline state with a dot. Static "RGB · Vector document" removed (now in the Document inspector). With no document the document items (complexity, artboard size, zoom) are **hidden but stay mounted**, with their former texts ("No artwork", "—"), so the `complexity` and `zoom` test IDs are always in the page (measured: present, not visible). The `status`, `canvas-state`, `offline-status`, `update-waiting` and `import-refused` test IDs and texts are unchanged. The trace-complete message groups its numbers ("80 paths, 2,107 anchors").

### 3.11 Also
- Top bar: wordmark, Studio, a hairline, the document title; the centred view switch; history; Import (outline) and Export (lime). A disabled Export is grey, not 50 % lime.
- Tool rail: 48 px, flat icons, groups separated by dividers (selection and tracing · path refinement · colour). Order unchanged.
- **Canvas focus made visible**: the canvas frame draws the dual ring above the canvas layers while the canvas has keyboard focus (BEFORE it was invisible in Chromium, see §2.4).
- Scroll thumbs use `control-border`; panels fade at their lower edge while more content is below; text selection and caret in lime.

## 4. Files
- `src/shell/Workspace.tsx` (layout, top bar, rail, empty canvas, status bar, export and shortcuts dialogs), `src/shell/Inspector.tsx`, `src/shell/LayersPanel.tsx`.
- `src/ui/styles.css` (type tokens, `ink-muted`, owned rules), `src/ui/numeric-field.tsx`, `src/ui/color-picker.tsx`, new `src/ui/tip.tsx` (a visual tooltip helper).
- No registry file changed; `PROVENANCE.json` unchanged.
- Tests: `tests/browser/ui-refinement-screenshots.spec.ts` (new, opt-in), `ui-document.spec.ts` (+1 test; one regex widened for grouped numbers), `ui-shell.spec.ts` (+2 contrast rows).
- Docs: `docs/DESIGN-SYSTEM.md` §13, this report, `docs/research/g-ui-r/screenshots/`.

## 5. Before/after evidence
**Committed (representative, 1366×768, 6 pairs, palette-quantised PNG, 1,437,254 bytes total):** `docs/research/g-ui-r/screenshots/<state>-before.png` and `<state>-after.png` for `01-empty`, `03-layer-selected` (Fill clip), `05-colour-picker`, `06-recolor`, `07-canvas-keyboard`, `08-export-dialog`. Quantisation: 48–160 colours (ffmpeg `palettegen`/`paletteuse`), the picker with dithering; full-fidelity originals below.

**Full set (gitignored, this worktree):** `tests/output/g-ui-r/before/` and `tests/output/g-ui-r/after/`, named `<state>-<W>x<H>.png`:
- states: `01-empty`, `02-imported`, `03-layer-selected` (handles visible), `04-path-selected`, `05-colour-picker`, `06-recolor`, `07-canvas-keyboard` (Tab from the rail, then Down, Right: the dashed cursor), `08-export-dialog`;
- sizes: 1920x1080, 1440x900, 1366x768 (both sets); 1280x720 and 1024x640 (after only: the discoverability check).
- Extra after-only views: `tests/output/g-ui-r/extra/` (Trace tool, shortcuts dialog, PDF export).

Reproduce: `pnpm run build`; `pnpm exec vp preview --host 127.0.0.1 --port 4191 --strictPort`; `PW_BASE_URL=http://127.0.0.1:4191 UI_R_SHOTS=after UI_R_EXTRA=1 pnpm exec playwright test tests/browser/ui-refinement-screenshots.spec.ts --project=chromium`. BEFORE was captured the same way at `ee72fb3` (with the spec file added, no app change) on port 4190.

| State | Before | After |
|---|---|---|
| Empty | Black canvas, dark dashed card; "No document" in 6 places | Charcoal surround, ivory sheet drop target, preset named with Change preset; quiet panels |
| Layer selected | Fill trigger cut at the split, note hidden; 3 scale controls | Property sheet; Fill and its note fully visible with 73 px to spare |
| Path selected | Same clip; layer row unchanged | Layer row reads "Selection inside" |
| Colour picker | Opens left, over the selected path | Opens below the trigger over the column; document swatches |
| Recolor | List cut at p1, caption cut mid-sentence | All 8 colours and the caption visible |
| Canvas keyboard | Dashed cursor only; no visible focus ring | Dual focus frame around the canvas plus the cursor |
| Export | Blurred artwork, plain radios | Legible artwork under a flat scrim; summary, format cards, extension |

## 6. Accessibility
**Contrast, measured from the running build** (`ui-shell` tokens test, Chromium, `tests/output/ui/contrast.json`): every pair passes. Text on surfaces: foreground 11.22–15.03, muted-foreground 5.65–7.56, primary 9.22–12.35, destructive 5.90–7.89, warning 7.75–10.38. Control boundaries: control-border 3.02–4.05. primary-foreground on primary 11.11. **New rows:** background (ink) on paper **14.24**, ink-muted on paper **5.64**. Decorative border 1.31–1.76 (dividers only). Computed control boundaries in the running build (`ui-document`, identical in all 3 engines): input border vs panel 3.7, slider track vs panel 3.7, resize grip vs background 4.05; the OS colour scheme changes nothing.

Derived colours introduced here (computed from the tokens, not measured in the build): the Choose image button's ink outline on paper 14.24 (the `background on paper` row above); status text `foreground/85` on panel 10.23; swatch ring (control-border) on the popover 3.34; field outline vs its well 4.05; view switch idle text 7.56, pressed 12.40. Disabled controls (unavailable tools at 40 %, unavailable views at 60 %) are exempt as disabled, and are also named "…, not available yet".

**Focus.** The dual ring is unchanged (`ui-shell`: `solid 2px rgb(185, 232, 123)`, offset 2 px, inner `rgb(25, 26, 28)` shadow). The canvas's ring is now visible (§3.11); `workspace-a11y` still reads `solid 2px` on the canvas itself.
**Keyboard.** Tab order kept; the view switch moved before the rail, so Tab from Select reaches the canvas in 6 stops (measured in the AFTER build; 9 BEFORE, counted from the `ee72fb3` DOM order); the zoom buttons moved after the side column (canvas → inspector is shorter). Rail order and names unchanged (the shell and Safari suites check them). Global-shortcut guard unchanged.
**Names and roles.** All accessible names, roles and test IDs the suites use are unchanged; radio names unchanged (descriptions via `aria-describedby`); one new group ("Document colours") with named swatches (`Use p5, #d3d0bc`, `aria-pressed` for the current draft); the zoom buttons are in a "Zoom" group.
**Reduced motion.** The global rule is unchanged; the activity spinner stops under it (`ui-shell` reduced-motion test passes in 3 engines).
**Target size.** New targets are ≥ 24 px (swatches 24, zoom buttons 24, layer icons 24 as before, fields and Reset 28, rotate 28, rail 36).

## 7. CSP
`public/_headers` unchanged; no inline `<style>`, no remote assets or fonts. New dynamic styles are React style properties (CSSOM), as before. The owned rules (scrim, scroll fade, canvas focus frame, selection, caret) are in the bundled stylesheet. `ui-shell` CSP tests (header equality, zero inline `<style>`, negative and positive controls) pass in 3 engines; every test drains CSP violations (0) and blocks off-host requests (0).

## 8. Bundle (`node docs/research/g-ui/measure-bundle.mjs`, gzip -9 KiB)

| | Before (`ee72fb3`) | After | Budget |
|---|---|---|---|
| Additional design-system JS | 113.8 | 114.5 | ≤ 150 |
| Workspace initial CSS | 8.2 | 9.1 | ≤ 15 |
| Total initial workspace JS | 227.8 | 230.1 | ≤ 250 |
| Shell JS | 13.5 | 15.0 | — |
| Baseline (minimal React) | 66.2 | 66.2 | — |

The brief quoted 220.9 KiB for the initial JS; the measurement at `ee72fb3` is 227.8 (G-R1's additions), and that is the figure compared here. Raw: `tests/output/g-ui-r/bundle-before.json`, `bundle-after.json`.

## 9. Tests
All on the final build of `4522ce9` (source; the docs commit on top changes no built file) (`pnpm run build`: 55 notices verified, dist check passed), served by `pnpm exec vp preview --host 127.0.0.1 --port 4191 --strictPort`. Playwright 1.65.1: Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2. macOS (Darwin 25.6.0, arm64), Node 24.22.1, pnpm 12.23.0. The machine is shared and was not quiet (other projects' dev and preview servers running; none touched).

| Command | Result | Load average (1/5/15 min) |
|---|---|---|
| `pnpm exec vp test` | **24 files, 377 tests passed** | 1.87 / 2.12 / 2.02 |
| `PW_BASE_URL=http://127.0.0.1:4191 pnpm exec playwright test tests/browser/ui-shell.spec.ts tests/browser/ui-document.spec.ts tests/browser/workspace-a11y.spec.ts tests/browser/workspace-integration.spec.ts tests/browser/drag-correctness.spec.ts` (3 engines) | **156 passed** (52 × 3), 0 failed, 0 flaky, 2.1 min; in the `ui-*` specs 0 CSP violations, 0 off-host requests and 0 console errors (their guard fails a test otherwise; the engineering specs do not carry that guard) | 1.87 / 2.12 / 2.02 before, 3.28 / 2.65 / 2.25 after |
| Extra: `PW_BASE_URL=… pnpm exec playwright test tests/browser/workspace-offline.spec.ts tests/browser/workspace-lifecycle.spec.ts` (3 engines; they assert status texts this gate restyled) | **21 passed** (7 × 3), 23.5 s | 3.28 / 2.65 / 2.25 before, 3.26 / 2.69 / 2.27 after |
| `pnpm exec vp check src/shell src/ui workspace.html tests/browser/ui-shell.spec.ts tests/browser/ui-document.spec.ts tests/browser/ui-refinement-screenshots.spec.ts` | formatted; no lint or type errors | — |
| `UI_R_SHOTS=after UI_R_EXTRA=1 … ui-refinement-screenshots.spec.ts --project=chromium` | 5 passed (40 PNGs) | — |

The new test (`small laptops: the inspector shows Fill without scrolling`) passes in all three engines.

**Earlier runs (not the evidence, recorded for honesty):**
- Chromium-only runs of the five specs during the work: 52/52.
- Full 3-engine runs on two earlier builds (an earlier amend of `fdb1529`, then `fdb1529`; later changes: the swatch ring colour, then the always-mounted status IDs, the ink outline and grouped status numbers): 156/156 each.
- One 3-engine attempt against the long-running preview server on port 4190 (started at 13:30 for the BEFORE capture) failed for environmental reasons: every Firefox test failed at `page.goto` ("Navigation … is interrupted by another navigation to …") and WebKit timed out at `page.goto`. The same failure reproduced for `/sw.js` and `/index.html` from that server instance, and not for a fresh `vp preview` of the same `dist/` (port 4191) nor for a plain static page. The run was stopped, the 4190 server (this worktree's own) was stopped, and all runs above use 4191. Root cause not established.

**NOT RUN (lead-owned or out of scope):** VoiceOver; real Safari and `tests/safari/gui.mjs` (its rail names and Tab order are unchanged by design); the other browser specs (benchmarks, P0 workbench, SW update suites); lower-end hardware; Windows and Linux; touch input. Aria snapshots were not regenerated.

## 10. Deviations
- **Paper as a UI surface** for the empty-state sheet (display only, never exported). DESIGN-SYSTEM §13.
- **Unavailable controls kept in place**, dimmed and explained, because `tests/safari/gui.mjs` (lead-owned) and `ui-shell` check the six rail names and the Tab order Select → Trace → Smooth. Removing them is §12 Q1.
- **Copy changes:** Paths/Compare "available with the production renderer" → "not available yet"; the empty state "Import an image to start" → "Drop an image to start" with a longer explanation; the Fill note reworded ("To edit a palette colour everywhere, use Recolor (R)"); the Trace section "Trace preset" → "Preset" (the radiogroup keeps its "Trace preset" name); preset descriptions added. No product claims added beyond the existing "traced on this device" and "Nothing is uploaded".
- **The capture spec** is opt-in (`UI_R_SHOTS`), Chromium only, like the G-UI screenshot spec.
- **Test port.** The brief's Playwright command uses the configured web server (port 4173, likely in use by the lead); the runs here use `PW_BASE_URL` against this worktree's own `vp preview` of the same `dist/`.

## 11. Requests (not done here: engineering or lead-owned)
**`src/canvas-host`:**
1. **Focus ring painted under the canvas layers.** In Chromium the canvas's `outline-offset: -2px` ring is covered by its own absolutely positioned layers, so keyboard focus on the canvas was not visible. G-UI-R draws the ring on the shell's frame (`.vx-canvas-frame:has(> .vectra-canvas:focus-visible)::after`); a canvas-host fix (paint the ring in the overlay, or give the layers a stacking order below it) would make the shell rule unnecessary.
2. **Empty canvas paints black.** With no document, the canvas fills black instead of the `canvas-surround` colour it is given. The shell's empty state now covers it with the surround; a canvas-host fix would remove the dependency.
3. **Transient colour preview.** The picker cannot preview the draft on the artwork. A canvas-side transient fill override (dropped on Cancel/Escape, no history entry) would let colour be judged in context (Assessment A P1).

**Engineering (other owners):**
4. **W/H fields in px, mm or in** (non-uniform or aspect-locked scale, physical units): the core transform for print work; Size is read-only today.
5. **Relink a fill to a palette colour** (a command): the swatches only set the value today.
6. **Status-message lifetime** (return to idle after success; errors persist until dismissed): a behaviour change the suites would need to agree to.

## 12. Open design questions for the maintainer
1. Remove the three unavailable tools and two unavailable views until they ship (needs `ui-shell` and the Safari script updated), or keep them dimmed as now?
2. Is the ivory sheet acceptable as the empty-state surface, or should `paper` stay strictly the artwork?
3. Should the renderer state leave the status bar when healthy (show it only on fallback or error)? `workspace-offline` asserts its text today.
4. Palette names `p0`–`p7` come from the engine; should the UI present them as inks ("Ink 1") or sort them by lightness?
5. Should the side column collapse (Layers to a header) below 720 px of height?
6. Keep the "Studio" label next to the wordmark?
7. **Copy needing approval:** the preset descriptions ("One ink on paper", "Every colour region", "A small palette of inks"), the empty-state text ("Drop an image to start … becomes the first layer; nothing is uploaded"), "Nothing to inspect yet", "Selection inside", and the reworded Fill note.
