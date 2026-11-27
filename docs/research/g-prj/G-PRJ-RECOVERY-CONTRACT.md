# G-PRJ-R — Autosave and recovery contract (proposal)

**Status:** **accepted (maintainer, 2026-11-27)** with the refinements of [decisions](G-PRJ-DECISIONS.md) §6.3 and §7.3–7.4, reconciled below (§4, §5, §7, §8). AM-3.1, which lifts RFC-002 §14's autosave exclusion, is approved. The tiers are defined in [architecture](G-PRJ-ARCHITECTURE.md) §2.

## 1. Purpose and non-purpose
- **Purpose:** after a crash, reload, tab or app close, power loss or an interrupted write, the artist loses at most the last few seconds of committed edits, and is offered them back explicitly.
- **Not a save:**
  - a recovery snapshot never marks a project saved, never changes its name, location or "last saved" time, and never overwrites a portable file or a library project;
  - recovery is offered; it is never applied silently.

## 2. Terms
- **Session:** one open document in one tab or window, identified by a random `sessionId`.
- **Base:** the explicit save the session started from or last made. Recorded as kind (file, library or none), location, revision and saved-version identity (`versionDigest`, [architecture](G-PRJ-ARCHITECTURE.md) §5.2).
- **Snapshot:** a complete `.vectra` container, codec `none`, of a **committed** document state, tagged with the session, the base, the session revision and the time.

## 3. When snapshots are written
- **Trigger:** a committed transaction that changes the document. Selection, camera and failed or rejected commands do not count.
- **Debounce:** write after **2 s** without further commits, but at least every **30 s** while edits continue. Values are proposed, to be tuned in G-PRJ-3.
- **Also written:** on `visibilitychange` → hidden and on `pagehide`, when a commit is newer than the last snapshot. Best effort: browsers may not run it on a crash.
- **Not written:**
  - during a drag gesture (the transform commits at release);
  - while a previous snapshot write is in flight (coalesced);
  - when the session is clean, meaning equal to its base.
- **Cost bound:**
  - Each snapshot is a full container. The canonical per-node fragment cache makes serialization O(changed nodes) on the main thread.
  - Writing happens in the persistence worker through an OPFS sync access handle (32 MiB written in 3–28 ms in the probe).
  - Codec `none` avoids deflate: 4 ms against 1.2 s on the halftone.
  - A snapshot never blocks input by more than **16 ms** on the main thread (the proposed G-PRJ-3 threshold).

## 4. Atomic publication (library and recovery; refinement 7.3)
This protocol is shared by library saves ([architecture](G-PRJ-ARCHITECTURE.md) §5.3) and recovery snapshots. Publication is a **pointer flip**, not a rename:
- `move()` is not in the WHATWG File System spec;
- its signatures differ by engine (Safari needs `move(dir, name)`);
- overwrite-on-rename behaviour is unverified.

**OPFS and IndexedDB are not one atomic transaction.** A file write and a pointer commit can each survive or be lost independently, for example when power fails after the pointer commits but before the browser has made the file durable. So the protocol keeps a **verified previous generation**, and every reader re-verifies what a pointer names.

### 4.1 Records and names
- **Record** (IndexedDB, one per library project or recovery session): `current` and `previous` generations, each `{ file, versionDigest, revision, time, size, formatVersion, documentSchemaVersion }`. `previous` is null until the second publication. The record also carries the record-format version of the build that wrote it (§4.4).
- **Generation files** are named `gen-<sessionId>-<n>.vectra`, in `library/<projectId>/` or `recovery/<sessionId>/`. The writing session's id is in the name, so every file has a known owner, and `n` never repeats within a session. Existing files are never overwritten.

### 4.2 Steps
1. **Hold the locks.** The writer holds its own session lock (§5) for its whole life. A library save also holds the project lock ([concurrency](G-PRJ-CONCURRENCY-CONTRACT.md) §1).
2. **Write** a new generation file (sync access handle: `truncate`, `write`, `flush`, `close`).
3. **Verify** by reading the file back, running the complete loader on it as an untrusted file, and comparing its `versionDigest` ([architecture](G-PRJ-ARCHITECTURE.md) §5.2).
4. **Flip** in one IndexedDB `readwrite` transaction, asking for `durability: "strict"` (honoured in Chromium and Safari; Firefox exposes only the getter, and whether it is honoured there is unverified):
   - re-read the record, and require its `current` to be the generation this write started from (compare-and-set). If it is not, abort the transaction and delete the new file, which this session owns;
   - set `previous = current` and `current = new`.
5. **Clean up** only after the transaction commits: delete this session's own files in that directory that are neither `current` nor `previous`. Files owned by other sessions are left to the sweep (§4.3).

**What the platforms guarantee:**
- File writes are **best-effort durable**. The spec says browsers try to avoid partial writes but promise no fsync on `close()`, and a sync handle's `flush()` is an attempt.
- IndexedDB transactions are specified as **all-or-nothing**.
- So correctness rests on verify-before-flip, the transactional compare-and-set pointer, the retained previous generation, and re-verification on read. Never on rename or fsync semantics.

### 4.3 Failure cases
| Case | Detected by | Behaviour |
|---|---|---|
| **Crash before the flip** | The new file is referenced by no record | The record still names the last verified generations. The unreferenced file is swept once its owner is dead (§4.4) |
| **The pointer names a missing file** | Opening or listing: the file is not found | Fall back to `previous` if it verifies, with disclosure ("The latest save of *name* couldn't be found. The save from 2 hours ago was opened"). With no usable generation, the entry shows "Missing — remove from list?" and is **never offered as openable** |
| **The pointer names a corrupted file** | Verify-on-read fails: hash, parse, validation or `versionDigest` | As for a missing file. The damaged file is not deleted automatically; it goes with the entry when the user removes it |
| **The pointer commit survived but the newest file did not** (lost or truncated after power loss) | The same verify-on-read | Fall back to `previous`, which was verified before its own flip. This is why it is kept |
| **Cleanup was interrupted** | Files beyond `current` and `previous` remain | The sweep removes them later, under §4.4's rules |
| **Another tab is writing a candidate** | The candidate's owner session holds its lock | Never touched: the sweep cannot acquire the owner's lock (§4.4) |
| **An older build meets a newer record or file** | A record-format version above the build's own, a newer IndexedDB database version (`VersionError`), or a file refused with `version` | Left **untouched**: never rewritten, never swept, never offered as openable by that build. The build says "Made with a newer version of Vectra. Reload to update". Service-worker build isolation (C5) keeps each tab on one build |

### 4.4 Orphan sweep
At startup and when the project home opens, a file is deleted only when **all** of these hold:
1. Its name matches this build's generation scheme. Unknown names are never deleted.
2. Its header is readable and declares a **supported** `formatVersion` and `documentSchemaVersion`. Files of an unsupported newer version are never deleted.
3. The sweep **acquires** the owner session's lock (from the file name) with `ifAvailable`. If it is not granted, the owner is alive or another tab has claimed it, and the file is skipped. A `locks.query()` observation is never enough.
4. Inside that lock, a fresh read of the records shows that **no record references the file**, as `current` or `previous`. Retained recovery snapshots are always referenced by their record, so they are never swept.

The sweep releases the owner's lock when it is done with that owner's files.

## 5. Detecting an interrupted session (refinement 7.4)
- Each live session holds a Web Lock `vectra:session:<sessionId>` for its lifetime. All engines support Web Locks (probe).
- **Acquire before acting.** Before acting on a recovery record (offering it, recovering, discarding, or a retention delete), the app **requests** that record's session lock with `ifAvailable: true`:
  - **granted:** the session that wrote the record has ended, and this tab now holds the **claim**. It keeps the lock for as long as it acts on the record (while the offer is shown, while the recovered document is open), so a second tab cannot act on the same record;
  - **not granted:** the record belongs to a live session, or another tab has claimed it. It is never offered here; the project home may say "Open in another window".
- **Re-read inside the lock.** The record may have changed between listing and acquiring, so it is read again once the lock is held, and the action uses that read.
- `navigator.locks.query()` may drive display hints only. It is never the basis for an action, because a lock can be taken between the query and the action.
- **Scope.** Web Locks coordinate cooperating sessions of this origin in one browser profile. They do not protect against other applications, other browsers or other profiles (which have separate storage anyway).
- Whether every engine releases a crashed tab's locks promptly is specified behaviour still to be verified ([qualification](G-PRJ-QUALIFICATION-PLAN.md) §3).
- A clean close (the user closes or replaces the project) deletes that session's snapshots, after the explicit save or an explicit discard.

## 6. Offering recovery
- **Where:**
  - in the project home: the project's tile shows "Unsaved changes from 12 min ago can be recovered";
  - in the workspace, when the same project is opened, as an inline notice.
- **What is shown:**
  - the snapshot time;
  - the base it diverged from ("last saved to `great-wave.vectra` yesterday" or "never saved");
  - a thumbnail;
  - the statement that undo history is not restored.
- **Choices:**
  - **Recover:** opens the snapshot as a document **with unsaved changes**. Its base stays the original save, so a later Save writes to the original location after the normal checks.
  - **Open last save instead:** opens the last explicit save and **keeps the snapshot**. Choosing it is not a decision to discard (maintainer requirement, 2026-11-26), so the choice can be revisited:
    - in the workspace, a quiet status entry stays: "Recovery from 12 min ago kept · Review". It is a word control in the save-status area, not an alarm or a modal. The wording was refined after the Impeccable critique: "Unsaved changes" is reserved for the dirty state;
    - the project's tile in the project home keeps "Recovery available";
    - **Review** offers the same Recover / Discard… choice at any time. If the artist has edited or saved the last-save version since, Recover opens the snapshot **as a copy** (a new untitled project), so neither version overwrites the other.
  - **Discard…:** the only action that deletes the snapshot, apart from retention expiry (§8). It asks for confirmation that names the snapshot's time and says the action cannot be undone.
- **Never:**
  - overwrite a newer portable file with recovery data without consent. If the base file's `versionDigest` or modified time changed since the snapshot (Chromium handles show this), the Recover flow says so and offers "Save recovered version as a copy";
  - auto-apply recovery at startup.

## 7. Failure handling
| Failure | Behaviour |
|---|---|
| Quota exceeded writing a snapshot | Keep the previous snapshot; stop retrying until the next commit; show a persistent **"Recovery paused: browser storage is full"** status with Manage storage. Explicit saves are unaffected |
| Storage evicted by the browser (best-effort storage) | The next startup finds no records. Nothing is offered, and nothing is claimed. The storage panel explains eviction and offers to request persistent storage |
| `persist()` denied | Recovery still works as best-effort, and the storage panel says so |
| Snapshot fails verification | Delete the new generation file (this session owns it), keep the published generations, show a status error after 3 consecutive failures |
| The record names a missing or damaged snapshot | Fall back to the previous generation, with disclosure (§4.3) |
| Recovery cannot keep up (slow storage, a very large document) | The 30-second lag target applies under healthy conditions only (D-PRJ-9). When the newest snapshot is more than 30 s behind the latest commit during continuous editing, the status says "Recovery is behind" until it catches up |
| A newer build reads an older snapshot | Normal versioned load (readers accept older versions) |
| An older build (an old tab after a deploy) finds a newer snapshot | `version` refusal; the snapshot and its record are left untouched, never swept, and offered again by the newer build (§4.3). Service-worker build isolation (C5) keeps one tab on one build |
| The source file of the base is gone or its permission expired | Recovery still opens from the snapshot; the base shows "file unavailable", and Save becomes Save As |

## 8. Retention and cleanup
- **A live session's own snapshots** are deleted on its clean close: after it saves explicitly, or after an explicit Discard.
- **An interrupted session's snapshot** (one no live session owns, §5) is deleted only by the artist's explicit **Discard…**, or by a **Recover** whose result is then saved explicitly, or by retention expiry. It is never deleted as a side effect of:
  - choosing Open last save;
  - editing or saving the last-save version;
  - opening another project;
  - closing the project home.
- **Ordinary unclaimed snapshots are kept 14 days** after their last write (D-PRJ-6, approved), then deleted at startup, under the claim rule of §5. "Ordinary" means a snapshot of unsaved changes on top of a saved base that still exists.
- **An only known copy is never expired automatically.** A snapshot is the only known copy of unsaved artwork when its base is `none` (the artwork was never saved anywhere, such as a temporary session) or its base no longer exists (the library project or its generations are gone). It is kept until the artist recovers or discards it. The storage panel lists it as "Only copy · kept until you decide".
- The storage panel lists every snapshot with its size, age and retention, and the user can delete any of them earlier, with confirmation.
- **Eviction is disclosed.** Browser storage can be evicted (best-effort storage, Safari's 7-day rule, the user clearing site data). The storage panel and the recovery offer say that recovery data lives in this browser and can be lost that way; persistent storage reduces eviction but does not survive clearing site data (D-PRJ-7).
- **Library-backed projects:** a recovery snapshot newer than the library copy is kept until the user recovers or discards it.
- **No implicit discard, merge or overwrite**, ever (D-PRJ-6).

## 9. Qualification (summary; full matrix in the [qualification plan](G-PRJ-QUALIFICATION-PLAN.md))
- **Kill scenarios:** kill the tab or process between each step of §4.2 (fault injection in the worker), then restart.
  - The newest published snapshot is offered.
  - No unpublished generation file is offered.
  - The base is never modified.
- **Publication faults (§4.3), by fault injection:** delete or corrupt `current` after the flip; truncate the newest file after the pointer commit; interrupt cleanup; run a second tab's write during the sweep; present a newer-version record and file to an older build. Each must fall back to a verified generation or leave the data untouched, as specified.
- **Quota exhaustion and eviction:** simulated by filling OPFS, and by clearing site data.
- **Multi-tab and claims:** a live tab's snapshots are never offered elsewhere; two tabs racing to claim one record end with exactly one claim.
- **Version skew:** old build against new snapshot.
- **Retention:** an only known copy survives past 14 days; an ordinary snapshot is removed after 14 days only under the claim rule.
- **Throughput:** snapshot cadence under continuous editing at the interactive target and at 756k anchors, with main-thread impact ≤ 16 ms per snapshot (proposed threshold).
