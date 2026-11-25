# G-UI — Design-system workspace shell (P1-B)

**Status:** ready for review, 2026-11-25. Branch `gate/g-ui-shell` (base `origin/main` 80a1d1a; `main` be74819, which includes G-JOB, is merged in). Nothing is merged or deployed.
**Disposition: PARTIAL.** The engineering criteria that can be run here pass. Four items stay open:
- the VoiceOver smoke test is NOT RUN;
- real Safari is NOT RUN (the lead adds the real-Safari G-UI evidence on top of this head);
- single paths are not keyboard-selectable while the interim host is in place (§5.4); this needs a maintainer decision;
- the maintainer's visual review against the mockups is pending.

| Gate criterion (G0-P1 plan, G-UI) | Result |
|---|---|
| Root integration: exact pins, Tailwind plugin, `CSPProvider disableStyleElements` with the owned rule | **PASS**. No `@` alias (deviation, §3) |
| Tool rail, inspector, layers with keyboard reordering | **PASS**, bound to the real document (§2) |
| Dialogs and popovers | **PASS**: shortcuts dialog, export dialog, colour popover, layer menu |
| Accessible slider; owned colour picker with commit/cancel | **PASS** in 3 Playwright engines (§5) |
| Corrected tokens and the dual focus ring | **PASS**: contrast table from the running build (§5.3) |
| Notices extended for copied sources and CSS | **PASS**: `pnpm run build` verifies the notices (55 components) |
| Bundle against the fixed baseline | **PASS**: 113.8 / 8.2 / 211.3 KiB against budgets of 150 / 15 / 250 (§6) |
| R05-A suite promoted, 3 engines, 0 CSP violations, zero network | **PASS**: 75 passed, 0 failed, 0 flaky (§7) |
| Reduced motion | **PASS** (3 engines) |
| Screen-reader smoke test (VoiceOver) | **NOT RUN**. Aria snapshots are a proxy only (§8) |
| Real Safari | **NOT RUN** (Playwright WebKit is not Safari) |
| Owner visual review against the mockups | **PENDING** (screenshots in §9) |
| Stop conditions: `unsafe-inline`, a Radix primitive, an unresolved a11y gap | `unsafe-inline` and Radix: not hit (CSP unchanged, 0 `@radix-ui` packages). **Accessibility: two gaps are open and not waived**: the screen-reader pass (§8) and keyboard selection of single paths (§5.4). Either needs a fix or an approved exception before acceptance |

## 1. Stack (exact pins, as DESIGN-SYSTEM §2 / R05-A)
- **Runtime:** `@base-ui/react` 1.9.0, `@base-ui/utils` 0.5.0, `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/modifiers` 9.0.0, `@dnd-kit/utilities` 3.2.2, `react-resizable-panels` 4.24.1, `lucide-react` 1.79.0, `class-variance-authority` 0.7.1, `cn` 0.5.2. React 19.3.1 is unchanged.
- **Build only:** `tailwindcss` and `@tailwindcss/vite` 4.3.5.
- **Transitive runtime:** identical to R05-A: Floating UI 1.8.0 / 2.1.9 / 0.2.12, `use-sync-external-store` 1.7.0, `reselect` 5.3.0, `@babel/runtime` 7.29.15, `@dnd-kit/accessibility` 3.1.1, `tslib` 2.9.1, `clsx` 2.1.1, `scheduler` 0.28.0.
- **Supply chain:** the lockfile has **0** `@radix-ui` packages, and so does the built JS/CSS (`grep radix dist/assets/*` finds nothing). `src/ui/supply-chain.test.ts` fails on any `@radix-ui` entry or on a non-exact design-system pin.
- **Registry sources:** copied from the R05-A harness after their SHA-256s were verified against `registry-provenance.json`. The CLI was not re-run.
  - The slider's original was reconstructed by reversing the D1 patch, and it hashes to the recorded CLI hash `1fd32ee…`.
  - Manifest: `src/ui/registry/PROVENANCE.json` (item, URL, upstream and current SHA-256, patches).
  - Copied files: button, input, tooltip, popover, dialog, dropdown-menu, resizable, scroll-area and slider (shadcn `base-nova`); sortable (Dice UI); shadcn `tailwind.css`.
  - Local patches: slider D1 (`aria-label` on the thumbs); dialog (`@/components/ui/button` becomes `./button`); scroll-area (an unused `React` import removed, TS6133).

## 2. Implementation
**Entry.**
- `workspace.html` is the second Vite input (`build.rolldownOptions.input`; vite-plus-core 8 marks `rollupOptions` as a deprecated alias).
- It loads `src/shell/main.tsx`, which registers the same service worker, adds `CSPProvider`, and imports `src/ui/styles.css`.
- The P0 workbench (`index.html`) is unchanged.

**Layout** (mockup order):
- top bar: mark, document title with "Edited", Undo, Redo, Shortcuts, Import, lime Export;
- 56 px tool rail;
- canvas column: Artwork/Paths/Compare strip, interim canvas host, zoom bar;
- resizable right column, 288–336 px: inspector over layers, also resizable;
- status bar: complexity, live status with Cancel trace, renderer disclosure, offline readiness.

**Bindings.** Every edit is a RFC-002 §7 command dispatched through `DocumentSession`. The shell never mutates state.

| Control | Real binding |
|---|---|
| Import (button, empty-state button, file drop on the canvas) | `decodeImage`, then `JobController.traceFinal` (preset `bw`, `color` or `limited`, engine defaults), committed as a new layer. With no document, a document sized to the image is created and **adopted only if the trace commits**, so a failed or cancelled import leaves no document (tested). The source image is not attached: `assetId: null`, and the digest goes into provenance (C10). |
| Export dialog (SVG / PDF with page width and unit) | `JobController.export("svg" \| "pdf")`, then a local download. The files are real engine output (tested: parseable, paths, no `<image>`, `%PDF-`). |
| Canvas | Interim host (§4): a preview-class SVG export (`kind: "preview"`, scope `canvas`) shown as an `<img>` |
| Layers: Show/Hide, Lock/Unlock, rename (F2, double-click, menu), Move up/down (header and menu), keyboard and pointer drag, Duplicate, Delete | `setVisible`, `setLocked`, `rename`, `reorder` (display order is top-most first; one command per move), `duplicate`, `delete` |
| Selection (canvas click, Shift-toggle, layer rows, Escape) | Shell state, not history (RFC §7) |
| Inspector X / Y (numeric) | `applyTransform` with a world translation (P⁻¹·T·P) on the top-level targets. Enter commits; arrows step and coalesce. |
| Scale slider and numeric field, Reset | `applyTransform` with a uniform scale about the selection centre. A drag commits once on release, Escape cancels the drag, and keyboard steps coalesce. |
| Rotate 90° (both directions) | `applyTransform` with exact quarter turns about the centre |
| Fill colour picker (selected paths, or the unlocked paths inside selected layers and groups) | `setFill` with the first target's alpha kept; one commit on Apply. The inspector states how many paths it affects and when their fills differ |
| Recolor tool: palette colours | `setPaletteColor`; one commit on Apply |
| Undo / Redo (buttons, Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y) | `session.undo()` / `redo()` |

**Locks.** Commands do not enforce locks, so the shell does:
- locked (or ancestor-locked) items cannot be hit on the canvas, dragged, renamed, duplicated or deleted;
- their inspector controls are disabled, with a visible "Locked" note.

**Not implemented, shown as unavailable.** Each of these is focusable with `aria-disabled` and its explanation in its accessible name:
- the Smooth, Simplify and Cleanup tools;
- the Paths and Compare views.

**Not shown:** open/save (P1-C) and the P2-A tools (nodes, booleans, offset). Nothing pretends to work.

**History.**
- Keyboard runs carry a coalesce key (`move-x:<ids>`, `scale:<ids>`, …).
- Blur calls `session.endCoalescing()`.
- The session's coalescing window stays at its default of 1000 ms, which RFC-002 marks provisional. G-UI qualified the behaviour, not the window length: a fast keyboard run is one entry, and a focus change splits runs.

## 3. Deviations (architecture and process)
1. **Locations:** `src/ui/registry/`, `src/ui/` and `src/shell/`, instead of DESIGN-SYSTEM §11's `src/components/{ui,editor}` (this follows the lead's file-ownership split).
2. **No `@` alias and no `components.json`:** `tsconfig.app.json` is outside G-UI's ownership, and relative imports need no alias.
3. **Colour picker:** an owned picker (allowed by DESIGN-SYSTEM §3) instead of the patched Dice picker.
4. **Import:** a native `<input type="file">` plus a canvas drop target, instead of Dice `file-upload`. The behaviour is the same (local `File`, zero network) with about 1,500 fewer lines.
5. **Copied sources and lint:** they are excluded from `vp fmt` to stay byte-identical, but they are linted and type-checked. A lint override turns off `only-export-components` and `unbound-method` for `src/ui/registry/**` only (upstream idioms).
6. **`?csp=default`** drops the `CSPProvider`. It exists only for the CSP positive control. It cannot weaken the policy: Base UI's inline `<style>` is still blocked.
7. **Dark only:** a `dark` class on `<html>` drives registry `dark:` styles, so the OS colour scheme changes nothing (tested).
8. **`scripts/check-dist.mjs`** (not on either ownership list) now allows two URL strings:
   - Base UI's error-documentation link inside thrown messages (`https://base-ui.com/production-error`);
   - Tailwind's licence-banner comment (`https://tailwindcss.com`).
   Neither is fetched.
9. **`scripts/generate-notices.mjs`** now finds the module-preload polyfill in any script. With two pages, Rolldown moves it into a shared chunk.
10. **Workbench chunking:** with two inputs, the workbench loads `index-*.js` plus a shared chunk (`scheduler-*.js`: React, document, jobs). Its code is unchanged, and the initial gzip JS goes from 93.6 to 95.0 KiB (+1.4 KiB of chunk overhead, §6).
11. **Hit testing:** the interim hit test uses bounding boxes (smallest containing box, visible and unlocked paths). This is disclosed in the canvas's accessible description and replaced by G-R0/G-R1 exact hit testing.
12. **No source layer on import:** traces commit without attaching the source (see §2). The mockup's "Original image · locked" row arrives with a renderer that can show it (G-R1).

## 3a. File ownership
- **Owned and changed:** `workspace.html`, `src/shell/**`, `src/ui/**`, `src/canvas-host/types.ts` (the agreed copy), `tests/browser/ui-*.spec.ts` and `ui-helpers.ts`, `docs/research/g-ui/**`, `vite.config.ts`, `package.json`, `pnpm-lock.yaml`, the notices script and supplements, and the regenerated `public/THIRD-PARTY-NOTICES.txt`.
- **Docs edited as instructed:** the TD-UI-* rows and sections of `docs/TECHNICAL-DEBT.md` only (Counts untouched).
- **Outside both lists, changed and disclosed:** `scripts/check-dist.mjs` (two allowed URL strings, §3 item 8) and `docs/DESIGN-SYSTEM.md` (a new §12 recording the deviations; §1–§11 untouched).
- **Forbidden paths untouched:** `git diff origin/main` is empty for `index.html`, `src/main.tsx`, `src/App.tsx`, `src/workspace`, `src/jobs`, `src/renderer`, `src/document`, `src/persistence`, `scripts/generate-sw.mjs`, `public/_headers`, `playwright.config.ts`, `tsconfig.app.json` and every pre-existing spec under `tests/browser/`.
- **Needed change outside G-UI (not made):** `tests/browser/sw-update-lifecycle.spec.ts` line 368 expects the precache to hold `assets + 2` files (`index.html` and the notices). With `workspace.html` it holds `assets + 3`, so that test fails in Chromium and Firefox on this branch (§7). The fix is to count the HTML pages, for example `+ 3`, or to derive the count from `dist/`.

## 4. Canvas-host interface
- `src/canvas-host/types.ts` is byte-identical to the agreed file (SHA-256 `c9a3006054e0a0ec53ff398c3445e722d292bac0adf1c833a0257834debdf02c`, `cmp` clean).
- The shell uses only `CanvasHostProps` and `CanvasHostHandle` (`fitToView`, `zoomBy`, `setView`, through a ref).
- **Interim host:** `src/shell/InterimCanvasHost.tsx`, labelled INTERIM.
  - It adds one prop, `renderSvg`. The G-R0 host will not need it.
  - It renders by preview-class SVG export (one per document revision, debounced), shows the `<img>` on an ivory artboard, and draws selection outlines from `store.derived(chunk).bounds(i)` composed with the node's world matrix.
  - Navigation: wheel pans, Ctrl/Cmd+wheel zooms about the pointer, fit runs once per document.
  - It reports `empty → rendering → ready(host: "worker") | error`.
  - A preempted preview is resubmitted only while it is still the latest request (resubmitting an older one would preempt the newer one: live-lock; tested with ten edits 50 ms apart).
- At G-R1, swap `InterimCanvasHost` for the G-R0 host in `Workspace.tsx`; nothing else in the shell depends on the interim host.

## 5. Accessibility
### 5.1 Repaired controls (R05-A D1–D9), qualified in Chromium, Firefox and Playwright WebKit
| Defect | Fix | Evidence (`ui-document.spec.ts`, `ui-shell.spec.ts`) |
|---|---|---|
| D1 unnamed slider thumbs | D1 patch kept; Scale thumb named "Scale", value as a percentage | `slider "Scale"`, value 100, `min` 10 / `max` 400 (native range input), one slider for one value (D2) |
| D2 scalar value gives two thumbs | Array values always | as above |
| D3 picker thumbs unnamed | Owned picker: "Saturation and brightness", "Hue" | both found by role and name; the hue value steps |
| D4 hex typing reverts | Free-text draft; Enter or blur commits; an invalid value sets `aria-invalid` with a message and disables Apply | after each key of `#3366cc` the field reads `#`, `#3`, … `#3366cc` in all 3 engines |
| D5 S/V area pointer-only | Focusable 2-D slider: arrows change S and V, PageUp/PageDown, Home/End; `aria-valuetext` gives both | focused on open; value text changes ("Saturation 83%, brightness 94%" to "82%, 93%") |
| D6 no commit/cancel | Local draft; Apply commits once; Cancel, Escape and outside click discard; an unchanged Apply commits nothing; focus returns to the trigger | Apply then one Undo restores the original; Escape changes nothing; an unchanged Apply adds no history entry |
| D7 per-key commits | Coalesce key per parameter; blur ends the run | 5 ArrowRight = 1 undo entry; 2 + blur + 2 = 2 entries; a pointer drag (10 moves) = 1 entry; Escape mid-drag = 0 entries (redo kept) |
| D8 id-based announcements | Name-based dnd-kit `announcements` (no patch) | live region: "nested_rings dropped at position 2 of 2." |
| D9 tooltips not associated | Names, unavailability and `aria-keyshortcuts` on the triggers | tool rail names and `aria-keyshortcuts="R"` asserted |

### 5.2 Other checks (3 engines)
- **Keyboard:**
  - full rail and bar traversal; tooltips on focus;
  - global shortcuts (V/T/R, Escape, Delete, +, −, Shift+1, ?) are blocked in inputs, dialogs and menus, while Cmd/Ctrl+Z still works from a focused slider;
  - layer reorder by keyboard drag (Space/Arrow/Space) and by explicit Move up/down.
- **Modal focus:** in the shortcuts and export dialogs, focus starts inside, Tab and Shift+Tab are trapped, and Escape returns focus to the trigger.
- **Reduced motion:** `transition-duration` goes from 0.15 s to 0.00001 s under `prefers-reduced-motion: reduce`.
- **Focus ring:** the rendered ring is a solid 2 px rgb(185, 232, 123) outline with a 2 px offset filled by an rgb(25, 26, 28) ring.
- **Resize:** keyboard and pointer, with the inspector clamped to 288–336 px. Layer rows, including the More actions button, fit at both widths.
- **Status:** processing status is in a `role="status"` live region. Error text is prefixed "Error:", never colour alone.

### 5.3 Contrast table (WCAG 2.x; tokens resolved by the running build, `contrast.json`)
| Pair | Background | Panel | Elevated | Canvas surround | Need |
|---|---|---|---|---|---|
| foreground #eeeef0 | 15.03 | 13.74 | 12.40 | 11.22 | 4.5 |
| muted-foreground #a9abad | 7.56 | 6.91 | 6.24 | 5.65 | 4.5 |
| primary #b9e87b (text, outer focus ring) | 12.35 | 11.29 | 10.19 | 9.22 | 4.5 / 3 |
| destructive #ff8f85 | 7.89 | 7.22 | 6.51 | 5.90 | 4.5 |
| warning #f2c14e | 10.38 | 9.49 | 8.56 | 7.75 | 4.5 |
| **control-border #787a7e** (input outlines, slider tracks, resize grips) | 4.05 | 3.70 | 3.34 | 3.02 | 3 |
| border #414347 (decorative dividers only) | 1.76 | 1.61 | 1.45 | 1.31 | — |

- primary-foreground on primary: 11.11 (need 4.5).
- Inner focus ring (#191a1c) on paper #eee8d8: 14.24; on a lime fill: 12.35 (need 3).
- **Measured on real elements** (computed colours, 3 engines, identical): X input border against the panel 3.70; slider track against the panel 3.70; resize grip against the background 4.05.
- The light and dark OS colour schemes produce identical computed colours.

### 5.4 Open keyboard gap: single paths
- The Layers panel lists layers and groups, not paths (a trace has hundreds; DESIGN-SYSTEM §3). Only a canvas click (interim box hit test) selects a single path.
- By keyboard, the fill and transform of a layer or group are reachable (tested: Layers row, Enter, Fill picker, Apply recolours every unlocked path of the layer). The per-path fill and transform are not.
- The canvas's accessible description says so.
- Fix path: keyboard object navigation on the canvas with the G-R0/G-R1 renderer (exact hit testing), or a virtualised path list. Until then this is an open gap, not a waiver.

## 6. Bundle (gzip -9; `node docs/research/g-ui/measure-bundle.mjs` → `bundle-sizes.json`)
| | Measured | Budget |
|---|---|---|
| Baseline: minimal React 19.3.1 app, same toolchain | 66.2 KiB JS (R05-A also measured 66.2) | — |
| **Additional design-system JS** (Base UI with Floating UI and friends 62.4, react-resizable-panels 15.0, dnd-kit 14.5, cn/cva/clsx 10.8, owned and copied `src/ui` 7.5, lucide 3.5) | **113.8 KiB** (R05-A harness: +121.9) | ≤ 150 KiB, **PASS** |
| **Design-system CSS** (Tailwind preflight and utilities, tokens) | **8.2 KiB** (46.5 KiB raw) | ≤ 15 KiB, **PASS** |
| **Total initial UI JS** of `workspace.html` (React 65.8, design system, shell 12.2, document and jobs 20.6) | **211.3 KiB** (665 KiB raw) | ≤ 250 KiB, **PASS** |
| Additional JS over the baseline, everything (design system, shell, domain) | 145.2 KiB | — |
| WASM (separate) | 253.8 KiB gzip / 646.3 KiB raw | not in the UI budget |
| Compute worker (separate) | 3.9 KiB gzip | not in the UI budget |
| Lazy chunks | none (nothing is lazy-loaded) | — |
| Workbench (`index.html`) initial JS | 95.0 KiB, against 93.6 KiB built alone | +1.4 KiB, shared-chunk overhead only |

Per-library figures come from an attribution build. Its chunks are compressed separately, so their sum (about 216 KiB) exceeds the single-bundle total.

## 7. Browser results (production build; `pnpm exec vp preview --host 127.0.0.1 --port 4180 --strictPort`; `PW_BASE_URL=http://127.0.0.1:4180`)
Chromium 159.0.8154.6, Firefox 159.0 and Playwright WebKit 27.2. **Playwright WebKit is not Safari.**

| Run (final head) | Result |
|---|---|
| `pnpm exec playwright test ui-` (3 engines) | **75 passed**, 6 skipped (screenshot spec, Chromium-only and opt-in), 0 failed, 0 flaky, 47.2 s. Every test asserts 0 off-host requests; every test except the positive control (which expects them) asserts 0 CSP violations and 0 console errors |
| `… ui-shell ui-document --repeat-each=2`, at the earlier head `c85c5c8` (before the keyboard-fill change) | **144/144**, 1.5 min |
| P0 regression `smoke csp privacy offline-recovery` (3 engines) | **21/21**, 39.5 s |
| Workbench and G-JOB suites `workbench jobs-adversarial jobs-lifecycle sw-update sw-update-lifecycle` (3 engines; `jobs-perf` not run) | **81 passed, 3 failed**, 3.8 min. The failure is the same test in all 3 engines: `sw-update-lifecycle.spec.ts:368` expects `assets + 2` precached files and gets `assets + 3`, because `workspace.html` is now precached (expected 9, got 10). The spec hard-codes one HTML page and is not G-UI's to change (§3a). The other 27 tests per engine pass, including the update and offline lifecycles |
| `pnpm exec vp check` | pass: 239 files formatted; 131 files with no lint or type issues |
| `pnpm exec vp test` | 21 files, **349/349** (adds `src/shell/document.test.ts`, `src/ui/color.test.ts`, `src/ui/supply-chain.test.ts`) |
| `pnpm run build` | pass: WASM build, notices verified (55 components), `sw.js` (10 precached files), `check-dist` passed |

**Specs.**
- `tests/browser/ui-shell.spec.ts` (8 tests):
  - CSP equality, clean load, the scrollbar rule, and the negative and positive controls;
  - tool rail; shortcuts dialog; shortcut guards; resizable panels;
  - reduced motion; tokens, contrast and focus ring.
- `tests/browser/ui-document.spec.ts` (17 tests):
  - import (keyboard-opened chooser, no upload);
  - layers; selection and Delete;
  - slider (keyboard), slider (pointer and Escape), numeric field, colour picker, keyboard-only layer fill, recolor;
  - export; offline import, trace, edit and export;
  - drop, cancel and failure;
  - layer menu; row width; zoom and fit (buttons and +, −, Shift+1), rotate and reset; preview catch-up;
  - control contrast and colour-scheme independence.
- `tests/browser/ui-screenshots.spec.ts`: evidence only, with `UI_SCREENSHOTS=1`.
- Per-test results and annotations: `browser-results.json`.

**Test-only notes.**
- dnd-kit swallows clicks for 50 ms after a pointer drag (its click-after-drag guard), so the pointer-reorder test waits 100 ms before clicking Undo.
- Offline is tested after load, as in the P0 privacy suite. An offline reload is not exercised, because Playwright Firefox refuses offline navigations before the service worker answers.

## 8. Screen reader
- **VoiceOver smoke test: NOT RUN.** It needs macOS UI automation with real Safari, and only the lead runs Safari sessions.
- **Proxy only:** Playwright aria snapshots of the running build are in `aria/` (`01-empty`, `03-selected-path`, `04-layer-selected`, `05-colour-picker`, `09-export-dialog`). These are Playwright's accessibility tree, not what VoiceOver announces.

## 9. Screenshots (actual production build, Chromium, `screenshots/`)
- **States, each at 1920×1080 and 1366×768:**
  - `01-empty`;
  - `02-imported` (Hokusai, *The Great Wave*, public domain, `tests/fixtures/external`, Black & White preset);
  - `03-selected-object` (a path selected on the canvas);
  - `04-layers-inspector` (layer selected, groups expanded);
  - `05-colour-picker`;
  - `06-resized-panels`;
  - `07-focus-rail` (dual ring on the panel);
  - `08-focus-lime` (dual ring on the lime Export button).
- **1366 only:** `09-export-dialog` (the blurred backdrop makes the 1920 PNG exceed 400 KB).
- **Sizes:** 17 files, 2.8 MB in total, largest 273 KB.
- CSP violations were drained and asserted empty before every screenshot.

## 10. NOT RUN
- VoiceOver or any screen reader (§8).
- Real Safari: TD-UI-001 closure, owner sign-off.
- Touch and pen input; Windows and Linux; lower-end hardware.
- An offline reload of `workspace.html`. Offline after load is tested, and the G-JOB service worker serves precached `.html` shells.
- The coalescing window length (1000 ms) as a usability parameter.
- Exact hit testing and the Paths/Compare views (renderer gates).
- Keyboard selection of single paths (an open gap, §5.4).
- `jobs-perf.spec.ts` (benchmark; not a regression gate here).
- Owner visual review.

## 11. Technical debt (TD-UI-*)
Each item has a G-UI disposition in `docs/TECHNICAL-DEBT.md`. None is closed: only maintainer acceptance closes an item.

| Item | Stage now |
|---|---|
| TD-UI-001 (CSP) | Production verified in 3 Playwright engines; real Safari pending |
| TD-UI-002 (slider and picker) | Production verified (automated); screen-reader pass pending |
| TD-UI-003 (contrast) | Owner acceptance pending (visual review) |
| TD-UI-004 (notices) | Production verified; closure criteria met; owner acceptance pending |

No new debt item was added. The interim host and box hit test are G-R1 scope, and the Counts section is left to the lead. Count change: 0 items opened, 0 closed.

## 12. For the lead at integration
- **Conflict points:** `package.json`, `pnpm-lock.yaml`, `vite.config.ts` (Tailwind plugin, two inputs, `workspace.html` in `buildId()`, fmt and lint entries), `public/THIRD-PARTY-NOTICES.txt` (regenerate after merging), `scripts/generate-notices.mjs`, `scripts/check-dist.mjs`.
- **G-R0:** `src/canvas-host/types.ts` is identical on both branches. Replace `InterimCanvasHost` in `src/shell/Workspace.tsx` (one element) and drop `renderSvg`.
- **Service worker:** `scripts/generate-sw.mjs` is unchanged and needs no change; `workspace.html` is precached.
- **`tests/browser/sw-update-lifecycle.spec.ts:368`** must count the HTML pages (`assets + 3`, or derive the count from `dist/`). Until then it fails in all 3 engines on this branch (§7).
- **Workbench:** its scripts are now split into `index-*.js` plus a shared chunk. The P0 suites (21/21) and the workbench and G-JOB suites (81/84; the 3 failures are the precache count above) pass.
- **Real Safari:** the lead adds the real-Safari G-UI evidence on top of this head.
- **Port:** the default Playwright config (port 4173) also picks up `ui-*.spec.ts`. Those specs need nothing beyond the production build.

## 13. Reproduction and environment
```sh
pnpm install --frozen-lockfile
pnpm exec vp check && pnpm exec vp test && pnpm run build
pnpm exec vp preview --host 127.0.0.1 --port 4180 --strictPort &
PW_BASE_URL=http://127.0.0.1:4180 pnpm exec playwright test ui-
PW_BASE_URL=http://127.0.0.1:4180 pnpm exec playwright test smoke csp privacy offline-recovery
UI_SCREENSHOTS=1 PW_BASE_URL=http://127.0.0.1:4180 pnpm exec playwright test ui-screenshots --project=chromium
node docs/research/g-ui/measure-bundle.mjs > docs/research/g-ui/bundle-sizes.json
```

**Environment.**
- macOS 26.6.2 (25G83), arm64; Node 24.22.1; pnpm 12.23.0; vp 1.7.0 (vite-plus-core 8.3.8000); TypeScript 7.0.2; Playwright 1.65.1; Rust per `rust-toolchain.toml`; wasm-bindgen 0.2.130.
- Machine load (`uptime`): 0.82–1.96 (1-minute load average) during the final runs, from 11:40 to 11:50. Other projects were running; no process was touched.
- The final runs used source head `b9ad382` (before the commit-message reword; trees are identical). Later commits add only docs and evidence.
