# G-DOC — Document model, GeometryStore, history and container v1 (P1-A)

**Status: IMPLEMENTED; PR open for maintainer review.** Not merged. Nothing here is closed without maintainer acceptance. The lead engineer's review, re-run and integration cross-check are in §5.1 and §10.1.

| | |
|---|---|
| Date | 2026-11-25 |
| Branch | `gate/g-doc-document-store` (worktree `vectra-g-doc`) |
| Base | `main` `29432da7dbcfabd869daa97887bda34331be65bd` (approved G-0 baseline) |
| Specification | [G0-NEXT-GATE-BRIEF](../g0/G0-NEXT-GATE-BRIEF.md) (G-DOC), [G0-ARCHITECTURE-CONTRACTS](../g0/G0-ARCHITECTURE-CONTRACTS.md) C1, C2, C3, C6, C7, C8; RFC-002 §5, §7, §8.8, §11.3, §14 |
| Environment | Node v24.22.1 (the C7 qualified unit-test environment), Apple M5 Max, 18 cores, macOS (Darwin 25.6.0); `vite-plus` test runner v5.1.0 |
| Validator used | the **test-only** C3 adapter (`src/document/testing/packet-adapter.ts`), injected through the packet port. G-ENG's production validator and codec replace it at the P1-A integration step. |

**Claims are Node-only.** No browser was run in this gate (see §8, NOT RUN).

**Read first:**
- **Performance miss.** Opening a 1M-anchor container misses ≤ 1 s when the document has 250,000 paths: 1.65 s median, heavy machine load. It meets the target at 50,000 paths: 287 ms (`none`), 487 ms (`deflate-raw`). The cost follows node count (document JSON), not anchors (§5). The target is not lowered.
- **Three amendment requests** (§7A): A1, `derived()` returns a frozen view rather than raw typed arrays; A2, C8 rule 6 empty-run wording and run-id collisions; A3, C8 clip arithmetic. Each is implemented with the reading described there and is easy to switch if the maintainer directs the literal text.
- **Test-only validator.** Commit timing and every packet code come from the test-only C3 adapter until P1-A integration.

**Dates.** The gate is dated 2026-11-25, the date the brief uses. The local machine clock read 2026-11-24 (CST) when the benchmark load records were taken.

## 1. Scope
**Delivered** (all in files this gate owns):
- `src/document/`: framework-neutral session store (`subscribe`/`getSnapshot`, usable with `useSyncExternalStore`), Document v1 as immutable state objects, C1 identifiers, invariant validator, GeometryStore (C2), RFC §7 commands as pure transactions, history with budget and visible truncation, keyboard coalescing API, state-identity dirty tracking, the single C8 document evaluation (runs and draw list), and the resource-ledger skeleton.
- `src/document/packet-port.ts`: the packet port (C3 shapes plus `validate`, `encodeRecord`, `decodeRecord`). It is the only C3 surface production code depends on.
- `src/document/testing/`: the test-only C3 adapter, the scene → packet encoder, a seeded PRNG, synthetic packets, fixtures with provenance, and test helpers.
- `src/persistence/`: RFC 8785 canonical JSON, the strict Document v1 JSON schema, and container v1 (serializer and strict, atomic loader).
- `scripts/vectra-dump.mjs`: the inspection utility.
- `docs/research/g-doc/`: this report, the benchmark and golden scripts, and artefacts.
- `docs/TECHNICAL-DEBT.md`: four appended G-DOC disposition lines (TD-ARCH-002, TD-ARCH-003 document half, TD-ARCH-005, TD-PERF-003).

**Excluded** (per the brief): renderer, workers, scheduler, product UI, Save/Open UI, wiring into the app, browser qualification, and any production validator or codec.

**Not touched:** `package.json`, lockfiles, `vite.config.ts`, `tsconfig*.json`, `crates/**`, `packages/**`, `src/geometry/**`, `tests/fixtures/packet-conformance/**`, existing app code, `.github/**`, README and ROADMAP. **No new dependency.**

## 2. Files
| Path | Role |
|---|---|
| `src/document/packet-port.ts` | C3 shapes, error codes, limits, `PacketPort` interface |
| `src/document/model.ts` | Document v1 types, C1 IDs, `IdAllocator`, `DocumentError`, 2×3 affine helpers, exact quarter turns, clip mapping and intersection |
| `src/document/geometry-store.ts` | GeometryStore (C2), `copyIncoming`, `startupCheck` |
| `src/document/invariants.ts` | whole-state invariant pass (RFC §5.1, C8 clip rules, per-reference anchor cap) |
| `src/document/commands.ts` | RFC §7 commands as pure functions, including the C3.1 commit mapping |
| `src/document/session.ts` | session store: transactions, revisions, undo/redo, history budget, coalescing, ownership, dirty state, sources |
| `src/document/evaluate.ts` | C8 rule 5 evaluation → `{ runs, drawList }` |
| `src/document/ledger.ts` | resource-ledger skeleton (RFC §11.3) |
| `src/persistence/canonical-json.ts` | RFC 8785 writer and strict canonical reader |
| `src/persistence/document-json.ts` | Document v1 ↔ JSON (strict schema, unknown fields rejected) |
| `src/persistence/container.ts` | container v1 serializer and loader |
| `src/persistence/golden/circle-bw.none.vectra.b64` | committed codec-`none` golden (2,080 bytes, base64) |
| `src/document/testing/**` | test-only adapter, encoder, PRNG, synthetic packets, fixture loader and helpers; 7 fixture scenes (119,778 bytes) with `PROVENANCE.md` |
| `src/**/*.test.ts` (9 files) | the G-DOC test suites (§4) |
| `scripts/vectra-dump.mjs` | dump utility |
| `docs/research/g-doc/bench/bench.mjs`, `make-golden.mjs` | benchmark; golden generator (`--check` mode) |
| `docs/research/g-doc/artifacts/` | benchmark JSON and load records; `circle-bw.none.vectra` (the golden as a binary, for `vectra-dump`) |

## 3. Design notes
**Packet port and independence.** The GeometryStore and the container loader receive a `PacketPort` at construction. Production modules import only the port; an architectural test (`src/document/architecture.test.ts`) scans every non-test file under `src/document` and `src/persistence`. It fails on any static, side-effect or dynamic import of `src/document/testing`, on any import outside `src/document`, `src/persistence` and `src/vectorization/intake.ts`, and on any renderer or worker identifier (`Worker`, `OffscreenCanvas`, `Path2D`, `CanvasRenderingContext2D`, `postMessage`). A probe import of the adapter from a production file was confirmed to fail the test.

**Test-only adapter.** It is derived from the review's `bench/packet.mjs`, corrected to the frozen text:
- the `packetVersion` key;
- integer counts in [0, 2³²−1] (`manifest`);
- caps checked before any allocation: P ≤ min(1M paths, anchor cap), V ≤ 2 × cap, C ≤ 6 × cap, styles and groups ≤ 65,536, `M_mem + D_max` ≤ 512 MiB, with `Number.isSafeInteger` on the sum;
- style and group entry checks (id rule, RGBA, stroke width, clip rect);
- derived `pathAnchors` and an exact-size `subpathStart` filled by a rescan of the verbs;
- C3.0 records with computed offsets, zero padding, and the `length` and `padding` codes;
- `Lm` ≤ 16 MiB checked before the manifest is read.

**GeometryStore.** `commit` reads each of the six section values once, then runs the C2 sequence: shape check (`ownership`) → `structuredClone(buffers, { transfer: buffers })` → copy the manifest → validate the store-owned arrays through the port → publish as `chk_<nextChunkId>`. A failure throws a typed `DocumentError` and leaves the store unchanged; the packet is consumed from the move on.
- Views (`ChunkView`) and derived metadata (`DerivedView`) are frozen objects whose methods close over the store's arrays. They expose element reads, counts and plain-value iteration only. Freed chunks invalidate their views.
- `jobCopy`/`renderCopy` slice fresh buffers.
- Refcounts are kept per owner kind. `release` only marks a chunk; `settle()` frees chunks whose counts are all zero (end of transaction or job settle).
- `bytes()` uses the exact C3.2 chunk cost, `M_mem + manifestBytes + 36P + 4S`, attributed to one kind by precedence.

**Document state.** Each committed transaction yields one immutable `DocState`: maps for nodes, styles, palette and assets, plus ordered root IDs. The high-water marks (`nextId` in the session, `nextChunkId` in the store) and the revision sit outside it.
- Commands are pure functions over a copy-on-write draft. IDs come from an `IdAllocator` that starts at `nextId`; the session adopts the advanced value only on success, so a failed command consumes no IDs.
- One whole-state invariant pass runs after every transaction (and on load). It returns the per-state chunk reference counts and the document anchor count, which the session caches per state.

**Session.** `dispatch` runs one or several commands as one transaction. On any error it settles the store (freeing chunks the failed transaction committed) and rethrows; state, revision, `nextId` and the store's live chunks are unchanged. The store's `nextChunkId` may have advanced: IDs are never reused, and C1 allows gaps.
- Undo and redo swap state references and move `document`/`history` ownership (retain before release).
- `dirty = state !== savedState`.
- The history budget evicts oldest whole transactions by count (100) and by history-only bytes (128 MiB), and sets a visible `historyTruncated` flag.
- A change whose own history-only bytes exceed the budget is rejected (`history_budget`) unless the caller passes `withoutHistory` (explicit confirmation), which commits and drops history.
- Keyboard coalescing: `dispatch(cmd, { coalesceKey })` merges consecutive commits with the same key within a window (default 1,000 ms, provisional for G-UI; injectable clock). `endCoalescing()` marks a focus change.

**Strict canonical reader.** The header, manifest and document sections must be byte-canonical. The check is equivalent to `canonicalJson(JSON.parse(text)) === text`, but runs in linear time: the text must equal `JSON.stringify` of its value, every object's members must be strictly sorted, and the text must contain no surrogate escapes. This also rejects duplicate member names, which JSON.parse would otherwise collapse silently.

**Container.** The serializer builds every uncompressed section synchronously from the captured immutable state, then hashes (SHA-256, cached per immutable chunk) and compresses, so edits during an async save cannot change what is saved.
- The loader is bounded and atomic: magic → header (≤ 1 MiB, canonical JSON, strict) → section table (count, kinds, IDs, fixed order, contiguity) → declared-size caps before allocation → per-section streaming inflation into an exactly sized buffer, aborted past `uncompressedLength` → SHA-256 → manifest, document and geometry parsing → C2 commit of every chunk → source checks → session construction (invariants).
- Everything is built in a new store and session, which are returned only on success.

## 4. Commands run and results
All in the worktree, Node v24.22.1.

| Command | Result |
|---|---|
| `pnpm exec vp check` | pass: formatting; no lint or type errors (type-aware lint covers the test files, confirmed with a deliberate type error) |
| `pnpm exec vp test` | **12 files, 172 tests passed** (14 pre-existing + 158 G-DOC) |
| `node scripts/vectra-dump.mjs docs/research/g-doc/artifacts/circle-bw.none.vectra` | prints header, 3 sections (all SHA-256 OK), manifest, document and packet summary; exit 0. On a 2-byte file: `error: truncated: …`, exit 1 |
| `node docs/research/g-doc/bench/make-golden.mjs` | wrote the 2,080-byte golden; `--check` compares against the committed file |
| `node docs/research/g-doc/bench/bench.mjs --reps 7 --out …` | see §5 |
| `shasum -a 256 src/document/testing/fixtures/*.raw` | all 7 match `a4cf172.sha256` (also asserted by a test) |

G-DOC tests by file:

| File | Tests | Covers |
|---|---|---|
| `src/document/testing/packet-adapter.test.ts` | 40 | the review's adversarial cases on C3 names plus manifest cases; caps near 2³²−1 → `budget`; derived metadata; every fixture validates with Scene::validate anchor counting; C3.0 round trip, `length`, `padding`, `budget`; fixture hashes |
| `src/document/geometry-store.test.ts` | 22 | aliases detached (input arrays, extra `Float64Array` and `DataView` aliases) with view reads unchanged; validate–mutate–commit; each rule-1 violation (offset view, shared buffer ×2, `SharedArrayBuffer`, resizable, detached, plain array) → `ownership`, store unchanged; invalid packets → C3 codes; runtime property walk; 25 job/render copies transferred via `structuredClone` and `MessageChannel` with simulated terminations → no committed buffer detached; `copyIncoming`; refcounts free exactly at the last release; exact C3.2 bytes and attribution; startup check; getter read-once |
| `src/document/session.test.ts` | 27 | C3.1 mapping and deterministic IDs; replace; palette conflicts; every command undoable and redoable by reference with +1 revision each; redo cleared; failed commands and failed batches change nothing; subscribe/getSnapshot stability; zero `commit`/`copyIncoming`/`jobCopy`/`renderCopy` during structural commands and undo/redo; per-reference anchor cap (duplicate and trace beyond the cap → `budget`, document and chunks unchanged); dirty-state cases; history count and byte budgets, eviction order, `history_budget` and `withoutHistory`; coalescing (window, focus change, other key); clip rules at command validation; group, ungroup, duplicate, bake; sources |
| `src/document/evaluate.test.ts` | 10 | unedited fixtures: runs equal scene groups 1:1 and draw list equals scene paths; empty groups; nested, translated, scaled, reflected and 90°-rotated clips; empty intersection omitted; hidden nodes; runs split by containers; run-id fallbacks and collisions; effective colours; ungroup invariance |
| `src/document/property.test.ts` | 31 | 30 seeds × 80 random steps: commands with valid and invalid arguments, undo, redo. Measured on the code of the commit that adds this row (the final code commit): 1,193 accepted transactions; rejections `invalid_argument` 400, `clip_unsupported` 55, `invalid_transform` 49, `invariant` 11, `clip_transform_unsupported` 7. After every step: invariants, monotonic revisions, redo cleared, exact owner counts recomputed from the states, no leaked or missing chunk, Σ byOwnerKind = total, integrity, and evaluation (unique run ids, in-range `groupRun`). Mid-sequence and at the end: codec-`none` save → load → save is byte-identical and the evaluation is equal. Then full undo and redo. Plus eviction freeing |
| `src/document/ledger.test.ts` | 1 | store, history and source bytes; reporter registration |
| `src/document/architecture.test.ts` | 4 | §3 |
| `src/persistence/canonical-json.test.ts` | 7 | RFC 8785 number examples, UTF-16 key order, escaping, rejections, strict canonical reader (incl. surrogate escapes) and a 500-value randomised agreement check between the linear-time reader and the writer |
| `src/persistence/container.test.ts` | 16 | §6 C7 rows and the adversarial suite |

## 5. Performance
Local benchmark: `node docs/research/g-doc/bench/bench.mjs --reps 7 --out docs/research/g-doc/artifacts/bench-final.json`, then `open-profile.mjs` for a per-phase breakdown. The script is Node, main thread, with fresh packets per repetition and generation not timed. Each cell gives median [min–max] over 7 repetitions after one warm-up; container opens use 4 repetitions after one warm-up.
- **Machine:** Apple M5 Max, 18 cores, 128 GiB, Node v24.22.1.
- **Load (heavy; not a clean run in the C9 sense):**
  - at start (21:41:23): `uptime` load averages 27.19 / 28.26 / 19.53, `ps aux | grep -c '[n]gspice'` = 13;
  - at end (21:42:33): 32.48 / 29.83 / 20.81, ngspice = 14;
  - the script's own `os.loadavg()` read 26.17 / 27.99 / 19.58 at start and 36.81 / 30.48 / 20.88 at end;
  - other CPU-bound processes from another project were also running at 100 %.
- **Validator:** **test-only adapter**, so validate+derive must be re-measured with G-ENG's production validator at integration.
- **Workloads:** two synthetic 1,000,000-anchor packets (closed paths, half L and half C segments, 8 groups, 4 styles), traced into a document as one layer:
  - **A:** P = 50,000, V = 1,050,000, C = 3,903,180, `M_mem` = 33,075,448 B, 50,009 nodes;
  - **B:** P = 250,000, V = 1,250,000, C = 3,502,836, `M_mem` = 33,272,696 B, 250,009 nodes.

| Measure (ms) | A | B | Budget | Verdict |
|---|---|---|---|---|
| `commit` total | 24.7 [19.8–29.9] | 33.7 [31.3–36.0] | ≤ 50 | **met** (A, B) |
| · move (detaching transfer) | 0.16 [0.10–0.31] | 0.09 [0.06–0.13] | | |
| · validate + derive (test-only adapter) | 24.4 [19.5–29.4] | 33.5 [31.1–35.9] | | |
| · publish | 0.14 [0.11–0.21] | 0.06 [0.04–0.09] | | |
| `copyIncoming` (separate, not in the budget) | 4.8 [2.2–6.8] | 2.1 [1.2–10.9] | — | |
| structural undo, worst median of 5 commands | 0.013 | 0.009 | ≤ 16 | **met** |
| structural redo, worst median of 5 commands | 0.006 | 0.005 | ≤ 16 | **met** |
| open container, `deflate-raw` (file 24.9 MB / 25.7 MB) | 487 [461–527] | 1,668 [1,620–1,719] | ≤ 1,000 | A **met**; B **MISS** |
| open container, `none` (file 43.9 MB / 88.1 MB) | 287 [275–298] | 1,648 [1,430–1,653] | ≤ 1,000 | A **met**; B **MISS** |
| *For information (no target):* structural command dispatch, median, 5 commands | 38.6–52.2 | 258–329 | — | |
| *For information:* whole trace-commit transaction (store commit + C3.1 mapping + invariants), 1 run | 164 | 440 | — | |
| *For information:* save, `deflate-raw` / `none`, 1 run | 2,501 / 269 | 3,818 / 1,327 | — | |

The five structural commands are: layer transform, path rename, group hide, path recolour and group delete. Undo and redo are a reference swap plus ownership moves over the state's chunk set (one chunk here), so they do not depend on node count.

**Open breakdown** (`open-profile-*.json`, one run each under the same load; total, then strict JSON = `JSON.parse` + canonical check, schema, invariants):

| Config, codec | Total | inflate + SHA-256 | strict JSON | schema | decode + commit | session + invariants | Document JSON |
|---|---|---|---|---|---|---|---|
| A, none | 277 | 28 | 110 | 61 | 27 | 51 | 10.8 MB |
| A, deflate-raw | 592 | 327 | 121 | 54 | 28 | 61 | 10.8 MB |
| B, none | 1,496 | 55 | 652 | 303 | 242 | 242 | 54.8 MB |
| B, deflate-raw | 2,011 | 685 | 774 | 280 | 34 | 238 | 54.8 MB |

**Reading the results.**
- **Open (B, MISS).** The ≤ 1 s open target is met for 50,000 paths and missed for 250,000 paths at the same 1M anchors. The cost follows the **node count**, not the anchor count: the document section is about 220 bytes per PathObject (54.8 MB at 250k paths), and parsing, the strict canonical check, the schema and the invariant pass are linear in it. The geometry path (inflate, hash, decode, C2 commit) is 60–300 ms in every case, in line with the review's primitives. The target is not lowered.
  - Options for a later gate: a more compact node encoding (omit default-valued members), which would be a strict-schema decision before v1 is frozen; parsing off the main thread; or a measured re-scope of the target to node counts. None was implemented.
  - An earlier run (`bench-run1.json`, load 24–26) used a canonical check that re-serialised the document, and measured B at 2.6–2.8 s. The linear-time strict reader (§3) brought it to about 1.65 s.
- **Command latency (risk for G-EDIT; no G-DOC target).** Each transaction copies the node map and runs the whole-state invariant pass, both O(nodes): about 40–50 ms at 50k nodes and 260–330 ms at 250k nodes. Undo and redo stay far below 16 ms because they reuse validated states. The upgrade path is persistent maps and incremental invariants, measured in G-EDIT before any interactive-latency claim.
- **Trace-commit transaction.** The store `commit` meets ≤ 50 ms. The whole trace-commit transaction (164 ms at A) is relevant to G-TRACE's import → visible budget.
- **Load.** The machine was heavily loaded throughout, so absolute numbers are pessimistic. A quiet-machine re-run is NOT RUN.

### 5.1 Lead-engineer re-run (lower load) and review
The same command (`bench.mjs --reps 7`) was re-run by the lead engineer after the gate agent finished: load average 11.3 at start and 11.2 at end, with 13 `ngspice` processes. That is still not a clean run (`artifacts/bench-rerun-lead.json`).

| Measure (ms, median) | A (50k paths) | B (250k paths) | Budget | Verdict |
|---|---|---|---|---|
| `commit` total (move / validate+derive / publish) | 24.2 (0.14 / 24.0 / 0.10) | 31.8 (0.08 / 31.7 / 0.05) | ≤ 50 | **met** |
| `copyIncoming` (separate) | 2.8 | 2.3 | — | |
| structural undo / redo, worst of 5 | 0.010 / 0.004 | 0.005 / 0.005 | ≤ 16 | **met** |
| open, `deflate-raw` | 457 | 1,493 | ≤ 1,000 | A met; **B miss** |
| open, `none` | 254 | 1,449 | ≤ 1,000 | A met; **B miss** |
| *Information:* structural command dispatch | 36.6–44.9 | 257–331 | — | **risk for G-EDIT** |

The conclusions are unchanged at the lower load:
- the open miss at 250k paths is real and follows node count;
- dispatching a structural command is O(nodes): about 0.3 s at 250k paths. That needs persistent maps and incremental invariants before any interactive-latency claim (G-EDIT).

The lead engineer also checked the following:
- **Ownership:** every changed file is inside G-DOC's paths (`git diff --name-only main..HEAD`).
- **Fixtures:** they are procedural only.
- **Checks:** `pnpm exec vp check` PASS and `pnpm exec vp test` 172/172 PASS in the worktree.
- **C2:** the `GeometryStore.commit` sequence was read against C2 (shape check → `structuredClone` transfer → manifest copy → validation of the owned bytes → publish).

## 6. Contract conformance notes
**C1.** Node IDs `^[a-z]{3}_[0-9]{1,15}$` with prefixes `lay grp pth src ast sty pal`, allocated from one shared `nextId`, never reused. The invariant pass rejects a number used twice across kinds. Chunk IDs `chk_<n>` come from the store's own counter. Both high-water marks are persisted and live outside undoable state (duplicate then undo is clean, and `nextId` stays advanced). `documentRevision` increments on every committed transaction, including undo and redo, and is not persisted.

**C2.** The commit sequence, rules 1–9 and the G-DOC test list are implemented as described in §3 and tested in §4.
- Rule 9: structural commands never call `commit`, `copyIncoming`, `jobCopy` or `renderCopy` (instrumented counters, in the dedicated test and at every fuzz step).
- Rule 10: one chunk per trace commit or bake.
- The startup check returns `{ ok, littleEndian, detachingTransfer }`. Wiring it into editor start-up is G-UI/G-PRJ work.
- **Additive surface** beyond the eight C2 signatures:
  - `settle()` (the end-of-transaction and job-settle hook that C2's lifetime rules need);
  - `has`, `chunkIds`, `cost`, `ownerCounts`;
  - `encodeRecord(id)` (the serializer's route to a record without exposing arrays);
  - `advanceChunkCounter(n)` (load only, forward only; see §7B.2);
  - `checkIntegrity()`, `stats`, `lastCommitTiming`.
- `derived(id)` returns a frozen `DerivedView`, not raw typed arrays (amendment request A1).

**C3 / C3.0 / C3.2 (through the port).** The adapter follows the validation order and codes (§7B.5 for the interleaving and decode-order readings). It allocates `bounds` and `pathAnchors` only after steps 1–4 and `subpathStart` at exact size. Store accounting matches the C3.2 formulas exactly; the test recomputes them per fixture and checks `M_mem` against the real section byte lengths. Per-reference anchors are checked by the invariant pass before a transaction publishes: trace commit, duplicate and bake are covered, and paste and geometry operations do not exist yet. History-only chunks do not count.

**C3.1.** One Layer per packet (or the replaced Layer), one Group per packet group with `name` = group id and `clip` → `clipRef`, one PathObject per path in path order. Styles → document styles; `paletteId` → a palette entry; `evenOdd` → `fillRule`. IDs are allocated deterministically in the order layer, palette entries, styles, then each group followed by its paths. After commit the document is authoritative; the evaluation never reads packet style tables.

**C6.** `documentSchemaVersion` 1, container `formatVersion` 1, `packetVersion` 1. Unknown or newer values are refused with `version`.

**C7.**
- Limits table enforced, plus a manifest-section cap of 1 MiB (§7B.4).
- Codecs `none` and `deflate-raw` via native streams.
- Streaming inflation is aborted past `uncompressedLength`, tested with a 32 MiB-zero document declared as 4,096 bytes (`inflate`). The test proves the typed error, **not a memory bound**: before the abort, the transient overshoot depends on the 64 KiB input chunking and the stream queues, and was not measured.
- SHA-256 over uncompressed bytes, verified before parsing.
- RFC 8785 for the header, manifest, document and packet manifests.
- Fixed section order, and no clocks or file names written.
- Strict schemas reject unknown fields.
- Atomic load: every adversarial case also asserts that a separate live session's snapshot, chunk set, bytes and `nextChunkId` are unchanged.
- Geometry is decoded into fresh whole-buffer arrays and committed through C2.
- Determinism:
  - save → load → save is byte-identical in Node 24.22.1 for both codecs, on a document built from all seven fixtures plus edits (transform, quarter turn, duplicate, hidden layer, recolour, palette change, delete leaving a chunk-ID gap, Unicode name);
  - the codec-`none` container equals the committed golden;
  - uncompressed section bytes, `sha256` and `uncompressedLength` are identical across codecs.
- Dirty state: edit then undo, and duplicate then undo, are clean; save then edit is dirty; an equal edit sequence is conservatively dirty; an evicted saved state stays dirty until the next save.

**C8.**
- `clipRef` on a PathObject → `clip_unsupported`.
- Clips live in local space and map through the composed transform.
- The axis-preserving check is exact. Transform, reparent and `setClip` under a non-axis-preserving composed transform → `clip_transform_unsupported`; a 45° rotation of a clipped group or of its layer, and a skew, are rejected.
- `rotate90` emits exact 0/±1 matrices; four quarter turns give the identity linear part.
- Nested clips intersect, an empty intersection omits the subtree (items and runs), and runs follow rule 6 as read in amendment request A2. Clip arithmetic follows A3.
- Draw items carry effective transform, fill, optional stroke, `evenOdd` and `groupRun`.

## 7. Amendment requests and gap-fills
### 7A. Departures from the literal frozen text: amendment requests
These three pieces could not be implemented exactly as written. In each case the literal text contradicts another frozen rule or the TD-ARCH-005 closure intent. Each is **implemented as described below and raised as an amendment request**. Each is small and localised, so the maintainer can direct the literal reading instead; its cost is given under "literal alternative".

A1. **C2 `derived(id)` return type.** C2 types it as `DerivedMetadata`, whose C3.1 fields are typed arrays (`bounds`, `pathAnchors`, `subpathStart`). G-DOC returns a frozen `DerivedView` with the same content through accessors: `anchors`, `pathCount`, `subpathCount`, `pathAnchors(i)`, `subpathStart(k)`, `bounds(i)`. **Literal alternative:** return the store's arrays, which a caller could place in a transfer list and detach (store-owned data; against TD-ARCH-005 and the rule-6 discipline), or fresh copies on every call (36P + 4S bytes per call). Change site: `GeometryStore.derived` (`src/document/geometry-store.ts`).

A2. **C8 rule 6: empty runs and run-id collisions.** Read literally ("a visible Group or Layer with no visible PathObject children yields one run with no items"), every Layer whose children are all Groups would emit an extra empty run. That adds a scene group to every export and breaks the unedited-P0 hash guarantee that the same rule states. G-DOC emits an empty run only for a visible, not fully clipped container whose subtree emits nothing. A test asserts that for every unedited fixture the runs equal the scene groups 1:1 (id and clip, in order). The rule also does not cover a generated `run-<k>` that is already taken by an earlier container's name; G-DOC then uses `run-<k>-<n>` (smallest free n), so run ids stay unique, as scene v1 requires. **Literal alternative:** an empty run for every container without direct PathObject children, and possible duplicate run ids. Change site: `evaluate` (`src/document/evaluate.ts`).

A3. **C8 rules 2–4: clip arithmetic.** "Computed in f64 from the transformed corners (min/max)" does not reproduce a packet clip bit for bit under the identity transform, because `(x + w) − x ≠ w` in general (for example x = 0.1, w = 0.2). That contradicts rule 2's "their effective clip equals the packet clip, and the P0 route is unchanged". G-DOC takes the min corner from the transformed corners and the extent as |scale| × size; in an intersection, an interval contained in the other keeps its exact extent. **Literal alternative:** corner min/max, which perturbs unedited P0 clips in the last bit for some inputs. Change site: `mapRect`/`intersectRects` (`src/document/model.ts`).

### 7B. Gap-fills where the frozen text is silent (confirmation requested)
1. **Styles in Document v1.** C1 has a `sty` prefix and §5.1 says style references must resolve, but the §5.1 schema and C7 list no style collection. G-DOC adds `stylesById` (`{ id, fill, paletteRef, stroke }`, with `fill` and `paletteRef` mutually exclusive, so there is one colour authority) and keeps the packet `paletteId` as the palette entry's `name` (`{ id: pal_n, name, color }`).
   - Each trace commit creates its own palette entries; layers never share them implicitly.
   - Only styles that are actually used are created.
   - A `paletteId` with no single colour is rejected (`palette_conflict`).
   - Recolouring creates new styles, so other objects are unaffected.
   - The artboard is `{ width, height, background }` (background RGBA or null, needed for halftone export).

   These fields become the strict v1 schema. Suggested: record them in RFC §5.1.
2. **Chunk IDs on load.** `commit()` assigns its own ID, but a file's `chk_n` (possibly sparse) must survive. The loader uses a fresh store, advances its counter to `n` before each chunk (`advanceChunkCounter`, forward only, load only), and commits through the unchanged four-step C2 sequence. It finally sets `nextChunkId` from the file.
3. **Freeing unowned chunks.** C2 frees a chunk "at the end of the transaction" but has no hook for it, so `settle()` was added. `bytes()` attributes a committed but not yet retained chunk (it exists only inside a transaction) to `document`, so Σ = total still holds.
4. **Header `offset` base.** C7 leaves it unspecified, and absolute offsets would make the header length self-referential. G-DOC writes offsets relative to the first byte after the header. Sections must be contiguous in the fixed order, and the file must end at the last section; overlaps, gaps and trailing bytes are rejected (`section`), and a final section past EOF is `truncated`. The manifest section is `{ app: "vectra", formatVersion, documentSchemaVersion, packetVersion }`. The review's `engineVersion`, `precisionFitVersion` and `createdWith` are omitted because they have no definition; engine versions belong to trace provenance.
5. **Validation order.** The adapter interleaves steps 5–12 per path and per verb, as the review prototype does. The table could also be read as separate passes, and single-defect fixtures cannot tell the two apart. Other readings:
   - a non-object manifest returns `version`, as the review does;
   - unknown manifest keys return `manifest`;
   - styles or groups over 65,536 return `budget` (C3.2 lists them as pre-allocation caps);
   - in `decodeRecord`, `Lm` (`budget`/`length`) and the manifest checks (steps 1–2) necessarily run before the record `length` and `padding` checks, because the layout comes from the counts and caps must precede allocation.

   G-ENG's shared fixtures settle these at integration.
6. **Undefined shapes omitted.** `effectStack`, `SourceAsset.decodePolicy`, `SourceAsset.provenance` and `TraceProvenance` have no defined shape. The strict v1 schema therefore omits them, and the loader rejects them as unknown fields. They need a definition before documentSchemaVersion 1 is frozen for a public release; otherwise adding them needs a version bump or a migration.
7. **Semantics chosen where the RFC is silent:**
   - Explicit replace keeps the layer's id, name, visibility, lock and clip, and resets its transform to identity, following the C3.1 row.
   - Reparent keeps local transforms.
   - Ungroup composes the group transform and effective visibility and lock into the children, and refuses a clipped group: release the clip first.
   - Bake re-points the targets to the new chunk, resets their own transforms to identity, and keeps their styles.
   - Deleting the last reference to a source removes the asset; history keeps the bytes for undo.
   - Lock is not enforced by commands (a UI concern).
   - The tree shape: the root holds Layers and SourceReferences; Layers and Groups hold Groups and PathObjects.
   - The non-singular tolerance: entries |v| ≤ 1e9 and condition number κ = σmax/σmin ≤ 1e8.
8. **Observation for G-EXP/G-ENG.** The frozen C8 draw item carries only an effective `fill: u32`, not palette ids. The unedited-P0 export needs scene palette ids (`fill.paletteId`) to keep its hashes, so `bake_draw_list` or `sceneMeta` must source them. G-DOC keeps palette names in the document for that purpose.
9. **Strict canonical reads.** C7 requires canonical writes. G-DOC also requires the header, manifest and document sections to be byte-canonical on read, which rejects duplicate member names, whitespace and number variants. Packet manifests inside geometry records are parsed by the port and are not required to be canonical on read. One consequence: array-index member names (`"0"`, `"17"`) are refused, because JSON.parse reorders them. No Vectra schema uses them.
10. **Exportability and saveability are invariants.** A style must have a fill, a palette reference or a stroke, because scene v1 rejects a path with neither; `setFill(null)` on a strokeless path is therefore rejected with `invariant`. Node names must be well-formed Unicode, because canonical JSON refuses lone surrogates. Both rules were found by review and are tested.
11. **Architecture note (AGENTS.md).** `src/document/session.ts` and `src/persistence/container.ts` import `sniffImage` from `src/vectorization/intake.ts`, a pure function, to reuse the existing signature checks for source images. No other dependency leaves `src/document` or `src/persistence`; the architecture test enforces this.

## 8. NOT RUN
- **Browsers.** No Playwright Chromium run, so C7 property 2 is qualified in Node only. No Firefox or WebKit run (C7 property 1), and no per-browser measurement of the C2 move, which C2 asks G-DOC to take "in each target browser".
- **Shared packet-conformance fixtures** (`tests/fixtures/packet-conformance`) are G-ENG's and are read only after integration. The `invalid packets` adversarial cases here use adapter-generated corrupt records.
- **The P1-A integration conformance test** (Rust = TS = `commit` codes; Rust ↔ TS ↔ container byte round trip).
- **Engine regressions** (the 326 and 72 hashes, `cargo test`, `pnpm run build`). G-DOC changes no engine, build or app file, and its modules are not wired into the app.
- **A quiet-machine benchmark.** The machine was heavily loaded throughout (§5).
- **TD-ARCH-002 worker-termination tests in real workers** (G-JOB).

## 9. Debt dispositions (appended to TECHNICAL-DEBT.md, dated 2026-11-25)
- **TD-ARCH-005:** PRODUCTION VERIFIED for both closure criteria, in Node unit tests only; next stage OWNER ACCEPTANCE PENDING. Browser runs NOT RUN.
- **TD-ARCH-002 (document side):** document of record, history and store live outside workers, and workers receive only fresh copies. Item stage unchanged (PROTOTYPE DEMONSTRATED / IMPLEMENTATION PENDING); closure is G-JOB's.
- **TD-ARCH-003 (document half):** implemented against the port with the test-only validator. Not PRODUCTION VERIFIED until integration; stage IMPLEMENTATION PENDING.
- **TD-PERF-003:** ledger skeleton implemented. Budgets and reserve-before-allocate are G-JOB/G-R1; stage IMPLEMENTATION PENDING.

## 10. Notes for the P1-A integration PR
- **Wiring.** Inject `src/geometry/packet`'s validator and codec as the `PacketPort`, replace the duplicated shapes in `packet-port.ts` with imports, and delete `src/document/testing/` and the architecture test's exemption.
- **Tests that move.** The G-DOC suites build packets with `fixturePacket`/`syntheticPacket` from the testing directory. They need G-ENG packets or fixtures as their source.
- **Golden.** The golden depends only on the C3.0 record layout and canonical JSON. G-ENG's encoder must produce identical record bytes for it to stay valid, which is a useful conformance check. Regenerate it only if `from_scene` builds a different style table; `make-golden.mjs --check` detects that.
- **Re-measure** the commit benchmark with the production validator.

### 10.1 Cross-check with G-ENG (done before the PRs)
- **Trial merge.** In a scratch worktree, `main` + G-ENG (PR #10) + G-DOC was merged.
  - The only conflict is the expected one: adjacent appended lines under TD-ARCH-003 in `docs/TECHNICAL-DEBT.md`. Keep both lines.
  - The merged tree passes `vp check`, and `vp test` passes 227/227 (14 existing + 55 G-ENG + 158 G-DOC).
- **Validator agreement.** G-ENG's 34 Rust-and-TS `arrays` conformance cases were run through this gate's test-only adapter *and* G-ENG's production validator. They agreed 34/34 with the expected codes.
- **Port mapping for integration.** `PacketLimits` here has `maxStyles`, `maxGroups` and `maxManifestBytes`, which G-ENG's `Limits` does not: G-ENG uses the C3 constants. Its validator throws `PacketError`, whereas the port returns `{ok, code}`. The integration PR needs a small adapter for both. Canonical JSON exists in both gates (`src/persistence/canonical-json.ts` and G-ENG's `canonicalJson`), and the integration keeps one.
- **Observation 8 (palette ids)** matches G-ENG's amendment request AR-2 (the export draw list carries `paletteId` and the artboard size).
- **Inflation bound** (verified by reading the code). `inflate()` pre-allocates exactly the declared, capped `uncompressedLength` and counts each `DecompressionStream` chunk. It cancels the reader and fails (`inflate`) as soon as a chunk would pass the declared length. Peak memory is therefore the capped section size plus one stream chunk. A bomb is stopped during streaming, not after buffering.
- **Scene metadata gap (risk for G-EXP).** The document stores no trace provenance or scene metadata (generator, engine version, mode, preset version, seed, source size, params): `TraceProvenance` was omitted as an undefined shape (§7B.6). G-ENG's `bake_draw_list` needs them in `SceneMeta` to reproduce unedited-P0 export hashes, so the document must store enough provenance to rebuild `SceneMeta` before G-EXP. See G-ENG's report (risk next to AR-2).


## 11. P1-A corrective review (AM-1)
This section records the corrective work on this branch after the P1-A corrective-review brief. The production wiring, the end-to-end export proof, browser persistence and the benchmarks on the production validator are on the integration branch (`p1a/integration`, report `docs/research/p1a-integration/P1A-INTEGRATION-REPORT.md`): this branch alone still validates through the test-only adapter, so its isolated results do not close the gate.

### 11.1 TraceProvenance v1 and source subsets (C10 r1)
- **Where it lives.** `Layer.traceProvenance` on the layer a trace creates (`src/document/provenance.ts`). `commitTrace` requires it and checks it before the packet is consumed. The store assigns `chunkId`. The record is a private, deep-frozen copy.
- **What it holds.** `provenanceVersion` 1; the commit-time `chunkId` (a historical reference that may stop resolving); `source` {SHA-256 digest, width, height} (content identity, never a file name); `decodePolicy` (closed enum `browser-canvas-v1` | `external`); `traceRequest` {presetVersion, seed, maxPixels, maxAnchors, settings} (≤ 64 KiB canonical JSON); `engineVersion`; `fitMode`; `precisionFitVersion`; `presetVersion`; `seed`; `originalScene` {width, height, background, palette, metadata}.
- **Consistency rules** (strict checker, also run by the loader and the invariant pass): exact members; `fitMode` equals `traceRequest.settings.fit.mode`; the explicit fields equal `originalScene.metadata`; `metadata.sourceWidth/Height` equal `source`; ids follow the scene-v1 rule; the chunk reference is below `nextChunkId`.
- **Validity after edits.** No command modifies provenance. `replace` installs the new trace's record; `duplicate` copies it; `bake` leaves it as history. Provenance is never authoritative for current styles, transforms, palette, artboard or geometry.
- **Source assets.** `SourceAsset.decodePolicy` (same enum) and `provenance: {kind: "local-file"}`, the only v1 subset. Effect stacks are not in Document v1 (C10: added by a later schema version with a migration; v1 files carry none).

### 11.2 Export metadata semantics (`src/document/export.ts`)
`buildExport(state, store, engineVersion)` returns the export draw list (C8 r2: `paletteId`, artboard size, packet-set indices), the referenced chunks in packet-set order, and the SceneMeta.
- **Export-unedited is computed** from current state on every call: a traced layer's runs and items equal the C3.1 identity draw list of its chunk. Undo restores it. A run renamed only because an earlier layer took the packet's group id is not an edit.
- **Original form** only for a single contributing, export-unedited trace whose artboard equals the trace's original scene: the trace's background, palette and metadata are used verbatim, so the export is byte-identical to P0.
- **Document form** for everything else: `mode: "document"`, `presetVersion` 0, `seed` 0, artboard size rounded up, palette in first-use order with unique scene ids, and `params.derivedFrom[]` (source digest, mode, preset, seed, fit mode, precision version, `edited`). Original trace metadata is never presented as describing edited artwork.

| Case | Form | Test (`src/document/export.test.ts`) |
|---|---|---|
| Unedited single trace (every fixture) | original, verbatim | `unedited single trace uses the original scene verbatim` |
| Edited trace (recolour, transform, clip, palette edit) | document, `edited: true` | `an edited trace exports in document form…`, `palette edits flow…`, `a clip added…` |
| Undo of the edit | original again | `undoing the edit restores the original form` |
| Multiple traced layers | document, one `derivedFrom` each | `multiple traced layers…`, `hiding a layer…` |
| Baked geometry | document, `edited: true` | `baked geometry exports in document form` |
| Missing source bytes | unchanged (exports never read sources) | `a missing source asset does not change the export` |

### 11.3 Independent review findings (`src/document/review-regressions.test.ts`)
| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | A throwing subscriber made a published transaction look failed and could drop attached source bytes | listener errors isolated (`onListenerError`; default rethrows asynchronously) | review 1 |
| 2 | Source bytes aliased the caller's buffer | copied on input and output | review 2 |
| 3 | Committed state, history states and derived data were mutable at runtime | sealed maps; changed entries frozen at `finish` and on load; draw-list strokes and `derivedOf` are copies | review 3 |
| 4 | The history budget ignored history-only source bytes | counted | review 4 |
| 5 | The chunk counter could pass what the container accepts | bounded by the 15-digit id space at load and in the store; typed failure when exhausted | review 5 |
| 6 | A geometry section below the store counter (`chk_0`) was an untyped error | typed `ContainerError` (`section`) | `container.test.ts` geometry sections (added here; it failed with `untyped:DocumentError` when the check was removed) |
| 7 | A composed transform could overflow to non-finite | `invalid_transform` | review 7 |
| 8 | Undo/redo-triggered eviction kept source bytes | freed | review 8 |
| 9 | Embedded sources above C7's 20 MiB, bad `rotate90` turns, spoofed typed-array views | typed errors at attach and commit (intrinsic accessors) | review 9 |

### 11.4 Missing sources and relinking (RFC §14)
`missingSources()` lists assets whose bytes the session does not hold. `relinkSource(assetId, bytes)` accepts bytes only when the SHA-256 digest, image signature and dimensions match the asset. It is not a document edit: no transaction, revision or history entry. Tested here in Node and, on the production loader, in three browser engines (integration report).

### 11.5 Commands and results (this branch, `c5bfb87` + this section's commit)
- `pnpm exec vp check`: PASS (132 files formatted; 71 files without lint or type errors).
- `pnpm exec vp test run`: 198/198 PASS (14 files).
- Benchmarks were re-run on the integration branch with the production validator (integration report). The figures in §5 used the test adapter.

### 11.6 Debt
- **TD-PERF-007** (new, gate G-EDIT): structural transactions cost O(nodes). At the interactive target a structural dispatch measured 27–31 ms (budget 16 ms), 77–85 % of it in the whole-state invariant pass. Closure needs incremental invariants and structural sharing, with the full pass kept for load and as a test oracle.
- **TD-ARCH-003 (document half):** PRODUCTION VERIFIED on the integration branch (sole validator and codec); this branch alone is unchanged.

### 11.7 Disposition
**PARTIAL.** The corrective items on this branch are done and tested. The gate still depends on the integration branch, and the 250k-path open target (≤ 1 s) is missed (integration report §7). Clean benchmarks are NOT RUN.
