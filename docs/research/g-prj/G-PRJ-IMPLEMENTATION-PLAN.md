# G-PRJ-R — Implementation plan (proposal)

**Status:** proposal, refined from the brief's sequence by the dependencies found in this research. Each stage is its own gate, branch and PR, with maintainer acceptance before the next begins. No stage begins without approval of G-PRJ-R.

## Dependency summary
- **The invariant comes first.** Without compact encoding and a persistable-size limit, Save can produce files that cannot be reopened (w996k is refused today). So **G-PRJ-0** precedes any visible Save.
- **AM-3 (contract and RFC changes) gates storage work.** RFC-002 §14 currently excludes autosave, libraries and recent files. G-PRJ-2 and G-PRJ-3 cannot begin before AM-3.1 is approved.
- **Source attachment is a prerequisite of "complete restoration".** The workspace never attaches the source image (audit), so G-PRJ-1 wires it.
- **The project home (G-PRJ-4) needs** the library (G-PRJ-2) and recovery (G-PRJ-3) to show anything real; a home with only New, Open and Import is possible earlier, as G-PRJ-1's empty state.

## Stages
### G-PRJ-0: Persistence limits and contract closure
- **Scope:**
  - C10 v2 compact canonical encoding, with the v1 reader kept;
  - the frozen canonical hash re-baselined under change control;
  - the persistable document-section size computed incrementally per transaction and enforced like the anchor cap;
  - `saveContainer` no longer calls `markSaved`;
  - a pre-flight size check before hashing and deflating;
  - AM-3 recorded.
- **Acceptance:**
  - w996k and limit-500k save and reopen;
  - a transaction that would exceed the limit is refused before commit, with its error;
  - v1 golden files still load;
  - frozen exports unchanged;
  - G-DOC-R dispatch thresholds held, since accounting adds ≤ 1 ms per transaction;
  - a differential test (≥ 10k) of the incremental size against a full serialization.
- **Out of scope:** UI, storage.
- **Stop if:** the incremental size disagrees with a full serialization in any test, or the export hashes change.

### G-PRJ-1: Portable Save, Save As, Open, Download a copy
- **Scope:**
  - `ProjectStore` and the persistence worker (serialize, deflate, verify by reload);
  - File System Access in Chromium (save in place with conflict detection);
  - `<input type=file>` and downloads elsewhere;
  - source attachment wired into imports;
  - workspace top-bar project controls (name, File menu, save status);
  - the unsaved-changes guard on Open, New and close;
  - the shortcut contract;
  - load moved off the main thread.
- **Acceptance:**
  - round trip byte-identical across engines (4 × 4 portability);
  - a verified write precedes every "Saved" status;
  - a download is never shown as "Saved";
  - open of the interactive target ≤ 1 s and ≤ 50 ms blocking (proposed);
  - permission denial and external modification handled.
- **Out of scope:** library, autosave, project home.
- **Stop if:** any save indication can precede an unverified write, or the main-thread budget cannot be met.

### G-PRJ-2: Local project library and recents
- **Requires** AM-3.1.
- **Scope:**
  - the OPFS library with pointer-flip publication;
  - the IndexedDB index, with recents and persisted handles in Chromium;
  - rename, duplicate, delete-from-this-browser, remove-from-recent;
  - the storage panel, with `persist()` requested after the first library save;
  - thumbnails rendered by the render worker.
- **Acceptance:**
  - index–OPFS reconciliation;
  - quota and eviction behaviour;
  - multi-tab locks;
  - no artwork deleted by a "remove" action;
  - thumbnails never in files or exports.
- **Stop if:** any library entry can be offered that does not reopen.

### G-PRJ-3: Autosave and crash recovery
- **Requires** AM-3.1.
- **Scope:** the recovery writer (debounce, codec `none`, worker sync handles), session locks, the recovery offer, retention, and the version-skew rules.
- **Acceptance:**
  - every fault-injection point in the recovery contract §9;
  - main-thread cost ≤ 16 ms per snapshot (proposed);
  - **Open last save keeps the snapshot until an explicit Discard or retention expiry** (maintainer requirement);
  - recovery never overwrites a newer base without consent.
- **Stop if:** a partial snapshot can be offered, or a snapshot ever marks a project saved.

### G-PRJ-4: Project home and workspace integration
- **Scope:**
  - the project home from the approved design (UX spec; Impeccable-reviewed prototype);
  - first launch and the empty state;
  - launch routing: the installed app's `start_url` and the workspace entry show the home when nothing is open; direct workspace access remains;
  - `file_handlers` for installed Chromium apps (optional);
  - the Project home command.
- **Acceptance:**
  - the design review against the approved mockups at 1024 × 640 through 1920 × 1080;
  - keyboard and VoiceOver (owner);
  - no fictional content in production.
- **Stop if:** the home hides artwork access behind the library (the portable path must always be one action away).

### G-PRJ-5: Destructive-operation safeguards and TD-UI-006
- **Scope:**
  - every destructive confirmation: delete, discard recovery, clear recents, replace project;
  - the TD-UI-006 commit-without-history confirmation: Cancel is the default; it discloses that undo and redo are cleared and offers Save a copy first; the revision is re-validated before commit; `withoutHistory` is never invoked automatically.
  - Also an investigation (no contract change) of whether unrelated history can be preserved.
- **Acceptance:** each confirmation's default is the safe choice; TD-UI-006 closure criteria met.
- **Stop if:** any path calls `withoutHistory` without the confirmation.

### G-PRJ-Q: Integrated qualification
- The [qualification plan](G-PRJ-QUALIFICATION-PLAN.md) matrix on the final build, including real Safari and the installed PWA.
- Owner checks: VoiceOver and the stock-Safari keyboard check.
- Performance thresholds as approved at G-PRJ-0.

## Alternatives considered
- **Library before portable files:** rejected. The portable file is authoritative, and the invariant must hold first.
- **Autosave inside G-PRJ-1:** rejected. It is a separate trust boundary and needs AM-3.1.
- **One combined gate:** rejected. Too large to review, and its stop conditions would interact.
