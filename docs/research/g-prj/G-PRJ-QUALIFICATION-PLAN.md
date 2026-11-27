# G-PRJ-R — Qualification plan (proposal)

**Status:** **accepted (maintainer, 2026-11-27).** The initial performance targets in §2 are **approved** (D-PRJ-9), with the qualifications reconciled below: each stage measured separately (§1), the recovery-lag target scoped to healthy conditions, and zero unreopenable successful saves mandatory.

**Standing requirements that stay in force:**
- the frozen regression requirements (bundle v1, document export, engine corpus, bundle v2), with every `concert-*` input excluded;
- the G-DOC-R dispatch and AM-2 history-accounting guarantees;
- real Safari via safaridriver, Chromium, Firefox and Playwright WebKit;
- the evidence-preservation policy.

## 1. Measurement rules
- **Save and restore are measured apart from rendering and trace generation:**
  - load and validate before the session is shown (`scripts/g-prj/browser-load.mjs`);
  - save serialization, write and verify inside the persistence worker, timed per stage.
- **Stages measured separately (D-PRJ-9):** first save, subsequent save, parsing, validation, verification, and the main-thread hand-off. A single end-to-end figure never stands in for them.
- **The whole worker hand-off is measured** ([architecture](G-PRJ-ARCHITECTURE.md) §4.1): transfer, deserialization of the parsed document on the main thread, store commits, `validateState` and session construction. The main-thread blocking budget applies to their sum, so work moved off the main thread cannot reappear there unmeasured.
- **Persistability accounting** (G-PRJ-0) is reported as integrated dispatch timings (the G-DOC-R dispatch harness), not as isolated fragment-encoding benchmarks, with its overhead measured separately against the ≤ 1 ms ordinary-transaction target.
- **Main-thread blocking** is the longest frame gap: requestAnimationFrame monitor in every engine, plus Long Tasks in Chromium.
- **Conditions** recorded with every run: commit, `BUILD_ID`, engine versions, load average, top consumers, `ngspice` count, and screen lock and page visibility for real Safari. Runs on a shared machine are labelled as such.
- **Workloads:** small, bark-1224, bark-2350, halftone, palette-provenance, interactive-43k, synthetic-250k, w756k, w996k and limit-500k (the [persistence limits](G-PRJ-PERSISTENCE-LIMITS.md) set). Real photographic traces come from licensed fixtures only.

## 2. Thresholds (approved 2026-11-27, D-PRJ-9)
| Measure | Threshold | Today (evidence) |
|---|---|---|
| Open, interactive target (load and validate, all engines) | ≤ 1 s, with main-thread blocking ≤ 50 ms | 118–183 ms load; **24–60 ms** blocking (WebKit 60) |
| Open, 756k anchors | ≤ 1 s; blocking ≤ 50 ms (once parsing moves to a worker) | 717–1,039 ms; 160–333 ms blocking |
| Explicit save, interactive target | ≤ 1 s to verified completion; blocking ≤ 50 ms; first and subsequent saves reported separately | 323 ms deflate save in Node, main thread; not yet verified |
| Recovery snapshot, interactive target | main-thread cost ≤ 16 ms per snapshot; snapshot ≤ 30 s behind the latest commit under continuous editing, **under healthy operating conditions**; when it cannot keep up, the status says so | — |
| Persistable size | 100 % of accepted documents saveable; 0 save refusals for documents within the limits, over the **complete container** ([limits](G-PRJ-PERSISTENCE-LIMITS.md) §9) | w996k refused today |
| **Unreopenable successful saves** | **Zero. Mandatory** | — |
| Persistability accounting overhead | ≤ 1 ms per ordinary transaction, integrated dispatch; no full-document traversal on ordinary edits | — |
| Round trip | byte-identical canonical document after save → open → save | Golden fixtures today |
| Thumbnail | ≤ 50 ms of main-thread time per update; never during a gesture | — |

## 3. Matrix
| Area | Tests | Engines |
|---|---|---|
| **Round-trip equivalence** | Save, open, compare canonical document digests and geometry records. Every workload, compact v2 and legacy v1 reads, every node kind, clips, provenance, embedded sources | Node + 3 engines + real Safari |
| **Cross-machine portability** | A file saved in each engine opens in every other engine (a 4 × 4 matrix); a file copied over the filesystem opens offline | 3 engines + real Safari |
| **Large projects** | w756k, w996k and limit-500k save and reopen under compact v2; the persistable-size limit refuses the first transaction that would exceed it, with the right error | Node + 3 engines |
| **Malformed files** | The existing container adversarial suite plus: truncated at every section boundary, wrong hashes, a decompression bomb, an over-cap declaration, an unknown `formatVersion`/`documentSchemaVersion`, v2 fields in a v1 document, library and recovery records pointing at corrupted files | Node + 3 engines |
| **Resource limits** | Every complete-container limit ([limits](G-PRJ-PERSISTENCE-LIMITS.md) §9): document section, section count, total declared bytes, source cap, plus the anchor cap: the first transaction that would exceed one is refused before commit, atomically; never a "saved" status | Node + 3 engines |
| **Interrupted writes** | Fault injection in the persistence worker at each step (write, verify, pointer flip, delete). Kill the page or worker at each step; restart; assert the last good version, no partial file offered, and the base untouched | Chromium, Firefox, real Safari |
| **Publication faults** ([recovery](G-PRJ-RECOVERY-CONTRACT.md) §4.3) | By fault injection: a pointer to a missing file; a pointer to a corrupted file; a surviving pointer commit with a truncated newest file; interrupted cleanup; a second tab writing a candidate during the sweep; an older build meeting a newer record and file. Each falls back to a verified generation or leaves data untouched; the sweep never deletes an in-flight write, a retained snapshot or a newer-version file | Chromium, Firefox, real Safari |
| **Portable write failures** ([architecture](G-PRJ-ARCHITECTURE.md) §5.4) | Failure before replacement, failure after replacement with a bad re-read, and an ambiguous `close()`: each is classified and worded correctly; the previous file is never claimed untouched after a replacement; the project stays dirty | Chromium |
| **Saved-version identity** | `versionDigest` changes when only a geometry record or only an embedded source changes, and is equal for the same state saved with `none` and `deflate-raw` | Node |
| **Quota exhaustion** | Fill OPFS to the quota (estimate-driven); library save fails cleanly; recovery pauses with the status; explicit download still works | Chromium, Firefox, real Safari |
| **Eviction and clearing** | Clear site data; the next start offers nothing and claims nothing; the storage panel is explained. Safari's 7-day deletion documented, not simulated | 3 engines + real Safari |
| **Permission denial** | File System Access: deny the picker, deny `requestPermission`, revoke mid-session; the save falls back to Save As or Download a copy; the project stays dirty | Chromium |
| **Autosave failure** | Snapshot verification failure; three consecutive failures produce a status | 3 engines |
| **Crash recovery** | Kill during editing; restart; recovery offered with time and base; Recover reopens dirty; **Open last save keeps the snapshot, and it stays offered until Discard or retention** (maintainer requirement); Discard deletes it | Chromium, Firefox, real Safari |
| **Multi-tab and multi-window** | Same project in two tabs: the second gets "open in another window"; Open a copy works; locks are released when a tab crashes (spec behaviour, to be verified); index updates propagate via BroadcastChannel | 3 engines + real Safari; installed PWA in Chromium |
| **Lock races** ([concurrency](G-PRJ-CONCURRENCY-CONTRACT.md) §1.1) | Two tabs opening the same Chromium file at once resolve to one project id and one editor; two tabs claiming one recovery record end with one claim; no action is taken on a `locks.query()` observation alone | 3 engines + real Safari |
| **External modification** | Chromium: change the file on disk between open and save, then the conflict dialog appears with Cancel as the default | Chromium |
| **Offline** | Open, save, library, recovery and thumbnails with the network off, on the production build under the service worker | 3 engines + real Safari |
| **Service-worker version isolation** | An old tab saves while a new build is installed; an old build refuses a newer snapshot and leaves it intact; a newer build reads older files and snapshots | 3 engines + real Safari (existing G-JOB lifecycle harness) |
| **Unsaved-change tracking** | Dirty after commit, clean after a verified save, never clean after a snapshot or an unconfirmed download; undo back to the saved state is clean (state identity) | Node + 3 engines |
| **Download confirmation** (D-PRJ-4) | The container is validated before hand-off; the status says "Download requested"; a confirmation marks only the downloaded state; an edit made before or after the confirmation stays dirty; the record distinguishes `confirmed-download` from `verified-write`; no repeated prompts during editing | 3 engines + real Safari |
| **New projects and temporary sessions** (D-PRJ-5) | An untouched new project leaves no library entry; the first edit stores it, labelled "No file copy yet"; with storage unavailable, the temporary session is disclosed and Download a copy works | 3 engines + real Safari |
| **Source embedding** (D-PRJ-10) | Sources are embedded by default; an oversized source triggers the explicit resolution, never a silent omission; removing a source keeps the artwork; source hashes and provenance unchanged | Node + 3 engines |
| **Recovery retention** (D-PRJ-6) | An only known copy survives past 14 days; an ordinary snapshot expires after 14 days only under the claim rule | Node + 3 engines |
| **Destructive operations** | Open, New, Home, close and replace while dirty prompt Save / Don't save / Cancel (Cancel the default); delete a library project, discard recovery, clear recents: each confirms; removing a recent never deletes artwork | 3 engines + real Safari |
| **Destructive contrast (TD-UI-008)** | Before any production destructive control ships: destructive text meets WCAG AA in rest, hover, focus and disabled states, measured on the shared design system's components | 3 engines |
| **TD-UI-006** | An oversized edit shows the confirmation; Cancel is the default; Continue re-validates the revision first; history is cleared only on Continue | 3 engines |
| **Thumbnails** | Derived from the committed document; never in files or exports (scan the `.vectra` sections and the SVG/PDF exports for raster data); stale state shown | 3 engines |
| **Keyboard accessibility** | Project home, menus and dialogs fully operable by keyboard; focus order; Esc; focus return; shortcut contract (UX spec §9) without overriding unrelated browser commands | 3 engines + real Safari (stock keyboard check) |
| **VoiceOver** | Owner check: home landmarks, list semantics, status announcements, dialog titles | real Safari (owner) |
| **Installed PWA** | Launch to the project home; Chromium `file_handlers` opens a `.vectra` file (if adopted); same storage as the tab | Chromium installed; Safari Dock (where available) |

## 4. Not in scope of G-PRJ qualification
- Lower-end hardware and quiet-machine qualification stay with their existing items.
- iOS Safari is not a qualified target in P1.
- Cross-browser storage migration.
