# Browser storage and file capabilities for a local-first creative PWA (late 2026)

Research date: 2026-11-26/27 (UTC). Scope: saving large project files (tens to hundreds of MB) in Chromium (Chrome/Edge), Firefox and Safari/WebKit (macOS + iOS), with no backend.

## Method and source hygiene

- **Version numbers** come from MDN browser-compat-data (BCD) **v8.1.11**, fetched as JSON from `https://bcd.developer.mozilla.org/bcd/api/v0/current/<feature>.json` at 2026-11-27T00:01Z. This is the data behind MDN's compat tables. Each citation below names its BCD feature key.
- **Living specs fetched 2026-11-26:**
  - WHATWG File System, last updated 19 Oct 2026 (https://fs.spec.whatwg.org/)
  - WHATWG Storage, last updated 19 Oct 2026 (https://storage.spec.whatwg.org/)
  - WICG File System Access, CG draft of 10 Oct 2025 (https://wicg.github.io/file-system-access/)
  - W3C IndexedDB 3.0, Editor's Draft of 30 Oct 2026 (https://w3c.github.io/IndexedDB/)
  - WICG Storage Buckets, CG draft of 19 Dec 2023 (https://wicg.github.io/storage-buckets/)
- **Quotes:** text pulled from MDN, web.dev and WebKit pages was extracted by a tool. It is **paraphrased** here, not quoted verbatim.
- **Apple release notes** were read from Apple's JSON data behind each page (`https://developer.apple.com/tutorials/data/documentation/safari-release-notes/safari-<ver>-release-notes.json`). Each cited item's parent section was checked: Storage, Web API, Web Apps, Networking or Lockdown Mode.
  - Scanned: 17, 17.4, 18, 18.4, 26.0 to 26.6, 27.0 to 27.2 and 27.3 beta.
  - Not scanned: 15.x, 16.x, 17.1 to 17.3, 17.5, 17.6, 18.1 to 18.3, 18.5 and 18.6.
- **Sources outside the requested list** are marked **[non-listed]**. They are primary vendor artifacts:
  - WebKit and Firefox WebIDL at `main`
  - bugs.webkit.org
  - the Mozilla and WebKit standards-positions repositories
  - whatpr.org PR previews
  - Apple's Safari release notes on developer.apple.com, which count as "Safari release notes"

---

## 0. Design-relevant headlines

1. **OPFS can be written through `createWritable()` in all three engines:** Chrome 86, Firefox 111 and **Safari 26.0 (15 Sep 2025, macOS and iOS)**.
   - For Safari, main-thread availability rests on BCD plus WebKit IDL at `main`, which puts no Exposed restriction on `createWritable`. Apple's release note says only "File System WritableStream API".
   - Before Safari 26, the only way to write in WebKit was `FileSystemSyncAccessHandle` in a worker. Sources: BCD `api.FileSystemFileHandle.createWritable`; Safari 26.0 release notes item 145875384 (https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes); WebKit blog, Feb 2022 (https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/).
2. **The File System Access pickers (`show*Picker`) are Chromium-only.** Mozilla's position is *negative* and WebKit's is *oppose*. Firefox and Safari must use `<input type=file>` to open, and `a[download]` or Web Share to export.
3. **Quotas are large everywhere except Firefox best-effort mode,** which is capped at min(10% of disk, 10 GiB per site). All origins are **best-effort by default**, and `persist()` grant rules differ per engine.
4. **Safari's 7-day script-writable-storage deletion** has an explicit exemption only for **Home Screen web apps**.
   - The documented list of affected storage predates OPFS, so whether OPFS is covered is unverified.
   - Dock (macOS) web apps get the same quota as Safari and separate storage, but no explicit statement of an ITP exemption was found.
5. **Atomicity is best-effort, not guaranteed.**
   - For `createWritable()`, the spec says user agents only attempt to avoid partial writes.
   - No durability (fsync) is promised on `close()`.
   - Sync access handles write in place.
   - `move()` is **not in the Living Standard**: it exists only in an unmerged PR and its signatures differ per engine.
   - IndexedDB transactions *are* specified as atomic.

---

## 1. IndexedDB

### Durability ("strict" vs "relaxed")

- **Spec** (IndexedDB 3.0 ED, 30 Oct 2026, §2.7, https://w3c.github.io/IndexedDB/):
  - `durability` is a hint with three values: `"default"`, `"strict"` and `"relaxed"`.
  - `strict`: the user agent may report a commit only after verifying the changes reached persistent storage.
  - `relaxed`: the user agent may report a commit once the changes reach the OS.
  - `default`: use the user agent's default for the storage bucket.
  - A non-normative note says `strict` typically means flushing OS buffers before `complete` fires.
- **Spec, commit semantics:** commits must be atomic. Either all changes in a transaction are written or, on error such as a disk write failure, none are (§ committing).
- **MDN** (IDBDatabase.transaction, last modified 23 Jun 2025, https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction) describes the same three values.
- **Chromium:**
  - The default changed from `strict` to `relaxed` in **Chrome 121** (Chrome blog, last updated 2023-11-03, https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed).
  - That post defines `strict` as asking the OS to flush to disk before `complete`. It defines `relaxed` as firing `complete` once data reaches the OS buffer, which the OS typically flushes every few seconds.
  - It recommends `strict` for steps like migrations, where old data must not be deleted until the new data is durably written.
  - It also states that other major browsers use `relaxed`. That is Chrome's claim, not verified from Firefox or WebKit sources.
- **Support for the `durability` attribute** (BCD `api.IDBTransaction.durability`): Chrome/Edge 83, **Firefox 126**, Safari 15 (macOS and iOS).
  - The Firefox 126 notes say only that the `durability` *getter* is now supported (bug 1878143) (https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/126).
  - Whether Firefox actually honours `strict` when writing is **unverified**.
  - Firefox also has a non-standard `readwriteflush` mode behind a flag since 40 (BCD `api.IDBDatabase.transaction.mode_parameter_readwriteflush`).
- **`IDBTransaction.commit()`** (BCD `api.IDBTransaction.commit`): Chrome 76, Edge 79, Firefox 74, Safari 15. Chrome's Page Lifecycle guide recommends `commit()` for saving from `freeze` or `visibilitychange` handlers (last updated 2026-10-16, https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

### Large Blob/ArrayBuffer values

- Values are copied with StructuredSerializeForStorage (IndexedDB ED, 30 Oct 2026, https://w3c.github.io/IndexedDB/). The HTML spec lists Blob, File and ArrayBuffer as serializable (https://html.spec.whatwg.org/multipage/structured-data.html#serializable-objects; not re-fetched for this report).
- **No authoritative per-engine maximum value size was found** (see §9).
- **Chrome 126** moved each IndexedDB backing store to its own sequence. Separating storage buckets helps same-site concurrency (Chrome blog, last updated 2024-06-13, https://developer.chrome.com/blog/maximum-idb-performance-with-storage-buckets).
- **Safari 27.3 beta** (16 Nov 2026), Networking section: fixes reads of file-backed Blob ranges larger than 2 GB, which were truncated by an integer overflow (187207663) (https://developer.apple.com/documentation/safari-release-notes/safari-27_3-release-notes).
  - The note is not IndexedDB-specific and does not say which earlier versions were affected.

### Workers

- IndexedDB is available in workers (BCD `api.IDBDatabase.worker_support`): Chrome 23, Firefox 37, Safari 10 (iOS 10).

### Known Safari issues (authoritative trackers and release notes)

- **Lockdown Mode disables IndexedDB** (Safari 17 release notes, 101187278, https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes).
- **Private Browsing and Blobs:**
  - WebKit bug 156347, "Blob support for the private browsing backing store", is still **NEW** (filed 2016, last changed 2023-07-19) **[non-listed]** (https://bugs.webkit.org/show_bug.cgi?id=156347).
  - Bug 198278, the iOS Private Browsing Blob case, is RESOLVED FIXED (2019) (https://bugs.webkit.org/show_bug.cgi?id=198278).
  - The two statuses conflict. Treat Blob values in Safari Private Browsing as unreliable.
- **Older reliability bugs:**
  - 226547: `open()` hanging on first load in iOS 14.6. RESOLVED DUPLICATE.
  - 201483: "Connection to Indexed Database server lost". Still NEW; the reports date from the iOS 13 era.
  - Status from the bugs.webkit.org REST API, fetched 2026-11-27 **[non-listed]**.
- **Recent fixes** (Apple release notes, "Storage" section unless noted):
  - 26.4 (24 Mar 2026): metadata version / name-encoding mismatch (163219457) (https://developer.apple.com/documentation/safari-release-notes/safari-26_4-release-notes).
  - **26.5 (11 May 2026): IndexedDB connections could stay broken until the page was reloaded (172247569)** (https://developer.apple.com/documentation/safari-release-notes/safari-26_5-release-notes).
  - 27.0 (14 Sep 2026) (https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes):
    - a version-0 database could be returned after an abort in the first `onupgradeneeded` (176195526)
    - IndexedDB connections in workers now recover after a network-process crash (177219395)
    - transactions could be blocked for a long time while another page's transaction was suspended in the background (178769599)
  - 27.3 **beta** (16 Nov 2026), "Web API" section (https://developer.apple.com/documentation/safari-release-notes/safari-27_3-release-notes):
    - `getAllRecords()` / `IDBGetAllOptions` (181043154)
    - `QuotaExceededError` as a DOMException subclass (141586555)
    - serializing and storing FileSystemHandle objects (182178736)

---

## 2. Origin Private File System (OPFS)

| Feature (BCD key) | Chrome/Edge | Firefox | Safari macOS / iOS |
|---|---|---|---|
| `StorageManager.getDirectory` | 86 | 111 | 15.2 / 15.2 |
| `FileSystemFileHandle.createSyncAccessHandle` | 102 | 111 | 15.2 / 15.2 |
| Synchronous `close/flush/getSize/truncate` (`*.sync_version`) | 108 | 111 | 16.4 / 16.4 |
| `FileSystemFileHandle.createWritable` / `FileSystemWritableFileStream` | 86 | 111 | **26 / 26** |
| `createWritable({mode})` and `createSyncAccessHandle({mode})` (non-standard) | 121 | no | no |
| `FileSystemHandle.move` (non-standard) | 102, partial | 111 | 15.2 / 15.2 |
| `FileSystemHandle.remove` (non-standard) | 110 | no | no |
| `FileSystemDirectoryHandle` async iterator | 86 | 111 | 16.4 |

- **Firefox 111** release notes: OPFS needs no permission prompt, and clearing site data deletes it (https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/111).
- **Safari 15.2 (macOS 12.2 / iOS 15.2)** shipped OPFS. The 2022 post says it was unavailable in Private Browsing (current status unverified) and that sync access handles are worker-only (WebKit blog 12257, 14 Feb 2022).
- **Safari 27.0**, "Web API" section, fixes `FileSystemDirectoryHandle.resolve()` path results (175645387) and `removeEntry()` (175745157) (https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes). The notes do not say which earlier versions were affected.

### Where each API runs

- **Spec** (fs.spec.whatwg.org, 19 Oct 2026):
  - `FileSystemWritableFileStream` is exposed in Window and Worker.
  - `createSyncAccessHandle()` and `FileSystemSyncAccessHandle` are `[Exposed=DedicatedWorker]`.
- **Firefox IDL** at `main` matches the spec **[non-listed]** (https://github.com/mozilla-firefox/firefox/blob/main/dom/webidl/FileSystemFileHandle.webidl).
- **WebKit IDL** at `main` **[non-listed]** (https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/filesystem/FileSystemFileHandle.idl, last commit 2026-01-22):
  - `createSyncAccessHandle` is `Exposed=Worker`.
  - `createWritable` carries no Exposed restriction, so it is available on Window and Worker.
  - The claim that Safari's `createWritable` works on the main thread rests on this IDL plus BCD. Apple's release note says only "File System WritableStream API".
- MDN's OPFS page notes that OPFS is subject to the browser's storage quota and that the synchronous calls are worker-only (last modified 14 Jul 2025, https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system).

### Write atomicity (spec §2.3.2 and §2.5, fs.spec.whatwg.org)

**`createWritable()`:**
- Changes are not reflected in the file until the stream is **closed**.
- User agents only attempt to avoid partial writes, so the file should hold either the old contents or the new ones. This is stated as an aim, not a guarantee.
- The usual implementation writes to a **temporary file** and swaps it in on close.
- With `keepExistingData: true`, the existing file is **copied into the temporary file first**, which costs a full copy for large files.

**The close algorithm:**
- runs implementation-defined malware and Safe Browsing checks, which may reject with `AbortError`;
- then sets the file's contents. A non-normative note says this is expected to be an atomic update.
- **No flush or fsync guarantee is stated for `close()`.**

**Locking:**
- `createWritable` takes a **shared** lock, which blocks sync access handles.
- `createSyncAccessHandle` takes an **exclusive** lock, which blocks both further sync handles and writable streams.
- MDN describes Chrome's non-standard `mode`. The default `"siloed"` gives each writer its own swap file, and the last writer to close wins. `"exclusive"` throws `NoModificationAllowedError` for a second writer (MDN createWritable, last modified 4 Jul 2025, https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable).

**In-place mode:**
- An "inPlace" mode for `createWritable` is **not implemented**. In-place writes exist only through `FileSystemSyncAccessHandle` (spec note referencing WICG/file-system-access#67).

**Sync access handle durability:**
- Writes may or may not be reflected immediately.
- `flush()` only attempts to move cached changes to the storage device, and may be a no-op on some file systems.
- `close()` does **not** guarantee a flush, so call `flush()` first (spec §2.6.5–2.6.6).

### `move()` and rename

- `move()` is **not in the WHATWG Living Standard** (absent from the 19 Oct 2026 text). It is proposed in whatwg/fs PR #10 (preview last updated 18 Jul 2023, https://whatpr.org/fs/10.html) **[non-listed]**. BCD marks it non-standard.
- **Signatures differ by engine:**
  - **Chrome:** partial. Exposed only on `FileSystemFileHandle`; no directory moves (crbug 40198034) (BCD `api.FileSystemHandle.move`).
  - **Firefox:** three overloads: `move(name)`, `move(dir)` and `move(dir, name)` (Gecko IDL at `main` **[non-listed]**, https://github.com/mozilla-firefox/firefox/blob/main/dom/webidl/FileSystemHandle.webidl).
  - **WebKit:** a single `move(destination, newName)` that **requires both arguments** (WebKit IDL at `main` **[non-listed]**, https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/filesystem/FileSystemHandle.idl).
  - The portable form is `move(dirHandle, newName)`.
- **Overwriting an existing destination:**
  - The PR #10 text allows it when write access to the destination is granted. It takes an exclusive lock on the destination and suggests Web Locks to avoid overwriting files the site can access.
  - The user-activation check in the PR applies only when destination permission is *not* granted, which does not happen in OPFS. This was checked against the list nesting in the PR's HTML.
  - Safari 17 release notes, "Storage" section: added support for overwriting with the FileSystemHandle move method (105858983) (https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes).
  - Whether overwrite works, and whether the rename is atomic, in Chrome and Firefox is **unverified** (§9).

---

## 3. File System Access API (user-visible files)

### Availability

**`showOpenFilePicker` / `showSaveFilePicker` / `showDirectoryPicker`** (BCD `api.Window.*`):
- Chrome/Edge desktop 86.
- **Chrome Android 132** (BCD `chrome_android`).
- Firefox: no.
- Safari: no.

**`FileSystemHandle.queryPermission` / `requestPermission`:**
- Chrome/Edge 86 (Chrome Android 109).
- Firefox and Safari: no.

**Other Chromium-only APIs:**
- `DataTransferItem.getAsFileSystemHandle` (drag and drop): Chrome 86 only.
- `FileSystemObserver`: Chrome 133 only (non-standard).

**Vendor positions** **[non-listed]**:
- **Mozilla: `position: negative`** (https://github.com/mozilla/standards-positions/issues/154). The assessment was that the spec's protections are inadequate.
- **WebKit: `position: oppose`** (https://github.com/WebKit/standards-positions/issues/28, closed). WebKit sees no way to grant local *write* access safely, though read access might make sense.

### Permission lifecycle

- **Spec** (WICG FSA, 10 Oct 2025):
  - Pickers require **transient user activation**, must be same-origin with the top-level page, and do not run in opaque origins (§3.1).
  - Handles are `Serializable`, so they can be stored in IndexedDB.
  - A handle restored from IndexedDB is likely to report `"prompt"` and needs `requestPermission()`.
  - Clearing browsing data is expected to clear stored handles and revoke grants (§2.3, §5).
- **Chrome default:** access lasts until the last tab of the origin is closed (Chrome FSA doc, last updated 2024-08-19, https://developer.chrome.com/docs/capabilities/web-apis/file-system-access). The same doc covers `move()` on user-visible handles.
- **Chrome 122+ persistent permissions** (Chrome blog, last updated 2024-01-09, https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api):
  - A three-way prompt offers "Allow this time", "Allow on every visit" and "Don't allow".
  - It appears when `requestPermission()` is called on a handle restored from IndexedDB on a later visit, or on a handle whose access was auto-revoked after the tab sat in the background (one-time-permission logic).
  - **Installed apps persist grants automatically, without the prompt.**
  - After the prompt is denied or dismissed more than three times, Chrome falls back to the regular prompt.
  - There is no API change, and per-file revocation is available in site settings.
- **Safari 27.3 beta** lists "serializing and storing FileSystemHandle objects" as a new feature (182178736). It is not in a shipped release yet. Safari has no user-visible file handles in any case, only OPFS handles.

### Fallbacks for Firefox and Safari

- **Open:** `<input type=file>`. It was not separately verified via BCD, being universally supported.
- **Export/save:**
  - `a[download]` with a Blob URL (BCD `html.elements.a.download`): Chrome 14, Firefox 20, Safari 10.1, **iOS 13**. Chrome 65+ and Edge 79+ ignore cross-origin downloads, so use same-origin Blob URLs.
  - **Web Share with files** (BCD `api.Navigator.share` / `.data_files_parameter`):
    - Safari 14 (macOS and iOS).
    - Chrome 89 for files. Full desktop `share()` arrived in Chrome 128; 89–127 was partial, ChromeOS/Windows only.
    - Edge 81 (Windows).
    - **Firefox: no file sharing.** BCD lists `data_files_parameter` as `false` on both desktop and Android. Desktop `share()` is behind a flag; Firefox Android has `share()` from 79.
- Every save through these fallbacks is a new download or share. There is no in-place overwrite of a user file.

---

## 4. Storage quotas, persistence and eviction

### Quota formulas

Source: MDN "Storage quotas and eviction criteria", last modified **5 Jan 2026** (https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

- **Firefox:**
  - Best-effort: min(10% of total disk, **10 GiB group limit per site**).
  - Persistent: up to 50% of disk, capped at 8 TiB, with no group limit.
  - Quotas are computed from *total* disk size, to avoid fingerprinting.
- **Chromium (Chrome/Edge):**
  - Up to **60% of total disk per origin**, in both best-effort and persistent modes.
  - The browser as a whole uses at most 80% of disk (MDN; web.dev, last updated 2024-09-23, https://web.dev/articles/storage-for-the-web).
  - web.dev adds: about 5% of disk in Incognito, and about 300 MB when "clear cookies and site data on close" is on.
- **Safari / WebKit** (macOS 14 / iOS 17 / Safari 17+):
  - Browser apps: about 60% of disk per origin.
  - Other WebKit apps (WKWebView): about 15%.
  - **Home Screen / Dock web apps get the browser-app quota.**
  - Cross-origin frames: about 10% of the parent's quota.
  - Overall cap: 80% of disk (browser apps) or 20% (other apps).
  - Before Safari 17: a 1 GiB origin quota, then a user prompt.
  - Sources: MDN (above); WebKit "Updates to Storage Policy", 10 Aug 2023 (https://webkit.org/blog/14403/updates-to-storage-policy/); Safari 17 notes 107711361.
- **Stale figures:** web.dev's "Storage for the web" still lists Firefox at 2 GB per origin and Safari at about 1 GB. These are **superseded** by MDN (2026) and WebKit (2023).

### `persist()` and `persisted()`

- **Support** (BCD `api.StorageManager.persist`): Chrome 55, Firefox 57, Safari 15.2.
- The spec exposes `persist()` on **Window only**, not in workers (Storage spec §8, 19 Oct 2026).
- **Chrome/Chromium:** no prompt. The request is auto-granted when the site is considered important and silently denied otherwise. Heuristics: site engagement, installed or bookmarked, notification permission (web.dev "Persistent storage", last updated 2020-05-12, https://web.dev/articles/persistent-storage; MDN 2026).
- **Firefox:** shows a **user prompt** (MDN 2026; web.dev 2020).
- **Safari:**
  - Granted by heuristics, for example whether the site is opened as a Home Screen web app (WebKit, Aug 2023). This is the only authoritative statement found.
  - BCD lists `persist()` from 15.2, but WebKit says fixes so that the storage mode is remembered across sessions, which eviction depends on, landed in **Safari 17** (WebKit WWDC23 post, https://webkit.org/blog/14205/news-from-wwdc23-webkit-features-in-safari-17-beta/; Safari 17 notes 84280909 "complete support for the Storage API").
  - Treat `persist()` on Safari before 17 as unreliable.

### `estimate()`

- Support (BCD `api.StorageManager.estimate`): Chrome 61, Firefox 57, **Safari 17**. The `usageDetails` breakdown is Chrome-only and non-standard.
- WebKit says the reported quota is an upper bound, may change with usage and visit frequency, and that `QuotaExceededError` must still be handled (WebKit, Aug 2023).

### Eviction

- **Spec:** under storage pressure, user agents clear **best-effort** buckets. Clearing is whole-bucket. User agents should avoid clearing while script that can access the bucket is running (Storage spec §7).
- **MDN 2026:**
  - Eviction is by least-recently-used origin, removes all of that origin's data at once, and skips persistent origins.
  - Proactive eviction happens only in Safari, when cross-site tracking prevention is on.
- **WebKit 2023:** eviction is per-origin LRU. Origins with an active page, or in persistent mode, may be excluded.

### Safari's 7-day cap

- **Rule:** in Safari, after 7 days of Safari use with no user interaction on the site, all script-writable storage is deleted. "Interaction" means a click, tap or key press; scrolling does not count.
- **Storage listed** (2020/2023): IndexedDB, LocalStorage, media keys, SessionStorage, Service Worker registrations and cache.
- **Since** Safari 13.1 / iOS 13.4 (WebKit blog, 24 Mar 2020, https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/; WebKit Tracking Prevention page, modified 2023-04-27, https://webkit.org/tracking-prevention/).
- **Home Screen web apps:**
  - The 2020 post says they keep their own day counter, driven by actual use of the app.
  - The Tracking Prevention page says the first-party domain of a Home Screen web app is **exempt** from the 7-day cap and isolated from Safari.
- **OPFS** is **not named** in either list, both of which predate or ignore OPFS, so coverage is **unverified**.
- **macOS Dock web apps:**
  - Safari copies only cookies to the web app. No other website data is shared, so storage is separate (WebKit WWDC23 post).
  - WebKit 2023 gives Dock apps the same quota as the browser.
  - **No explicit ITP exemption statement was found for Dock apps.**
- **iOS/iPadOS 26:** every site added to the Home Screen opens as a web app by default (WebKit "Features in Safari 26.0", 15 Sep 2025, https://webkit.org/blog/17333/webkit-features-in-safari-26-0/; Safari 26.0 notes 113034903).

### Storage Buckets

- **Support** (BCD `api.Navigator.storageBuckets`, `api.StorageBucketManager`): **Chrome/Edge 122 only**; Firefox and Safari: no.
- **Spec** (WICG CG draft, 19 Dec 2023):
  - `open(name, {persisted, quota, expires})`.
  - Each bucket has its own `indexedDB`, `caches` and `getDirectory()`.
  - `persist()` is Window-only.
- Chrome's 2022 introduction shows a `durability` bucket option (https://developer.chrome.com/docs/web-platform/storage-buckets, last updated 2022-11-04). It is **absent from the current IDL**, so do not rely on it.

---

## 5. PWA file handling and Safari web apps

- **Manifest `file_handlers` + `window.launchQueue`** (BCD `manifests.webapp.file_handlers`, `api.LaunchQueue`):
  - **Chrome/Edge 102, desktop only.** Chrome Android, Firefox and Safari: no.
  - The app must be installed.
  - Chrome shows a permission prompt before a PWA opens a file. The choice persists until the manifest's handlers change.
  - Files arrive as `LaunchParams.files`, which are `FileSystemFileHandle`s.
  - `launch_type` is `single-client` (default) or `multiple-clients`.
  - Sources: Chrome doc, last updated 2020-10-22 (https://developer.chrome.com/docs/capabilities/web-apis/file-handling); MDN, last modified 13 Nov 2025 (https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/file_handlers).
- **Safari "Add to Dock"** (macOS Sonoma / Safari 17, Sep 2023):
  - Any site can be added, and it always opens as a web app.
  - Only cookies are copied from Safari; storage is separate.
  - Dock apps get the same origin and overall quota as Safari, plus web push, badging and the usual WebKit standards.
  - Sources: WebKit WWDC23 post; WebKit storage policy 2023; Safari 17 notes 68606770.
  - Safari 17.4 added the `shortcuts` and `categories` manifest members on macOS (106137954, 116480550) (https://developer.apple.com/documentation/safari-release-notes/safari-17_4-release-notes).
  - Safari 18 added opening links directly in web apps on macOS (113034778) (https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes).
- No file-handler or file-system-picker capability is documented for Safari web apps. `file_handlers` and `launchQueue` are `false` in BCD.

---

## 6. Multi-tab coordination and page lifecycle

### Web Locks and BroadcastChannel

- **Web Locks** `navigator.locks` (BCD `api.LockManager`, `api.Navigator.locks`, `api.WorkerNavigator.locks`): Chrome 69, Edge 79, Firefox 96, **Safari 15.4** (macOS and iOS), in both window and worker.
  - Locks are scoped to the origin.
  - Modes are `exclusive` and `shared`; options are `ifAvailable`, `steal` and `signal`.
  - A lock is released when the callback's promise settles (MDN, last modified 3 Apr 2025, https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
  - Safari 27.0 fixes cleanup of the abort algorithm (178589067).
- **BroadcastChannel** (BCD `api.BroadcastChannel`): Chrome 54, Edge 79, Firefox 38, **Safari 15.4**.

### `beforeunload`

Sources: MDN, last modified 26 Oct 2026 (https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event); BCD `api.Window.beforeunload_event`.

- The dialog requires **sticky activation**.
- Only a **generic browser string** is shown.
- Trigger it with `preventDefault()`, and set `returnValue` for legacy browsers. Support for `preventDefault` triggering: Chrome 119, Firefox 6, Safari 11.
- The event does **not fire reliably, especially on mobile**.
- **Safari on iOS: not supported** (BCD `false`).
- Add the listener only while there are unsaved changes, and remove it after saving. This guidance appears in MDN and in web.dev bfcache (last updated 2026-10-16, https://web.dev/articles/bfcache).

### `visibilitychange` and `pagehide`

- The Chrome Page Lifecycle guide (2026-10-16) says:
  - Treat **hidden** as the last reliably observable state and persist unsaved state there. On mobile, `beforeunload`, `pagehide` and `unload` may never fire.
  - Use `pagehide` rather than `unload`.
  - On **freeze**, close IndexedDB connections and BroadcastChannels, and release Web Locks.
  - `IDBTransaction.commit()` lets an IndexedDB write complete from a freeze or visibilitychange handler.
- **Safari:** older versions did not fire `visibilitychange` when navigating away. BCD notes say this was fixed from Safari 14.1 / iOS 14.5 (BCD `api.Document.visibilitychange_event`).

### bfcache

- The `beforeunload` listener no longer blocks bfcache in modern browsers but is still unreliable.
- To stay bfcache-eligible, close the IndexedDB connection on `pagehide` and reopen it on `pageshow` (web.dev bfcache, 2026-10-16).

---

## 7. Atomic-write and crash-safety guidance (what the sources support)

- **IndexedDB:**
  - Transactions are specified as atomic: all of the changes or none (IndexedDB ED §committing).
  - Use `durability: 'strict'` for the commit that makes a new snapshot current.
  - Chrome's guidance: do not delete old data until the new data is durably written (Chrome durability blog, 2023).
  - The default is `relaxed` in Chrome 121+.
- **OPFS `createWritable`:**
  - Writes go to a swap or temporary file and become visible on `close()`. Atomic replacement is only described as expected, in a non-normative note, and nothing is said about fsync.
  - A failed safety check or an abort leaves the old contents.
  - Avoid `keepExistingData: true` for large files, since it copies the whole file first.
- **OPFS sync access handle (worker):**
  - Writes in place and is not atomic.
  - Call `flush()` before `close()`.
  - Any crash-safety scheme needs app-level structure, such as writing to a new file and then switching a pointer.
- **Write-new-then-switch is the pattern the primitives support:**
  1. Write the snapshot to a new OPFS file.
  2. `close()` it, then optionally re-read it and check its size or hash.
  3. Switch an IndexedDB "current file" record in a `strict` transaction.
  4. Delete the previous file only after that.
  
  This is a composition of the documented guarantees, not a vendor recommendation. Renaming with `move()` over the old file is engine-specific and unverified for Chrome and Firefox.
- **Serialise writers across tabs and workers with Web Locks.** The move() PR text itself recommends Web Locks to avoid overwrites, and Chrome's `siloed` default means the last writer to close wins.

---

## 8. Capability matrix

Version is the first stable release with support, from BCD v8.1.11 unless noted. "no" means not supported. Footnotes follow the table.

| Capability | Chromium (Chrome / Edge) | Firefox | Safari macOS | Safari iOS |
|---|---|---|---|---|
| IndexedDB in workers | 23 / 12 | 37 | 10 | 10 |
| IDB `durability` attribute | 83 / 83 (default `relaxed` since 121) | 126 (getter; honoured? ¹) | 15 | 15 |
| IDB `commit()` | 76 / 79 | 74 | 15 | 15 |
| OPFS `getDirectory()` | 86 | 111 | 15.2 | 15.2 |
| OPFS `createSyncAccessHandle` (dedicated worker) | 102 (sync methods 108) | 111 | 15.2 (sync methods 16.4) | 15.2 (16.4) |
| OPFS `createWritable` (window and worker) | 86 | 111 | **26** ² | **26** ² |
| `move()` (non-standard) | 102, files only | 111 | 15.2 (overwrite noted in 17) | 15.2 |
| Store FileSystemHandle in IDB | 86 | yes, version unverified ³ | **beta only (27.3 beta), not shipped** | **beta only (27.3 beta), not shipped** |
| `showOpen/Save/DirectoryPicker` | 86 desktop; Android 132 | no (negative) | no (oppose) | no |
| `query/requestPermission` | 86 (Android 109) | no | no | no |
| Persistent FSA permissions | 122 (installed apps automatic) | n/a | n/a | n/a |
| `a[download]` | 14 / 18 | 20 | 10.1 | 13 |
| Web Share with files | 89 (desktop full 128) / 81 | no (BCD: files `false` on desktop and Android; Android `share()` 79) | 14 | 14 |
| `file_handlers` + `launchQueue` | 102, desktop only | no | no | no |
| `navigator.storage.persist()` | 55, silent heuristics | 57, prompt | 15.2 (reliable from 17), heuristics | 15.2 (17) |
| `navigator.storage.estimate()` | 61 | 57 | 17 | 17 |
| Per-origin quota | 60% of disk | best-effort min(10%, 10 GiB/site); persistent 50% (≤8 TiB) | ~60% (browser and Dock apps) | ~60% (browser and Home Screen apps) |
| 7-day script-storage deletion | no | no | yes in Safari; Dock app exemption unverified | yes in Safari; **Home Screen apps exempt** |
| Storage Buckets | 122 | no | no | no |
| Web Locks | 69 / 79 | 96 | 15.4 | 15.4 |
| BroadcastChannel | 54 / 79 | 38 | 15.4 | 15.4 |
| `beforeunload` dialog | yes (sticky activation; `preventDefault` 119) | yes | yes (11) | **no** |

**Footnotes:**

1. Firefox 126 notes mention only the getter.
2. Release notes say "File System WritableStream API". Main-thread exposure comes from WebKit IDL at `main` and BCD.
3. Inferred from the `Serializable` attribute in Gecko IDL at `main`, which carries no version. There is no separate BCD key.

The "Store FileSystemHandle in IDB" row for Chromium comes from the FSA spec and Chrome docs.

---

## 9. Claims not verified from an authoritative source

- Whether Firefox and Safari actually **honour** IndexedDB `durability: 'strict'` with an fsync, and Chrome's claim (2023) that all other major browsers default to `relaxed`.
- Per-engine **maximum size of a single IndexedDB value or Blob**, and whether large Blobs are stored as separate files. Safari has a >2 GB range-read bug fixed in 27.3 beta. Nothing else authoritative was found.
- Whether **OPFS** is covered by Safari's 7-day ITP deletion. Both WebKit lists omit it.
- Whether **macOS Dock web apps** are exempt from the 7-day cap. The explicit exemption text names only Home Screen web apps.
- **`move()` overwrite and atomic-rename semantics** in Chrome and Firefox, and whether the Safari 17 "overwriting move" item means an atomic replace.
- Whether Safari's `createWritable` uses a swap file, and whether **any** engine fsyncs on `close()`. The spec frames atomicity only as an aim and as a non-normative expectation.
- Whether **OPFS still fails in Safari Private Browsing** (stated in 2022, not rechecked).
- **Private Browsing Blob support in Safari IndexedDB**: WebKit 156347 (NEW) and 198278 (FIXED) conflict. Third-party reports (Playwright, Dexie) were seen but are not authoritative.
- Whether Chrome still honours the bucket **`durability`** option shown in its 2022 article but missing from the current spec IDL.
- **Web Locks release on page or worker termination.** This is spec behaviour, but the fetched MDN text covered only release on callback settle.
- **Chrome's persist() heuristics** come from a 2020 web.dev article, and **Safari's** from a single 2023 sentence. Neither documents current criteria in full.
- `<input type=file>` and Blob-URL support were not separately checked in BCD.
- **No Firefox release notes after 126 were scanned** for storage changes. Only Firefox 111 and 126 were read.
- Safari release notes: see the scanned and not-scanned lists in the Method section.
- Chrome release notes were not scanned apart from the dated Chrome blog posts above.
- **caniuse and Baseline were not consulted.** Version numbers come from MDN BCD v8.1.11, the data MDN's compat tables use.
