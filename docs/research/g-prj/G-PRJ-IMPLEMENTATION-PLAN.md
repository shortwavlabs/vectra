# G-PRJ-R — Implementation plan (proposal)

**Status:** **approved (maintainer, 2026-11-27; D-PRJ-12)**, refined from the brief's sequence by the dependencies found in this research. Each stage is its own gate, branch and PR, with maintainer acceptance before the next begins. **G-PRJ-0 is authorized**; no later stage begins without acceptance of the one before it.

**Standing rules for every stage:**
- the installed Impeccable skill is mandatory for every user-facing stage, with an actual critique, audit, refinement and final design review, documented findings and before/after evidence ([decisions](G-PRJ-DECISIONS.md) §6.8);
- **TD-UI-008 is corrected before any production destructive project control** is introduced (it first matters in G-PRJ-2: Delete from this browser), with destructive text contrast qualified at rest, hover, focus and disabled, in the shared design system;
- unrelated UI fixes are never bundled into a stage;
- no deployment, release tag or new production dependency; R-COLOR and G-COLOR-UI stay untouched;
- qualification evidence is preserved under the evidence-preservation policy.

## Dependency summary
- **The invariant comes first.** Without compact encoding and a persistable-size limit, Save can produce files that cannot be reopened (w996k is refused today). So **G-PRJ-0** precedes any visible Save.
- **AM-3 (contract and RFC changes) gates storage work.** RFC-002 §14 currently excludes autosave, libraries and recent files. AM-3.1 is approved (2026-11-27) and is recorded formally through change control in G-PRJ-0.
- **Source attachment is a prerequisite of "complete restoration".** The workspace never attaches the source image (audit), so G-PRJ-1 wires it.
- **The project home (G-PRJ-4) needs** the library (G-PRJ-2) and recovery (G-PRJ-3) to show anything real; a home with only New, Open and Import is possible earlier, as G-PRJ-1's empty state.

## Stages
### G-PRJ-0: Persistence foundations and contract closure (authorized 2026-11-27)
- **Scope** (the maintainer's G-PRJ-0 authorization):
  - compact C10 v2 canonical document encoding, with every default and canonical omission rule defined per field, and malformed or ambiguous encodings rejected;
  - strict v1 and v2 readers; deterministic default reconstruction; v1 → v2 migration verified independently of ordinary v2 round trips;
  - exact incremental persistable-size accounting from immutable document identity and the transaction-local write log, covering every serialized component (map keys, punctuation, metadata, root ordering, high-water marks, changes outside the node map), with an independent full-serialization oracle;
  - transactional enforcement before publication, over the complete container ([limits](G-PRJ-PERSISTENCE-LIMITS.md) §9);
  - pre-flight validation before expensive serialization, hashing and compression;
  - removal of the premature `markSaved` (AM-3.4);
  - the approved AM-3 amendments, through change control; historical v1 fixtures and hashes preserved, v2 hashes re-baselined explicitly.
- **Acceptance:**
  - round trips for the existing v1 golden files, the interactive workload, w756k, w996k, limit-500k (where it fits every approved limit), large palettes and provenance, multiple embedded sources, and documents at the exact permitted boundary;
  - atomic rejection of the first transaction exceeding any applicable persistence limit;
  - frozen export equivalence;
  - G-DOC-R requirements and accepted exceptions held; accounting overhead measured separately, ≤ 1 ms per ordinary transaction, reported as integrated dispatch timings; no full-document traversal on ordinary edits;
  - at least 10,000 randomized differential transactions plus a broader adversarial corpus, with exact byte agreement, rejected transactions, undo/redo, coalescing and history branching;
  - any materially retained serialization cache accounted under AM-2, never retaining predecessor states.
- **Out of scope:** Save UI, library, autosave, production project home.
- **Stop if:** the incremental size disagrees with a full serialization in any test, the export hashes change, or a required workload cannot fit (report the exact limit; limits are never raised silently).

### G-PRJ-1: Portable Save, Save As, Open, Download a copy
- **Scope:**
  - `ProjectStore` and the persistence worker (serialize, deflate, verify by reload);
  - File System Access in Chromium (save in place with conflict detection);
  - `<input type=file>` and downloads elsewhere;
  - source attachment wired into imports;
  - workspace top-bar project controls (name, File menu, save status);
  - the unsaved-changes guard on Open, New and close;
  - the shortcut contract;
  - load moved off the main thread, within the worker boundaries of [architecture](G-PRJ-ARCHITECTURE.md) §4.1;
  - the saved-version identity (`versionDigest`, architecture §5.2) and the classified portable-write failures (§5.4);
  - download semantics per D-PRJ-4 (validated before hand-off, "Download requested", revision-bound confirmation);
  - source embedding by default per D-PRJ-10, with the explicit oversized-source resolution.
- **Acceptance:**
  - round trip byte-identical across engines (4 × 4 portability);
  - a verified write precedes every "Saved" status, and zero unreopenable successful saves;
  - a download is never shown as "Saved";
  - open of the interactive target ≤ 1 s and ≤ 50 ms blocking (approved), with parsing, validation and the whole main-thread hand-off measured separately;
  - permission denial and external modification handled, with the remaining race disclosed.
- **Impeccable:** the workspace project controls are user-facing: critique, audit, refinement and final review, with before/after evidence.
- **Out of scope:** library, autosave, project home.
- **Stop if:** any save indication can precede an unverified write, or the main-thread budget cannot be met.

### G-PRJ-2: Local project library and recents
- **Requires** AM-3.1 (approved) and **TD-UI-008 corrected** (Delete from this browser is the first production destructive project control).
- **Scope:**
  - the OPFS library with pointer-flip publication, generations, and the orphan sweep of the [recovery contract](G-PRJ-RECOVERY-CONTRACT.md) §4;
  - the IndexedDB index, with recents and persisted handles in Chromium, and the race-safe handle registry ([concurrency](G-PRJ-CONCURRENCY-CONTRACT.md) §1.1);
  - new projects in the library from their first edit, and the temporary session when storage is unavailable (D-PRJ-5);
  - rename, duplicate, delete-from-this-browser, remove-from-recent;
  - the storage panel, with `persist()` requested after the first successful library save (D-PRJ-7);
  - thumbnails rendered by the render worker.
- **Acceptance:**
  - index–OPFS reconciliation;
  - every publication fault case, by fault injection;
  - quota and eviction behaviour;
  - multi-tab locks and lock races;
  - no artwork deleted by a "remove" action;
  - thumbnails never in files or exports.
- **Impeccable:** critique, audit, refinement and final review of the library and storage surfaces.
- **Stop if:** any library entry can be offered that does not reopen.

### G-PRJ-3: Autosave and crash recovery
- **Requires** AM-3.1 (approved).
- **Scope:** the recovery writer (debounce, codec `none`, worker sync handles), session locks and claims (acquire before acting), the recovery offer, retention (14 days for ordinary snapshots; an only known copy never expires automatically), and the version-skew rules.
- **Acceptance:**
  - every fault-injection point in the recovery contract §9;
  - main-thread cost ≤ 16 ms per snapshot (approved); the 30 s lag target under healthy conditions, with "Recovery is behind" disclosed otherwise;
  - **Open last save keeps the snapshot until an explicit Discard or retention expiry** (maintainer requirement); no implicit discard, merge or overwrite;
  - recovery never overwrites a newer base without consent.
- **Impeccable:** critique, audit, refinement and final review of the recovery offer and status.
- **Stop if:** a partial snapshot can be offered, or a snapshot ever marks a project saved.

### G-PRJ-4: Project home and workspace integration
- **Scope:**
  - the project home from the approved design: direction A, "Resume hero with shelf" (D-PRJ-13), rebuilt in production code; the research prototype is a reference, not a production-qualified interface. The Show all projects view follows the compact list design;
  - first launch and the empty state;
  - launch routing: the installed app's `start_url` and the workspace entry show the home when nothing is open; direct workspace access remains;
  - `file_handlers` for installed Chromium apps, as a progressive enhancement that portable access never depends on (D-PRJ-11);
  - the Project home command.
- **Impeccable:** a full critique, audit, refinement and final review of the production surface, with before/after evidence against the approved mockups.
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
