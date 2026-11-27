# G-PRJ-R — Decision register

This register separates three things: what this research decided within its mandate, what it found, and what only the maintainer can decide. Nothing here is implemented.

**Disposition (maintainer, 2026-11-27).** G-PRJ-R is **accepted**, subject to the contract refinements in §7.
- AM-3.1 to AM-3.5 and D-PRJ-1 to D-PRJ-13 are approved, several with qualifications (§6). AM-3.6 is deferred.
- The proposals in §4 and §5 are kept as written, and each row carries its disposition.
- The reviewed head was `7ddadb31419b892d8cf77a1ae302cf7e812b6af7`; CI run `45948216117` was independently verified by the maintainer.

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
| F-2 | **The workspace never attaches the source image** to the document (`shell/jobs.ts:84,126`). Saved projects would not contain their source, and `relinkSource`/`missingSources` have no callers | G-PRJ-1 scope; source embedding approved by default (D-PRJ-10, §6.6) |
| F-3 | **Scope conflict:** RFC-002 §14, D08, VS-12 and the G-0 plan exclude autosave, project libraries, recent-file databases and OPFS/IndexedDB persistence, and say "each save is a new download". The G-PRJ scope (ROADMAP, decision register §12–13) requires them. ROADMAP says scope changes need an RFC update | AM-3.1 (D-PRJ-1), approved |
| F-4 | **w996k's document section is 69.3 MiB, over the 64 MiB cap.** The cap is reached by node count: about 305k synthetic nodes or about 190k photographic paths | Limits §4; AM-3.2/3.3, approved |
| F-5 | **Loading w756k blocks the browser main thread for 160–333 ms** (target ≤ 50 ms), takes 0.72–1.04 s, and peaks at about 719 MiB RSS in Node | G-PRJ-1: worker-side parsing, with the whole hand-off measured (§7.6) |
| F-6 | The **≤ 1 s open target** is not in RFC-002 (only ≤ 50 ms blocking, §17). It is set in REVISED-P1-SEQUENCE, the decision register and TD-PERF-009/010 | Thresholds approved (D-PRJ-9, §6.5) |
| F-7 | **Safari deletes script-writable storage after 7 days without user interaction**, except Home Screen apps. Whether OPFS is covered, and whether Dock apps are exempt, is unverified | Disclosure in the storage panel; G-PRJ-Q tests |
| F-8 | The File System Access pickers are **Chromium-only**, so save in place exists only there. Firefox and Safari save by download | Architecture §3; D-PRJ-4 |
| F-9 | Cmd/Ctrl+S and O currently reach the browser's own Save Page and Open File (`Workspace.tsx:482` passes modifiers through) | Shortcut contract (UX spec §9; D-PRJ-8) |
| F-10 | `/` is the P0 engineering workbench, not a public landing page; the PWA `start_url` is `./workspace.html` | UX spec §11: navigation |
| F-11 | No document title exists ("Untitled artwork" is hard-coded), and RFC-002 lists file names as not stored | The project name comes from the file or the library record (architecture §6) |
| F-12 | **The shared registry fails WCAG AA for destructive text: 4.43:1 at rest, 3.61:1 on hover** (`src/ui/registry/button.tsx:18`, `dropdown-menu.tsx:88`). This is production code. The audit also found the Button default `shrink-0`, which breaks truncation at 200 % zoom, the 14 and 16 px defaults outside the type scale, `transition-all`, and animation classes with no keyframes | Not fixed here (no production change in G-PRJ-R). Recorded as **TD-UI-008**; the fix measured is a /12–/15 tint (≥ 4.9:1). Overridden locally in the prototype. **Must be corrected before production destructive project controls** are introduced (maintainer, 2026-11-27; §6.8) |

## 3. Maintainer decisions recorded during this research (2026-11-26)
| # | Decision |
|---|---|
| M-1 | When Vectra opens with nothing to resume, the artist sees the **project home** first. The workspace opens once a project is chosen, and direct workspace links still work |
| M-2 | The project home is a **full-screen start screen** in the workspace's charcoal world, not an overlay |
| M-3 | Layout **A, "Resume hero with shelf"**, is chosen for the prototype (Impeccable decision round; the dealt lead) |
| M-4 | **Choosing "Open last save" must not discard the recovery snapshot.** The artist can revisit the decision: the snapshot stays offered until an explicit Discard or retention expiry (refined in §6.3: an only known copy never expires automatically) |

## 4. Architectural amendments (AM-3)
| # | Contract | Change (as proposed) | Disposition (2026-11-27) |
|---|---|---|---|
| AM-3.1 | RFC-002 §14, D08, VS-12, G-0 plan exclusions | Allow autosave and recovery, a local project library, recent projects and OPFS/IndexedDB persistence, under the three-tier rules (architecture §2). An explicit save overwrites in place only through a granted File System Access handle; elsewhere a save is a download | **Approved** |
| AM-3.2 | C10 → v2 (`documentSchemaVersion` 2) | Compact canonical encoding: default-valued node fields and the implied `id` omitted, `kind` optional, v1 read. Re-baseline the frozen canonical-serialization hash. Exports unaffected | **Approved**, with continued v1 read support. Historical v1 fixtures and hashes are preserved; v2 canonical hashes are re-baselined explicitly, never by overwriting historical evidence. G-PRJ-0's specification gives every document exactly one v2 encoding, so "`kind` optional" becomes a fixed rule, not a writer's choice |
| AM-3.3 | C3/C10 | A persistable document-section size limit, enforced per transaction like the anchor cap | **Approved** as **exact** persistable-size enforcement over the complete container, not only the document section (§7.5) |
| AM-3.4 | C7 save semantics (`saveContainer`) | Serialization does not mark the session saved; only a verified write does | **Approved**: serialization and verified-save semantics are separate |
| AM-3.5 | C5 | A persistence worker in the build's worker set, under build isolation | **Approved**: a dedicated persistence worker under C5 build isolation, never a second authoritative document engine (§7.6) |
| AM-3.6 (deferred) | C7 r3 | A sectioned document with streaming, only if limits above the compact ceiling are wanted | **Deferred**, with any streaming container change. The **64 MiB document-section cap is retained** |

**Formal recording.** The approved amendments go through the frozen-contract change-control process ([contracts](../g0/G0-ARCHITECTURE-CONTRACTS.md), "Change control": revision bumps, an RFC-002 amendment, maintainer approval) in G-PRJ-0, together with the code that implements them. Until then the contracts and RFC-002 describe the implemented v1 behaviour, so main never documents v2 as current while it writes v1.

## 5. Decisions requested from the maintainer
| # | Decision | Options | Recommendation | Disposition (2026-11-27) |
|---|---|---|---|---|
| D-PRJ-1 | AM-3.1: lift RFC-002 §14's P1 exclusions for G-PRJ | Approve / approve in part (e.g. no library) / keep | Approve, with the tier rules | **Approved** (AM-3.1) |
| D-PRJ-2 | AM-3.2 and AM-3.3: compact C10 v2 and the persistable-size limit | Approve / raise the C7 cap instead / both | Approve compact plus the limit; keep 64 MiB | **Approved**: compact encoding plus exact enforcement; 64 MiB kept |
| D-PRJ-3 | AM-3.4: verified-write save semantics | Approve / keep | Approve (F-1) | **Approved** (AM-3.4) |
| D-PRJ-4 | Firefox and Safari: does a download clear the unsaved mark? | Never (stays "Downloaded a copy") / after the user confirms / immediately | After the user confirms; the status says "Downloaded a copy" until then | **Approved with qualifications** (§6.1): "Download requested"; a confirmation clears only the revision it names |
| D-PRJ-5 | Where a new project lives before its first file save | This browser's library (automatic) / nowhere until saved (recovery only) | The library, labelled "Stored in this browser · No file copy yet"; recovery separately | **Approved with qualifications** (§6.2) |
| D-PRJ-6 | Recovery retention for unclaimed snapshots | 7 / 14 / 30 days | 14 days, listed in the storage panel | **Approved with qualifications** (§6.3): an only known copy never expires automatically |
| D-PRJ-7 | When to request `persist()` | Never / after the first library save / at first launch | After the first library save, with one sentence of explanation | **Approved with qualifications** (§6.4) |
| D-PRJ-8 | Shortcut contract (UX spec §9): take Mod+S, Mod+Shift+S, Mod+O, Mod+N in the workspace; Mod+N is not interceptable in browsers, so New project gets Mod+Alt+N or the menu | Approve / variants | Approve; browser-reserved combinations stay the browser's | **Approved**, subject to actual browser capability; unrelated browser commands are never overridden |
| D-PRJ-9 | Thresholds (qualification plan §2) | Approve / adjust | Approve as proposed, to be confirmed at G-PRJ-0 | **Approved with qualifications** (§6.5): each stage measured separately |
| D-PRJ-10 | Embed source images in projects by default | Embed (up to the 20 MiB cap) / reference only / ask | Embed by default for complete restoration; offer "Remove source to save space" | **Approved with qualifications** (§6.6): never a silent omission |
| D-PRJ-11 | Installed Chromium apps: register `file_handlers` for `.vectra` | Yes in G-PRJ-4 / later | Yes, as an enhancement | **Approved**: a progressive enhancement in G-PRJ-4, never required for portable project access |
| D-PRJ-12 | Implementation sequence ([plan](G-PRJ-IMPLEMENTATION-PLAN.md)) | Approve / reorder | Approve: G-PRJ-0 → 1 → 2 → 3 → 4 → 5 → Q | **Approved** |
| D-PRJ-13 | The project-home design ([UX spec](G-PRJ-UX-SPEC.md), [Impeccable review](G-PRJ-IMPECCABLE-REVIEW.md)) | Accept / request changes | Accept as the G-PRJ-4 target | **Approved** (§6.7) |

## 6. Maintainer qualifications (2026-11-27)
### 6.1 D-PRJ-4: download semantics
- **A download request is not proof that the file reached the filesystem.**
- The generated container is validated (reloaded through the full `loadContainer` checks) **before** it is handed to the browser.
- The status reads **"Download requested"** until the user confirms the file was saved.
- **A user confirmation may clear the dirty state for that specific revision only:**
  - it stays distinguishable from an independently verified filesystem write, in the session record and in the status wording;
  - a newer document revision is never marked clean because an older revision was downloaded.
- No repetitive confirmations during ordinary editing: the question is asked once per download, never per edit.

### 6.2 D-PRJ-5: new projects
- New projects live in the **local project library** by default.
- They are identified as **stored in this browser, with no portable file copy yet**.
- **Abandoned, untouched empty projects do not accumulate:** a project with no committed edit is not written to the library.
- **If local storage is unavailable,** an explicitly disclosed **temporary session** is permitted, with portable download available.

### 6.3 D-PRJ-6: recovery retention
- **14 days** of retention for ordinary unclaimed recovery snapshots.
- **A snapshot that is the only known copy of unsaved artwork is never expired automatically.**
- Browser storage eviction risks are disclosed clearly.
- **Open last save preserves the recovery snapshot** (M-4).
- **No implicit discard, merge or overwrite** is permitted.

### 6.4 D-PRJ-7: persistent storage
- `persist()` is requested **after the first successful library save**, where supported.
- Denial is not fatal.
- The app never claims that persistent storage survives the user manually clearing site data.

### 6.5 D-PRJ-9: qualification targets
- The proposed initial performance targets are approved.
- **Measured separately:** first save, subsequent save, parsing, validation, verification and main-thread hand-off.
- The **30-second recovery-lag target applies under healthy operating conditions.** When recovery cannot keep up, the app says so.
- **Zero unreopenable successful saves is mandatory.**

### 6.6 D-PRJ-10: source assets
- Original source images are **embedded by default**, within the existing source and session resource limits.
- **Oversized sources are never silently omitted.** The app proposes an explicit resolution: a user-approved omission, or a suitable smaller source.
- **Removing an embedded source is a deliberate action** and never removes the vector artwork.
- Existing source hashes and provenance semantics are preserved.

### 6.7 D-PRJ-12 and D-PRJ-13: sequence and design
- The staged sequence G-PRJ-0 → 1 → 2 → 3 → 4 → 5 → Q is approved.
- **Direction A, "Resume hero with shelf", is the approved target for G-PRJ-4.**
- The compact list design remains the basis for the **Show all projects** view.
- **The research prototypes are not production-qualified interfaces.**

### 6.8 Impeccable and accessibility (standing for every user-facing G-PRJ stage)
- The installed Impeccable skill is mandatory for every user-facing stage. Each stage includes an actual critique, audit, refinement and final design review, with documented findings and before/after evidence.
- **TD-UI-008 is corrected before any production destructive project control is introduced.** Destructive text contrast is qualified in rest, hover, focus and disabled states, in the shared design system.
- Unrelated UI fixes are not bundled into G-PRJ-0.

## 7. Contract refinements before implementation (2026-11-27)
The maintainer required these before implementation. Each is reconciled into the proposed contracts as listed.

| # | Refinement | Reconciled in |
|---|---|---|
| 7.1 | **Persistence identity.** A saved-version identity covers all authoritative project content, geometry and embedded sources included. A document-section digest alone never certifies equality | [Architecture](G-PRJ-ARCHITECTURE.md) §5.2; [concurrency](G-PRJ-CONCURRENCY-CONTRACT.md) §1 |
| 7.2 | **Portable write failure.** Failure before replacement is distinguished from failure detected after the browser committed the replacement. The previous file is not claimed untouched after a failed post-write verification; the project stays dirty, the failure is disclosed, and a safe alternative save path is offered | Architecture §5.4; concurrency §2 |
| 7.3 | **Atomic local publication.** Write-new, verify, then flip the IndexedDB pointer transactionally (approved). OPFS and IndexedDB are not one atomic transaction, so recovery is specified for: a pointer to a missing or corrupted file; a pointer commit that survives when the newest file does not; interrupted cleanup; another tab writing a candidate; an old build meeting a newer record. A verified previous generation is kept where needed. Orphan cleanup never deletes in-flight writes, retained recovery snapshots or files of an unsupported newer version. Qualified by fault injection | [Recovery](G-PRJ-RECOVERY-CONTRACT.md) §4; architecture §5.3; [qualification](G-PRJ-QUALIFICATION-PLAN.md) §3 |
| 7.4 | **Concurrency.** Web Locks protect cooperating same-origin sessions only, not other applications or browser profiles. Handle-identity registration, project locking and stale-session recovery claims are race-safe. The relevant lock is acquired before acting on a recovery record; a `locks.query()` observation alone is not enough. External-file conflict detection acknowledges the races that remain with non-cooperating writers | Concurrency §1–§4; recovery §5 |
| 7.5 | **Persistability.** The invariant covers the complete container: document section, source sections, geometry and manifest, section count, header and total limits, and compression bounds. No independent arbitrary path-count limit. Warnings near the document-section cap refer to document complexity or section capacity, never the maximum total file size | [Limits](G-PRJ-PERSISTENCE-LIMITS.md) §6, §7, §9; UX spec §6 |
| 7.6 | **Worker architecture.** The persistence worker is never a second authoritative document engine. Ownership, transfer, validation and publication boundaries are specified. Moving parsing into a worker must not shift equivalent blocking work back to main-thread reconstruction or repeated full validation; the entire hand-off is measured | Architecture §4.1; qualification §1 |

## 8. Impeccable tooling after acceptance (2026-11-27)
- **Installed version: 4.11.1** (`impeccable --version`; skill metadata `version: 4.11.1`). The maintainer updated it from 4.11.0, the version used throughout this research. No update or reinstall was run here.
- **`impeccable doctor --json`** at `7ddadb3` reported three findings, none of severity `auto`:

| Finding | Severity | What it means here | Action |
|---|---|---|---|
| `config-build-path-unset` | mention | No `buildPath` is recorded in `.impeccable/config.json` (which does not exist). It only matters for Persuade and Experience surfaces built from a generated comp | None. This tool surface has no image generation, so there is no comp-first choice to record (doctor's own rule); Vectra's project surfaces are Operate surfaces, which are code-led either way |
| `hook-not-installed` | route | No Impeccable design hook is installed | None without approval. Installing hooks is excluded by the brief. `impeccable hooks off` would record `hook.enabled: false` in a new, committed `.impeccable/config.json` and silence the finding; it changes hook configuration, so it is **raised for maintainer approval** rather than applied |
| `workspace-context-inherited` | mention | `packages/vector-engine-wasm` inherits the root PRODUCT.md and DESIGN.md | None. The package is the Rust/WASM engine with no user interface, so no Impeccable surface resolves to it. Only the maintainer can decide whether a child record is wanted |

- No optional telemetry was sent. DESIGN.md, PRODUCT.md, `.claude/` settings and global settings are untouched.
