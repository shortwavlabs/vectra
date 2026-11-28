# G-PRJ-0 — Persistence foundations: report

**Status: implemented and qualified for maintainer acceptance. Not merged; G-PRJ-1 not started.** No Save UI, library, autosave or production project home is part of this stage.

**Decisions requested from the maintainer:**
1. **The high-water-mark rule (C7 r3):** enforcement charges `nextId` and `nextChunkId` at their maximum width, 16 digits each. This keeps every state reachable by undo saveable after the marks grow, at the cost of up to 30 bytes of the 64 MiB document capacity (§4, §7).
2. **TD-PERF-009 closure:** the Node open criteria are now met on the P1-A benchmark itself (§8). The browser main-thread budget stays with TD-PERF-010 and G-PRJ-1.
3. **TD-PERF-013:** accept the 4,094-chunk bound for P1, or schedule chunk compaction before bake-heavy editing (§7, §12).
4. **Impeccable `hooks off`:** recording `hook.enabled: false` in a new, committed `.impeccable/config.json` would silence doctor's `hook-not-installed` finding. It changes hook configuration, so it waits for approval (§13).

| | |
|---|---|
| Mandate | "Vectra — G-PRJ-R Acceptance and G-PRJ-0 Authorization" (maintainer, 2026-11-27), §6–§8; [G0 decision register §14](../g0/G0-DECISION-REGISTER.md) |
| Base | `main` `2341123bf557573341126792023e248e8bdfd086` (G-PRJ-R integrated, §1) |
| Branch | `gate/g-prj-0`, in the main checkout (no extra clone or worktree) |
| Machine | Apple M5 Max, 128 GiB, macOS 26.6.2, Node 24.22.1. Shared, never quiet: load averages and top processes are recorded in every run file; no `ngspice` ran |
| Engines | Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2; real Safari 26.6.2 |
| Scope (checked: `git diff --name-only main...HEAD`) | no change to `package.json`, `pnpm-lock.yaml`, `Cargo.*`, `crates/`, `packages/`, `src/shell`, `src/ui`, `src/workspace`, `public/`, `vite.config.ts` or the HTML entries; no dependency added. Changed: `src/document`, `src/persistence`, tests, scripts, docs |

## 1. G-PRJ-R integration (verified)
- PR #23 merged with a merge commit: `2341123`, parents `276c1ec` (previous main) and `c6e8885` (final research head). The merge's tree equals the PR head's tree (`4cedb2eb…`), and both parents are ancestors of main.
- CI: run `46078333400` on `c6e8885` (the final documentation head) succeeded; main CI run `46078744682` on `2341123` succeeded. Auto-fix stayed off; branch protection was not bypassed.
- The PR contained no production implementation (`src/`, `public/`, build inputs and lockfile untouched; checked before merging).
- The G-PRJ-R worktree's ignored evidence (183 files) was archived to `tests/output/archive/g-prj-r-20261127` with `ARCHIVE.md`, checksummed (184/184 verified) and compared byte for byte with the source, then the worktree was removed (`git worktree remove`, no `--force`) and its merged branch deleted.

## 2. Formal AM-3 amendments (change control)
Recorded in this PR, with the code that implements them:

| Item | Where | Status |
|---|---|---|
| AM-3.1 library, recovery, recents, OPFS/IndexedDB | [RFC-002](../../RFC-002.md) status, D08 and §14; contracts §AM-3 | Approved, **not implemented** (G-PRJ-1 to 3) |
| AM-3.2 compact `documentSchemaVersion` 2 | contracts **C10 r2** (§Document v2), **C6 r3**; RFC-002 §14 | **Implemented** |
| AM-3.3 exact persistability | contracts **C7 r3** (§Persistability); RFC-002 §14 | **Implemented** |
| AM-3.4 serialization is not a save | contracts **C7 r3** (dirty state); RFC-002 §14 | **Implemented** |
| AM-3.5 persistence worker | contracts **C5 r3** (boundaries) | Approved, **not implemented** (G-PRJ-1) |
| AM-3.6 sectioned container | — | Deferred; 64 MiB kept |

The amendment record is [G0-ARCHITECTURE-CONTRACTS §AM-3](../g0/G0-ARCHITECTURE-CONTRACTS.md); the approval is in the decision register §14.

## 3. The compact encoding (normative: C10 r2)
- **Rules.**
  - The `id` member is never written in any ID-keyed map: the key is the id.
  - A node's `kind` is never written: the key's prefix implies it (`lay_`, `grp_`, `pth_`, `src_`).
  - Node defaults are never written: `name: ""`, `visible: true`, `locked: false`, and the identity `localTransform` (compared by value).
  - Null style members (`fill`, `paletteRef`, `stroke`) are never written.
  - Everything else is as in v1.
- **One encoding per document.** "Omit at default" is a rule, not a writer's option: an explicitly written default, null, `id` or `kind`, and any unknown key prefix are rejected. So `encode(decode(bytes)) = bytes` for every accepted v2 section (tested on a hand-written literal, on Unicode, escapes and numeric bounds, and on every workload).
- **Strict readers.** v1 keeps its own strict reader; v1 member sets inside a v2 document, and the reverse, are rejected; the manifest's version must equal the document's.
- **Default reconstruction** is deterministic: the reader restores each default; the identity transform becomes the shared `IDENTITY` constant (also what commands use).
- **Unchanged:** the in-memory model, every command, validation, exports. Export metadata keeps its literal `params.documentSchemaVersion: 1` (frozen export bytes, C10 r2 note).
- **Independent checks of the encoder:** a hand-written specification literal (not generated by the encoder), and the **test-only v1 writer** (`src/document/testing/document-json-v1.ts`, the pre-G-PRJ-0 production writer): a document read from v2 and written as v1 must equal the original's v1 bytes.

## 4. Persistability accounting and enforcement (AM-3.3, AM-3.4)
- **One number per state.** `body` is the exact length of the v2 document section without the digits of the two high-water marks. It is stored as a fourth field of the session's per-state derived record.
- **Incremental.** `bodyDelta(prev, next, writes)` uses the transaction's Draft write log, the same superset the incremental validator uses, so no unchanged node is visited. Identity tests come first for the artboard, roots, id and the style, palette and asset maps; changed map entries come from `changedKeys`.
  - **Paths:** an allocation-free length function mirrors the encoder's rules. Paths are most of every document and of every large commit.
  - **Containers:** child lists are measured without regular expressions, under the precondition that ids are C1 ids. Provenance length is memoised per immutable record (weak keys).
- **Construction.** The session constructor computes `body` as an entry sum, with no second document value.
- **Oracles.**
  - In `compare` validation mode (development and tests), every dispatch and every construction also compares with a full serialization (`fullBody`), so all 488 unit tests exercise it.
  - The differential and the qualification compare with real serialization: actual bytes, re-encoded geometry records and source bytes.
- **The complete container** (C7 r3 §Persistability):
  - document section (64 MiB);
  - section count (4,096);
  - header (implied: worst case 962,592 bytes);
  - total declared bytes against the session budget, which the loader passes to the session it builds, capped at C7's;
  - source and geometry section caps;
  - embedded assets without bytes, which are refused.

  Geometry sizes come from `GeometryStore.recordBytes(id)`: one number per chunk, computed at commit from the manifest length and the block layout, equal to `encodeRecord(id).length` (checked).
- **High-water marks** (`nextId`, `nextChunkId`) live outside the state and only grow, so enforcement charges each at 16 digits. **Proposed for acceptance as an explicit rule:** a state accepted at the exact limit stays saveable after later edits widen the marks and the artist undoes back to it. The usable capacity is up to 30 bytes below 64 MiB (25 bytes unused at the measured boundary, §7).
- **Enforcement** runs in `dispatch` after validation and before anything is published. A transaction that would exceed a limit throws `DocumentError("persist_limit")`, naming the limit, the size needed and the cap. The session, its revision, `nextId` and the store's live chunks are unchanged.
  - The shell shows it on its existing paths ("Edit rejected: …", "Import failed: …"); no new UI.
  - Messages near the document cap speak of document complexity, never a maximum file size.
- **Limits** are each a positive integer no greater than C7's (constructor, `setPersistLimits`, the loader's budget), and tightening them is refused when a state undo or redo can reach would exceed them (both from the independent review, §11).
- **Saves.** `saveContainer` no longer marks the session saved (AM-3.4). It pre-flights the exact sizes against the loader's limits **before** serializing, hashing or compressing, and refuses to return bytes if what it built differs from the accounting.
- **Files:** `src/persistence/persistable.ts` (accounting), `limits.ts` (shared C7 constants), `document-json.ts` (v2 writer, v1 and v2 readers), `canonical-json.ts` (`canonicalLength`), `container.ts`; `src/document/session.ts`, `geometry-store.ts` (`recordBytes`), `structure-accounting.ts` (`derivedCost` counts fields).

## 5. Differential and adversarial results
| Test | Result |
|---|---|
| Unit suite (`vp test`), every dispatch and construction in compare mode | **493 passed** (465 on main + 28 new) |
| Differential, unit (seed 2026): 10,000 transactions with undo, redo, coalescing, branching, commits without history, embedded sources and tightened limits | **0 disagreements**; every rejection atomic |
| Broader corpus (`scripts/g-prj-0/persistability-corpus.mjs`): 12 seeds × 10,000 in incremental, compare and full modes, real codec-`none` containers every 53 steps | **120,000 transactions, 0 disagreements**; 3,968 persistence refusals, all atomic |
| Boundaries (unit): document section, section count, session budget, source cap, missing source bytes, constructor and `setPersistLimits` | exact: at the limit accepted, one byte or section more refused |
| High-water marks: a 9 → 10 rollover inside a transaction; chunk ids advanced by refused commits | exact |
| `canonicalLength` against the encoder | 2,000 random values plus escapes, surrogate pairs, every number form: exact |
| v2 schema adversarial: 12 explicit-default cases, 17 malformed-member cases, version cases | all rejected |
| Container adversarial: v1 reader suite unchanged; new v2 suite; manifest/document version disagreement | typed errors, live document unchanged |

## 6. Legacy compatibility
| Fixture | Result |
|---|---|
| v1 golden `circle-bw.none.vectra.b64` | **unchanged** (SHA-256 `8beeea92…`, equal to the G-DOC artifact); re-derived byte for byte by the test-only v1 writer; loads; saves as the v2 golden; the v2 golden reloads and writes the v1 golden again |
| G-DOC-R frozen serialization hash `e60fa327…` (v1) | **kept**, re-derived in every validation mode; the v2 file reloads and writes it again |
| New v2 golden `circle-bw.v2.none.vectra.b64` | SHA-256 `ad621763…`; v2 frozen hash `e53eb986…` (re-baselined explicitly) |
| Registered photographic v1 containers (bark-1224, bark-2350, synthetic-many-250k, architecture-street-halftone) | load; the original v1 file's document section equals the v1 encoding of the document reloaded from its v2 save |

## 7. Large-project round trips (Node)
- **Records.** Correctness is from `scripts/g-prj-0/qualify.mjs` on the final code, `bd2fd8b` (`bench/qualify-bd2fd8b.json`; load 5.1 → 7.7, other work running). Timings are given from both that run and the identical-path run on `f7db368` (`bench/qualify-f7db368.json`; load about 1.8).
- **Checks.** Each workload is saved with both codecs (medians of three) and loaded. Its round trip is checked through independent paths:
  - resave byte-identical (codec none);
  - the v1 encoding of the reloaded document equal to the original's;
  - every geometry record and embedded source equal;
  - `persistInfo` equal;
  - clean after load;
  - serialization not marking a dirty session saved;
  - for v1 inputs, the original file's document section reproduced from the v2 save.

| Workload | Nodes | v1 doc (MiB) | v2 doc (MiB) | v2/v1 | Of the 64 MiB cap | Save none / deflate (ms) | Load none / deflate (ms) | Peak RSS load / save (MiB) | Checks |
|---|---|---|---|---|---|---|---|---|---|
| v1 golden (circle-bw) | 3 | 0.00 | 0.00 | 0.823 | 0.0 % | 0.3 / 1.1 | 0.4 / 0.8 | — | all 8 pass |
| bark-1224 (photographic, v1 file) | 16,058 | 5.70 | 3.37 | 0.591 | 5.3 % | 38 / 432 · 41 / 452 | 98 / 142 · 96 / 138 | — | all 8 pass |
| bark-2350 (photographic, v1 file) | 43,623 | 14.47 | 8.48 | 0.586 | 13.3 % | 120 / 1,303 · 116 / 1,345 | 247 / 349 · 237 / 341 | 356 / 133 | all 8 pass |
| halftone (v1 file, 977k anchors) | 3 | 0.00 | 0.00 | 0.820 | 0.0 % | 3 / 1,269 · 4 / 1,544 | 30 / 104 · 33 / 139 | — | all 8 pass |
| synthetic-250k (v1 file) | 41,862 | 8.66 | 4.60 | 0.531 | 7.2 % | 52 / 394 · 62 / 488 | 110 / 125 · 130 / 165 | — | all 8 pass |
| interactive-43k | 44,012 | 9.07 | 4.80 | 0.529 | 7.5 % | 51 / 271 · 66 / 366 | 113 / 144 · 152 / 188 | — | all 7 pass |
| palette-provenance (20k styles, 30k palette) | 20,005 | 7.35 | 4.38 | 0.595 | 6.8 % | 56 / 146 · 73 / 194 | 116 / 131 · 151 / 173 | — | all 7 pass |
| embedded sources (1, 5 and 20 MiB, plus one not embedded) | 2,007 | 0.41 | 0.21 | 0.525 | 0.3 % | 11 / 52 · 13 / 62 | 25 / 47 · 29 / 63 | — | all 7 pass |
| w756k (250k paths) | 251,012 | 52.48 | 27.93 | 0.532 | 43.6 % | 379 / 985 · 472 / 1,294 | 624 / 731 · 944 / 1,040 | 526 / 268 | all 7 pass |
| **w996k** (330k paths, 996k anchors) | 331,012 | **69.34** | **36.94** | 0.533 | **57.7 %** | 485 / 1,335 · 622 / 1,852 | 874 / 992 · 1,258 / 1,391 | 651 / 398 | all 7 pass |
| open-50k (50k × 4) | 50,009 | 10.31 | 5.45 | 0.529 | 8.5 % | 64 / 228 · 80 / 315 | 122 / 153 · 155 / 189 | — | all 7 pass |
| open-250k-1m (250k × 4) | 250,009 | 52.27 | 27.82 | 0.532 | 43.5 % | 377 / 1,192 · 472 / 1,664 | 655 / 784 · 890 / 878 | — | all 7 pass |
| **limit-500k** (500k paths, 1M anchors) | 500,009 | **104.96** | **55.95** | 0.533 | **87.4 %** | 790 / 1,662 · 784 / 1,672 | 1,459 / 1,576 · 1,455 / 1,602 | 944 / 414 | all 7 pass |

Timings are `f7db368 · bd2fd8b` (quiet-ish · loaded). Peaks are from `bd2fd8b`. Every required workload fits every approved limit, so **no limit had to be raised**. limit-500k fits with 8.4 MB of document capacity left.

**The exact boundary** (`boundary` in the record):
- limit-500k is filled with 31,732 names of 256 characters until the document bound equals **67,108,864 bytes exactly**. The actual section is 67,108,839 bytes: 25 of the reserved mark bytes are unused.
- One more rename (+11 bytes) is **refused** ("The document is too complex to save: its document section would need 67,108,875 bytes, and the document section cap is 67,108,864 bytes"), with the session unchanged.
- The boundary document saves, reloads, and round-trips through the v1 encoding.

**Refusal at the real limits:**
- **Section count:** 4,094 one-path trace commits are accepted; the next is refused at 4,097 sections (TD-PERF-013).
- **Session budget:** 25 embedded 20 MiB sources are accepted (524,321,620 bytes); the 26th is refused at 545,293,463 against 536,870,912. The 25-source document saves and reloads.

## 8. Performance
**Integrated dispatch** (the G-DOC-R harness, `scripts/bench-g-doc-r.mjs`, now also reporting the accounting time per dispatch).
- The same 12 transaction types, 30 repetitions, incremental validation, run on `main` `2341123` and on G-PRJ-0 `bd2fd8b`, by switching branches in the main checkout.
- Neither run is quiet. The main run started at load 1.67; the G-PRJ-0 run at 6.97, with other projects' Python jobs running.
- Values are p50 / p95 in ms.

| Type | 43k: main | 43k: G-PRJ-0 | 43k: accounting | 250k: main | 250k: G-PRJ-0 | 250k: accounting |
|---|---|---|---|---|---|---|
| setFill1 | 0.113 / 0.218 | 0.135 / 0.208 | 0.009 / 0.014 | 0.166 / 0.233 | 0.152 / 0.213 | 0.008 / 0.014 |
| setFillMany (1,000 paths) | 6.688 / 6.976 | 7.245 / 7.670 | 0.362 / 0.392 | 21.12 / 22.24 | 20.59 / 21.27 | 0.443 / 0.487 |
| setVisible | 0.073 / 0.095 | 0.086 / 0.122 | 0.004 / 0.007 | 0.162 / 0.184 | 0.130 / 0.161 | 0.003 / 0.005 |
| rename | 0.067 / 0.100 | 0.088 / 0.128 | 0.004 / 0.007 | 0.166 / 0.241 | 0.128 / 0.167 | 0.003 / 0.004 |
| reorder | 2.739 / 2.839 | 2.821 / 2.913 | 0.046 / 0.060 | 14.96 / 15.61 | 14.63 / 15.16 | 0.252 / 0.258 |
| applyTransformPath | 0.082 / 0.137 | 0.094 / 0.144 | 0.005 / 0.008 | 0.155 / 0.201 | 0.140 / 0.170 | 0.004 / 0.006 |
| applyTransformLayer | 5.083 / 5.402 | 5.182 / 6.200 | 0.022 / 0.041 | 27.32 / 27.67 | 26.47 / 26.74 | 0.028 / 0.040 |
| group | 3.480 / 3.605 | 3.380 / 3.536 | 0.038 / 0.044 | 17.93 / 18.91 | 17.85 / 18.44 | 0.253 / 0.262 |
| ungroup | 5.322 / 5.496 | 5.242 / 5.414 | 0.043 / 0.052 | 26.37 / 26.99 | 26.08 / 26.67 | 0.283 / 0.340 |
| delete | 2.958 / 3.047 | 2.817 / 3.009 | 0.038 / 0.048 | 16.18 / 16.89 | 16.05 / 16.62 | 0.255 / 0.269 |
| duplicate | 2.965 / 3.053 | 2.946 / 3.238 | 0.049 / 0.054 | 16.32 / 16.73 | 16.32 / 16.90 | 0.251 / 0.263 |
| commitTrace (1,000-path layer) | 7.025 / 7.583 | 7.261 / 7.748 | 0.383 / 0.405 | 6.194 / 7.234 | 6.528 / 7.848 | 0.394 / 0.436 |

- **The ≤ 1 ms target is met.**
  - Accounting p95 is at most **0.487 ms** in every type at both sizes.
  - Ordinary single-node edits cost about 0.01 ms.
  - Edits to a 31k-child container cost about 0.25–0.34 ms, from measuring its child list.
  - 1,000-path transactions cost 0.36–0.49 ms.
- **Integrated dispatch** stays within the run-to-run variation of main's: no type regresses beyond its own spread. No full-document traversal happens on ordinary edits.
- **Margin, before the fix:** an earlier version measured setFillMany at 250k at p95 1.35 ms. It was fixed by an allocation-free path length (§4), not by relaxing anything.
- **Large commits:** the w996k commit (330k paths) spends 50.8–54.9 ms of 958–1,244 ms in accounting (4–5 %; `f7db368` and `bd2fd8b`). It is proportional to the paths written.
- **Open (`loadContainer`, Node), the P1-A benchmark itself** (`docs/research/g-doc/bench/bench.mjs`): `main` vs G-PRJ-0 `3ad9f6a`, minutes apart. Medians in ms, codec none / deflate-raw:

| Workload | main (v1 file) | G-PRJ-0 (v2 file) |
|---|---|---|
| A: 50k paths × 20 anchors | 166 / 292 | **133 / 253** |
| B: 250k × 4 (1M anchors) | 857 / 1,007 | **643 / 813** |
| I: interactive target | 126 / 162 | **101 / 138** |

  Every open is now under 1 s; on main, B with deflate-raw was not. The session constructor's accounting (`bodyOf`) is included and costs 4–9 ms at these sizes, 16–44 ms for the largest workloads. The smaller v2 parse more than pays for it.
- **Save:** codec none is faster because the section is smaller. Deflate-raw save is still dominated by geometry compression (w996k 1.33 s; the halftone 1.27 s against 3 ms with none), as in G-PRJ-R.

## 9. Memory
| What is retained | Accounted (AM-2) | Measured |
|---|---|---|
| One number per document state (`body`, a fourth field of the derived record) | +8 bytes per retained state (`derivedCost` counts fields) | **+8 bytes per retained history entry** in every clean calibration scenario: AM-2 calibration on `main` and on G-PRJ-0 `c7230c8`, 27 scenarios |
| One number per geometry chunk (`recordBytes`) | covered by the frozen 3,136-byte fixed part | **+8 bytes per chunk** at all 11 sizes (`measure-chunk-overhead.mjs`, main vs `175c325`). The G-DOC-R closure's largest residual goes from 3,099 to 3,107, still under 3,136 |
| Provenance length memo | not accounted: one weakly keyed number per trace-provenance record, never per state, never retaining a state | — |

- **A measured defect, fixed before this report.** Building the derived record with an object spread (`{ ...v, body }`) measured **40 bytes** per retained state against 8 accounted. One literal with all four fields measures exactly 8 (§4, `withBody`).
- **Calibration ratios are unchanged** (accounted ÷ measured, median of three):
  - every clean scenario keeps its main value, 1.001–1.252;
  - two small scenarios are bimodal on main and in the accepted G-DOC-R closure records alike. They are "undo/redo and a branch" (0.875–1.031 on main) and "eviction, 60 edits" (median 0.694 in the closure record). They show the same two modes here, with the minimum measured value up exactly 8 bytes per entry.
- **Loading builds no second document** (the constructor's entry sum).
- **Peak RSS is lower than for v1,** because the document text is smaller (child process; max RSS after minus RSS before):
  - **w756k:** load 485–526 MiB, save 260–268 MiB. G-PRJ-R measured 719 / 490 MiB for the v1 file of the same workload.
  - **w996k:** load 649–651 MiB, save 398–407 MiB.
  - **limit-500k:** load 944–973 MiB, save 411–414 MiB.
  - Ranges span the two qualification runs, `f7db368` and `bd2fd8b` (§7).

## 10. Frozen regressions and browsers
| Check | Commit | Result |
|---|---|---|
| Engine corpus (326 minus every `concert-*`: 294) | `c7230c8` (no Rust change on the branch) | **294/294** identical to `a4cf172.sha256` |
| Bundle v2 | `c7230c8` | **72/72** identical |
| Document export (scene → document → `.vectra` save and strict load, both codecs → export) | `c7230c8`, re-run on **`bd2fd8b`** | **576/576** identical to `a4cf172.sha256`, both times |
| Bundle v1 through the workbench (Chromium, production build) | `34e5ca9` (`24497db2b67f7267`), re-run on **`bd2fd8b`** (`58a2a35ce046ea1a`) | **15/15** identical, both times |
| Browser persistence (`tests/browser/persistence`), Chromium, Firefox, Playwright WebKit | **`bd2fd8b`** | **28 passed, 2 skipped** (the cross-engine test runs once) |
| Real Safari 26.6.2 (`tests/safari/persistence.mjs`, console unlocked: `IOConsoleLocked = No`) | `34e5ca9`, re-run on **`bd2fd8b`** | **23/23**, both times |
| Job specs using the document digest (Chromium, production build) | `34e5ca9` | **14/14** |
| UI document spec (Chromium, production build), including the workspace opening a v2 container saved by Node ("no fill") | `bd2fd8b` (`58a2a35ce046ea1a`) | **25/25** |

## 11. Independent correctness review
- **Who and what.** A fresh agent with no access to this conversation reviewed the diff at `3ad9f6a`, given the specification and the claims, not my conclusions.
- **How.** It worked on read-only `git archive` exports, wrote its own adversarial scripts, and changed no repository file.
- **Result: no bug-severity defect.** Against its own attempts, it found:
  - **byte accounting:** 0 disagreements over a 2,800-step differential, with control characters, U+2028/2029, U+FFFF, U+10FFFF, 256-unit names, `-0` and `5e-324`, and digit rollovers;
  - **canonical length:** 0 mismatches over 200,000 random values;
  - **path and node lengths:** they agreed with the encoder on every node of a rich state;
  - **v2 uniqueness:** of 1,640 mutations at every level, provenance included, none re-encoded differently;
  - **atomicity:** coalesced, multi-command, without-history, trace and asynchronous source refusals all left the session unchanged;
  - **the exact boundary:** held;
  - **the header bound:** confirmed by arithmetic;
  - **serialization not marking saved:** confirmed against main.

| Finding | Severity | Disposition |
|---|---|---|
| 1. Limits looser than C7 (a session option, or a loader budget above 512 MiB) let the session accept a state `saveContainer` refuses. Executed: 4,097 sections accepted under a 5,000 cap, then the save refused it. Latent; no production caller passes limits | Risk | **Fixed** (`e900096`). Limits must be positive integers no greater than C7's (`checkPersistLimits`, constructor and `setPersistLimits`), and the loader caps the budget it passes at C7's. Tests added |
| 2. Provenance that canonical JSON cannot write (NaN, Date, BigInt, lone surrogates in `originalScene`) made `dispatch` throw an untyped `CanonicalJsonError` (atomically). On main, such a state was accepted and failed at save. Root cause predates G-PRJ-0: the validators check `traceRequest`'s encodability, not `originalScene`'s. Unreachable from the engine | Risk | **Fixed at the boundary:** refused with `DocumentError("invariant")`. Test added. The validator gap is registered as **TD-ARCH-007** for the next validation change, with its differential forgery (the `invariants.ts` rule) |
| 3. A loader can refuse a file it accepted under the same budget, because the marks are charged at 16 digits (≤ 30 bytes); messages said "This change would…" during a load | Nit | Accepted by C7 r3 (the reserved width is the stated rule; it bites only with a budget smaller than the writer's). Messages reworded to read correctly for edits, loads and saves |
| 4. The loader forwards `sessionBudget` but not `packetLimits` | Nit | No change. A larger packet limit cannot make the session accept an unwritable state, because the session's geometry cap is C7's |
| 5. `validations.incremental` counted refused transactions (also true for `history_budget` refusals on main) | Nit | **Fixed:** counted at publication. Test added |
| 6. NaN or undefined limits silently disabled a check | Nit | **Fixed** with finding 1 |
| 7. The qualification's "serialization did not mark saved" check was vacuous for clean (loaded) sessions | Nit | **Fixed:** checked on a dirty session, then undone |

**Re-review of the fixes** (`3ad9f6a..bd2fd8b`, the same reviewer):
- Findings 1, 2, 5, 6 and 7 are **resolved**, with evidence. Finding 3 is reworded as intended; finding 4 is unchanged by design. The re-runs are clean: 1,640 reader mutations, length fuzz, a 2,800-step differential, the exact boundary.
- **One small regression introduced by finding 1's fix,** now fixed: `loadContainer` reported a fractional or NaN `sessionBudget` as a broken document. The loader now validates its budget once (whole bytes, capped at C7, otherwise a typed `limit`) and uses that one value for its own check and for the session. Test added.
- **Still open, pre-existing:** a cyclic `params` object in caller-built provenance throws an untyped `RangeError` (atomically, as on main). It is recorded with TD-ARCH-007.

## 12. Technical debt
- **Added:** TD-PERF-013 (Low). The section cap, now enforced per transaction, bounds a document to 4,094 referenced chunks; measured in §7. TD-ARCH-007 (Low). The pre-existing provenance validation gap (review finding 2) is now refused at the transaction; the validator fix is left for the next validation change.
- **TD-PERF-009:** the compact encoding is delivered, the 64 MiB finding resolved, and the Node open criteria met on the P1-A benchmark itself (§8). **Closure is proposed**, for the maintainer to decide. The browser main-thread budget stays with TD-PERF-010 and G-PRJ-1.
- **TD-UI-008:** target set to "before any production destructive project control" (first in G-PRJ-2). Not touched here: no UI in G-PRJ-0.
- **TD-UI-006, TD-PERF-010, TD-PERF-012:** unchanged.
- **Total:** 49 open items, 14 High.

## 13. Impeccable and accessibility
- **Installed version: 4.11.1**, the maintainer's update, recorded with `impeccable --version`. No update or reinstall was run.
- **`impeccable doctor`:** three findings, none auto-fixable. They are recorded with their dispositions in [G-PRJ-DECISIONS](../g-prj/G-PRJ-DECISIONS.md) §8, merged with PR #23:
  - `config-build-path-unset`: not applicable here, because this tool surface has no image generation;
  - `hook-not-installed`: **awaiting maintainer approval** to record `hook.enabled: false`;
  - `workspace-context-inherited`: the WASM engine package has no UI.

  No repository-local fix was applicable without approval. No telemetry was sent, and no hook, global setting or design record was changed.
- **G-PRJ-0 changes no user-facing surface,** so no critique, audit or design review applies to this stage. The rejection message reaches the existing status line unchanged. G-PRJ-1 is the first user-facing stage, and the full Impeccable workflow applies there.
- **TD-UI-008** is not touched (no UI fix bundled). It is a prerequisite for G-PRJ-2's first production destructive control.

## 14. Evidence
- **Records:** [`bench/`](bench/) holds 11 JSON files and one log, with their commits and machine conditions ([`bench/README.md`](bench/README.md)).
- **Scripts:**
  - `scripts/g-prj-0/qualify.mjs` (large projects, boundary, limits, memory);
  - `scripts/g-prj-0/persistability-corpus.mjs` (broad differential);
  - `scripts/bench-g-doc-r.mjs` (dispatch, now with the accounting time);
  - `docs/research/g-doc/bench/bench.mjs` (P1-A open);
  - `scripts/calibrate-structure-accounting.mjs` and `scripts/measure-chunk-overhead.mjs` (memory);
  - `scripts/g-prj/browser-load.mjs`, which now takes `--dir` and `--only` (not run for this report).
- **Tests:**
  - `src/persistence/document-json.test.ts` (specification literal, rejections, versions);
  - `persistable.test.ts` (boundaries, limits, review findings, the 10,000-transaction differential);
  - `canonical-json.test.ts` (`canonicalLength`);
  - `container.test.ts` (both goldens, v1 and v2 adversarial suites, version agreement);
  - `session-validation.test.ts` (v1 and v2 frozen hashes);
  - `src/document/testing/persistable-differential.ts` and `document-json-v1.ts` (test-only oracles).
- **Local only** (`tests/output/g-prj-0/`): written containers (including the 64 MiB boundary file), logs, probe runs, the frozen corpus and bundle outputs. They are preserved under the evidence policy.

## 15. Not run, and limits of this evidence
- **Lower-end hardware and a quiet machine:** not run. Every run is on the shared M5 Max, with its load recorded.
- **Browser dispatch timings with the accounting:** not re-run. The accounting is the same JavaScript as the measured Node dispatch path; G-PRJ-1 measures the browser hand-off as a whole.
- **Browser memory:** no reading for the accounting fields.
- **Large documents in browsers:** not measured; this stage changes no browser path beyond save and load, which the persistence suites cover.
- **Files from other writers:** none exist; v1 is read strictly and v2 by its own schema.
