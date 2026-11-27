# G-PRJ-R — Impeccable design review record

This records how the installed Impeccable skill (v4.11.0; detector 0.1.30) was used throughout G-PRJ-R's product design, as the brief §8 requires. It covers:
- which operations ran;
- what each found;
- what changed as a result;
- what was deliberately rejected.

The surface is Operate mode: a project-home start screen and the workspace project controls.

## 1. Preparation
- **Skill read and followed:** `~/.claude/skills/impeccable/SKILL.md`, then the playbooks `shape.md`, `new-work.md`, `operate.md`, `critique.md`, `critique-rubric.md` (through Assessment A), `audit.md` and `craft-floor.md` (read by the builder before any UI code).
- **Context loaded with `impeccable context --target src/shell/Workspace.tsx`.** It read `PRODUCT.md`, the `DESIGN.md` map and `.impeccable/design-full.md`, and reported that `docs/DESIGN-SYSTEM.md` and RFC-002 §16 are normative. The output was archived (`scratchpad/impeccable-context.txt`).
- **Directives followed:**
  - The design-detector hook is not installed. It stays uninstalled (brief §8.1: no hooks or settings changes), and the detector is run manually instead.
  - The `CONTEXT_STALE` "hook-not-installed" finding is reported once, not repaired.
  - An update notice (v4.11.1) is mentioned once; no update was run.
  - Interview steps are kept live through the structured-question tool.
- **Prior use studied:** the G-UI-R Impeccable runs (critique 23/40; audit 14/20, then 15/20 final), what they changed, and what the maintainer rejected (the splitter overlay, replaced by 24 px strips). Summarised in [sources/DESIGN-CONTEXT.md](sources/DESIGN-CONTEXT.md) §5.
- **Approved records** (`DESIGN.md`, `docs/DESIGN-SYSTEM.md`, `.impeccable/design-full.md`) were not modified. The world is inherited, not replaced: a new surface inside an established world (new-work §3).

## 2. Initial design direction (shape and new-work decision round)
1. **Discovery round** (structured questions, 2026-11-26). The maintainer chose:
   - **the project home first** when nothing is open (M-1);
   - a **full-screen start screen** (M-2).
2. **Structures.** Seven materially different structures were derived from the task and ordered by resonance:
   1. action column + artwork wall;
   2. artwork-first gallery;
   3. resume hero + shelf;
   4. sidebar library;
   5. timeline list;
   6. single-column launcher;
   7. keyboard-first command home.
3. **`impeccable concept-seed --scope surface --mode operate`** dealt indices **3, 2, 6** (3 leading); seed reference `seed:4dea934f2c506be4`. The catalog's visual-world challengers were not used, because the world is settled.
4. **Sketches.** Three first-viewport HTML sketches (1440 × 900, inline CSS, no JavaScript, real fixture artwork) were written in parallel, per the PRESENTATION rules ([`mockups/decision/`](mockups/decision/)):
   - A: resume hero with shelf;
   - B: artwork-first gallery;
   - C: single-column launcher.
5. **Presentation through the structured-question fallback**, with the sketches sent as images. The maintainer was on Remote Control, where the localhost decision page is unreachable, and the PRESENTATION rules name this fallback. The maintainer chose **A** (M-3), the dealt lead. Impeccable's anonymous choice ping was **not** sent (R-8).
6. **Direction contract** written to the surface brief, `.impeccable/surfaces/prototypes-g-prj-home-index-html.md`, and verified to have all six blocks and the seed reference. Build path: **code-led** (Operate mode).
   - THESIS: "a resume desk, not a dashboard".
   - Signature interaction: the recovery choice rewrites Resume's consequence line.

## 3. Prototype (v1)
- **Built code-led** against the contract and the craft floor, as an isolated dev-server-only prototype ([`prototypes/g-prj/home/`](../../../prototypes/g-prj/home/)).
- **It reuses** `src/ui` registry components (Button, Dialog, DropdownMenu, Popover, Input, Tooltip) and the tokens.
- **States (12):**
  - empty, populated, recovery, library, storage;
  - workspace, workspace-recovery-kept;
  - unsaved, history-budget, conflict, save-failed, download-saved.
- **Captures:** at 1024 × 640, 1280 × 720, 1366 × 768 and 1920 × 1080, plus 390 × 844 for recovery and empty: [`mockups/v1/`](mockups/v1/) (WebP).
- **Maintainer requirement during the build (M-4):** Open last save keeps the recovery snapshot. Added as the consequence line and the `workspace-recovery-kept` state.

## 4. Critique (v1)
**Method:** dual-agent, isolated as `critique.md` requires.
- A: design review against the rubric, with its own browser session and keyboard walk-throughs.
- B: the detector: a CLI scan, then 12 URL scans at 1366 × 768, 1024 × 640 and 390 × 844.
- Snapshot: `.impeccable/critique/2026-11-27T04-14-53Z__prototypes-g-prj-home-index-html.md`.

**Score: 27/40 (Acceptable).**

| # | Heuristic | v1 | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Kept-recovery status reads as dirty at 1024 px; disappears at 200 % zoom |
| 2 | Match with the real world | 3 | "Rename" forks a file (Save As); "blank ivory artboard" |
| 3 | User control and freedom | 3 | Other projects' recovery has no choice when opened |
| 4 | Consistency and standards | 2 | Open… twice; two storage totals; ⌘N against spec §9; Close project leaves an empty workspace |
| 5 | Error prevention | 3 | Focus leak in workspace dialogs; Rename forks |
| 6 | Recognition rather than recall | 3 | No visible Save while Export is lime |
| 7 | Flexibility and efficiency | 2 | No F2; ⌘N can't work in tabs; 2 Tab stops per tile |
| 8 | Aesthetic and minimalist design | 3 | Storage figures on every visit; dead gaps |
| 9 | Error recovery | 3 | "File unavailable" points to a menu |
| 10 | Help and documentation | 2 | No first-launch explanation of `.vectra` |

**Priority issues:**
- **P1:** recovery designed for the most recent project only;
- **P1:** status meaning and zoom;
- **P1:** workspace modal focus;
- **P2:** inert first launch;
- **P2:** verb and spec mismatches;
- **P3:** skipped heading level.

**Detector findings (all confirmed):**
- flat-type-hierarchy ×8: partly intentional, within the approved 11/12/13/15 scale;
- skipped-heading ×2;
- low-contrast advisory ×2: the shared registry's destructive button at 4.46:1.

**Maintainer's answers to the critique's questions (2026-11-26):**
- fix **all P1 and P2** issues;
- **swap the hero preview** with the recovery choice;
- storage speaks **only when at risk**;
- **tracing is the front door** at first launch.

## 5. Audit (v1)
**Method:** `audit.md` was followed as a delegated, read-only run.
- Every state was measured in Chromium; the focus and trap checks also ran in Firefox and WebKit.
- Contrast was computed against the composited background, verified against the documented 7.56:1 calibration.
- 200 % zoom was emulated at 683 × 384 with a device scale factor of 2.
- The detector ran on the sources (`[]`, a regex-only undercount).

**Score: 13/20 (Acceptable).**

| # | Dimension | v1 | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | Enter in a tile rename field resumes a different project (all 3 engines). A focused control is fully hidden under the sticky header at 200 %. Destructive text is 4.43:1 |
| 2 | Performance | 3 | Registry `transition-all` and animation classes that do nothing; no long tasks; CLS 0 |
| 3 | Theming | 3 | Zero hex colours in the prototype; off-scale 14/16/12.8 px come from registry defaults |
| 4 | Responsive design | 2 | At 200 % the workspace top bar overlaps itself and the save status shrinks to 0 px |
| 5 | Implementation integrity | 3 | **Pass:** coherent and token-driven. Resume without recovery opens the wrong state; `key={save.kind}` remounts the status |

**Findings:** P0 0 · P1 4 · P2 5 · P3 4.
- **P1:**
  1. the Enter shortcut;
  2. the top bar at 200 % zoom (WCAG 1.4.4);
  3. focus hidden under the sticky header (WCAG 2.4.11);
  4. destructive text at 4.43:1, and 3.61:1 on hover (WCAG 1.4.3), in the shared registry.
- **P2:**
  - focus drops to `body` after actions;
  - a remounted live region;
  - the save-failed popover swallows the first Tab;
  - the wrong Resume route;
  - status text truncated to a sliver.
- **P3:**
  - off-scale sizes and arbitrary values;
  - heading and landmark gaps;
  - inert animation classes;
  - a modal trap that relies on an asynchronous focus guard (escapes only with key presses 0 ms apart; it held at ≥ 16 ms in all engines, under load and throttling).

**Reconciling with the critique's P1 "focus escapes the workspace dialogs":** the audit reproduced the escape only with synthetic Tab presses 0 ms apart. It happened equally in the home and the workspace and in all three engines, so it is a property of the shared Base UI dialog, not of the workspace. **Downgraded to P3**; the capture scripts now space key presses.

**Registry-level findings** (shared `src/ui/registry`, so production too; **not fixed in G-PRJ-R**, which does not touch `src/`):
- destructive tint contrast;
- `shrink-0` on Button;
- 14 and 16 px defaults;
- `transition-all`;
- animation classes with no keyframes.

They are recorded as F-12 and TD-UI-008. The prototype overrides them locally where they affect it.

## 6. Targeted refinement
*Pending.*

## 7. Revised mockups and before/after
*Pending.*

## 8. Final design review
*Pending.*

## 9. Recommendations deliberately rejected
*Pending.*
