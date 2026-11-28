# G-PRJ-R — Persistence architecture (proposal)

**Status:** **accepted by the maintainer (2026-11-27)** with the contract refinements of [decisions](G-PRJ-DECISIONS.md) §7, reconciled below (§4.1, §5, §6). It is research and design only; nothing here is implemented.
- **Inputs:**
  - the persistence audit (§1);
  - [persistence limits](G-PRJ-PERSISTENCE-LIMITS.md);
  - [storage comparison](G-PRJ-STORAGE-COMPARISON.md) and its feature probes ([`bench/storage-probe.json`](bench/storage-probe.json));
  - [recovery contract](G-PRJ-RECOVERY-CONTRACT.md);
  - [concurrency contract](G-PRJ-CONCURRENCY-CONTRACT.md).
- **Contract changes it needs:** listed in §9, and in [decisions](G-PRJ-DECISIONS.md) as AM-3.

## 1. What already exists (audited at `276c1ec`)
- **`.vectra` v1 is implemented and tested.**
  - `saveContainer` / `loadContainer` (`src/persistence/container.ts:275,364`).
  - Strict RFC 8785 canonical JSON.
  - A strict document schema that rejects unknown fields.
  - Hash-verified, deflate-raw or uncompressed sections, with a bomb guard.
  - Limits: header 1 MiB, 4,096 sections, document 64 MiB, source 20 MiB, session 512 MiB.
  - Full `validateState` on load.
- **It persists the committed document completely:**
  - layers, groups, paths, transforms, clips, order;
  - styles, palette, trace provenance, the artboard;
  - geometry chunks;
  - embedded source assets;
  - the ID high-water marks.
- **It does not persist:**
  - session state: revision, undo/redo, the saved mark, the history-truncated flag;
  - UI state: selection, camera, tool, panels;
  - runtime caches;
  - a document title (none exists);
  - non-embedded source bytes.
- **Dirty tracking exists:** `currentState !== savedState`, O(1) (`session.ts:204`). A loaded session starts clean, with no history, at revision 1.
- **Gaps found:**
  - none of this is reachable from the UI: no Open, Save, `.vectra` input or Mod+S/O;
  - `saveContainer` calls `markSaved` *before* anything is written, and without verification (`container.ts:434`);
  - the save-side limit check runs only after hashing and deflating;
  - the workspace never attaches the source image to the document (`shell/jobs.ts:84,126`), so a saved project would not contain its source;
  - nothing in `src/` uses IndexedDB, OPFS, File System Access, Web Locks, BroadcastChannel, `beforeunload` or `launchQueue`.

## 2. The three persistence tiers
The tiers differ by **who owns the bytes** and by **what a successful write means**. They never share a status word.

| Tier | Purpose | Storage | Written when | Marks the project "saved"? |
|---|---|---|---|---|
| **Portable project file** (`.vectra`) | The authoritative, user-owned artwork; moves between machines | The user's file system, through File System Access where available, else download and upload | Only on an explicit Save, Save As or Download a copy | **Yes**, after a verified write (§5) |
| **Local project library** | Convenient resumption: named projects, thumbnails, recents | **OPFS** (`library/<projectId>/project.vectra`, `thumb.webp`), indexed in **IndexedDB** | On an explicit "Save to this browser", and as the project's home when no file exists yet | **Yes** for that copy, after a verified write; the status names *where* ("Saved in this browser") |
| **Recovery snapshot** | Crash and interruption protection only | **OPFS** (`recovery/<sessionId>/`), codec `none`, indexed in IndexedDB | Automatically, after committed transactions (debounced) and on `pagehide`/`visibilitychange` | **Never** |

**Rules:**
- A recovery snapshot is never offered as "your project". It is offered as **"unsaved changes from <time>"**, always beside the last explicit save it diverged from (the [recovery contract](G-PRJ-RECOVERY-CONTRACT.md)).
- The library is never the only path to artwork. Every library project offers **Download a copy** (`.vectra`) and Export, and the UI says that clearing browser data removes it.
- A recent-projects entry is a **reference**. Removing it never deletes a file, a library project or a recovery snapshot; each of those has its own explicitly named action (UX spec §8).

## 3. Capability tiers (progressive enhancement)
Detected at runtime with no user-agent sniffing. The probe evidence is real Safari 26.6.2, Chromium 159, Firefox 159 and Playwright WebKit 27.2.

| Capability | Chromium (Chrome, Edge) | Firefox | Safari (macOS; iOS later) | Use |
|---|---|---|---|---|
| File System Access pickers and handles | yes | no | no | **Save in place**, re-open recents by handle |
| `<input type=file>`, `a[download]` | yes | yes | yes | **Universal** Open and Save (a download) |
| Web Share with files | no (desktop) | no | yes | An optional "Share a copy" on Safari |
| OPFS writable streams (main and worker) | yes | yes | yes | Library and recovery writes |
| OPFS sync access handles (worker) | yes | yes | yes | Fast recovery writes in the persistence worker |
| Writable abort leaves the committed file intact | yes | yes | yes | **Atomic publish** of each file |
| `FileSystemHandle.move(name)` | yes | yes | needs `move(dir, name)` | Rename after a temp write; Safari uses the two-argument form |
| IndexedDB blobs | yes | yes | yes | Index and metadata |
| Web Locks, BroadcastChannel | yes | yes | yes | Multi-tab ownership (the concurrency contract) |
| `navigator.storage.persist()` | heuristic (false in the probe) | prompts | false in the probe | Requested once, after the first library save |
| PWA `launchQueue` / `file_handlers` | yes | no | no | "Open with Vectra" for installed Chromium apps only |

**Consequences:**
- **Save in place exists only in Chromium.** In Firefox and Safari, "Save" downloads a new copy each time, which RFC-002 §14's current wording already requires. The UI says so ("Saves a copy to your Downloads folder") instead of pretending.
- Portable-file recents are handle-backed only in Chromium. In Firefox and Safari they are shown as "last saved as `name.vectra`" and re-opened by choosing the file again.
- **Library and recovery behave the same in all three engines.**
- Playwright WebKit's ephemeral context fails OPFS and IndexedDB (probe), so storage qualification must use real Safari, or a persistent WebKit context.

## 4. Components (proposed modules; no code in this phase)
- **`ProjectStore`** (main thread): the façade the shell calls. Open, Save, Save As, Download a copy, Save to this browser, list, rename, duplicate, delete, recent. It holds a `ProjectRef`:
  - project id;
  - backing: `file-handle` / `file-download` / `library` / `none`;
  - name;
  - last explicit save: time, revision, content digest, location;
  - lock state.
- **Persistence worker** (new dedicated worker, same build; AM-3.5): serialization finishing, deflate, hashing, OPFS writes through sync access handles, and **verify-by-reload** (§5). It takes transferred bytes and returns digests. No document state lives there (§4.1).
- **`RecoveryWriter`**: subscribes to committed transactions and debounces (recovery contract §3). It writes snapshots through the worker and never touches the saved mark.
- **`LibraryIndex`** (IndexedDB `vectra-library` v1): records for projects, recents (with persisted file handles in Chromium) and recovery entries. It is advisory: every list entry is re-validated against OPFS or the handle before it is offered.
- **`Thumbnailer`**: asks the existing render worker for a bounded raster (§7) at idle after an explicit save or a snapshot.

### 4.1 Persistence-worker boundaries (refinement 7.6)
The worker is **never a second authoritative document engine.**

| Boundary | Rule |
|---|---|
| **Ownership** | The main-thread `DocumentSession` owns the only authoritative document: states, history, the saved mark, the geometry store. The worker holds no `DocState`, no session and no history. It holds a container's bytes only for the duration of one job, then releases them |
| **Save direction** | The main thread produces the canonical sections from one immutable state (synchronously, so later edits cannot change them) and **transfers** them. The worker hashes, compresses, assembles, writes and verifies. It returns digests, sizes and a result code, never document data |
| **Open direction** | The worker reads and inflates the file, checks hashes, parses the canonical JSON and runs the **structural schema checks**. It transfers back the parsed sections in a form the main thread adopts **without re-parsing**: geometry records as transferred buffers, and the document as the parsed value. The main thread then runs `validateState` **once**, the existing trust boundary, and builds the session. The worker's checks never replace that validation |
| **Validation** | Exactly one full semantic validation per open (main thread) and one verify-by-reload per save (worker, on the written bytes). No repeated full validation of the same bytes on either side |
| **Publication** | Only the main thread publishes: it marks a state saved after the worker reports a verified write (§5.4), and only it flips an IndexedDB pointer for a library or recovery write it requested |
| **Failure** | A worker crash or error fails the job; the session is unchanged and stays dirty. The worker never retries a publication by itself |

**Measured as a whole.** Moving parsing into the worker must not just move equivalent blocking work into main-thread reconstruction. G-PRJ-1 measures the entire hand-off: transfer, structured-clone deserialization of the parsed document on the main thread, store commits, `validateState` and session construction, with the main-thread blocking budget applied to the sum ([qualification](G-PRJ-QUALIFICATION-PLAN.md) §1). If the reconstruction alone exceeds the budget, the stage stops and reports, rather than claiming the worker solved it.

## 5. The save transaction (the invariant, enforced)
The invariant: **every successful save indication refers to bytes that reopen.** Zero unreopenable successful saves is mandatory (D-PRJ-9).

**Order of a save:**
1. **Pre-flight** (§5.1). The **complete container** is already within every persistence limit, by construction ([limits](G-PRJ-PERSISTENCE-LIMITS.md) §9). The save re-checks the exact sizes **before** any expensive serialization, hashing or compression.
2. **Serialize** on the main thread, synchronously, from one immutable state.
   - A per-node canonical-fragment cache (G-PRJ-1) makes this O(changed nodes): nodes are frozen and shared across states, so their canonical bytes can be memoised. Any retained cache is accounted under AM-2 and never retains predecessor states.
   - The sections go to the persistence worker as transferred buffers (§4.1).
   - Measured: a full canonical pass is 479–798 ms at 330k nodes, too long for the main thread; the cache removes it.
3. **Write without destroying the last verified version** (§5.3 library, §5.4 portable file, §5.5 download).
4. **Verify by reload.** The worker re-reads what it wrote, from the OPFS file or the File System Access handle, runs the complete loader on it, including semantic validation, on a throwaway session that is then discarded, and compares the **saved-version identity** (§5.2) with the one computed at serialization.
5. **Only then** does the session's `markSaved(state)` run, and the status say "Saved to `name.vectra`" or "Saved in this browser", with the time.
   - **Changed from today (AM-3.4):** `saveContainer` serializes only. It never calls `markSaved` (F-1).
6. **On failure:** the session stays dirty, the error names the cause, and a safe alternative save path is offered (§5.4). What the app says about the previous version depends on when the failure happened; it never claims more than it knows.

### 5.1 Pre-flight
- The persistable-size accounting (G-PRJ-0) keeps every committed state within the complete-container limits, so a save never discovers an over-limit document after serializing it.
- The save still recomputes the exact section sizes and counts from the state it is about to write, before serialization, hashing and compression. A disagreement with the accounting is a defect: the save fails with the error, nothing is written, and the state stays dirty.

### 5.2 Saved-version identity (refinement 7.1)
A saved version is identified by **all of its authoritative content**, not by the document section alone. A canonical document-section digest alone never certifies that two versions are equal: the geometry or source bytes it references could differ.

- **Definition.** `versionDigest` = SHA-256 of the canonical JSON (RFC 8785) of:
  ```text
  { formatVersion, sections: [ { id, kind, uncompressedLength, sha256 } ... ] }
  ```
  - Every section is listed in the container's fixed order: manifest, document, geometry by chunk number, embedded source by asset number.
  - `sha256` is the section's existing digest over its **uncompressed** canonical bytes (C7).
  - It is the header minus the codec-dependent fields (`codec`, `offset`, `length`). So it costs one small hash, and is **independent of compression**: the same state saved with `none` and with `deflate-raw` has one identity.
- **What it covers:**
  - the document section: tree, styles, palette, provenance, artboard, asset records, and the high-water marks;
  - every geometry record the state references;
  - every embedded source's bytes;
  - a non-embedded source is covered by its asset record (its digest), because its bytes are by definition not part of the project.
- **What it is for:** "unchanged since save", base tracking for recovery, external-change detection, and confirming that a verify-by-reload read back the version that was written.
- **What it is not:** an edit-time dirty test. Dirty state stays state identity (C7).
- **Encoding changes identity.** The same document written by the v1 and the v2 encoder has two identities. A v1 file re-saved by a v2 build is a new version: a migration, not a silent equality.

### 5.3 Local library publication (refinement 7.3)
Write-new, verify, then transactionally flip the IndexedDB pointer. **OPFS and IndexedDB are not one atomic transaction**, so the design keeps a verified previous generation and specifies recovery for each gap.
- **Generations.** A library project's IndexedDB record holds `current` and `previous`: file name, `versionDigest`, revision, time. A save writes `gen-<n>.vectra` (never overwriting), verifies it (step 4), then in one `readwrite` transaction sets `previous = current` and `current = gen-<n>`. Only after that commits is the file older than `previous` deleted.
- So **two verified generations exist at all times** after the second save. A damaged or missing `current` falls back to `previous`, with disclosure.
- The full protocol and its failure cases (a pointer to a missing or corrupted file, a pointer that survives when its file does not, interrupted cleanup, another tab writing a candidate, an older build meeting a newer record, orphan cleanup) are specified once, for library and recovery alike, in the [recovery contract](G-PRJ-RECOVERY-CONTRACT.md) §4.
- It relies on neither `move()` (not in the spec, engine-specific signatures) nor fsync, which `close()` does not promise.

### 5.4 Portable file writes and their failures (Chromium; refinement 7.2)
`createWritable()` writes into a swap file that replaces the target on `close()`. An `abort()` or crash before `close()` leaves the committed file intact (probed in Chromium, Firefox and real Safari). That is best-effort per the spec, so the verify-by-reload is what certifies the result.

**Failures are classified by when they happened**, and after any ambiguous failure the worker re-reads the target to find out:

| When | Examples | What is known | What the app says and does |
|---|---|---|---|
| **Before replacement** | `createWritable` or a `write()` rejects; quota; permission lost; the writer is aborted | `close()` never resolved, so the browser did not commit the swap file. The previous file is expected to be intact (best-effort per spec) | "Couldn't save. `great-wave.vectra` was not replaced." Stays dirty; offers **Try again**, **Save As…** and **Download a copy** |
| **After replacement, verification failed** | `close()` resolved, then the re-read is unreadable, truncated, fails validation or has the wrong `versionDigest` | The target was replaced by bytes that do not verify. **The previous file is not claimed untouched**: it is gone from that path | "Couldn't verify `great-wave.vectra` after saving. The file may be damaged." Stays dirty; offers **Save As…** (a new file) and **Download a copy**, plus the library copy where one exists. Never retries overwriting the same file automatically |
| **Unknown** | `close()` rejects, or the tab is interrupted during `close()` | Either outcome is possible | The re-read decides: the new `versionDigest` → saved; the base's `versionDigest` → "not replaced"; anything else → treated as **after replacement, verification failed** |

- In every failure case the project **stays dirty**, the failure is disclosed until resolved, and a safe alternative path (Save As to a new file, Download a copy) is always available.
- External changes made between the base and this save are checked before writing ([concurrency](G-PRJ-CONCURRENCY-CONTRACT.md) §2), with the remaining race acknowledged there.

### 5.5 Downloads (Firefox, Safari, and Download a copy everywhere; D-PRJ-4)
- **A download request is not proof that the file reached the filesystem.** The browser owns that write, and the app cannot observe it.
- **Before hand-off,** the worker validates the generated container by reload (step 4), so the bytes handed over are known to reopen.
- **The status reads "Download requested (`name.vectra`)"**, never "Saved".
- **Confirmation is per revision.** The status offers "Did the file save? Mark as saved". A confirmation:
  - marks **the state that was downloaded** as saved (C7 state identity), never the current state as such. If the artist has edited since, the newer state stays dirty; undoing back to the downloaded state shows it clean;
  - is recorded as `confirmed-download`, distinct from a `verified-write`, in the session's save record and in the wording ("Marked as saved after download", not "Saved to …");
  - is never asked again for the same download, and never during ordinary editing.
- **A library save** (verified) also clears the dirty state, as "Saved in this browser".
- This is the honest reading of RFC-002 §14, "each save is a new download".

## 6. What a project is
- **Project id:** a new UUID in the library index. It is **not** stored in the document, so no schema change is needed.
- **The document's `documentId`:** keeps its existing meaning. Save As creates a new project id and keeps `documentId`; Duplicate creates both anew.
- **Project name:**
  - comes from the file name (without `.vectra`), or from the library record;
  - a new project is "Untitled project" until first named;
  - renaming a library project changes its record; renaming a file-backed project is Save As.
  - RFC-002 lists file names as not stored in the document, and that stays true.
- **Not in the project file:** undo history (by default, §8), selection, camera, panel layout. Camera and the last tool may live in the library record as **workspace preferences**, so they never alter the artwork's bytes.

### 6.1 New projects (D-PRJ-5)
- **A new project lives in the local library by default.** It is labelled as **stored in this browser, with no portable file copy yet** ("Stored in this browser · No file copy yet").
- **No abandoned empty projects.** A new project is written to the library at its first committed edit, not when it is created. Closing an untouched new project leaves nothing behind.
- **Local storage unavailable** (OPFS or IndexedDB fails, a private window refuses storage, quota is exhausted): the project opens as an explicitly disclosed **temporary session**. "This project is not stored anywhere yet. Download a copy to keep it." Download a copy and Export work normally; nothing claims the project is stored.

## 7. Thumbnails
- **How rendered:** by the existing render worker (OffscreenCanvas, display cache) from the committed document, after an explicit save or a recovery snapshot, at idle, never during a gesture.
- **Format and size:** 512 px on the long edge, WebP q≈0.8 where the engine encodes it, else PNG.
  - Size is bounded by pixels; the cost depends on the artwork's detail.
  - Measured on the mockups' WebP renders:
    - 0.8–66 KB at 480 px;
    - 3–102 KB at 960 px, the largest being the photographic halftone (Talbot);
    - so about 1–30 KB is expected at 512 px.
  - A hard cap (e.g. 128 KB per thumbnail, re-encoded at lower quality above it) is enforced in G-PRJ-2.
- **Where stored:** `library/<id>/thumb.webp` and `recovery/<session>/thumb.webp`, with the document revision and digest they depict. A thumbnail older than the project's last save is drawn with a "Preview updating" state, never as current.
- **Never** in the `.vectra` file, never in an export, never transmitted. It is a derived UI asset.

## 8. Undo history
- **Not persisted by default:** RFC-002 §14 says "History is not persisted, and the user is told so on reopen".
- **Why:**
  - AM-2 history accounting, at up to 128 MiB, would multiply the file size;
  - history states reference history-only geometry chunks;
  - the format would have to freeze the transaction model.
- **Evaluated alternative, not recommended for P1:** persisting the last N transactions as structural deltas in a separate optional section. It needs a C7/C10 amendment, a delta format, and validation of every intermediate state on load.
- **Recovery snapshots** likewise restore the document only. The recovery dialog says that undo history is not restored.

## 9. Contract changes (AM-3; dispositions 2026-11-27)
| Item | Contract | Change | Disposition |
|---|---|---|---|
| AM-3.1 | **RFC-002 §14, D08, VS-12, the G-0 plan's exclusions** | Lift the P1 exclusion of autosave, project library, recent files and OPFS/IndexedDB persistence, under the tier rules of §2. Explicit saves only ever overwrite in place through a granted File System Access handle; elsewhere a save is a download | **Approved** |
| AM-3.2 | **C10 v2** | Compact canonical encoding (defaults and the implied `id` omitted; `kind` optional) with a v1 reader; re-baseline the frozen canonical hash | **Approved**; v1 stays readable; historical v1 fixtures and hashes preserved; v2 hashes re-baselined explicitly |
| AM-3.3 | **C3/C10 document limit** | A persistable document-section size, enforced at transaction time like the anchor cap | **Approved** as exact enforcement over the complete container ([limits](G-PRJ-PERSISTENCE-LIMITS.md) §9) |
| AM-3.4 | **`saveContainer` semantics** | Serialization no longer marks the session saved; the store marks it only after a verified write | **Approved** |
| AM-3.5 | **C5 / service worker** | A persistence worker added to the build's worker set, inside the same build-isolation rules | **Approved**, with the boundaries of §4.1 |
| AM-3.6 (optional, later) | **C7 r4** (r3 is now AM-3.3/3.4) | Sectioned document and worker-side streaming, only if limits above the compact ceiling are required | **Deferred**; the 64 MiB document-section cap is retained |

Formal change control (revision bumps, the RFC-002 amendment) happens in G-PRJ-0 with the implementation ([decisions](G-PRJ-DECISIONS.md) §4).

## 10. Security and privacy
- **Nothing leaves the device:** no network calls, telemetry or remote thumbnails.
- **Untrusted files** keep the full load validation, with no relaxation for library or recovery data. Those are untrusted too: other code at the origin, or tampering.
- **Recovery data** is the same container format, so the same validation and limits apply.
- **No secrets** are stored. File System Access handles are stored only in IndexedDB, at the user's grant.
