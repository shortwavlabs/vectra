# G-PRJ-R — Browser storage comparison

**Sources:**
- **Documentation research:** [sources/STORAGE-RESEARCH.md](sources/STORAGE-RESEARCH.md). It cites MDN browser-compat-data v8.1.11, the WHATWG specs, WebKit and Mozilla release notes and positions, and Chrome documentation, with a URL and date per claim, plus a list of unverified claims.
- **Feature probes run here:** [`bench/storage-probe.json`](bench/storage-probe.json), produced by `node scripts/g-prj/run-probe.mjs --safari` on the probe page [`prototypes/g-prj/probe.html`](../../../prototypes/g-prj/probe.html). That page is served by the dev server only and is not in the build.
- **Engines probed:** Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2 and **real Safari 26.6.2**. Each probe writes and reads 32 MiB.

## 1. Probe results
| | Chromium 159 | Firefox 159 | Real Safari 26.6.2 | Playwright WebKit 27.2 |
|---|---|---|---|---|
| File System Access pickers / `queryPermission` | yes / yes | no / no | no / no | no / no |
| `<input type=file>` / `a[download]` / Web Share files | yes / yes / no | yes / yes / no | yes / yes / **yes** | yes / yes / yes |
| OPFS `getDirectory` | yes | yes | yes | yes |
| OPFS `createWritable`: 32 MiB write / read | 28 / 10 ms | 8 / 19 ms | 9 / 15 ms | **failed** ("UnknownError … transient") |
| OPFS sync access handle (worker): 32 MiB write | 27 ms | 3 ms | 3 ms | not reached |
| `abort()` leaves the committed file intact | yes | yes | yes | — |
| `move(newName)` | works | works | **TypeError: needs (dir, name)** | — |
| IndexedDB 32 MiB Blob put (strict / relaxed) / get | 2 / 1.5 / 0.7 ms ¹ | 18 / 16 / 0 ms | 11 / 9 / 4 ms | **failed** |
| `persist()` result (fresh profile, no engagement) | false | prompt (timed out at 10 s) | false | false |
| `estimate()` quota | 10,240 MiB ² | 10,240 MiB ² | 78,643 MiB | 1,000 MiB |
| Web Locks (exclusive, then `ifAvailable` → null) | yes | yes | yes | yes |
| BroadcastChannel | yes | yes | yes | yes |
| `launchQueue` | yes | no | no | no |
| Storage Buckets | yes | no | no | no |
| `CompressionStream("deflate-raw")` | yes | yes | yes | yes |

¹ Chromium's put timings resolve before the blob reaches disk (relaxed durability by default since Chrome 121), so they are not a write-speed measurement.

² Headless test profiles. The real per-origin quotas are in §2.

**Playwright WebKit fails both OPFS and IndexedDB** in its default ephemeral context, while real Safari passes. Storage qualification therefore uses real Safari, or a persistent WebKit context; Playwright WebKit results for storage are not evidence about Safari.

## 2. Comparison by mechanism
| Criterion | IndexedDB | OPFS | File System Access | `persist()` | `<input type=file>` + download |
|---|---|---|---|---|---|
| **Availability** | All engines; workers everywhere | All engines (Safari 15.2+; `createWritable` from Safari 26) | **Chromium only** (Mozilla negative, WebKit oppose) | All; grant rules differ | Universal |
| **Safari / Firefox limits** | Safari: Lockdown Mode disables it; Private-Browsing Blobs unreliable; reconnect fixes in 26.5/27.0. Firefox: `durability` getter only | Safari: `move(dir, name)` signature; Private-Browsing support unverified | Not available | Firefox prompts; Safari heuristics (reliable from 17) | Safari offers Web Share for files; no external-change detection anywhere |
| **Permission lifecycle** | None (origin storage) | None | Per handle: `queryPermission`/`requestPermission` on a gesture; Chrome 122+ "Allow on every visit"; installed apps keep access | One-time grant | Each open is a fresh user choice; each save is a new download |
| **Quota and eviction** | Shares the origin quota. Chrome ~60 % of disk; Safari 17+ ~60 %; Firefox best-effort min(10 %, 10 GiB per site), 50 % when persistent. Best-effort by default (LRU eviction under pressure). **Safari deletes script-writable storage after 7 days without user interaction**, except Home Screen web apps; whether that covers OPFS, and whether Dock apps are exempt, is unverified | Same origin quota and eviction as IndexedDB | User's disk; no browser eviction | Turns eviction off for the origin when granted | User's disk |
| **Atomicity** | Transactions all-or-nothing by spec | `createWritable`: swap file replaced on `close()`, best-effort by spec, no fsync promised; `abort()` keeps the old file (probed in 3 engines). Sync handles write in place. `move()` is non-standard | Same `createWritable` semantics on user files | — | Browser-owned; the app cannot observe completion |
| **Large-file performance** | Good for Blobs (stored as files in most engines; max value size unverified) | Best: 32 MiB in 3–28 ms; streaming writes | Like OPFS on the user's disk | — | Fine; the user handles the download prompt |
| **Worker compatibility** | Yes | Yes (sync handles worker-only) | Handles can be passed to workers (Chromium) | Page only | Page only |
| **Offline** | Yes | Yes | Yes | — | Yes |
| **Failure recovery** | Transactions roll back | Write a new file, verify it, then flip a pointer (no rename needed) | Swap-file semantics; the old file survives an abort | — | Re-download |
| **Security** | Origin-scoped; data is untrusted on read | Origin-scoped; not visible to the user | The user picks every file; handles are origin-bound | — | The user picks every file |
| **Implementation complexity** | Medium (schema and versioning) | Medium | Medium (permissions, re-grants, change detection) | Low | Low |

## 3. Decisions this supports (architecture §3)
1. **OPFS holds artwork bytes** (library and recovery), as ordinary `.vectra` containers: the same format and the same validation as user files.
2. **IndexedDB holds the index:** the project list, recents, recovery records, persisted file handles in Chromium, and the "current file" pointers. Strict-durability transactions flip the pointers.
3. **Portable files:**
   - File System Access in Chromium: Save in place, Save As, re-open from recents;
   - elsewhere, `<input type=file>` to open and a download to save, with Web Share "Share a copy" on Safari;
   - the status wording tells them apart.
4. **No rename-based atomicity** (`move()` is non-standard). Publication is write-new, verify, then flip the pointer in IndexedDB.
5. **`persist()` is asked once, after the first library save.** In Firefox it is a user prompt, so it is tied to the explicit action with a sentence of explanation. The storage panel shows `persisted()`.
6. **Safari tabs are at risk of the 7-day deletion.** The storage panel says plainly that projects kept only in this browser may be removed by Safari after a week without use. A project that has never been saved to a file shows a quiet "No file copy yet" state. Installing the app (Home Screen on iOS, Dock on macOS) is suggested where it is documented to help, and the Dock case is marked unverified.
7. **Web Locks and BroadcastChannel** provide the multi-window rules (concurrency contract).
8. **Storage Buckets and `launchQueue`** are Chromium-only enhancements, not dependencies. "Open with Vectra" (`file_handlers`) is a G-PRJ-4 option for installed Chromium apps.

## 4. Unverified, to be measured in G-PRJ-Q
Whether:
- Firefox and Safari honour `durability: "strict"`;
- the 7-day deletion covers OPFS, and whether Dock apps are exempt;
- OPFS works in Safari Private Browsing;
- Web Locks are released on a crashed tab or worker (the spec says they are);
- any engine fsyncs on `close()`.

There is also the maximum single IndexedDB value size. Each becomes a qualification test (qualification plan §3).
