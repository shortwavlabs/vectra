# G-PRJ-R — Decision register

This register separates three things: what this research decided within its mandate, what it found, and what only the maintainer can decide. Nothing here is implemented.

## 1. Research decisions taken within the mandate
| # | Decision | Why | Where |
|---|---|---|---|
| R-1 | **OPFS holds artwork bytes** (library and recovery) as ordinary `.vectra` containers. **IndexedDB holds the index** and the current-file pointers | OPFS is fast for large files (32 MiB written in 3–28 ms) and present in all engines. The same format means the same validation. IndexedDB transactions are all-or-nothing by spec | [Storage](G-PRJ-STORAGE-COMPARISON.md) §3 |
| R-2 | **Publish by write-new, verify, then flip the pointer**, not by rename | `move()` is not in the WHATWG spec and its signatures differ (Safari needs `move(dir, name)`, probed). `close()` promises no fsync | [Recovery](G-PRJ-RECOVERY-CONTRACT.md) §4 |
| R-3 | **Recommend compact canonical JSON (C10 v2) plus a persistable-size limit, before any larger limit** | Lossless compact encoding gives 0.594–0.772 of the size and makes w996k (41.4 MiB) and the 1M-anchor synthetic case (62.6 MiB) fit. Alone it cannot cover style-heavy documents, so the limit establishes the invariant | [Limits](G-PRJ-PERSISTENCE-LIMITS.md) §6 |
| R-4 | **Codec `none` for recovery snapshots, `deflate-raw` for explicit saves** | Deflate dominates save time: 1,238 ms against 4 ms on the halftone | Limits §4.6 |
| R-5 | **Playwright WebKit is not evidence for storage** | It fails OPFS and IndexedDB in its ephemeral context, while real Safari 26.6.2 passes | Storage §1 |
| R-6 | Research harnesses live in `scripts/g-prj/` and `prototypes/g-prj/` (dev server only; not in `vite.config.ts` build inputs) | No production behaviour change (brief §3) | — |
| R-7 | **Impeccable decision round through the structured-question fallback**, with the sketches sent as images | The maintainer was on Remote Control, where the localhost decision page is not reachable; Impeccable's PRESENTATION rules name this fallback | [Impeccable review](G-PRJ-IMPECCABLE-REVIEW.md) §2 |
| R-8 | Impeccable's optional anonymous choice ping was **not** sent | Vectra's no-telemetry stance; nothing about the round leaves the machine | Impeccable review §2 |
| R-9 | Undo history stays unpersisted by default (RFC-002 §14 kept) | AM-2 history can reach 128 MiB, and persisting it would freeze the transaction model; evaluated in [architecture](G-PRJ-ARCHITECTURE.md) §8 | Architecture §8 |

## 2. Findings
| # | Finding | Disposition |
|---|---|---|
| F-1 | **`saveContainer` calls `markSaved` before anything is written, and without verification** (`container.ts:434`). A save UI built on it would show "saved" for bytes that never reached disk | Must change before any Save UI (AM-3.4, G-PRJ-0) |
| F-2 | **The workspace never attaches the source image** to the document (`shell/jobs.ts:84,126`). Saved projects would not contain their source, and `relinkSource`/`missingSources` have no callers | G-PRJ-1 scope; source embedding is a maintainer decision (D-PRJ-10) |
| F-3 | **Scope conflict:** RFC-002 §14, D08, VS-12 and the G-0 plan exclude autosave, project libraries, recent-file databases and OPFS/IndexedDB persistence, and say "each save is a new download". The G-PRJ scope (ROADMAP, decision register §12–13) requires them. ROADMAP says scope changes need an RFC update | AM-3.1 (D-PRJ-1) |
| F-4 | **w996k's document section is 69.3 MiB, over the 64 MiB cap.** The cap is reached by node count: about 305k synthetic nodes or about 190k photographic paths | Limits §4; AM-3.2/3.3 |
| F-5 | **Loading w756k blocks the browser main thread for 160–333 ms** (target ≤ 50 ms), takes 0.72–1.04 s, and peaks at about 719 MiB RSS in Node | G-PRJ-1: worker-side parsing |
| F-6 | The **≤ 1 s open target** is not in RFC-002 (only ≤ 50 ms blocking, §17). It is set in REVISED-P1-SEQUENCE, the decision register and TD-PERF-009/010 | Thresholds proposed for approval (D-PRJ-9) |
| F-7 | **Safari deletes script-writable storage after 7 days without user interaction**, except Home Screen apps. Whether OPFS is covered, and whether Dock apps are exempt, is unverified | Disclosure in the storage panel; G-PRJ-Q tests |
| F-8 | The File System Access pickers are **Chromium-only**, so save in place exists only there. Firefox and Safari save by download | Architecture §3; D-PRJ-4 |
| F-9 | Cmd/Ctrl+S and O currently reach the browser's own Save Page and Open File (`Workspace.tsx:482` passes modifiers through) | Shortcut contract (UX spec §9; D-PRJ-8) |
| F-10 | `/` is the P0 engineering workbench, not a public landing page; the PWA `start_url` is `./workspace.html` | UX spec §11: navigation |
| F-11 | No document title exists ("Untitled artwork" is hard-coded), and RFC-002 lists file names as not stored | The project name comes from the file or the library record (architecture §6) |
| F-12 | **The shared registry fails WCAG AA for destructive text: 4.43:1 at rest, 3.61:1 on hover** (`src/ui/registry/button.tsx:18`, `dropdown-menu.tsx:88`). This is production code. The audit also found the Button default `shrink-0`, which breaks truncation at 200 % zoom, the 14 and 16 px defaults outside the type scale, `transition-all`, and animation classes with no keyframes | Not fixed here (no production change in G-PRJ-R). Recorded as **TD-UI-008**; the fix measured is a /12–/15 tint (≥ 4.9:1). Overridden locally in the prototype |

## 3. Maintainer decisions recorded during this research (2026-11-26)
| # | Decision |
|---|---|
| M-1 | When Vectra opens with nothing to resume, the artist sees the **project home** first. The workspace opens once a project is chosen, and direct workspace links still work |
| M-2 | The project home is a **full-screen start screen** in the workspace's charcoal world, not an overlay |
| M-3 | Layout **A, "Resume hero with shelf"**, is chosen for the prototype (Impeccable decision round; the dealt lead) |
| M-4 | **Choosing "Open last save" must not discard the recovery snapshot.** The artist can revisit the decision: the snapshot stays offered until an explicit Discard or retention expiry |

## 4. Architectural amendments requiring approval (AM-3)
| # | Contract | Change |
|---|---|---|
| AM-3.1 | RFC-002 §14, D08, VS-12, G-0 plan exclusions | Allow autosave and recovery, a local project library, recent projects and OPFS/IndexedDB persistence, under the three-tier rules (architecture §2). An explicit save overwrites in place only through a granted File System Access handle; elsewhere a save is a download |
| AM-3.2 | C10 → v2 (`documentSchemaVersion` 2) | Compact canonical encoding: default-valued node fields and the implied `id` omitted, `kind` optional, v1 read. Re-baseline the frozen canonical-serialization hash. Exports unaffected |
| AM-3.3 | C3/C10 | A persistable document-section size limit, enforced per transaction like the anchor cap |
| AM-3.4 | C7 save semantics (`saveContainer`) | Serialization does not mark the session saved; only a verified write does |
| AM-3.5 | C5 | A persistence worker in the build's worker set, under build isolation |
| AM-3.6 (deferred) | C7 r3 | A sectioned document with streaming, only if limits above the compact ceiling are wanted |

## 5. Decisions requested from the maintainer
| # | Decision | Options | Recommendation |
|---|---|---|---|
| D-PRJ-1 | AM-3.1: lift RFC-002 §14's P1 exclusions for G-PRJ | Approve / approve in part (e.g. no library) / keep | Approve, with the tier rules |
| D-PRJ-2 | AM-3.2 and AM-3.3: compact C10 v2 and the persistable-size limit | Approve / raise the C7 cap instead / both | Approve compact plus the limit; keep 64 MiB |
| D-PRJ-3 | AM-3.4: verified-write save semantics | Approve / keep | Approve (F-1) |
| D-PRJ-4 | Firefox and Safari: does a download clear the unsaved mark? | Never (stays "Downloaded a copy") / after the user confirms / immediately | After the user confirms; the status says "Downloaded a copy" until then |
| D-PRJ-5 | Where a new project lives before its first file save | This browser's library (automatic) / nowhere until saved (recovery only) | The library, labelled "Stored in this browser · No file copy yet"; recovery separately |
| D-PRJ-6 | Recovery retention for unclaimed snapshots | 7 / 14 / 30 days | 14 days, listed in the storage panel |
| D-PRJ-7 | When to request `persist()` | Never / after the first library save / at first launch | After the first library save, with one sentence of explanation |
| D-PRJ-8 | Shortcut contract (UX spec §9): take Mod+S, Mod+Shift+S, Mod+O, Mod+N in the workspace; Mod+N is not interceptable in browsers, so New project gets Mod+Alt+N or the menu | Approve / variants | Approve; browser-reserved combinations stay the browser's |
| D-PRJ-9 | Thresholds (qualification plan §2) | Approve / adjust | Approve as proposed, to be confirmed at G-PRJ-0 |
| D-PRJ-10 | Embed source images in projects by default | Embed (up to the 20 MiB cap) / reference only / ask | Embed by default for complete restoration; offer "Remove source to save space" |
| D-PRJ-11 | Installed Chromium apps: register `file_handlers` for `.vectra` | Yes in G-PRJ-4 / later | Yes, as an enhancement |
| D-PRJ-12 | Implementation sequence ([plan](G-PRJ-IMPLEMENTATION-PLAN.md)) | Approve / reorder | Approve: G-PRJ-0 → 1 → 2 → 3 → 4 → 5 → Q |
| D-PRJ-13 | The project-home design ([UX spec](G-PRJ-UX-SPEC.md), [Impeccable review](G-PRJ-IMPECCABLE-REVIEW.md)) | Accept / request changes | Accept as the G-PRJ-4 target |
