# G-PRJ-R — Persistence architecture (proposal)

**Status:** proposal for maintainer approval. It is research and design only; nothing here is implemented.
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
- **Persistence worker** (new dedicated worker, same build): serialization finishing, deflate, hashing, OPFS writes through sync access handles, and **verify-by-reload** (§5). It takes transferred bytes and returns digests. No document state lives there.
- **`RecoveryWriter`**: subscribes to committed transactions and debounces (recovery contract §3). It writes snapshots through the worker and never touches the saved mark.
- **`LibraryIndex`** (IndexedDB `vectra-library` v1): records for projects, recents (with persisted file handles in Chromium) and recovery entries. It is advisory: every list entry is re-validated against OPFS or the handle before it is offered.
- **`Thumbnailer`**: asks the existing render worker for a bounded raster (§7) at idle after an explicit save or a snapshot.

## 5. The save transaction (the invariant, enforced)
The invariant: every successful save indication refers to bytes that reopen.

1. **Pre-flight.** The document is already within the persistable-size limit, by construction ([limits](G-PRJ-PERSISTENCE-LIMITS.md) §6.2). The save re-checks the exact size before serializing.
2. **Serialize.**
   - On the main thread, a per-node canonical-fragment cache makes this O(changed nodes): nodes are frozen and shared across states, so their canonical bytes are memoised.
   - The fragments and the geometry records go to the persistence worker, as transferred buffers.
   - Measured: a full canonical pass is 479–798 ms at 330k nodes, too long for the main thread; the cache removes it.
3. **Write without destroying the previous version.**
   - **Library (OPFS):**
     - write a **new uniquely named file** (`project-<rev>.vectra`);
     - verify it (step 4);
     - flip the project's "current file" pointer in one IndexedDB `readwrite` transaction (all-or-nothing by spec);
     - then delete the previous file.

     This is the same pointer-flip as recovery (recovery contract §4). It relies on neither `move()` (not in the spec, engine-specific signatures) nor fsync, which `close()` does not promise.
   - **Portable file (Chromium):** `createWritable()` writes into a swap file that replaces the target on `close()`. An `abort()` or crash leaves the committed file intact (probed in Chromium, Firefox and real Safari). That is best-effort per the spec, so the step-4 re-read is what certifies the result.
   - **Downloads:** the browser owns the write, and the app cannot observe it (§5.1).
4. **Verify.** The worker re-reads what it wrote, from the OPFS file or the File System Access handle, and runs the full `loadContainer` validation, then compares the document digest with the saved state's.
5. **Only then** does the session's `markSaved(state)` run, and the status say "Saved to `name.vectra`" or "Saved in this browser", with the time.
   - **Changed from today:** `saveContainer` must stop calling `markSaved` itself (audit §1.9).
6. **On failure** (quota, permission, verification mismatch, a crash mid-write): the previous committed file is untouched; the session stays dirty; the error names the cause and offers **Download a copy** as the always-available fallback.

### 5.1 Downloads (Firefox, Safari)
- A download can't be verified after the browser takes it. So the worker verifies the **bytes** by reload before handing them over, and the status says "Downloaded a copy (`name.vectra`)" rather than "Saved".
- The project stays marked as **having unsaved changes in this browser** until either:
  - the user confirms the download ("Did the file save? Keep editing / Mark as saved"), or
  - a library copy is saved.
- This is the honest reading of RFC-002 §14: "each save is a new download". The maintainer decides whether a confirmed download clears the dirty mark (D-PRJ-4).

## 6. What a project is
- **Project id:** a new UUID in the library index. It is **not** stored in the document, so no schema change is needed.
- **The document's `documentId`:** keeps its existing meaning. Save As creates a new project id and keeps `documentId`; Duplicate creates both anew.
- **Project name:**
  - comes from the file name (without `.vectra`), or from the library record;
  - a new project is "Untitled project" until first named;
  - renaming a library project changes its record; renaming a file-backed project is Save As.
  - RFC-002 lists file names as not stored in the document, and that stays true.
- **Not in the project file:** undo history (by default, §8), selection, camera, panel layout. Camera and the last tool may live in the library record as **workspace preferences**, so they never alter the artwork's bytes.

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

## 9. Contract changes required (AM-3, for approval)
| Item | Contract | Change |
|---|---|---|
| AM-3.1 | **RFC-002 §14, D08, VS-12, the G-0 plan's exclusions** | Lift the P1 exclusion of autosave, project library, recent files and OPFS/IndexedDB persistence, under the tier rules of §2. Explicit saves only ever overwrite in place through a granted File System Access handle; elsewhere a save is a download |
| AM-3.2 | **C10 v2** | Compact canonical encoding (defaults and the implied `id` omitted; `kind` optional) with a v1 reader; re-baseline the frozen canonical hash |
| AM-3.3 | **C3/C10 document limit** | A persistable document-section size, enforced at transaction time like the anchor cap |
| AM-3.4 | **`saveContainer` semantics** | Serialization no longer marks the session saved; the store marks it only after a verified write |
| AM-3.5 | **C5 / service worker** | A persistence worker added to the build's worker set, inside the same build-isolation rules |
| AM-3.6 (optional, later) | **C7 r3** | Sectioned document and worker-side streaming, only if limits above the compact ceiling are required |

## 10. Security and privacy
- **Nothing leaves the device:** no network calls, telemetry or remote thumbnails.
- **Untrusted files** keep the full load validation, with no relaxation for library or recovery data. Those are untrusted too: other code at the origin, or tampering.
- **Recovery data** is the same container format, so the same validation and limits apply.
- **No secrets** are stored. File System Access handles are stored only in IndexedDB, at the user's grant.
