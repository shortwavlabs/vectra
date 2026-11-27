# G-PRJ-R — Autosave and recovery contract (proposal)

**Status:** proposal. It depends on AM-3.1 (lifting RFC-002 §14's autosave exclusion); see [decisions](G-PRJ-DECISIONS.md). The tiers are defined in [architecture](G-PRJ-ARCHITECTURE.md) §2.

## 1. Purpose and non-purpose
- **Purpose:** after a crash, reload, tab or app close, power loss or an interrupted write, the artist loses at most the last few seconds of committed edits, and is offered them back explicitly.
- **Not a save:**
  - a recovery snapshot never marks a project saved, never changes its name, location or "last saved" time, and never overwrites a portable file or a library project;
  - recovery is offered; it is never applied silently.

## 2. Terms
- **Session:** one open document in one tab or window, identified by a random `sessionId`.
- **Base:** the explicit save the session started from or last made. Recorded as kind (file, library or none), location, revision and content digest.
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

## 4. Atomic publication
Publication is a **pointer flip**, not a rename:
- `move()` is not in the WHATWG File System spec;
- its signatures differ by engine (Safari needs `move(dir, name)`);
- overwrite-on-rename behaviour is unverified.

1. The worker writes a **new, uniquely named** file `recovery/<sessionId>/snap-<n>.vectra` (sync access handle: `truncate`, `write`, `flush`, `close`), never overwriting the current snapshot.
2. It verifies by reading the file back and validating it with the same `loadContainer` checks as an untrusted file.
3. It updates the IndexedDB recovery record in one `readwrite` transaction (`latest = n`, revision, base, time, size, digest). It asks for `durability: "strict"`: honoured in Chromium and Safari; Firefox exposes only the getter, and whether it is honoured there is unverified. The record is the only pointer readers follow.
4. Once that transaction commits, it deletes files older than the latest two published snapshots.

A crash at any step leaves the record pointing at a complete, verified file, either the previous snapshot or the new one. A file no record points to is an orphan: deleted at startup, never offered.

**What the platforms guarantee:**
- File writes are **best-effort durable**. The spec says browsers try to avoid partial writes but promise no fsync on `close()`, and a sync handle's `flush()` is an attempt.
- IndexedDB transactions are specified as **all-or-nothing**.
- So correctness rests on verify-before-flip, plus the transactional pointer. Never on rename or fsync semantics.

## 5. Detecting an interrupted session
- Each live session holds a Web Lock `vectra:session:<sessionId>` for its lifetime. All engines support Web Locks (probe).
- At startup, and when the project home opens, the app lists recovery records and calls `navigator.locks.query()`:
  - a record whose session lock is **not held** belongs to a session that ended without closing cleanly;
  - a record whose lock **is** held belongs to another live tab and is never offered (concurrency contract).
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
    - in the workspace, a quiet status entry stays: "Unsaved changes from 12 min ago are still available · Review". It is a word control in the save-status area, not an alarm or a modal;
    - the project's tile in the project home keeps "Recovery available";
    - **Review** offers the same Recover / Discard… choice at any time. If the artist has edited or saved the last-save version since, Recover opens the snapshot **as a copy** (a new untitled project), so neither version overwrites the other.
  - **Discard…:** the only action that deletes the snapshot, apart from retention expiry (§8). It asks for confirmation that names the snapshot's time and says the action cannot be undone.
- **Never:**
  - overwrite a newer portable file with recovery data without consent. If the base file's digest or modified time changed since the snapshot (Chromium handles show this), the Recover flow says so and offers "Save recovered version as a copy";
  - auto-apply recovery at startup.

## 7. Failure handling
| Failure | Behaviour |
|---|---|
| Quota exceeded writing a snapshot | Keep the previous snapshot; stop retrying until the next commit; show a persistent **"Recovery paused: browser storage is full"** status with Manage storage. Explicit saves are unaffected |
| Storage evicted by the browser (best-effort storage) | The next startup finds no records. Nothing is offered, and nothing is claimed. The storage panel explains eviction and offers to request persistent storage |
| `persist()` denied | Recovery still works as best-effort, and the storage panel says so |
| Snapshot fails verification | Delete the `.tmp`, keep the previous snapshot, log a status error after 3 consecutive failures |
| A newer build reads an older snapshot | Normal versioned load (readers accept older versions) |
| An older build (an old tab after a deploy) finds a newer snapshot | `version` refusal; the snapshot is left untouched and offered again by the newer build. Service-worker build isolation (C5) keeps one tab on one build |
| The source file of the base is gone or its permission expired | Recovery still opens from the snapshot; the base shows "file unavailable", and Save becomes Save As |

## 8. Retention and cleanup
- **A live session's own snapshots** are deleted on its clean close: after it saves explicitly, or after an explicit Discard.
- **An interrupted session's snapshot** (one no live session owns, §5) is deleted only by the artist's explicit **Discard…**, or by a **Recover** whose result is then saved explicitly, or by retention expiry. It is never deleted as a side effect of:
  - choosing Open last save;
  - editing or saving the last-save version;
  - opening another project;
  - closing the project home.
- Unclaimed snapshots are kept **14 days** after their last write (proposed), then deleted at startup. The storage panel lists them with size and age, and the user can delete them earlier.
- **Library-backed projects:** a recovery snapshot newer than the library copy is kept until the user recovers or discards it, with no automatic merge.

## 9. Qualification (summary; full matrix in the [qualification plan](G-PRJ-QUALIFICATION-PLAN.md))
- **Kill scenarios:** kill the tab or process between each step of §4 (fault injection in the worker), then restart.
  - The newest published snapshot is offered.
  - No `.tmp` file is offered.
  - The base is never modified.
- **Quota exhaustion and eviction:** simulated by filling OPFS, and by clearing site data.
- **Multi-tab:** a live tab's snapshots are never offered elsewhere.
- **Version skew:** old build against new snapshot.
- **Throughput:** snapshot cadence under continuous editing at the interactive target and at 756k anchors, with main-thread impact ≤ 16 ms per snapshot (proposed threshold).
