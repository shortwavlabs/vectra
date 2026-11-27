# G-PRJ-R — Concurrency and failure-safety contract (proposal)

**Status:** proposal. **Principle:** explicit conflict detection, never silent last-writer-wins. Recovery never overwrites a newer portable project without consent.

## 1. Primitives (available in every engine: Chromium, Firefox, real Safari; probed)
- **Web Locks** (`navigator.locks`):
  - `vectra:project:<projectId>`: held exclusively by the session editing a library project, or a file-backed project in Chromium (handle identity);
  - `vectra:session:<sessionId>`: held by every live session, for recovery detection.
- **BroadcastChannel** `vectra-library`: index-change notifications between tabs and windows of the same origin, browser and installed app alike.
- **A content digest** (SHA-256 of the canonical document section, already computed by the container writer). It identifies a saved version.
- **Revision and base** per session (recovery contract §2).

## 2. Deterministic behaviour per case
| Case | Behaviour |
|---|---|
| **The same library project opened in a second tab or window** | The second session asks for the project lock with `ifAvailable`. When it is held, the second window shows a calm notice, "This project is open in another window", with **Switch to it** (`BroadcastChannel` asks the owner to focus, where the platform allows) and **Open a copy** (a duplicate with a new project id). No read-only editing mode in P1 |
| **The same portable file opened twice** (Chromium handles: compared with `isSameEntry`) | As above. In Firefox and Safari the two opens are separate uploads with no shared identity: they are two independent projects, and the second save is just another download |
| **Two installed app windows**, or a browser tab plus the installed app | One origin, the same locks and channel: handled identically |
| **Concurrent modification** (only possible across *different* projects, given the lock) | Independent |
| **A stale File System Access permission** (`queryPermission` ≠ granted) | Save asks for `requestPermission` on the user gesture. If denied: "Vectra can't write to `name.vectra` any more", offering **Save As** and **Download a copy**; the project stays dirty |
| **The portable file changed externally** since it was opened or last saved (Chromium: `getFile().lastModified` and size, or digest, against the base) | Before overwriting: "`name.vectra` changed on disk since you opened it", offering **Save As**, **Overwrite**, **Cancel** (the default). Never a silent overwrite |
| **A service-worker update during a save or recovery** | C5 isolation: the old tab keeps its build's workers until reload. The save completes on the old build, or fails with the previous file intact; the update waits (G-JOB contract) |
| **Interrupted autosave** | Recovery contract §4: the previous snapshot survives; `.tmp` files are discarded |
| **A failed or cancelled save** | The previous file is untouched (swap-file semantics); the session stays dirty; the error is shown with a fallback |
| **Project replacement during a trace or export job** | Already handled: the job's result for the old document arrives `stale: document_replaced` and is never applied (`jobs/controller.ts:159,200`). G-PRJ adds the unsaved-changes guard *before* replacement (UX spec §10). An export in flight finishes into its own snapshot (`controller.ts:373-391`) |
| **Recovery against a newer base** | Recovery contract §6: the base changed, so "Save recovered version as a copy" is offered; the default never overwrites |
| **The library index disagrees with OPFS** (crash between file and index updates) | The index is advisory. Entries are re-validated at listing: a missing file is shown as "Missing — remove from list?"; an unindexed OPFS project is re-indexed at startup ("Found 1 project not in your list") |
| **Two tabs deleting or renaming the same library project** | Deletion requires the project lock (it fails when another window has the project open); renames broadcast; the last committed IndexedDB transaction wins for the *name* only, never for artwork bytes |

## 3. Ordering rules
1. Artwork bytes are written and verified **before** any index record points to them.
2. Index records are deleted **before** artwork bytes, and only after the project lock is acquired.
3. A save takes the project lock, or a per-file lock in Chromium keyed by handle identity, for its whole duration.
4. Recovery snapshots of a session are deleted only by that session (on a clean close), or by the retention sweep when the session lock is not held.

## 4. What is not promised
- **Custom close confirmations.** Browsers allow only the generic `beforeunload` prompt, and only after user activation. Installed apps follow the browser's rules. The design relies on recovery, not on prompts.
- **Cross-browser or cross-profile coordination.** Different browsers or profiles have separate storage; a portable file opened in two browsers is two independent copies.
- **Detecting external changes** to downloaded files in Firefox and Safari, where there is no handle.
