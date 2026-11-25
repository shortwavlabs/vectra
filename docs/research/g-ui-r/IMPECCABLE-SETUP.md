# Impeccable setup (G-UI-R maintainer review, §B)

**Date:** 2026-11-25. **Branch:** `gate/g-ui-r-review`. **Impeccable:** skill and engine 0.1.30 (`~/.claude/skills/impeccable`, engine `~/.impeccable/bin/0.1.30`), invoked through the Skill tool (`impeccable`, args `doctor`).

**Environment for every run:** `DO_NOT_TRACK=1 IMPECCABLE_NO_TELEMETRY=1 IMPECCABLE_NO_UPDATE_CHECK=1 IMPECCABLE_NO_TASTE=1 IMPECCABLE_NO_SWITCH_SYNC=1`, from the worktree root. Not signed in.

**Commands run:**
- `impeccable doctor --json`, before and after the change;
- `impeccable context --target src/shell/Workspace.tsx`, before and after, to see what the loader resolves (`IMPECCABLE_NO_STALENESS_CHECK=1` as well).

**Not run:**
- `doctor --fix`: no `auto` finding;
- `hooks on` or `off`, `design-compact`, `document`, `init`, `detect`;
- any audit or other design command. The final audit is the lead's, after the canvas-host fix.

## What doctor reported (before)
`productPath: null`, `designPath: docs/DESIGN.md`, `platform: null`; `packages/vector-engine-wasm` was seen as a workspace, so `isMonorepo` was true. The loader also printed `NO_PRODUCT_MD`, and it read **`docs/DESIGN.md`**, which is the superseded P0 baseline (its own banner says the normative UI is DESIGN-SYSTEM and RFC-002 §16), as the design record.

| Finding | Severity | Summary |
|---|---|---|
| `design-md-coverage` | mention | `docs/DESIGN.md` has no colors, typography or components section |
| `design-md-sprawl` | route | `docs/DESIGN.md` (1,709 bytes) is carried as a map |
| `hook-not-installed` | route | no design hook in `.claude/settings.local.json` |

## Diagnosis
**Root cause: no design record at the project root.** The loader's search order found `docs/DESIGN.md`, so every Impeccable pass took design guidance from the superseded preset-gallery baseline. It held no tokens, so it also reported missing coverage. There was no product record either.

## What changed, and why
| File | Change | Why |
|---|---|---|
| `DESIGN.md` (new, project root) | The approved tokens from DESIGN-SYSTEM §4 and §13 as DESIGN.md frontmatter (14 colours, the 11/12/13/15 px type roles, radii, 4 components), and the canonical sections, each a short summary of DESIGN-SYSTEM §4, §8, §9, §13 and this review's decisions | The loader now resolves the approved system, not the superseded file. The file says it is a map, that DESIGN-SYSTEM.md and RFC-002 §16 win on any conflict, and that the values live in `src/ui/styles.css` (every colour matches that file; doctor reports no colour drift) |
| `PRODUCT.md` (new, project root) | `## Platform: web`, plus users, purpose, positioning, constraints, principles and accessibility, each taken from PRD, PRD-002 (as amended at G-0), RFC-002 and DESIGN-SYSTEM, with links to them | It removes `NO_PRODUCT_MD`, and it records the platform, which was unknown before. It adds no claim: no customers, benchmarks, pricing or new direction |
| `docs/DESIGN.md` | unchanged | It is a historical record outside this gate's files. It is no longer the resolved design record |

No `.impeccable/` folder, config or sidecar was written. No dependency was added. Nothing outside the worktree was written.

## After
`productPath: PRODUCT.md`, `designPath: DESIGN.md`, `platform: web`. `design-md-coverage` is gone. The loader prints the approved palette, the type roles and the do's and don'ts, and maps `src/ui/styles.css`, DESIGN-SYSTEM and RFC-002.

| Finding | Severity | Disposition |
|---|---|---|
| `design-md-sprawl` | route | **Not acted on.** DESIGN.md is now 6,177 bytes, so the loader carries it as a map and agents read sections on demand; that is the intended behaviour. `design-compact --write` would move the file to `.impeccable/design-full.md` and needs the maintainer's consent (doctor Step 5) |
| `hook-not-installed` | route | **Not installed.** `hooks on` writes a PostToolUse hook into `.claude/settings.local.json`, which is Claude Code's own configuration. A delegated agent cannot authorise that change. The file is also per-developer and gitignored (`*.local`), so in a worktree it would never reach the branch. If the maintainer wants per-edit detection, they can run `impeccable hooks on` themselves. Until then, the loader asks for one manual detector run at the end of UI work (`MANUAL_DETECTOR_REQUIRED`) |
| `workspace-context-inherited` | mention | `packages/vector-engine-wasm` inherits the root records. It is the WASM engine package with no UI, so inheriting them does no harm; no child record is needed. `packages/` is outside this gate's files |

`buildPath` is not recorded: no answer was given, and Operate surfaces build code-first either way.
