# G-UI-R final audit (Impeccable `audit`), merged head `2303e18`

**Date:** 2026-11-25. **Target:** `workspace.html`, the G-UI-R workspace merged with #19's corrected head (`2303e18`; the canvas host draws its own focus ring, and the crash-fallback host-state fix `17a3ac0` is included). **Branch:** `gate/g-ui-r-audit`, created from `2303e18`; this file is its only change.

**Command:** Impeccable `audit` only (skill 0.1.30, detector 4.11.0), invoked through the Skill tool. Telemetry, update check, taste and switch sync were off, and the account was not signed in. No other Impeccable command was run, and nothing was fixed. The audit's own `audit-storage` save step was **not** run: this file is the retained record, and nothing else is committed.

**Context the loader resolved:** `PRODUCT.md`, `DESIGN.md` (map of DESIGN-SYSTEM §4/§13), platform `web`. Mode: **Operate**, a docked editor.

**Environment:**
- macOS 26.6.2 (Darwin 25.6.0 arm64), Node 24.22.1, pnpm 12.23.0, Playwright 1.65.1 (Chromium, Firefox, WebKit; WebKit is not Safari).
- Build: `pnpm run build` (55 notices verified, dist check passed).
- Server: `pnpm exec vp preview --host 127.0.0.1 --port 4193 --strictPort`, stopped afterwards.
- The machine is shared and was not quiet. Load averages (1/5/15 min): 3.26 / 2.59 / 2.08 at the start (other Playwright runs active), 1.57–4.12 during the probes, 1.68 / 2.05 / 2.03 at the end. No timing figure here is a quiet-machine measurement.

## Evidence (how each dimension was measured)
| Evidence | Method | Result |
|---|---|---|
| Detector, source | `impeccable detect --json workspace.html src/shell src/ui` | 0 failures; 3 advisories (`design-system-color`): the modal scrim `rgb(10 10 12 / 0.6)` and the picker's `#000`/`#fff` value gradient (`src/ui/styles.css:135, 178`) |
| Detector, live page, empty state | `detect --json --viewport W×H http://127.0.0.1:4193/workspace.html` at 1920×1080, 1366×768, 1024×640 | 0 findings at each size |
| Detector, live page, with a document | `detect --json --cdp` against a headless Chromium with the Hokusai fixture traced as Limited Palette (1,613 paths). 7 states at 1366×768 and 1024×640: layer selected, mixed-fill picker open, Recolor, Layers collapsed, export dialog, canvas keyboard focus, `?renderer=main` fallback (14 scans) | `tiny-text` (warning) in 13 scans; `repeating-stripes-gradient` (advisory) in 12; `flat-type-hierarchy` (advisory) in 6; `text-occlusion` only with the picker open (2 scans). All verified in context below |
| Names, landmarks, headings | ARIA snapshot and DOM, 3 engines, empty and document states | 0 unnamed buttons, text fields, sliders or separators. Landmarks: banner, navigation "Tools", region "Canvas", complementary "Inspector", region "Layers", contentinfo; **no `main`**. Headings: h2 (tool name, Layers), h3 (sections); **no h1** |
| Focus | Tab from the top through every stop (250 ms settle), 3 engines. Screenshot of the focused canvas | Every stop shows the 2 px lime outline. The canvas element has no outline of its own: its ring is drawn by the canvas host's last layer, and is visible in the screenshot |
| Rendered text contrast | Every visible text element. Colours resolved by a 2-D canvas, which handles `oklab` and `color-mix`; backgrounds composited up the tree. Chromium; path selected; Select and Recolor tools; fallback disclosure shown | Lowest **6.15:1** (11 px meta on the tinted "Contains selection" row), then 6.91 (muted on panel). Empty state lowest **5.64:1** (`ink-muted` on paper, 12 px). All ≥ 4.5 |
| Target size (WCAG 2.5.8) | Every visible interactive box under 24 CSS px, with the 24 px-circle spacing test, 3 engines | See P2-2. The hidden file input (1 × 1, `aria-hidden`, `tabindex=-1`) is not a target. The Scale thumb (10 × 10) passes by the equivalent-control exception (the 28 px Scale value field) |
| Reflow and overflow | 1024×640, and 683×384 (the CSS size of 1366×768 at 200 % zoom), 3 engines | No horizontal or vertical page scroll. Top bar, rail, Export and the status bar stay on screen; the inspector scrolls inside its column |
| Touch | Computed `touch-action` plus code. **Gestures were not synthesised** | Canvas host `none`, resize handles `none`, slider control `touch-none`, colour area `touch-none`. Layer reorder uses dnd-kit's TouchSensor (250 ms long press), so the handle's `auto` is correct |
| Reduced motion | `emulateMedia({ reducedMotion: "reduce" })` | Transitions resolve to 0.00001 s. State changes stay visible: the pressed colours, the "Tracing…" text and Cancel |
| Interaction cost | Chromium `longtask` observer, 1,613-path layer selected: 20 keyboard Scale steps, then 10 tool switches | **0 long tasks** (> 50 ms). The 20 steps took 134 ms wall time, automation included |
| Bundle | `node docs/research/g-ui/measure-bundle.mjs` on this build | Design-system JS **114.3** / 150 KiB gzip; workspace CSS **9.4** / 15; total initial workspace JS **230.6** / 250 |
| Pressed-tool hover | Computed style of the Select button: loaded, after a click with the pointer still on it, then with the pointer away (Chromium) | On hover the background becomes `oklab(0.2848 −0.0004 −0.0039 / 0.5)` while the icon stays `rgb(32, 37, 26)`. See P2-1 |

## Audit health score
| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | Names, focus, contrast and live regions are sound. A pressed tool's icon vanishes while hovered (P2-1), and the inspector splitter's hit area is 8 px (P2-2) |
| 2 | Performance | 3 | No long tasks in inspector edits on 1,613 paths. No blur, and cached tree queries. Initial JS is at 92 % of its budget |
| 3 | Theming | 3 | Tokens throughout; dark-only and deterministic by design. A few literals remain (two `text-[…px]` sizes; the scrim is not in DESIGN.md), and the registry ghost hover overrides a call-site state (P2-1) |
| 4 | Responsive design | 3 | Holds at 1024×640 and at 200 % zoom without page scroll. Touch drag surfaces declare `touch-action`, but no gesture was exercised. Below-24 px splitter (P2-2) |
| 5 | Implementation integrity | 3 | Coherent, product-specific system. The detector warnings are explained below. One integration defect (P2-1) and small consistency gaps |
| **Total** | | **15/20** | **Good** (address the weak spots) |

## Implementation integrity verdict
**Pass.** The workspace expresses one product-specific system: the charcoal/lime/ivory print studio, docked panels, a property-sheet inspector, and tokens from `src/ui/styles.css` used everywhere but the literals listed in P3-4. Only working tools are shown. Statuses are in words. The strict CSP holds: no inline `<style>`, and dynamic colours go through CSSOM properties.

Detector findings, verified in context:
- **`tiny-text` (real, minor; P3-1).** The selector is `p.text-2xs.text-pretty`: the three-line Fill note and the Trace preset note, set at 11 px. Similar guidance elsewhere (the Recolor lock note, the Document and empty-inspector notes) is 12 px. The 11 px role is meant for meta, so this is a role inconsistency.
- **`repeating-stripes-gradient` (false positive).** This is `.vx-swatch-mixed`, the functional "mixed fill" indicator required by the maintainer's decision 8 (DESIGN-SYSTEM §13). It appears only in states with a mixed fill, and it is not decoration.
- **`flat-type-hierarchy` (accepted advisory).** An 11/12/13/15 px role scale is deliberate for a dense editor; weight and case separate the levels (DESIGN-SYSTEM §13).
- **`text-occlusion` (false positive).** It fires only while the colour picker is open: the popover covers inspector text by design. At 1024×640 it flips above the trigger and also covers the top bar's Import and Export. It fits the viewport, and Escape or an outside click closes it.
- **`design-system-color` (advisory, P3-4).** The scrim is documented in DESIGN-SYSTEM §13 but not in DESIGN.md's tokens. The picker's black and white gradients are colour mathematics, not theme.

## Executive summary
- **15/20, Good.**
- 0 P0, 0 P1, 2 P2, 6 P3.
- Top issues:
  1. A pressed tool's icon disappears while the pointer is over it (P2-1).
  2. The inspector/canvas splitter is an 8 px pointer target (P2-2).
  3. Inconsistent type role for guidance notes (P3-1).
- No defect blocks a task. Both P2s are small, contained shell changes in G-UI-R-owned files. **Not fixed here, as instructed.**

## Findings by severity
### P2-1 Pressed rail tool: icon vanishes on hover
- **Location:** `src/shell/Workspace.tsx:179` (`IconAction`, pressed class), with `src/ui/registry/button.tsx:15–16` (ghost variant).
- **Category:** Accessibility, Theming.
- **Cause:** the registry ghost variant carries `dark:hover:bg-muted/50`. The call site passes `hover:bg-primary/90`, which has a different variant prefix, so `cn` keeps both, and the `dark:hover:` rule wins. On hover the pressed tool's background becomes 50 % `muted`. The call site's `hover:text-primary-foreground` keeps the icon dark (`rgb(32, 37, 26)`).
- **Impact:** the selected tool's icon is about **1.0:1** against its hovered background (computed from the measured colours). It reappears when the pointer leaves, and the tooltip still names the tool. It is seen in every state after the artist clicks a tool.
- **Standard:** WCAG 1.4.11 Non-text Contrast (3:1), in the hover state.
- **Recommendation:** add `dark:hover:bg-primary/90` (or an owned pressed class) to the pressed state, and assert the hovered colour in `ui-shell`.
- **Suggested command:** `$impeccable polish`.

### P2-2 Inspector splitter: 8 px pointer target
- **Location:** `src/shell/Workspace.tsx:731–732` (`Resize inspector`: a 1 px box with an `after:w-2` hit area).
- **Category:** Accessibility, Responsive.
- **Impact:** an 8 × 696 px target is hard to grab with a trackpad or with motor impairments. The spacing test fails: the canvas is within 12 px. Keyboard resizing works, but it is not a pointer alternative. The Layers splitter is 296 px wide and passes.
- **Standard:** WCAG 2.5.8 Target Size (Minimum).
- **Recommendation:** widen the hit area to 24 px (`after:w-6`), centred on the hairline; the visible hairline does not change. Check that it does not take clicks from the inspector scroll thumb.
- **Suggested command:** `$impeccable adapt`.

### P3-1 Guidance notes at the 11 px meta size
- **Location:** `src/shell/Inspector.tsx:354` (Fill note), `src/shell/Workspace.tsx:518` (Trace note).
- **Category:** Implementation integrity (type roles).
- **Impact:** multi-line guidance at 11 px muted text, while equivalent notes are 12 px. Contrast passes (6.91:1 measured). The detector flags it in 13 of 14 document scans.
- **Recommendation:** use the 12 px control/body role (`text-xs`) for multi-line guidance, and keep 11 px for meta.
- **Suggested command:** `$impeccable typeset`.

### P3-2 No `main` landmark or `h1`
- **Location:** `src/shell/Workspace.tsx` (layout).
- **Category:** Accessibility (semantics).
- **Impact:** screen-reader users cannot jump to the main area, and the heading outline starts at h2. Landmarks otherwise exist (banner, Tools, Canvas, Inspector, Layers, contentinfo), so this is minor.
- **Standard:** WCAG 1.3.1 / 2.4.1 (best practice).
- **Recommendation:** make the canvas-and-panels row `main`, and give the document title an h1, which can be visually unchanged.
- **Suggested command:** `$impeccable harden`.

### P3-3 Plain Tab in WebKit's default mode skips some buttons but not their neighbours
- **Location:** `src/shell/LayersPanel.tsx`: the "Layers" disclosure and the layer-row select button are native `<button>`s. Registry (Base UI) buttons set `tabIndex=0` explicitly.
- **Category:** Accessibility (keyboard consistency).
- **Impact:** in Playwright WebKit, plain Tab reaches Hide, Lock and More, but skips the Layers disclosure and the row's select button (and the Scale range input). Option-Tab reaches everything. Real Safari's default ("Press Tab to highlight each item" off) is expected to behave the same; **this needs confirmation in real Safari** (`tests/safari/gui.mjs`, lead-owned).
- **Recommendation:** pick one rule for the Layers row and header: all reachable by plain Tab (`tabIndex=0`, or the registry Button), or all Option-Tab only.
- **Suggested command:** `$impeccable harden`.

### P3-4 Token literals
- **Location:**
  - `Workspace.tsx:193` `text-[11px]` (tooltip kbd; `text-2xs` exists);
  - `:557` `text-[15px]` (wordmark; `text-title` exists);
  - `:691` `shadow-black/40`;
  - `styles.css:135` scrim, not in DESIGN.md.
- **Category:** Theming.
- **Impact:** none visible; the risk is drift.
- **Recommendation:** use the type tokens, and add the scrim (and the mixed hatch) to DESIGN.md's tokens.
- **Suggested command:** `$impeccable document`.

### P3-5 "No fill" shown as black
- **Location:** `src/shell/Inspector.tsx:342` (`fill.color === null ? "#000000"`).
- **Category:** Implementation integrity.
- **Impact:** a path without a fill is named "Fill colour: #000000" and shows a black swatch; only the note says "No fill". Traces always have fills, so this needs a loaded or edited document with an unfilled path. It is the same class of misrepresentation that decision 8 removed for mixed fills.
- **Recommendation:** a "None" state, like the mixed state.
- **Suggested command:** `$impeccable harden`.

### P3-6 Copy and naming left open
- **Location:** `workspace.html:9`, `<title>Vectra · Studio</title>`; the Fill note, "Apply gives them all this colour."
- **Category:** Implementation integrity (copy).
- **Impact:**
  - The tab title keeps "Studio" after the label beside the wordmark was removed (maintainer decision 6). That may be intended product naming ("Vector Creation Studio").
  - With the trigger reading "Mixed", "this colour" has no visible referent.
  - Both are the maintainer's call; neither is a defect.
- **Suggested command:** `$impeccable clarify`.

## Patterns and systemic issues
- **Registry hover styles can override call-site state styles.** The `dark:hover:` rules in copied shadcn variants survive `cn` merging whenever the call site uses a plain `hover:` (P2-1). Any future pressed or selected state on a ghost or outline button has the same exposure; an owned "pressed" class would close it.
- **The 11 px role is drifting from "meta" into "body".** P3-1 is the visible case.

## Positive findings
- Every control is named (0 unnamed in 3 engines). Names, states and shortcuts sit on the triggers.
- The dual focus ring is visible on every Tab stop. The canvas host's own ring is visible above the artwork (the shell workaround is gone).
- Rendered text contrast is ≥ 5.64:1 everywhere measured, including the tinted selection row and the paper sheet.
- The renderer is silent when healthy and discloses the fallback in a live region. The status region stays mounted. Errors are alerts.
- The layout holds at 1024×640 and at 200 % zoom with no page scroll. Layers keep their pixel height on resize. The Layers disclosure has `aria-expanded`.
- No long tasks while editing 1,613 paths. No full-screen blur. Tree queries are cached per immutable state. Bundle within budget.
- Strict CSP intact; the detector finds 0 failures in the source.

## Recommended actions
1. **[P2] `$impeccable polish`:** the pressed tool's hover state (P2-1).
2. **[P2] `$impeccable adapt`:** a 24 px hit area for the inspector splitter (P2-2).
3. **[P3] `$impeccable typeset`:** 12 px for multi-line guidance notes (P3-1).
4. **[P3] `$impeccable harden`:** a `main` landmark and h1 (P3-2); consistent Tab reachability in the Layers row (P3-3); a "None" fill state (P3-5).
5. **[P3] `$impeccable document`:** the scrim and mixed-hatch tokens in DESIGN.md; type tokens for the two literals (P3-4).
6. **[P3] `$impeccable clarify`:** the tab title and the Fill note wording, if the maintainer wants them changed (P3-6).
7. **`$impeccable polish`:** a final pass after the fixes.

Re-run `$impeccable audit` after the fixes.

## Not run
- Real Safari (the screen was locked; the lead runs it).
- VoiceOver.
- Synthesised touch gestures.
- Windows, Linux and lower-end hardware.
- Quiet-machine timing.
- Impeccable's `audit-storage` save step.

Raw probe outputs, CDP scans and screenshots are kept locally, not committed, under `tests/output/g-ui-r-audit/` (gitignored).
