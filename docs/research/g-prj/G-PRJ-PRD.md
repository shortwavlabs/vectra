# G-PRJ — Product requirements: project management and persistence

**Status:** proposal for maintainer approval (G-PRJ-R). It defers to `docs/PRD.md`, `docs/PRD-002-VECTOR-STUDIO.md` and RFC-002 except where AM-3 ([decisions](G-PRJ-DECISIONS.md)) is approved.

## 1. Goal
Vectra becomes a studio where artists can invest hours in a piece with confidence. They can start a project, save it as a file they own, close the browser, come back, and find the work exactly as committed. When something goes wrong (a crash, a reload, a full disk, a revoked permission), they are told plainly what is safe, and offered their work back.

## 2. Users and situations
- **The returning artist:** opens Vectra to continue yesterday's piece. Needs "Resume" in one action, with honest state: is it saved, where, and are there newer unsaved changes?
- **The starting artist:** opens Vectra to trace a new image, or to start blank. Needs the three ways in, explained once.
- **The careful artist:** keeps files in their own folders and backups and moves between machines. Needs Save, Save As and Open of a portable `.vectra`, and needs to know what the browser keeps.
- **The interrupted artist:** the tab crashed, the laptop slept, the browser updated. Needs recovery that never lies about what is saved.

## 3. Principles (from the brief; binding)
1. No account, no mandatory cloud, no subscription, and nothing uploaded.
2. Fully functional offline.
3. Portable, user-owned project files are authoritative.
4. **No silent data loss.** Every destructive action is explicit and named.
5. **Every successfully saved project reopens** under the supported limits, and the app never exceeds them silently.
6. Equivalent functionality between the browser tab and the installed app wherever the platform permits. Where it does not (File System Access is Chromium-only), the difference is stated, not hidden.

## 4. Requirements
| ID | Requirement | Stage |
|---|---|---|
| PRJ-1 | Save, Save As and Open of `.vectra` projects; Download a copy; open on another machine | G-PRJ-1 |
| PRJ-2 | Complete restoration of the committed editable artwork: layers, groups, paths, transforms, clips, palettes, styles, artboard, trace provenance, embedded source assets | G-PRJ-1 (sources: D-PRJ-10) |
| PRJ-3 | Unsaved-change tracking by state identity. "Saved" appears only after a verified write; a download is labelled as a download | G-PRJ-0/1 |
| PRJ-4 | Persistability enforced: a change that would make the project unsaveable is refused before commit, with an actionable message; no save is ever refused for a document the app accepted | G-PRJ-0 |
| PRJ-5 | Unsaved-changes guard on Open, New, Project home and replace: Save, Don't save, Cancel (default) | G-PRJ-1 |
| PRJ-6 | A local project library: named projects, thumbnails, last-edited times, search and sort when many, grid and list, rename, duplicate, remove from recent, delete browser-stored projects, storage and file-availability states | G-PRJ-2 |
| PRJ-7 | Projects are always distinguished as backed by a portable file, stored in this browser, unsaved drafts, recovery snapshots, or recent references to unavailable files | G-PRJ-2 |
| PRJ-8 | Removing a recent reference never deletes artwork. The recent list is never the only path to artwork | G-PRJ-2 |
| PRJ-9 | Autosave for recovery after committed transactions (debounced, periodic); revision-aware; atomic publication; survives crashes, reloads and interrupted writes; quota- and eviction-aware; retention and cleanup | G-PRJ-3 |
| PRJ-10 | Recovery never marks a project saved, and never overwrites a newer portable project without consent. **Choosing "Open last save" keeps the snapshot available to revisit** | G-PRJ-3 |
| PRJ-11 | A project home: New project, Open, Resume the most recent, Recover when applicable; recent artwork leads; purposeful first launch; no fictional content in production | G-PRJ-4 |
| PRJ-12 | Workspace project controls: project name, File menu, Save and Save As, Open, New, Project home, save status, autosave/recovery status, save failures, permission expiry; Export (SVG/PDF) clearly separate from saving | G-PRJ-1/4 |
| PRJ-13 | A cross-platform shortcut contract that does not override browser commands indiscriminately | G-PRJ-1 |
| PRJ-14 | Transparent storage controls: where projects live, which have file copies, approximate use, recovery retention, the consequences of clearing browser data, and separate actions for clearing recents, removing recovery data, deleting a browser project, and deleting or overwriting a file | G-PRJ-2 |
| PRJ-15 | Concurrency: the same project in two windows is detected; there is no silent last-writer-wins | G-PRJ-2/3 |
| PRJ-16 | Thumbnails are derived locally from committed artwork, bounded, never transmitted, never in files or exports, and stale states are shown | G-PRJ-2 |
| PRJ-17 | TD-UI-006: confirmation to commit without history. It discloses that undo and redo are cleared, Cancel is the default, it offers Save a copy first, and it re-validates the revision | G-PRJ-5 |

## 5. Non-goals
- Accounts, cloud sync, collaboration, sharing links.
- Persisted undo history (RFC-002 §14 kept; architecture §8).
- A new project format (`.vectra` evolves by versioning only, under change control).
- iOS qualification.
- G-COLOR-UI, R-COLOR, CMYK, Precision v2, deployment.

## 6. Success measures (proposed thresholds in the [qualification plan](G-PRJ-QUALIFICATION-PLAN.md) §2)
- **Integrity:** zero saved projects that fail to reopen, across the qualification matrix, every workload and every engine.
- **Honesty:** zero "Saved" indications without a verified write; zero recovery snapshots presented as saves.
- **Speed:** open of the interactive target ≤ 1 s with ≤ 50 ms main-thread blocking; an explicit save ≤ 1 s to verified completion (proposed).
- **Recovery:** after a forced kill, the work lost is at most the debounce window (2 s idle, 30 s maximum, proposed).
