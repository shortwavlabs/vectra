# G-UI-R — Design refinement of the integrated workspace

**Status:** ready for maintainer review, 2026-11-25. Branch `gate/g-ui-r` (PR #20), stacked on G-R1 (#19). It took #19's corrected head by merge commits: §13 covers the first merge, §14 the maintainer-review corrections, and §15 the merged head, the final audit and the verification. Nothing is merged or deployed.
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
| VoiceOver | **NOT RUN**: owner checklist (`docs/research/g-r1/VOICEOVER-CHECKLIST.md`, E1/E2 updated for this layout) |
| Real Safari | `tests/safari/gui.mjs` on the merged head (§13) |

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
- **Canvas focus made visible**: the canvas frame draws the dual ring above the canvas layers while the canvas has keyboard focus (BEFORE it was invisible in Chromium, see §2.4). *Superseded: the canvas host now draws its own ring above its layers (#19, `d9b5208`), and this shell workaround was removed when #19's corrected head was merged (§15).*.
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
This section is the pre-merge record, at `4522ce9`. The results on the merged head are in §13.

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
The maintainer's review changed some of these: unavailable controls are now hidden, and the copy is approved with edits. See §14.

- **Paper as a UI surface** for the empty-state sheet (display only, never exported). DESIGN-SYSTEM §13.
- **Unavailable controls kept in place**, dimmed and explained, because `tests/safari/gui.mjs` (lead-owned) and `ui-shell` check the six rail names and the Tab order Select → Trace → Smooth. Removing them is §12 Q1.
- **Copy changes:** Paths/Compare "available with the production renderer" → "not available yet"; the empty state "Import an image to start" → "Drop an image to start" with a longer explanation; the Fill note reworded ("To edit a palette colour everywhere, use Recolor (R)"); the Trace section "Trace preset" → "Preset" (the radiogroup keeps its "Trace preset" name); preset descriptions added. No product claims added beyond the existing "traced on this device" and "Nothing is uploaded".
- **The capture spec** is opt-in (`UI_R_SHOTS`), Chromium only, like the G-UI screenshot spec.
- **Test port.** The brief's Playwright command uses the configured web server (port 4173, likely in use by the lead); the runs here use `PW_BASE_URL` against this worktree's own `vp preview` of the same `dist/`.

## 11. Requests (not done here: engineering or lead-owned)
**`src/canvas-host`:**
1. **Focus ring painted under the canvas layers.** In Chromium the canvas's `outline-offset: -2px` ring is covered by its own absolutely positioned layers, so keyboard focus on the canvas was not visible. G-UI-R draws the ring on the shell's frame (`.vx-canvas-frame:has(> .vectra-canvas:focus-visible)::after`); a canvas-host fix (paint the ring in the overlay, or give the layers a stacking order below it) would make the shell rule unnecessary. *Done in #19 (`d9b5208`): fixed at the canvas-host level and verified from rendered pixels; the shell rule is removed (§15).*
2. **Empty canvas paints black.** With no document, the canvas fills black instead of the `canvas-surround` colour it is given. The shell's empty state now covers it with the surround; a canvas-host fix would remove the dependency.
3. **Transient colour preview.** The picker cannot preview the draft on the artwork. A canvas-side transient fill override (dropped on Cancel/Escape, no history entry) would let colour be judged in context (Assessment A P1).

**Engineering (other owners):**
4. **W/H fields in px, mm or in** (non-uniform or aspect-locked scale, physical units): the core transform for print work; Size is read-only today.
5. **Relink a fill to a palette colour** (a command): the swatches only set the value today.
6. **Status-message lifetime** (return to idle after success; errors persist until dismissed): a behaviour change the suites would need to agree to.

## 12. Open design questions for the maintainer
Answered by the maintainer's review; the corrections are in §14.

1. Remove the three unavailable tools and two unavailable views until they ship (needs `ui-shell` and the Safari script updated), or keep them dimmed as now?
2. Is the ivory sheet acceptable as the empty-state surface, or should `paper` stay strictly the artwork?
3. Should the renderer state leave the status bar when healthy (show it only on fallback or error)? `workspace-offline` asserts its text today.
4. Palette names `p0`–`p7` come from the engine; should the UI present them as inks ("Ink 1") or sort them by lightness?
5. Should the side column collapse (Layers to a header) below 720 px of height?
6. Keep the "Studio" label next to the wordmark?
7. **Copy needing approval:** the preset descriptions ("One ink on paper", "Every colour region", "A small palette of inks"), the empty-state text ("Drop an image to start … becomes the first layer; nothing is uploaded"), "Nothing to inspect yet", "Selection inside", and the reworded Fill note.

## 13. Integration with the final G-R1 head
**Merge.**
- `1e7c184` merges `754ec77` with `gate/g-r1-interactive` at `24550b8` (#19). It is a merge commit made with `ort`, with no conflicts; no file changed on both sides since `ee72fb3`.
- Follow-up commits:
  - `83e0816` and `d283ef8`: test fixes;
  - `928cd82`: VoiceOver checklist E1/E2;
  - then this section.
- Against `24550b8`, this branch changes only `src/shell/**`, `src/ui/**`, five browser test files and docs. No engine, document, renderer, hit-test, job, persistence or canvas-host file changed.

**Environment.** macOS 26.6.2 (Darwin 25.6.0, arm64), Node 24.22.1, pnpm 12.23.0, Playwright 1.65.1 (Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2). The machine is shared and was not quiet: four Vectra preview servers from other checkouts were left running on 4179, 4181, 4182 and 4291. ngspice was not running. Playwright used its configured server on port 4173.

**Build and unit.**
- `pnpm run build`: the dist check passed.
- `pnpm exec vp check`: 303 files formatted; no lint or type errors in 170 files.
- `pnpm exec vp test`: 26 files, 382 tests passed.

**Bundle** (`node docs/research/g-ui/measure-bundle.mjs`, gzip KiB, merged build):

| | Value | Budget |
|---|---|---|
| Design-system JS | 114.5 | 150 |
| Workspace CSS | 9.1 | 15 |
| Total initial workspace JS | 230.5 | 250 |

Total initial workspace JS measured 228.1 at `24550b8` and 227.8 at `ee72fb3`. Raw: `tests/output/g-ui-r/bundle-merged-1e7c184.json`.

**Playwright, every full run on this branch after the merge (3 engines):**

| Run | Head | Result | Cause of failures |
|---|---|---|---|
| 1 | `1e7c184` | 321 passed, 3 failed, 39 skipped (7.8 min) | 2 × `renderer-behaviour` crash test (Chromium): `render_compare` was absent in this worktree when that spec ran (ENOENT). `renderer-correctness`'s `beforeAll` built it later in the same run (`cargo --locked`). Plus 1 × `ui-document` "keyboard only" (Chromium): no path under any probe point (fix 1 below) |
| 2 | `974c485` (later amended) | 323 passed, 1 failed, 39 skipped (8.3 min) | `workspace-integration` "selection … replacement clears it" (WebKit; fix 2 below) |
| 3 | `9a5bce0` (later amended) | 324 passed, 0 failed, 39 skipped (8.2 min) | Intermediate: the helper was edited during this run |
| 4 | `928cd82` | 321 passed, 6 failed, 36 skipped (19.4 min) | A regression in the test fix: the diagnostic read added in `83e0816` waited, without a bound, for an element that is absent when a probe selects nothing. `ui-document` tests at lines 142 and 552 failed in 3 engines. Fixed in `d283ef8` |
| Stress | `928cd82` | 345 passed, 30 failed | The same two tests, 3 engines × 5 repeats. Everything else passed, including both earlier flakes |
| **Final** | **`d283ef8`** | **327 passed, 0 failed, 0 flaky, 36 skipped (8.5 min)** | Load average 0.93 → 1.56 |
| **Stress** | **`d283ef8`** | **375 passed**: `ui-document` + `workspace-integration`, `--repeat-each=5`, 3 engines (10.1 min) | Load average 1.56 → 1.21 |

**Skips and inputs.**
- The 36 skips are all opt-in specs: benchmark 3, jobs-perf 3, native-benchmark 3, owner-bundle 3, renderer-perf 6, ui-refinement-screenshots 9, ui-screenshots 6, workspace-perf 3.
- Runs 1–3 also skipped `pdf-eval` (3), because this worktree had no `tests/output/native`. Before run 4 it was generated here with `cargo run --release --locked -p vector-engine --example export_samples` (105 SVG/PDF pairs).
- `render_compare` was built in this worktree during run 1. Runs 2–3 used a copy of the main checkout's binary (same crate sources; 32 bytes differ, from embedded paths). The local build was restored before run 4.
- Records (gitignored): `tests/output/g-ui-r/pw-final-d283ef8.json` and `pw-stress-d283ef8.json`.

**The two test fixes.** Both are races in G-R1's specs and helpers, so #19 carries them too. The product behaves as specified in both cases. The fixes are `83e0816` and `d283ef8`, and they can be cherry-picked onto #19.
1. **`selectOnCanvas`** (`tests/browser/ui-helpers.ts`):
   - It read the selection name immediately after each click. An exact hit answers asynchronously, after the current revision's hit index, which is rebuilt in slices after an edit. Answers come in click order, and only a document change makes one stale.
   - The most likely cause is that under full-suite load every read ran ahead of the answers. This is **inferred, not observed**.
   - Each probe now waits up to 3 s for its own answer. A failure now reports what each probe left selected and, on debug pages, the hit counters.
2. **Replacement clears the selection** (`workspace-integration`):
   - The debug `selection()` returns the last committed render. `load()` returns once `canvas-state` is "ready", and the old document already was.
   - The IDs received were exactly those `a.select()` had set, and no click was pending.
   - The reads after clicks and after the replacement now poll. A kept selection still fails.
   - Other reads after a second load (`documentId`, `tree`, and the lifecycle spec's `held`/`chunks`) are synchronous or polled, so `load()` is unchanged.

**Real Safari** (Safari 26.6.2, macOS 26.6.2; the two scripts that load `workspace.html`):
- `node tests/safari/gui.mjs` on `d283ef8`: 14 PASS, 0 PARTIAL, 0 FAIL, findings 0 (load average 1.18 → 1.27). Record: `docs/research/g-ui-r/safari/gui-d283ef8.json`.
- `node tests/safari/gr1.mjs` on `8c71d3c` (same build): **5/5 passed, 0 NOT RUN**. The page was visible (31 animation frames in 500 ms), so the timing scenarios ran; for #19 they were NOT RUN because the window was hidden. Inputs: the registered G-R1 workloads, copied from the main checkout and verified against the container SHA-256 values in `docs/research/g-r1/bench/workloads.json` (all 4 match). Load average 1.15 → 1.77. One run on a shared machine, so this is not a quiet-machine qualification. Record: `docs/research/g-ui-r/safari/gr1-8c71d3c.json`.

  | Measure (real Safari) | synthetic-many-250k | architecture-street-halftone |
  |---|---|---|
  | Preview | **190 ms: misses** the interactive target's ≤ 100 ms | 302 ms: a stress workload (RFC §8.8). Measured; no 100 ms threshold applies (maintainer ruling, 2026-11-25) |
  | First / exact frame | 100 / 160 ms | 292 / 292 ms |
  | Visible after load (displayed-canvas sampler) | 206 ms | 478 ms |
  | Hit index ready, slices, max slice | 89 ms, 11, 4 ms | 288 ms, 31, 5 ms |

  Gestures (display cache): pan p50/p95/max 17/17/25 ms, zoom 17/18/18 ms (budget p95 ≤ 33 ms); exact settle 4 and 8 ms. Drag: 6 of 6 cases with 0 geometry errors and 0 % of pixels over 32 (layers, and live for scale). Keyboard selection and offline recovery passed.

  The renderer, hit-test and canvas-host code is identical to #19's head. The shell around the canvas differs, and so does the canvas size.

**VoiceOver.** NOT RUN. The owner checklist (`docs/research/g-r1/VOICEOVER-CHECKLIST.md`) now describes this layout:
- E1: the inspector Tab order is X, Y, Scale value, Scale slider, Rotate. Reset sits between Scale value and the slider, and is disabled, so skipped, while the scale is 100 %.
- E2: the picker's named document-colour swatches.

Accessible names are unchanged.

**NOT RUN on the merged head.**
- VoiceOver (owner checklist).
- The Safari G-JOB, G-R0 and persistence scripts. They load the workbench page or the persistence harness, and those import none of the changed files: the changed `src/ui` modules are imported only by `src/shell`, and `src/ui/styles.css` only by the workspace entry.
- `workspace-perf` (`R1_PERF`) and the other opt-in benchmarks: no renderer, hit-test or job change.
- The 326 + 72 and 636 exports and bundle v1: crates, packages, export and persistence are identical to `24550b8`.
- Lower-end hardware, Windows and Linux, and touch input.

## 14. Maintainer review corrections
**Branch** `gate/g-ui-r-review` from `3d39ec6`, for the lead to merge into `gate/g-ui-r`. Not pushed. The binding decisions of the maintainer's review of #20 answer §12 and supersede the §10 deviations "Unavailable controls kept in place" and the proposed copy. This is not a redesign: the docked workspace, the property inspector, the canvas area, the type scale and the charcoal/lime/ivory identity are unchanged.

**Scope.** Only `src/shell/**`, `src/ui/color-picker.tsx`, `src/ui/styles.css`, five test files (`ui-shell`, `ui-document`, `workspace-offline`, `workspace-lifecycle`, `tests/safari/gui.mjs`), docs and the Impeccable records changed (`git diff --stat 3d39ec6..` lists them). Nothing changed in `src/canvas-host`, `src/renderer`, `src/hit-test`, `src/document`, `src/jobs`, `src/persistence`, `crates/`, `packages/`, `src/ui/registry/` or `PROVENANCE.json`. The shell's canvas focus-frame workaround is untouched.

| # | Decision | Change | Covered by |
|---|---|---|---|
| 1 | Hide unavailable tools and views | Smooth, Simplify and Cleanup removed from the rail. The Paths/Compare switch and the "Artwork" button are removed, and the top bar is two columns. The `unavailable` mechanism is deleted, since nothing uses it. Rail: Select, Trace, divider, Recolor. Tab from Select to the canvas is now 3 stops (Trace, Recolor, canvas; it was 6). The shortcuts dialog needed no change: it never listed the hidden tools or views (V, T, R, history, Esc, Delete, zoom, fit, `?`) | `ui-shell` "tool rail: only working tools…": names `["Select","Trace","Recolor"]`, no `aria-disabled` in the rail, Tab Trace → Recolor. "top bar and status bar…": no "View" group, no Artwork/Paths/Compare buttons. `tests/safari/gui.mjs` updated (names, Tab Trace → Recolor), checked with `node --check`, **not run** |
| 2 | Keep the ivory empty-state sheet | No code change. DESIGN-SYSTEM §13 records it as an onboarding surface, not committed artwork or an exported artboard | Docs |
| 3 | Renderer state | `rendererNotice()` returns nothing while healthy (worker, starting or drawing). It shows the main-thread fallback with its reason, "Renderer: recovering (…)" and "Renderer error: …", with an icon in `warning` or `destructive`. The fallback stays shown while a fallback renderer draws, because the client's `fallbackReason` stays set. `canvas-state` stays mounted: an empty live region (`status`; `alert` on failure) carrying `data-state` (unchanged, so every `canvasSettled` still works) and a new `data-host` | `ui-document` "renderer: the main-thread fallback is disclosed…": a healthy worker gives empty text and `data-host=worker`; `?renderer=main` gives visible text "Renderer: main thread (fallback: main-thread renderer selected)", `role=status`, `data-host=main-thread`. `ui-shell` "top bar and status bar…": `role=status`, empty text, no "Renderer" in the footer. `workspace-offline` `recoverRenderer` now reads `data-host=worker` and empty text instead of "Renderer: worker". `workspace-lifecycle` "renderer disclosure…": one debug crash shows "Renderer: recovering (…)" in the live region (recorded by a MutationObserver), then the region is empty again with `data-host=worker`; a fourth crash within 30 s shows "Renderer: main thread (fallback: the render worker crashed repeatedly (…))", visible, `role=status`. **Not covered by a workspace test:** the failure state ("Renderer error: …", `role=alert`); its text is unchanged from before. **Finding for the lead (canvas-host, not changed here):** after that crash fallback the host state stays `rendering` (`data-state="rendering"`, no `data-host`), although the main-thread renderer has drawn the exact frame (`lastExact.renderRevision` equals `renderRevision`, host `main-thread`; observed for 4.6 s in Chromium, and for 30 s in all three engines in an earlier version of the test). With `?renderer=main` it reaches `ready`. The disclosure does not depend on it |
| 4 | Palette names | **Engine source** (read only): `crates/vector-engine/src/staged.rs` and `lib.rs` `paths_with_palette`. Limited Palette pre-assigns `p{i}` (and `x{n}` on its error path). Full Colour assigns `c{n}` in first-use order. Black & White and halftone assign `ink`, then `ink{n}`. `commitTrace` (`src/document/commands.ts`) stores that string as `PaletteEntry.name` under a new `pal…` ID. Export writes the name into SVG and PDF (`class="p2"`). **Display rule** (`paletteLabel`, `src/shell/document.ts`): `^(p\|c\|x\|ink)(\d+)$` → "Colour N+1"; `ink` → "Colour 1"; any other name is shown verbatim. It uses the number in the name, never the list position. Applied in the Recolor triggers (`Colour 3: #dc2828. Edit colour`), the Fill note ("Uses Colour 3 from the palette; …") and the picker swatches (`Use Colour 3, #dc2828`). Layers show no palette names (groups carry the mode), and canvas announcements give hex values only. No sorting, no "ink" wording | Unit tests (`src/shell/document.test.ts`): the rule, custom names kept, and real Limited, Full Colour and B&W traces checked for number ≠ position with the entries unchanged. `ui-document` "palette names…" (Limited): every Recolor name is "Colour N" whose hex equals the exported `class="p(N−1)"` fill; positions ≠ numbers (list order p2, p3, p0, p1, p4); swatch names; Fill note; the export has no "Colour" and is byte-identical after the UI was used. **Byte identity across builds:** a scratch capture (not committed) exported SVG and PDF from the base build `3d39ec6` and from this branch (the builds of `40333e0` and of the final source `8aa6b65`), Chromium, port 4193. Cases: Limited Palette, Black & White and Full Colour unedited; Limited and Full Colour after a Recolor edit, which takes the path where export derives IDs from the names. Each was exported twice per build. `cmp`: **20/20 files identical**. `export.test.ts` passes (in `vp test`) |
| 5 | Layers panel | No automatic collapse (there never was a height breakpoint; none was added). The Layers title is a disclosure button: constant name "Layers", `aria-expanded`, `aria-controls="layers-body"`. It drives the panel's `collapsible` / `collapsedSize={36}` API through `panelRef` (react-resizable-panels 4.24.1, already installed). `aria-expanded` is derived from the panel (`onResize` → `isCollapsed()`), so it follows a drag-collapse too. The collapsed body is `hidden`, so the rows leave the Tab order. The split stays resizable. **Layers keep their pixel height when the window resizes** (`groupResizeBehavior="preserve-pixel-size"`; the inspector absorbs the change). Without it, Layers near their 120 px minimum fell below it in a shorter window, and the collapsible panel closed by itself. This was reproduced (1920×1080 with Layers dragged to 125 px, then 1024×640: collapsed, 36 px) and fixed in `6f7b328` | `ui-document` "layers: an explicit collapse control at 1024×640, 1280×720 and 1366×768": expanded on load at each size (Layers 170/194/209 px, inspector 397/453/487 px, identical in 3 engines); the control is on screen; click collapses to ≤ 37 px with rows hidden and the inspector taller; Enter restores the exact height. Layers dragged near the minimum at 1366×768 stay expanded (≥ 120 px) when the live window shrinks to 1024×640; this step fails without the fix (checked in Chromium). A pointer drag past the minimum collapses them, and `aria-expanded` follows. The `ui-shell` "Resize layers" keyboard scenario is unchanged and passes; `gui.mjs`'s is unchanged (not run) |
| 6 | Wordmark | "Studio" removed | `ui-shell` "top bar and status bar…": the banner contains "vectra", not "Studio" |
| 7 | Copy | Preset descriptions exactly as given (B&W, Full Colour, Limited Palette). "Selection inside" → "Contains selection" | `ui-shell` "trace presets…": each radio's accessible description. `ui-document` "palette names…": the layer row contains "Contains selection" |
| 8 | Mixed fills | `ColorPicker` gains `mixed`. In that state the trigger shows a neutral hatched swatch (`.vx-swatch-mixed`, owned CSS; no inline style), the text "Mixed" and the name `Fill colour: mixed. Edit colour`. The picker shows "Current mixed" with a hatched current chip. The draft starts from the first path's colour and is labelled "New". Apply commits once, and always in this state (before, Apply with an unchanged draft was a silent no-op although the fills differed). Cancel and Escape commit nothing. **Open (copy):** the approved Fill note "Their fills differ: Apply gives them all this colour." is kept verbatim. With the trigger reading "Mixed", "this colour" can only mean the colour chosen in the picker. A one-word change ("one colour") is left to the maintainer | `ui-document` "keyboard only: select a layer…" (a Limited layer is mixed): exact name `Fill colour: mixed. Edit colour`, text "Mixed", no `#`, note "Their fills differ", picker "Current mixed", then Apply gives `#2050a0` and undo reverts. The `fillTrigger` locator is now `/^Fill colour: /`. Single-path picker tests unchanged |
| 9 | Redundant status messages | The idle "Ready" is removed; the status region is mounted empty (`role=status`, no empty `title`). Errors are unchanged (visible, `role=alert`). The trace, export and cancel messages are kept, because they are the only announcement of each event and the suites wait on them. "Traced …: N paths, M anchors in T ms" partly overlaps the complexity item, but it also names the file and the time, and the complexity item is not live. No message lifetime was added. With no document, the status-bar divider before the app state is no longer drawn | `ui-shell` "top bar and status bar…": empty text and `role=status` at load. `workspace-a11y` "announcements…" (polite status, then alert) unchanged and passing |
| 10 | Palette edits and locked paths | The Recolor panel now states, above the list: "A palette edit recolours every path that uses that colour, including locked paths: locks prevent transforms and deletion, not palette edits." "including locked paths" is in `foreground`. It replaces the former 11 px caption below the list | `ui-document` "recolor…": exact text of `recolor-note` |
| 11 | Out of scope | Not implemented: editable physical dimensions, a draft-colour preview on the canvas, new palette commands, a message lifetime | — |

**Impeccable (§B).** Doctor found no project records: the loader resolved the superseded `docs/DESIGN.md` as the design authority, and there was no product record or platform. A root `DESIGN.md` (a map of DESIGN-SYSTEM §4/§13, which stays normative) and a `PRODUCT.md` (from PRD, PRD-002, RFC-002 and DESIGN-SYSTEM) now resolve, with platform `web`. The design hook was not installed, and DESIGN.md was not compacted. Details: [IMPECCABLE-SETUP.md](IMPECCABLE-SETUP.md). No final audit was run.

**Tests.** The final source is `8aa6b65`; the commits after it change only tests and docs. Its build was tested with the tests of `cf02330`. macOS 26.6.2 (Darwin 25.6.0 arm64), Node 24.22.1, pnpm 12.23.0, Playwright 1.65.1 (its Chromium, Firefox and WebKit builds; §9 and §13 list their versions). Server: `pnpm exec vp preview --host 127.0.0.1 --port 4193 --strictPort`, restarted after the build and stopped afterwards. The machine is shared, so these are not quiet-machine runs; other projects' processes were not touched.

| Command | Result | Load average (1/5/15) |
|---|---|---|
| `pnpm run build` | 55 notices verified; dist check passed | 0.90 / 1.29 / 1.49 |
| `pnpm exec vp check` | 304 files formatted; no lint or type errors in 170 files | 0.99 / 1.30 / 1.49 |
| `pnpm exec vp test` | **26 files, 384 tests passed** (382 before, plus 2) | 0.99 / 1.30 / 1.49 |
| `PW_BASE_URL=http://127.0.0.1:4193 pnpm exec playwright test tests/browser/ui-shell.spec.ts tests/browser/ui-document.spec.ts tests/browser/workspace-a11y.spec.ts tests/browser/workspace-integration.spec.ts tests/browser/workspace-offline.spec.ts tests/browser/workspace-lifecycle.spec.ts tests/browser/drag-correctness.spec.ts` (3 engines) | **195 passed** (65 × 3: ui-shell 10, ui-document 21, workspace-a11y 3, workspace-integration 7, workspace-offline 5, workspace-lifecycle 3, drag-correctness 16), 0 failed, 0 flaky, 3.6 min | 2.05 / 2.10 / 1.84 before, 3.73 / 2.34 / 1.96 after |
| Export capture (scratch, Chromium) on the same build, `cmp` with `3d39ec6` | 20/20 SVG and PDF files identical | — |
| `node --check tests/safari/gui.mjs` | syntax OK (the script was not run) | — |

**Earlier runs on this branch, recorded for honesty:**
- `40333e0`: `ui-shell` and `ui-document` in Chromium only, 31/31 passed.
- `ed7c5a4`: the seven specs in 3 engines, 192/192 passed. The 20/20 export `cmp` above was first run on the build of `40333e0`.
- `6f7b328`: the seven specs in 3 engines, 193 passed and 2 failed. Both failures were in the new Layers test, and both were test faults:
  - in Chromium, the height was read in the one frame where the layout is still at the relative size (102 px, then 125 px; measured over 3 repeats per engine);
  - in WebKit, the collapse drag ran past the window edge, where WebKit drops pointer moves.
- `cf02330` fixes both (a polled height, a drag kept inside the window). The Layers test then passed with `--repeat-each=3` in 3 engines (9/9).
- The fill-space figures of §3.1 are unchanged: 73/89 px at 1366×768 and 39/55 px at 1280×720, in 3 engines.

**Bundle** (`node docs/research/g-ui/measure-bundle.mjs`, gzip KiB): design-system JS **114.3** (≤ 150), workspace CSS **9.2** (≤ 15), total initial workspace JS **230.3** (≤ 250); shell 15.3. The merged head (§13) measured 114.5 / 9.1 / 230.5.

**Screenshots.** None committed. Local after-captures were refreshed (`UI_R_SHOTS=after-review`, `tests/output/g-ui-r/after-review/`, gitignored), with scratch views of the fallback, the mixed picker and collapsed Layers. The lead produces the representative set.

**NOT RUN:** real Safari (`tests/safari/*.mjs`; the lead runs it), VoiceOver (owner checklist: D1, D4, E2 and E5 updated), the other browser specs, and lower-end hardware, Windows and Linux.

## 15. Merged head after the maintainer review (#19 corrected, the corrections, the final audit)
**History** (merge commits only; nothing force-pushed):
- `14c4e9a`: the review corrections (§14), fast-forwarded from the review branch.
- `a66adc2`: merge of #19's corrected head `7b44bda`. It brings the canvas-host focus ring, the deletion lock policy, the test-race fixes and the review docs.
  - Conflicts were resolved as follows: both sides' Layers props (collapse control, `onDelete`); both sets of unit tests; `styles.css` from #19.
  - The **G-UI-R shell focus workaround** (`.vx-canvas-frame::after`), the old `.vectra-canvas:focus-visible` rule and the unused `vx-canvas-frame` class are **removed**. The canvas host draws its own ring above its layers.
- `f7efb05`: the fallback disclosure test also asserts that the host settles ready.
- `2303e18`: merge of #19's `247d094`, which adds the crash-fallback host-state fix (`17a3ac0`). It is a #19 canvas-host defect, found by the G-UI-R review agent (§14). Both fallback tests are kept.
- `e2d133c`: the focused final Impeccable audit, [FINAL-AUDIT.md](FINAL-AUDIT.md). Score 15/20 ("Good"); no P0 or P1; 2 P2; 6 P3.
- `30b2d60`: **the two P2 findings are fixed**, together with two merged-test fixes:
  - **P2-1, WCAG 1.4.11.** The registry ghost variant's `dark:hover:bg-muted/50` overrode the pressed tool's lime, so its icon sat at about 1.03:1 under the pointer. Fixed with `dark:hover:bg-primary/90`.
  - **P2-2, WCAG 2.5.8.** The "Resize inspector" splitter's pointer target was 8 px; it is now 24 px, centred on the split line. It therefore extends 12 px over the canvas's right edge, where the resize cursor shows. The **Layers splitter stays at 8 px and still fails WCAG 2.5.8** (open: a 24 px target would cover the Layers disclosure button, so it needs a layout decision). The canvas trade-off: the canvas's rightmost 12 px now start a panel resize instead of a canvas gesture, including any transform handle that falls in that strip. Reverting is one class (`after:w-6` back to `after:w-2`). **Superseded by §16:** the maintainer rejected the overlay; both splitters are now 24 px strips of their own, outside the canvas.
  - `ui-shell` asserts both in OS dark mode. Before the fix: 1.03–1.04:1 and 8 px in 3 engines.
  - Lock test: the Recolor disclosure appears only when the document has palette colours, and this fixture has none. Its wording is asserted in `ui-document`.
  - Focus-ring test: samples under a visible splitter grip (adjacent UI over the canvas edge in the docked layout) are excluded, at most 1/8. Hit-testing cannot decide occlusion, because the 24 px targets are invisible.
- The audit's **P3s are reported, not fixed**:
  - 11 px multi-line notes;
  - no `main` landmark or h1;
  - plain-Tab order in Playwright WebKit (to confirm in real Safari);
  - token literals;
  - a no-fill path shown as `#000000`;
  - copy: the tab title "Vectra · Studio", and "this colour" in the mixed Fill note.

**Verification on `30b2d60`** (the final source; later commits are docs and screenshots only). Environment: macOS 26.6.2 arm64, Node 24.22.1, pnpm 12.23.0, Playwright 1.65.1 (Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2). The machine is shared and was not quiet.

| Check | Result |
|---|---|
| `vp check` | Clean (307 files formatted; no lint or type errors in 170) |
| `vp test` | 26 files, **388 passed** (on `2303e18`; `30b2d60` changes no unit-tested code) |
| Build | Dist check passed |
| Bundle (gzip KiB) | Design-system JS **114.3**, CSS **9.4**, initial workspace JS **230.6** (budgets 150 / 15 / 250) |
| Playwright full suite, 3 engines | **360 passed, 0 failed, 0 flaky**, 36 skipped (opt-in specs); 8.9 min; load average 1.28 → 1.70 |
| Stress: `ui-shell`, `ui-document`, `workspace-a11y`, `workspace-integration`, `workspace-lifecycle`, `workspace-offline`, `drag-correctness`, `--repeat-each=3`, 3 engines | **630 passed**; 11.2 min; load average 1.70 → 2.52 |
| Final representative screenshots | 6 states at 1366×768 from `30b2d60` (Chromium, production build), palette-quantised, replacing the committed `*-after.png`. 0.93 MB for the 6; the full set is local in `tests/output/g-ui-r/after-final/` |
| Real Safari (`gui.mjs`, `gr1.mjs`) on this head | **NOT RUN: the macOS screen is locked**, so the automation page is hidden. To run once it is unlocked |

**Earlier runs on `2303e18`, before the P2 fixes:**
- Full suite: 353 passed, 4 failed.
- Stress: 609 passed, 12 failed.

The failures were deterministic and test-side only: the lock test expected the Recolor disclosure without palette colours, and in WebKit the splitter grip covered one ring sample. Both are fixed in `30b2d60`, as described above.

## 16. Final closure
**Branch:** `gate/g-ui-r-closure`, from `c29d5e2` (`origin/gate/g-ui-r`). Local only: not pushed, and #19 not merged into it.

**Scope:** `src/shell/**`, `src/ui/color-picker.tsx`, `src/ui/styles.css`, `workspace.html` (the title), `tests/browser/ui-shell.spec.ts`, `tests/browser/ui-document.spec.ts`, `tests/safari/gui.mjs`, the Impeccable records, and docs. Nothing changed under canvas-host, renderer, hit-test, document, jobs, persistence, crates, packages or the registry.

| # | Decision | Change | Covered by |
|---|---|---|---|
| 1 | Palette names | See "The palette signal" below. `paletteLabels(state)` (`src/shell/document.ts`) is the only source of on-screen palette names, for Recolor, the Fill note and the picker swatches, and is cached per state. Custom names are shown as stored. Generated labels are unique in the palette: a taken label gets " (2)", " (3)", in palette order | Unit tests (`src/shell/document.test.ts`), 7 in all, including: real Limited + Full Colour + B&W traces (`c0`… read "Colour 1 (2)"…, `ink` reads "Colour 1 (3)"); two traces of one image; patterned custom names (`p9`, `x1`, and `c0` generated by another trace) shown verbatim; a custom "Colour 2" keeps its name while the generated `p1` becomes "Colour 2 (2)"; an unused entry after a layer fill; labels stable across an unrelated edit; limits 1 and 3 below. Browser (`ui-document`): "palette names: two traces of one image read unique names in Recolor"; the existing "palette names" test (Colour N equals the exported `class="p(N−1)"` fill). **Export byte identity:** a scratch capture exported SVG and PDF, twice each, from `c29d5e2` and from this build, in 7 cases: Limited, B&W and Full Colour unedited; Limited and Full Colour recoloured; two Limited traces; a Limited layer fill (entries left unused). `cmp`: **28/28 identical** |
| 2 | Root records | `PRODUCT.md` separates current vector export (SVG and vector PDF on the device) from future qualified professional print output (CMYK, PDF/X, separations, provider compliance: not yet qualified), and drops "print-ready". `DESIGN.md` was updated for this closure, then compacted with `impeccable design-compact --write` (the full text is `.impeccable/design-full.md`); one map line keeps DESIGN-SYSTEM and RFC-002 §16 normative. The hook is not installed, and no local Claude setting changed | `impeccable doctor --json`: `design-md-sprawl` gone; `hook-not-installed` (by decision) and `workspace-context-inherited` remain. Details in [IMPECCABLE-SETUP.md](IMPECCABLE-SETUP.md) |
| 3 | Tab title | `workspace.html`: `<title>Vectra</title>` | `ui-shell` "top bar and status bar…": `toHaveTitle("Vectra")` |
| 4 | Mixed Fill note | In the mixed state the Fill note is exactly "Apply assigns one colour to all unlocked selected paths." **Reading chosen:** the whole note is that sentence. The count stays in the section meta ("Mixed · N paths"). The ordinary note (count, palette colour, the Recolor hint) returns once the fills are uniform | `ui-document` "keyboard only…": `toHaveText` on the exact sentence; after Apply, the ordinary note returns |
| 5 | No fill | `ColorPicker` takes `value: null` as **None**: a struck-through swatch (`.vx-swatch-none`: the field well with one `destructive` diagonal), the text "None", the name "Fill colour: none. Edit colour", and "Current none" in the picker. The draft starts from **#808080** (a choice: any non-black neutral). Apply always commits in this state. The note keeps "No fill." Only stroked paths can lack a fill (scene v1 needs a fill or a stroke); no trace or command creates one today | `ui-document` "no fill: an explicit None state, never black". It loads a stroke-only `.vectra` document built in the test with the project's own encoder and container writer, and asserts: the name, "None", the swatch class, a background that is not black, no "#000000" anywhere in the inspector, a Hex and draft of #808080, Apply, and undo back to None |
| §2 | Splitters | See "Splitters" below | See below |

**The palette signal (decision 1).**
- **Signal.** The commit path (`commitTrace`) names each palette entry after the scene's palette id, and stores those ids in the layer's `traceProvenance.originalScene.palette`.
  - An entry's name counts as generated only if the provenance of a traced layer whose paths use the entry records it.
  - For an entry that no path uses (after a fill edit), the provenance of every traced layer in the document stands in.
  - This needs no schema or document change, and uses existing data only.
- **Limits, reported rather than worked around:**
  1. When no traced layer is left (the only traced layer was deleted), no provenance remains. Its palette entries stay in the document and are listed by Recolor under their stored names (`p2`, `ink`). Undo restores the labels. A unit test records this. A fix needs a record that outlives the layer, which is a schema change.
  2. A custom name identical to an id that the entry's own trace generated cannot be told apart from the generated name. No command renames palette entries today.
  3. **A trade-off for the lead.** An entry that no path uses has no owning trace, so every trace's provenance stands in. An unused custom name equal to an id that some trace in the document generated would therefore be relabelled. A unit test pins this. The strict alternative is a one-line change, but it shows raw names (`p2`…) after every layer fill.

**Splitters (§2).** The rejected 24 px overlay over the canvas (`after:w-6`, `30b2d60`) is replaced:
- **Layout.** Both splitters are 24 px resize strips of their own in the layout (`ResizableHandle` with `w-6`, or `h-6` for the Layers splitter). They are panel-coloured, with a `border` hairline on the canvas side or the Layers side, the `control-border` grip centred, and a hover tint. The registry's `::after` hit area is removed (`after:hidden`), so no pointer target reaches over a neighbour.
- **Focus.** The dual focus ring is drawn inside each strip (an owned rule: `outline-offset: -2px` plus an inset dark ring).
  - `ui-shell` asserts the computed ring (solid 2px lime, offset −2px, inset dark shadow) on both splitters in 3 engines.
  - Local screenshots of both focused splitters, viewed in all 3 engines, show it unclipped. They are in `tests/output/g-ui-r-review/shots-closure/` (gitignored).
- **Layers collapse control.** It did not need to move: the strip sits above the Layers header and touches no control. Collapse, expand and resize stay independent.
- **Cost, measured:**
  - Canvas 23 px narrower (998 px at 1366×768, was 1021).
  - Inspector and Layers 23 px shorter together:
    - Layers 163/187/202 px and inspector 381/437/470 px at 1024×640, 1280×720 and 1366×768 (were 170/194/209 and 397/453/487).
    - Space left under Fill: 56/72 px at 1366×768 and 23/39 px at 1280×720 (were 73/89 and 39/55).
  - Collapsed Layers: the 36 px header, plus the 24 px strip above it.
- **Found and fixed in the shell: a Firefox-only defect in handle drags.**
  - A transform-handle drag left a selection range over the canvas overlay. Firefox then turned the next handle drag that started inside that range into a native drag (`pointercancel`), and the transform was lost (west, then east, in that order).
  - The canvas section is now `select-none`.
  - The root cause is in canvas-host: the handles neither prevent default on pointer-down nor set `user-select`. That is the lead's to fix, if wanted.

| Splitter evidence | Result |
|---|---|
| `ui-shell` "splitters: their own 24 px strips…" (1024×640 and 1920×1080) | Each splitter is 24 px across, has no overlay, and touches neither the canvas nor any control |
| `ui-shell` "resizable panels" | Inspector splitter by keyboard and pointer; Layers splitter by keyboard and, new, by pointer, with Layers staying expanded |
| `ui-document` "canvas edges: transform handles beside all four edges are never intercepted" | At 1920×1080, 1366×768, 1280×720 and 1024×640, with live viewport changes and both splits resized by keyboard at each size: for the w, e, n and s handles placed about 8 px inside each canvas edge, `elementFromPoint` is the handle, a real drag changes the selection bounds, and undo restores them. **On `c29d5e2` it fails at the right edge in all 3 engines** (the element under the e handle is the splitter overlay) |
| `ui-document` "layers: an explicit collapse control…" | Unchanged and passing: the drag-collapse still works and keeps Layers from collapsing on a shorter window |
| `tests/safari/gui.mjs` | The resizable-panels scenario now qualifies both strips' geometry; keyboard and pointer for both splitters; the Layers collapse control by keyboard and pointer; the hit test inside every canvas edge; and a real pointer-down 4 px inside the right edge reaching the canvas. Passes `node --check`. **Not run** (the lead runs real Safari) |

**Tests.**
- **Environment.** Build of `30a9f42`: 55 notices verified, dist check passed. macOS 26.6.2 (Darwin 25.6.0 arm64), Node 24.22.1, pnpm 12.23.0, Playwright 1.65.1.
- **Server.** `pnpm exec vp preview --host 127.0.0.1 --port 4193 --strictPort`, restarted after every build and stopped at the end.
- **Machine.** Shared. The lead reported real-Safari timing running in parallel; at the start of the Playwright run the process list showed one Safari process (`SafariLinkExtension`). No run here is a quiet-machine run.

| Command | Result | Load average (1/5/15) |
|---|---|---|
| `pnpm run build` | dist check passed | 1.17 / 1.06 / 1.07 → 1.40 / 1.11 / 1.08 |
| `pnpm exec vp check` | 307 files formatted; no lint or type errors in 170 files | 1.40 / 1.11 / 1.08 |
| `pnpm exec vp test` | **26 files, 392 tests passed** | 1.40 / 1.11 / 1.08 |
| Playwright, 3 engines: `ui-shell`, `ui-document`, `workspace-a11y`, `workspace-integration`, `workspace-lifecycle`, `workspace-offline`, `drag-correctness` (`PW_BASE_URL=http://127.0.0.1:4193`) | **222 passed** (74 × 3: ui-shell 12, ui-document 25, workspace-a11y 4, workspace-integration 8, workspace-lifecycle 4, workspace-offline 5, drag-correctness 16), 0 failed, 0 flaky, 3.9 min | 1.26 / 1.09 / 1.08 → 2.13 / 1.61 / 1.30 |
| Export capture vs `c29d5e2` (scratch, Chromium) | 28/28 files identical | — |
| `node --check tests/safari/gui.mjs` | syntax OK (not run) | — |
| `node docs/research/g-ui/measure-bundle.mjs` | Design-system JS **114.3** / 150 KiB gzip; CSS **9.4** / 15; total initial workspace JS **231.0** / 250; shell 15.9 | 1.63 / 1.54 / 1.29 |

**Follow-up on the same build (tests only, `311a89f`):**
- The third palette limit is pinned by a unit test.
- `ui-shell` adds a document-loaded geometry pass and the splitter focus-ring check.
- `workspace-a11y` now requires no ring sample under a grip (was: at most 1/8).
- Results: `vp test` **393 passed**; `ui-shell` + `workspace-a11y` in 3 engines **48 passed** (16 × 3); `vp check` clean. Load average 0.82 / 0.85 / 1.01 → 1.13 / 0.91 / 1.03.
- `tests/safari/gr1.mjs`'s skip of samples under splitter grips is now moot: no grip overlaps the canvas.

**Earlier runs on this branch, recorded for honesty:**
- The new edge test on the `c29d5e2` build failed at the right edge in 3 engines. That was intended: it is the evidence above.
- On the first strip build, Firefox failed the e-handle drag at 1920×1080, deterministically in 3 of 3 repeats. Diagnosed as the selection-range defect above, and fixed by `select-none`; the test then passed in 3 engines.
- The first draft of the no-fill test failed in 3 engines: `setFill(null)` on an unstroked path is rejected ("neither fill nor stroke"). The test now builds a stroke-only document instead.

**Not run:** real Safari (the lead runs it), VoiceOver (the checklist is updated: A6, A7, D4, D5, E5, E6, E7), the other browser specs, and Windows and Linux.

