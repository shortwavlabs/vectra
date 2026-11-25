# R05-A — Design-system feasibility (RFC-002 independent review)

Status: draft gate report, 2026-11-24. Branch `review/rfc-002-architecture` (base `0e32fda`). Disposable integration proof, not production UI. Scope: [DESIGN-SYSTEM](../../DESIGN-SYSTEM.md) "R05 acceptance", [RFC-002 §12 / D09](../../RFC-002.md), [RFC-002-REVIEW §R05](../../RFC-002-REVIEW.md) (design-system half only; Save/Open and geometry-library parts of R05 are not covered here).

Harness: `experiments/rfc-002-review/design-system-harness/` (own `package.json`, `pnpm-lock.yaml`, local `pnpm-workspace.yaml`). Raw results: `artifacts/design-system/`. Root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `Cargo.lock` and `vite.config.ts` were SHA-256-checked unchanged after the first installs and the CLI run, and again as the final step of this gate (after all re-installs, test runs and the root `vp fmt` on artifact JSON).

## 1. Summary verdict

| # | Item | Verdict | One-line evidence |
|---|---|---|---|
| 1 | Versions, provenance, licences | **PASS** | Exact pins below; all runtime deps MIT/ISC/Apache-2.0/0BSD with licence files; registry sources copied by pinned CLI, SHA-256 recorded (`registry-provenance.json`). Registry URLs are unversioned → content-hash pinning only. |
| 2 | Common Base UI primitive foundation | **PASS** | Every required overlay/focus/input primitive is Base UI 1.9.0 (shadcn `base-nova` + Dice `diceui/base`). Resizable = react-resizable-panels, sortable = dnd-kit (primitive-free). Lockfile contains **0** `@radix-ui` packages: one focus/overlay system. |
| 3 | Production CSP in 3 engines | **PASS with mitigation** | With `<CSPProvider disableStyleElements>` + one owned CSS rule: 0 violations / 0 console errors in 13 functional tests × 3 engines. Without it: 1 `style-src-elem` violation (Base UI ScrollArea inline `<style>`) in all 3 engines. **No CSP change needed.** |
| 4 | Tailwind v4 + Vite+ (vite-plus-core 8.3.8000) | **PASS** | `@tailwindcss/vite` 4.3.5 works unmodified under `vp build`; peer `vite ^8` satisfied by the `vite` alias; no real `vite` package resolved. |
| 5 | Bundle impact | **PARTIAL** (measured; no budget exists to pass against) | +373.8 KiB raw / +121.9 KiB gzip / +102.5 KiB brotli JS and +46.6 / 8.3 / 7.3 KiB CSS over a minimal React baseline. Base UI is the largest addition (62.8 KiB gzip). Owner budget needed. |
| 6 | Accessibility / keyboard (Playwright) | **PARTIAL** | 14/14 tests pass in Chromium, Firefox and WebKit (42/42; 126/126 over `--repeat-each=3`), **but only after** 2 local patches and harness-level workarounds. Upstream defects found in Dice colour picker (keyboard/hex entry) and shadcn Slider wrapper (unnamed thumbs). |
| 7 | Token contrast | **PARTIAL** | All text pairs ≥ 4.5:1. Non-text failures: `border` #414347 1.31–1.76:1, slider track 1.11:1, lime ring on paper 1.15:1, lime ring on lime fill 1.00:1. Proposed `control-border` #787a7e (≥ 3.02:1 on all surfaces), destructive #ff8f85, warning #f2c14e. |

NOT RUN (CSP and a11y PASS do not cover these): dropdown-menu, dnd-kit `DragOverlay`/Sortable overlay, the dropzone drag-and-drop path, file-item preview (`blob:` image), the colour-picker eyedropper, `tailwindcss()` inside the root `lazyPlugins` config; real Safari (WebKit ≠ Safari), screen readers (VoiceOver/NVDA), touch/pen input, `prefers-reduced-motion` behaviour (CSS rule present, not tested), Windows/Linux, root `vp check`/lint over the copied sources, the root notices generator against these packages, `wrangler`/Cloudflare serving (a local server applies the same `_headers` rules), constrained hardware.

## 2. Exact pins

Runtime (bundled):

| Package | Version | Licence | Role |
|---|---|---|---|
| react / react-dom | 19.3.1 | MIT | unchanged root baseline |
| @base-ui/react | 1.9.0 | MIT | primitives (current name; `@base-ui-components/react` stops at 1.0.0-rc.0) |
| @base-ui/utils | 0.5.0 | MIT | imported directly by Dice sources |
| @dnd-kit/core · sortable · modifiers · utilities | 6.3.1 · 10.0.0 · 9.0.0 · 3.2.2 | MIT | Dice Sortable |
| react-resizable-panels | 4.24.1 | MIT | shadcn Resizable |
| lucide-react | 1.79.0 | ISC (+ MIT for Feather-derived icons) | icons |
| class-variance-authority | 0.7.1 | Apache-2.0 | shadcn button variants |
| cn | 0.5.2 | MIT | shadcn's clsx + tailwind-merge replacement (no build step required; `cn build` optional) |

Transitive runtime (from lockfile): @babel/runtime 7.29.15, @floating-ui/core 1.8.0, @floating-ui/dom 1.8.0, @floating-ui/react-dom 2.1.9, @floating-ui/utils 0.2.12, use-sync-external-store 1.7.0, reselect 5.3.0, @dnd-kit/accessibility 3.1.1, tslib 2.9.1 (0BSD), clsx 2.1.1, scheduler 0.28.0. Base UI's `date-fns`/`@date-fns/tz` peers are optional and not installed.

Build/dev: tailwindcss 4.3.5, @tailwindcss/vite 4.3.5 (MIT; pulls @tailwindcss/oxide 4.3.5, lightningcss 1.33.0, jiti 2.7.0 — prebuilt optional binaries, no install scripts), vite-plus 1.7.0, `vite` → npm:@voidzero-dev/vite-plus-core@8.3.8000, @vitejs/plugin-react 6.3.0, typescript 7.0.2, @playwright/test 1.65.1, @types/react 19.3.0, @types/react-dom 19.3.0, @types/node 24.19.2. Source-copy tool (not installed): shadcn CLI 4.23.0 (MIT, `pnpm dlx`; no telemetry strings in its dist).

Considered, not chosen: radix-ui 1.8.1 (not needed), tailwind-merge 3.7.1 (replaced by `cn`), tw-animate-css 1.4.0 (not installed; shadcn `animate-in/out` classes are inert in the harness — add only if motion is wanted), @dnd-kit/react 0.5.3 (pre-1.0 rewrite; Dice uses the 6.x API).

## 3. Registry provenance and variant availability

- shadcn/ui: style `base-nova` from `https://ui.shadcn.com/r/styles/base-nova/<item>.json`. The base-nova index lists 65 `registry:ui` items vs 64 for `radix-nova`; the sets are identical except a base-only `toast`. No base-nova `number-field` wrapper (Base UI has NumberField; harness uses `Input type=number`).
- Dice UI: `https://diceui.com/r/<item>.json`, registry index name `diceui/base`. `color-picker`, `sortable`, `file-upload` all exist and declare `@base-ui/react` + `@base-ui/utils`; a Radix variant location was not determined (the two guessed paths `/r/radix/color-picker.json` and `/r/base/color-picker.json` returned 404). Not relevant here: a few Dice items (combobox, listbox, mention, tags-input, checkbox-group) depend on Dice's own `@diceui/*` packages.
- Upstream heads at spike time (read with the authenticated `gh` CLI, not a generic-UA request; registry JSON itself was fetched with a generic UA): shadcn-ui/ui `055aa6b`, sadmann7/diceui `8b94856` (MIT, © 2024 Sadman Sakib), mui/base-ui `df28357`. Registry JSON was fetched twice ~1 h apart with identical hashes. Per-file SHA-256 (as written by the CLI, and current) are in `artifacts/design-system/registry-provenance.json`.
- CLI behaviour observed: `shadcn add` (without `init`) wrote caret ranges (`^1.9.0`, …) — re-pinned by hand; it did **not** install `lucide-react` or `class-variance-authority` although the copied files import them — added by hand. It spawns `pnpm add`, so it must run inside an isolated workspace (see §5).

## 4. Component assignment

| Feature | Chosen implementation | Primitive | Variant | Licence | Notes |
|---|---|---|---|---|---|
| Tool rail | owned buttons on shadcn `button` + `tooltip`, Lucide icons | Base UI Button, Tooltip | base-nova | MIT / ISC | `aria-label`, `aria-pressed`, `aria-keyshortcuts`; Base UI tooltip popup has no `role=tooltip`/`aria-describedby`, so the tooltip is visual only |
| Dialog | shadcn `dialog` | Base UI Dialog | base-nova | MIT | focus trap via Base UI focus guards |
| Popover | shadcn `popover` | Base UI Popover | base-nova | MIT | |
| Menu | shadcn `dropdown-menu` | Base UI Menu | base-nova | MIT | copied, **not exercised** (tree-shaken out) |
| Slider | shadcn `slider` (**patched**) | Base UI Slider | base-nova | MIT | see defects D1–D2 |
| Numeric input | shadcn `input` + owned commit logic | Base UI Input | base-nova | MIT | Base UI NumberField is the alternative if steppers/scrub are wanted |
| Scroll area | shadcn `scroll-area` | Base UI ScrollArea | base-nova | MIT | needs CSP mitigation (§6) |
| Select | shadcn `select` (dependency of colour picker) | Base UI Select | base-nova | MIT | |
| Resizable panels | shadcn `resizable` | react-resizable-panels 4.24.1 | — | MIT | cursor via constructable stylesheet (`adoptedStyleSheets`), CSP-safe |
| Colour picker | Dice `color-picker` (**patched**) | Base UI Popover/Slider/Select + own pointer-only area | diceui/base | MIT | see defects D3–D6 |
| Layer order | Dice `sortable` | dnd-kit 6.x + Base UI `useRender`/`mergeProps` | diceui/base | MIT | `onMove(activeIndex, overIndex)` maps to one domain command |
| Import | Dice `file-upload` | Base UI `useRender` + own logic | diceui/base | MIT | no network unless an `onUpload` callback is supplied; previews use `blob:` |
| Icons | lucide-react | — | — | ISC/MIT | all requested exports exist: MousePointer2, ScanLine, Scan, PenTool, Spline, Minimize2, Palette, Layers, SprayCan, Grid3X3 **and** Grid3x3, Combine, Eraser, WandSparkles, Download, Printer, Waves, Brush, Shuffle |
| Canvas | owned `<canvas>` + ResizeObserver | — | — | — | shows CSS px and DPR-scaled backing size |

Focus/overlay systems: Base UI (with Floating UI) only. dnd-kit adds its own keyboard sensor and `aria-live` region but no focus trap or overlay manager; its drag overlay is presentational. Minimal set = the 14 copied files listed in `registry-provenance.json` (dropdown-menu only if menus are needed).

## 5. Vite+ / Tailwind findings and required root changes

- Install isolation: both `pnpm install --ignore-workspace` and a local `pnpm-workspace.yaml` (`packages: []` + the root's `vite@*` override) keep the root lockfile untouched; both resolve `vite` to vite-plus-core 8.3.8000 with no real `vite` package. Only the local workspace file also isolates the CLI's spawned `pnpm add` (which does not carry `--ignore-workspace`), so the harness uses it.
- `@tailwindcss/vite` 4.3.5 (peer `vite ^5.2 || ^6 || ^7 || ^8`) works as a plain plugin under `vp build`; thin slice built in 83 ms, full harness in ~310 ms. Typecheck with TypeScript 7.0.2 passes over the copied sources; TS 7 rejects `baseUrl`, so use `paths` only.
- Root changes P1-B would need (not made here): (1) add the runtime deps above + `tailwindcss`/`@tailwindcss/vite` as exact pins; (2) `tailwindcss()` in the `lazyPlugins` list; (3) `@` → `src` alias in `vite.config.ts` + `paths` in `tsconfig.app.json` + `components.json` (`style: base-nova`, `iconLibrary: lucide`); (4) a CSS entry with `@import "tailwindcss"`, the shadcn `tailwind.css` custom variants (copied, MIT), semantic tokens and the `.base-ui-disable-scrollbar` rule; (5) wrap the root in `<CSPProvider disableStyleElements>`; (6) extend `scripts/generate-notices.mjs` for copied registry source (§10); (7) decide whether `src/components/ui/**` is formatted/linted by the root `vp check` (NOT RUN).

## 6. CSP results (exact `_headers` policy, production build, local static server)

`serve.mjs` parses `public/_headers` with the same rules as the root preview plugin; the first test asserts the served `Content-Security-Policy` equals the file line byte-for-byte.

| Check | Chromium 159.0.8154.6 | Firefox 159.0 | WebKit 27.2 |
|---|---|---|---|
| Mitigated build: violations / console errors across 13 functional tests (load, tooltip, dialog, popover, slider drag, Select, colour picker, sortable keyboard+mouse, resizable keyboard+pointer, file chooser, shortcuts) | 0 / 0 | 0 / 0 | 0 / 0 |
| Inline `<style>` elements in DOM after load | 0 | 0 | 0 |
| `.base-ui-disable-scrollbar` computed `scrollbar-width` | none | none | none |
| Positive control `?csp=default` (no CSPProvider) | 1 × `style-src-elem` at load (ScrollArea) | same | same |
| …then opening Base UI Select (listbox asserted visible) | 0 extra observed (cause not isolated; likely React 19 de-duplication of the same `href`) | 0 | 0 |
| Negative control: injected `<style>` reported | yes | yes | yes |
| Off-host requests (all routed to fail) | 0 | 0 | 0 |
| Tool-induced: Playwright `page.screenshot` | 0 | 0 | **1 × `style-src-elem`** (Playwright injects a `<style>`) |

Notes: React `style` props, Floating UI positioning and dnd-kit transforms use CSSOM and are not blocked. react-resizable-panels writes its global cursor rule into a constructable stylesheet, which `style-src` does not govern (pointer drag: 0 violations). Base UI's `PrehydrationScript` (inline `<script>`) only renders during SSR hydration; a client-only `createRoot` app never emits it (source inspection; 0 `script-src` violations observed). The built HTML has no inline script/style and the bundle references no remote assets (only XML namespace URIs and error-doc link strings).

Alternatives considered for the one violation: `style-src 'self' 'sha256-kLmvWqfziFavKtqHqRsb90f006UAK2Dmd0It5Iz2KFA='` (hash of Base UI's fixed CSS string; computed locally and identical to the hash Chromium and Firefox print in their blocked-style console messages; actually allowing it was NOT RUN) would likely work but couples the deployment CSP to library internals and breaks silently on upgrade; CSPProvider + owned rule is preferred. `unsafe-inline`/`unsafe-eval` not needed. Root-suite hygiene: drain violation logs before screenshots in WebKit.

## 7. Bundle (production, `vp build`, gzip -9, brotli q11; exact bytes in `bundle-sizes.json`)

| Build | JS raw | JS gzip | JS brotli | CSS raw | CSS gzip | CSS brotli |
|---|---|---|---|---|---|---|
| Baseline (minimal React counter, same toolchain) | 214.4 KiB | 66.2 KiB | 57.0 KiB | — | — | — |
| Harness | 588.3 KiB | 188.1 KiB | 159.5 KiB | 46.6 KiB | 8.3 KiB | 7.3 KiB |
| **Delta** | **+373.8 KiB** | **+121.9 KiB** | **+102.5 KiB** | +46.6 KiB | +8.3 KiB | +7.3 KiB |

Per-library attribution (`ANALYZE=1` build splits vendors into chunks; chunk totals equal the single bundle within 1 KiB):

| Chunk | Raw | Gzip | Brotli |
|---|---|---|---|
| react + react-dom + scheduler | 213.6 KiB | 65.8 | 56.7 |
| @base-ui (+ floating-ui, babel runtime, use-sync-external-store, reselect) | 189.1 | 62.8 | 54.6 |
| harness app + copied shadcn/Dice sources | 61.6 | 17.2 | 15.3 |
| react-resizable-panels | 47.1 | 15.0 | 13.5 |
| dnd-kit (+ tslib) | 44.7 | 14.5 | 13.2 |
| cn + cva + clsx | 26.1 | 10.8 | 9.4 |
| lucide-react (icons used by app + copied sources) | 6.5 | 2.8 | 2.5 |

Single chunk > 500 kB triggers the Vite warning; P1 should lazy-load rarely used surfaces (colour picker, export dialog). `cn build` (compile-time tables) is a possible ~10 KiB gzip saving, untested.

## 8. Accessibility / keyboard (Playwright, production build under CSP)

| Test | Chromium | Firefox | WebKit | Measured detail |
|---|---|---|---|---|
| Tool rail: 7 named buttons, `aria-pressed`, tooltip on Tab focus, Enter selects | PASS | PASS | PASS | 3 Tabs to first tool; tooltip opens on keyboard focus |
| Dialog: Enter opens, initial focus inside, Tab/Shift+Tab trapped, Escape closes, focus returns | PASS | PASS | PASS | stops: input, Close, Cancel, Export; initial focus lands one frame after open |
| Popover: Enter/Space open, focus moves in, Escape closes, focus returns | PASS | PASS | PASS | |
| Slider transaction | PASS | PASS | PASS | drag (10 moves) → 10 previews, **1** commit; keyboard 5× → 5 previews, **5** commits |
| Numeric input: Enter commits, clamp 250→100, Escape reverts | PASS | PASS | PASS | |
| Colour picker: keyboard open, hue arrows, Select keyboard, hex entry, Apply commits once, Escape cancels, focus returns | PASS* | PASS* | PASS* | *hex only via paste/`fill`; see D4 |
| Sortable: keyboard Space/↓/Space reorder; locked layer disabled | PASS | PASS | PASS | 1 move command; live region: `Sortable item "ink-1" dropped at position 2 of 4.` |
| Sortable: mouse drag reorder | PASS | PASS | PASS | 1 move command |
| Resizable: keyboard arrows and pointer drag; canvas CSS + backing size | PASS | PASS | PASS | 907→747→827 CSS px; backing 1814→1494→1654 at DPR 2 (WebKit) |
| File input: chooser opened by keyboard, local File listed, 0 requests | PASS | PASS | PASS | 0 requests of any kind during selection |
| Global shortcut: `p`/`v` work on canvas; blocked in number input, dialog text input, dialog button | PASS | PASS | PASS | guard: inputs, contenteditable, `[role=dialog/menu/listbox]` |

Defects found (upstream sources, all three engines):
- **D1** shadcn base-nova `Slider` drops `aria-label`; thumbs are unnamed (WCAG 4.1.2). Patched locally (forward to `Thumb`).
- **D2** shadcn `Slider` with a scalar `value` renders two thumbs (`[min, max]` fallback). Use array values or patch.
- **D3** Dice colour picker hue/alpha thumbs unnamed. Patched locally.
- **D4** Dice hex field is controlled and rejects unparseable intermediate text. Measured path: select-all then type `#3366cc` key by key → every key reverts the field to `#b5e87b`; programmatic `fill` (paste-like) works. Other typing strategies (e.g. same-length overwrite) not tried. Needs a draft-text input that commits on Enter/blur.
- **D5** Dice saturation/value area is pointer-only (`tabIndex -1`, no keyboard handler); keyboard users can only reach S/V through the HSL/HSB text inputs.
- **D6** With the harness's controlled `value`/`onValueChange` wiring, Dice `onValueChange` fired 2× on mount with no interaction and 4× per hue key press (8 for 2 presses); there is no commit/cancel API. The harness derives Apply/Cancel itself (controlled `open`, any close without Apply reverts).
- **D7** Base UI Slider calls `onValueCommitted` on every keyboard step. The command layer must coalesce (for example, merge consecutive same-parameter commits into one undo entry).
- **D8** dnd-kit default announcements use item IDs, not names; supply custom `announcements`.
- **D9** Base UI tooltip popups have no `role` and the trigger gets no `aria-describedby` (runtime DOM check), i.e. the tooltip is not associated with its trigger; accessible names and shortcuts must be on the trigger (`aria-label`, `aria-keyshortcuts`).

## 9. Contrast (WCAG 2.x; full table in `contrast.json`, script self-checks 21:1 and #777/#fff = 4.48)

| Pair | Ratio | Need | Result |
|---|---|---|---|
| foreground #eeeef0 on background / panel / elevated / canvas surround | 15.03 / 13.74 / 12.40 / 11.22 | 4.5 | PASS |
| muted #a9abad on the same four | 7.56 / 6.91 / 6.24 / 5.65 | 4.5 | PASS |
| primary #b9e87b as text on the same four | 12.35 / 11.29 / 10.19 / 9.22 | 4.5 | PASS |
| primary-foreground #20251a on primary | 11.11 | 4.5 | PASS |
| primary-foreground / background on paper #eee8d8 | 12.80 / 14.24 | 4.5 | PASS |
| proposed destructive #ff8f85 as text on the four surfaces | 7.89 / 7.22 / 6.51 / 5.90 | 4.5 | PASS |
| proposed warning #f2c14e as text on the four surfaces | 10.38 / 9.49 / 8.56 / 7.75 | 4.5 | PASS |
| background text on destructive / warning fill | 7.89 / 10.38 | 4.5 | PASS |
| destructive text on shadcn `destructive/10` over background / panel | 6.65 / 6.04 | 4.5 | PASS |
| border #414347 vs background / panel / elevated / canvas surround | 1.76 / 1.61 / 1.45 / 1.31 | 3 | **FAIL** (fine for decorative dividers; not for input or handle boundaries) |
| slider track (`bg-muted` = elevated) vs panel | 1.11 | 3 | **FAIL** |
| focus ring lime (opaque) vs the four surfaces | 12.35 – 9.22 | 3 | PASS |
| shadcn ring `ring/50` blended vs the four surfaces | 4.02 / 3.88 / 3.70 / 3.53 | 3 | PASS (thin margin) |
| lime ring on paper / on a lime-filled control without offset | 1.15 / 1.00 | 3 | **FAIL** |
| selected tool (lime fill vs panel; icon on lime) | 11.29 / 11.11 | 3 | PASS |
| proposed `control-border` #787a7e vs the four surfaces | 4.05 / 3.70 / 3.34 / 3.02 | 3 | PASS |

Proposals: keep `border` for dividers and add `control-border` #787a7e for input outlines, slider tracks and resize handles; destructive #ff8f85 and warning #f2c14e as above; on paper and on lime fills, the focus ring needs a dark inner ring or offset (background on paper = 14.24:1).

## 10. Licence and notice obligations

- npm runtime (`pnpm licenses list --prod`): 20 MIT (including react, react-dom, scheduler), 1 Apache-2.0 (cva, LICENSE only, no NOTICE file), 1 ISC (lucide-react; its LICENSE also carries MIT © Cole Bemis for Feather-derived icons, e.g. `minimize-2`, `upload`, `download`, `lock`), 1 0BSD (tslib). Every package ships a licence file (checked), so the root source-map notices generator should pick them up (NOT RUN).
- Copied source is not an npm package and is invisible to the source-map pipeline: shadcn/ui registry code (MIT © 2023 shadcn), Dice UI registry code (MIT © 2024 Sadman Sakib) and shadcn `tailwind.css` (MIT). P1 must add a copied-source manifest (URL + hash, like `registry-provenance.json`) and their licence texts to `THIRD-PARTY-NOTICES.txt`.
- Tailwind CSS (MIT) preflight is emitted into the shipped CSS (banner `tailwindcss v4.3.5 | MIT License` retained); include it in the notices, since the CSS is not covered by JS source maps.
- No fonts, images or remote assets; system font stack only.

## 11. Blockers and alternatives

No blocker to D09's direction (shadcn base-nova + Dice UI on one Base UI foundation). Required before P1-B adoption:
1. Colour picker (D3–D6): patch the Dice source (draft hex input, keyboard S/V area as a 2-D slider, coalesced/de-duplicated changes, explicit commit/cancel); or replace it with an owned picker built from Base UI Slider × 3 + hex input. Either path stays inside Base UI.
2. Slider wrapper patch (D1/D2) and command-layer coalescing for keyboard commits (D7).
3. Tokens: add `control-border`; set the focus-ring treatment for paper and lime fills.
4. Root: CSPProvider + owned CSS rule, plus a CSP regression test with positive and negative controls (as here).
5. Notices for copied source and Tailwind CSS.
6. Explicit Move up/down layer commands for discoverability, plus name-based dnd-kit announcements (D8). The dnd-kit keyboard path already works.
7. Bundle budget decision; lazy-load the colour picker and dialogs.

## 12. Reproduction

```sh
cd experiments/rfc-002-review/design-system-harness
export DO_NOT_TRACK=1
pnpm install --frozen-lockfile
pnpm run typecheck            # tsc 7.0.2 --noEmit
pnpm run build                # dist/app, dist/baseline, dist/analyze (vp build ×3)
pnpm test                     # 14 tests × chromium/firefox/webkit against node serve.mjs (exact _headers)
pnpm run report               # summarize.mjs, measure.mjs, contrast.mjs → artifacts/design-system/*.json
(cd ../../.. && pnpm exec vp fmt docs/research/rfc-002-review/artifacts/design-system)   # root formatter on artifact JSON
pnpm exec playwright test --repeat-each=3                                                 # stability run
```

Source acquisition (already done; re-running it overwrites files and needs a new hash review):
`DO_NOT_TRACK=1 pnpm --ignore-workspace dlx shadcn@4.23.0 add --yes button input slider tooltip popover dialog dropdown-menu resizable scroll-area https://diceui.com/r/color-picker.json https://diceui.com/r/sortable.json https://diceui.com/r/file-upload.json`, followed by re-pinning to exact versions, adding `lucide-react` and `class-variance-authority`, and applying patches D1 and D3 (marked `R05-A patch` in source).

Artifacts: `playwright-results.json` (status and measured notes per test/engine), `csp-violations.json` (per engine/test violations, console errors, off-host requests), `bundle-sizes.json`, `contrast.json`, `registry-provenance.json`, screenshots `harness-{chromium,firefox,webkit}.png` and `harness-chromium-color-picker.png` (244 KB total).

## 13. Environment

macOS 26.6.2 (25G83) arm64; Node 24.22.1; pnpm 12.23.0; vp 1.7.0 (vite-plus-core 8.3.8000); Playwright 1.65.1 with Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2 (pre-installed browsers, not re-downloaded). Final run: 42 passed, 0 flaky, 0 retries; `--repeat-each=3` on the final suite revision minus the last two assertion additions (listbox visible, console-message capture): 126/126.
