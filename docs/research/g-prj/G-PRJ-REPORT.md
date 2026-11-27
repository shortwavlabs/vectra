# G-PRJ-R — Project management and persistence: research and design report

**Status: research and design complete for maintainer review. Nothing is implemented in production.** Every implementation stage waits for approval of this phase ([decisions](G-PRJ-DECISIONS.md) §4–§5).

| | |
|---|---|
| Base | `main` `276c1ec347387da73db4bf034cede07da42844b9` (G-DOC-R accepted for integration) |
| Branch | `gate/g-prj-r` (worktree `.claude/worktrees/g-prj-r`) |
| Mandate | The maintainer's "G-PRJ: Project Management and Persistence" brief (2026-11-26), phase G-PRJ-R |
| Machine | Apple M5 Max, 128 GiB, macOS 26.6.2. Shared, not quiet; load recorded per run |
| Engines | Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2, **real Safari 26.6.2** |
| Production change | **None.** Research harnesses live in `scripts/g-prj/`; the prototypes in `prototypes/g-prj/` are served by the dev server only and are not in `vite.config.ts`'s build inputs |

## Documents
| Document | Content |
|---|---|
| [G-PRJ-PRD](G-PRJ-PRD.md) | Goals, users, principles, requirements PRJ-1…17, non-goals, success measures |
| [G-PRJ-ARCHITECTURE](G-PRJ-ARCHITECTURE.md) | What exists today; the three persistence tiers; capability tiers; components; the verified save transaction; project identity; thumbnails; undo history; AM-3 |
| [G-PRJ-PERSISTENCE-LIMITS](G-PRJ-PERSISTENCE-LIMITS.md) | The 64 MiB investigation: sizes, compact encoding, save, restore, memory, main-thread blocking; options; recommendation |
| [G-PRJ-STORAGE-COMPARISON](G-PRJ-STORAGE-COMPARISON.md) | IndexedDB, OPFS, File System Access, `persist()`, input and download, from probes and cited documentation |
| [G-PRJ-RECOVERY-CONTRACT](G-PRJ-RECOVERY-CONTRACT.md) | Autosave triggers, atomic publication (pointer flip), crash detection with Web Locks, the recovery offer, failures, retention |
| [G-PRJ-CONCURRENCY-CONTRACT](G-PRJ-CONCURRENCY-CONTRACT.md) | Multi-tab and multi-window rules, conflicts, ordering, what is not promised |
| [G-PRJ-UX-SPEC](G-PRJ-UX-SPEC.md) | Project home, first launch, recovery, library, workspace controls, dialogs, storage, shortcuts, accessibility, navigation |
| [G-PRJ-IMPECCABLE-REVIEW](G-PRJ-IMPECCABLE-REVIEW.md) | The Impeccable process: context, decision round, prototype, critique, audit, refinement, final review |
| [G-PRJ-QUALIFICATION-PLAN](G-PRJ-QUALIFICATION-PLAN.md) | Measurement rules, proposed thresholds, the production qualification matrix |
| [G-PRJ-IMPLEMENTATION-PLAN](G-PRJ-IMPLEMENTATION-PLAN.md) | G-PRJ-0 … 5 and Q, with acceptance criteria, scope boundaries and stop conditions |
| [G-PRJ-DECISIONS](G-PRJ-DECISIONS.md) | Research decisions, findings, decisions already taken, amendments (AM-3), decisions requested |
| [sources/](sources/) | Persistence audit, storage research with citations, design-context digest |

## 1. Recommended persistence architecture
- **Three tiers that never share a status word** ([architecture](G-PRJ-ARCHITECTURE.md) §2):
  - **Portable `.vectra` files** are authoritative. Explicit Save, Save As and Download a copy only. "Saved" appears only after a verified write.
  - **The local project library** keeps OPFS `.vectra` containers, indexed in IndexedDB: convenient resumption, always with Download a copy.
  - **Recovery snapshots** are OPFS, codec `none`, debounced after committed transactions. They never mark a project saved.
- **Capability tiers:**
  - File System Access (save in place, handle-backed recents) exists **only in Chromium**.
  - Firefox and Safari open with a file input and save by download, and the UI says so.
  - Library, recovery, Web Locks and BroadcastChannel work in all engines, real Safari included.
- **Atomicity:**
  - write-new, verify-by-reload, then flip the pointer in a strict IndexedDB transaction;
  - never rename: `move()` is non-standard, and Safari needs two arguments;
  - never relying on fsync, which `close()` does not promise.
- **Already in the code** (audit): a complete, strict `.vectra` v1 and state-identity dirty tracking. **Missing:**
  - every UI path;
  - verified saves (today `saveContainer` marks the session saved before writing);
  - source attachment;
  - any storage API.

## 2. The 64 MiB document-section investigation
- **The cap is reached by node count:**
  - 217–220 bytes per node for synthetic traces, 348–385 for photographic ones (per-path styles, palette and provenance);
  - so the cap holds about 305k synthetic nodes or about 190k photographic paths;
  - **w996k is 69.3 MiB and is refused today.**
- **Compact canonical JSON** omits default fields and the `id` implied by its key. It is lossless (round trip asserted) and gives **0.594–0.597** of the size (synthetic) and **0.747–0.772** (photographic):
  - w996k becomes **41.4 MiB**;
  - the 1M-anchor synthetic case becomes 62.6 MiB.
- **Not sufficient alone:** style-heavy documents near the anchor cap still exceed the cap. Hence the recommendation: **compact C10 v2 plus a persistable-size limit enforced per transaction, with 64 MiB kept.**
- **Loading w756k** blocks browser main threads for **160–333 ms** and peaks at about 719 MiB RSS in Node. Parsing moves to a worker.
- Details: [limits](G-PRJ-PERSISTENCE-LIMITS.md).

## 3. Browser storage capability matrix
In summary ([storage](G-PRJ-STORAGE-COMPARISON.md) §1):
- **Real Safari 26.6.2:**
  - OPFS writable streams, sync access handles, abort-safe writes, IndexedDB blobs, Web Locks and BroadcastChannel all work;
  - **no** File System Access pickers;
  - `move()` needs `(dir, name)`;
  - `persist()` returned false;
  - quota about 77 GiB.
- **Firefox 159:** the same, minus File System Access; `persist()` prompts.
- **Chromium 159:** everything, including `launchQueue` and Storage Buckets.
- **Playwright WebKit** fails OPFS and IndexedDB in its ephemeral context, so it is not storage evidence.

## 4. Proposed autosave and recovery contract
- **Snapshots:**
  - debounced 2 s after the last commit, at most every 30 s, and on hide;
  - written new, verified, then the pointer flipped;
  - detected after a crash by an unheld Web Lock;
  - offered beside the save they diverged from.
- **"Open last save" keeps the snapshot to revisit** (maintainer requirement).
- **Retention:** 14 days, proposed.
- **Quota exhaustion** pauses recovery, with a status.
- Details: [recovery contract](G-PRJ-RECOVERY-CONTRACT.md).

## 5. Project home and workspace design
*See §8 below and the [Impeccable review](G-PRJ-IMPECCABLE-REVIEW.md).*

## 6. Implementation sequence
G-PRJ-0 (limits and contracts) → 1 (portable Save/Open) → 2 (library) → 3 (recovery) → 4 (project home) → 5 (safeguards, TD-UI-006) → Q ([plan](G-PRJ-IMPLEMENTATION-PLAN.md)).

## 7. Qualification criteria
The [qualification plan](G-PRJ-QUALIFICATION-PLAN.md) holds the matrix. Its proposed thresholds are not approved:
- open of the interactive target ≤ 1 s with ≤ 50 ms blocking;
- explicit save ≤ 1 s to verified completion;
- snapshot ≤ 16 ms of main thread;
- zero unreopenable saves.

## 8. Design outcome
*Filled in after the Impeccable reviews.*

## 9. Amendments and decisions for the maintainer
AM-3.1 to AM-3.5, and D-PRJ-1 to D-PRJ-13 ([decisions](G-PRJ-DECISIONS.md) §4–§5).

## 10. Evidence
| Record | What |
|---|---|
| [`bench/persistence-limits-8b6c451.json`](bench/persistence-limits-8b6c451.json) | Node sizes, compact encoding, save, load, peak RSS |
| [`bench/browser-load.json`](bench/browser-load.json) | Browser load-and-validate and frame gaps |
| [`bench/storage-probe.json`](bench/storage-probe.json) | Storage capabilities in 4 engines |
| [`mockups/`](mockups/) | Decision sketches, prototype captures before and after refinement |
| `sources/` | Audit, research, design digest |
