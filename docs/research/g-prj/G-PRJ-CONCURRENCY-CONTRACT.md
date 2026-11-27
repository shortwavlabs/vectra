# G-PRJ-R — Concurrency and failure-safety contract

**Status:** **accepted (maintainer, 2026-11-27)** with the refinements of [decisions](G-PRJ-DECISIONS.md) §7.1, §7.2 and §7.4, reconciled below. **Principle:** explicit conflict detection, never silent last-writer-wins. Recovery never overwrites a newer portable project without consent.

## 1. Primitives (available in every engine: Chromium, Firefox, real Safari; probed)
- **Web Locks** (`navigator.locks`):
  - `vectra:project:<projectId>`: held exclusively by the session editing a library project, or a file-backed project in Chromium (handle identity, below);
  - `vectra:session:<sessionId>`: held by every live session for its lifetime. Acquiring another session's lock is how a tab **claims** its recovery record ([recovery](G-PRJ-RECOVERY-CONTRACT.md) §5);
  - `vectra:handle-registry`: held briefly while a Chromium file handle is matched to, or registered as, a project.
- **Scope of Web Locks.** They coordinate **cooperating sessions of this origin in one browser profile**: tabs, windows and installed-app windows. They do not protect against other applications writing the same file, other browsers, or other profiles.
- **Acquire, never infer.** A decision that acts on shared state (opening for edit, claiming a recovery record, deleting, sweeping) is taken while holding the relevant lock, after re-reading the state inside it. `locks.query()` drives display hints only: a lock can be taken between a query and the action it would justify.
- **BroadcastChannel** `vectra-library`: index-change notifications between tabs and windows of the same origin, browser and installed app alike. Advisory: a missed message never causes data loss, because every reader re-reads IndexedDB.
- **The saved-version identity** `versionDigest` ([architecture](G-PRJ-ARCHITECTURE.md) §5.2): SHA-256 over the canonical list of every section's id, kind, uncompressed length and SHA-256. It covers the document, every geometry record and every embedded source. **A document-section digest alone never certifies that two versions are equal.**
- **Revision and base** per session (recovery contract §2).

### 1.1 Race-safe identity and locking
- **Handle identity (Chromium).** Opening a file handle as a project:
  1. acquire `vectra:handle-registry`;
  2. compare the handle with every registered handle (`isSameEntry`), and reuse that project id, or register a new one in one IndexedDB transaction;
  3. release the registry lock;
  4. request `vectra:project:<id>` with `ifAvailable`.

  Two tabs opening the same file at once therefore resolve to **one** project id, and only one of them gets the project lock. The registry lock is a Web Lock rather than an IndexedDB transaction because `isSameEntry` is asynchronous, and an IndexedDB transaction commits as soon as it awaits anything else.
- **Project locking.** Editing, saving, renaming and deleting a library project all require its project lock, acquired, not queried.
- **Stale-session recovery claims.** A tab acts on a recovery record only while holding that record's session lock (granted with `ifAvailable`), and only after re-reading the record inside it. Two tabs racing for one record end with exactly one claim.

## 2. Deterministic behaviour per case
| Case | Behaviour |
|---|---|
| **The same library project opened in a second tab or window** | The second session asks for the project lock with `ifAvailable`. When it is held, the second window shows a calm notice, "This project is open in another window", with **Switch to it** (`BroadcastChannel` asks the owner to focus, where the platform allows) and **Open a copy** (a duplicate with a new project id). No read-only editing mode in P1 |
| **The same portable file opened twice** (Chromium handles; §1.1) | As above, through the handle registry. In Firefox and Safari the two opens are separate uploads with no shared identity: they are two independent projects, and the second save is just another download |
| **Two installed app windows**, or a browser tab plus the installed app | One origin, the same locks and channel: handled identically |
| **Concurrent modification** (only possible across *different* projects, given the lock) | Independent |
| **A stale File System Access permission** (`queryPermission` ≠ granted) | Save asks for `requestPermission` on the user gesture. If denied: "Vectra can't write to `name.vectra` any more", offering **Save As** and **Download a copy**; the project stays dirty |
| **The portable file changed externally** since it was opened or last saved (Chromium: `getFile().lastModified` and size, then `versionDigest` when they differ, against the base) | Before overwriting: "`name.vectra` changed on disk since you opened it", offering **Save As**, **Overwrite**, **Cancel** (the default). Never a silent overwrite. **A race remains** (§4): a non-cooperating writer can change the file between this check and the browser's replacement |
| **A service-worker update during a save or recovery** | C5 isolation: the old tab keeps its build's workers until reload. The save completes on the old build or fails as classified in architecture §5.4; the update waits (G-JOB contract) |
| **Interrupted autosave** | Recovery contract §4: the record still names verified generations; unpublished generation files are swept once their owner is dead |
| **A failed or cancelled save** | Classified by when it failed (architecture §5.4). **Before replacement**: the previous file is expected intact. **After replacement with failed verification**: the previous file is *not* claimed untouched; the file may be damaged. In every case the session stays dirty, the failure is disclosed, and Save As to a new file and Download a copy are offered |
| **Project replacement during a trace or export job** | Already handled: the job's result for the old document arrives `stale: document_replaced` and is never applied (`jobs/controller.ts:159,200`). G-PRJ adds the unsaved-changes guard *before* replacement (UX spec §10). An export in flight finishes into its own snapshot (`controller.ts:373-391`) |
| **Recovery against a newer base** | Recovery contract §6: the base changed, so "Save recovered version as a copy" is offered; the default never overwrites |
| **The library index disagrees with OPFS** (crash between file and index updates) | The index is advisory. Entries are re-verified at listing; a damaged `current` falls back to `previous` (recovery §4.3); with no usable generation, the entry shows "Missing — remove from list?". An unindexed OPFS project is re-indexed at startup ("Found 1 project not in your list") |
| **Two tabs deleting or renaming the same library project** | Both require the project lock (deletion fails when another window has the project open). Renames broadcast; the last committed IndexedDB transaction wins for the *name* only, never for artwork bytes |

## 3. Ordering rules
1. Artwork bytes are written and verified **before** any index record points to them.
2. Index records are deleted **before** artwork bytes, and only after the project lock is acquired.
3. A save takes the project lock (in Chromium, a file-backed project's lock, keyed through the handle registry) for its whole duration.
4. Recovery snapshots of a session are deleted only by that session (on a clean close), or by a tab that has **acquired** that session's lock (claim, retention, sweep).
5. A pointer flip is a compare-and-set on the generation the write started from (recovery §4.2).

## 4. What is not promised
- **Custom close confirmations.** Browsers allow only the generic `beforeunload` prompt, and only after user activation. Installed apps follow the browser's rules. The design relies on recovery, not on prompts.
- **Cross-browser, cross-profile or cross-application coordination.** Different browsers or profiles have separate storage; a portable file opened in two browsers is two independent copies. Web Locks do not reach other applications.
- **Race-free external conflict detection.** File System Access offers no compare-and-swap. The check before overwriting narrows the window but cannot close it: another application can still write the file between the check and the replacement, and the verify-by-reload then reports what is actually there (architecture §5.4).
- **Detecting external changes** to downloaded files in Firefox and Safari, where there is no handle.
