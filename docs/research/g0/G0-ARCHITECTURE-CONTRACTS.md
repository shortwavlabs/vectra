# G-0 — Architecture contracts (frozen for G-ENG and G-DOC)

**Status:** FROZEN at G-0 closure, then amended three times through change control:
- **amendment set AM-1** (P1-A corrective review, maintainer-approved, 2026-11-25), recorded in §AM-1 and in [G0-DECISION-REGISTER §6](G0-DECISION-REGISTER.md);
- **amendment AM-2** (G-DOC-R history accounting, maintainer-approved, 2026-11-26), recorded in §AM-2 and in [G0-DECISION-REGISTER §11](G0-DECISION-REGISTER.md);
- **amendment set AM-3** (G-PRJ project persistence, maintainer-approved, 2026-11-27), recorded in §AM-3 and in [G0-DECISION-REGISTER §14](G0-DECISION-REGISTER.md). AM-3.2–3.4 are implemented by G-PRJ-0; AM-3.1 and AM-3.5 are approved and not yet implemented (G-PRJ-1 to G-PRJ-3).

All are integrated below.

This file holds the **byte-level and API details** that RFC-002 defers to. Architecture, rationale and evidence stay in [RFC-002](../../RFC-002.md); this file does not restate them.

**Change control.** A change to a frozen contract requires three things:
1. a contract version bump;
2. an RFC-002 amendment;
3. maintainer approval.

Additive fields are allowed only where a contract says so. A gate that needs a change stops the affected work and raises an amendment ([G0-NEXT-GATE-BRIEF](G0-NEXT-GATE-BRIEF.md)).

**Two kinds of version.** A **specification revision** (`rN`) identifies the text of a contract; it is bumped by every approved amendment. A **serialized version** is a number written into bytes or messages (`packetVersion`, `protocolVersion`, container `formatVersion`, `documentSchemaVersion`); it changes only when the wire format changes. AM-1 bumps revisions and changes **no** serialized version.

| ID | Contract | Spec revision | Serialized version(s) | Authoritative here | Architecture in |
|---|---|---|---|---|---|
| C1 | Identifiers and revisions | r1 | — | yes | RFC §5.1 |
| C2 | GeometryStore ownership and lifetime | **r2** (AM-1: A1) | — | yes | RFC §5.2 |
| C3 | GeometryPacket and resource accounting | **r3** (AM-1: AR-1, AR-3; AM-2: history accounting) | `packetVersion` 1 (unchanged) | yes | RFC §6, §7 |
| C4 | Engine API (Rust and WASM) | **r2** (AM-1: finalised signatures) | — | yes | RFC §6, §11.2 |
| C5 | Worker protocol | **r3** (AM-1: AR-2; AM-3.5: persistence worker admitted) | `protocolVersion` 2 (unchanged) | yes | RFC §10 |
| C6 | Geometry and algorithm versions | **r3** (AM-1: version table; AM-3.2: `documentSchemaVersion` 2) | — | yes | RFC §12.2 |
| C7 | `.vectra` container | **r3** (AM-1: offsets, contiguity; AM-3.3: complete-container persistability; AM-3.4: save semantics) | `formatVersion` 1 (unchanged; unreleased) | yes | RFC §14 |
| C8 | Renderer boundary, snapshots and P1 clipping | **r2** (AM-1: A2, A3, AR-2) | — | yes | RFC §8, §12.3 |
| C9 | Measurement boundaries | r1 | — | yes | RFC §17 |
| C10 | Document schema and TraceProvenance | **r2** (new at AM-1; AM-3.2: compact v2 encoding) | `documentSchemaVersion` **2** written, 1 read (unreleased), `provenanceVersion` 1 | yes | RFC §5.1, §6.1, §14 |

## C1 — Identifiers and revisions
- **Node IDs.**
  - Format: ASCII `<prefix>_<decimal>`. Prefixes: `lay` (layer), `grp` (group), `pth` (path object), `src` (source reference), `ast` (source asset), `sty` (style), `pal` (palette entry).
  - At most 64 bytes; regex `^[a-z]{3}_[0-9]{1,15}$`.
  - Allocated from `Document.nextId`, a positive safe integer shared by all kinds, monotonic and **never reused**, including across undo, redo, save and load.
- **Chunk IDs.** `chk_<decimal>`, allocated by the GeometryStore from its own monotonic counter `nextChunkId`. Never reused within a document, including across save and load: both high-water marks are persisted (C7).
- **High-water marks are not undoable state.** `nextId` and `nextChunkId` live beside the immutable document states, never move backwards, and take no part in dirty detection (C7).
- **Geometry reference.** `{ chunkId, pathIndex }`, where `pathIndex` is the 0-based path index inside the chunk's packet. It is immutable, because chunks are immutable. Several PathObjects may reference the same geometry; each reference counts towards the anchor cap (C3).
- **Revisions.**
  - `documentRevision`: a positive safe integer that increments on **every** committed transaction, including undo and redo. Session-scoped; it is not persisted.
  - `renderRevision`: increments on every snapshot sent to the renderer.
  - `jobId`: increments per submitted job.
  - `generation`: increments per worker instance (compute and render workers counted separately).
  - All are positive safe integers, compared for equality only.
- **Content identity** (integrity, relink, "unchanged since save"): SHA-256 over **canonical uncompressed** serialisations (C7). It is computed at save time and cached per immutable chunk, not on every edit. Dirty state uses state identity (C7), not a per-edit digest.

## C2 — GeometryStore (ownership and lifetime)
```ts
interface GeometryStore {
  commit(packet: IncomingPacket): ChunkId;        // consumes the packet: move, validate, derive, publish (rules 1–5)
  view(id: ChunkId): ChunkView;                   // read-only accessors; NO ArrayBuffer/TypedArray/DataView exposure
  derived(id: ChunkId): DerivedView;              // C3 derived metadata through frozen accessors (AM-1 A1)
  jobCopy(ids: ChunkId[]): { packets: TransferPacket[]; transfer: ArrayBuffer[] };    // fresh copies
  renderCopy(ids: ChunkId[]): { packets: TransferPacket[]; transfer: ArrayBuffer[] }; // fresh copies
  retain(id: ChunkId, owner: OwnerRef): void;     // owner kinds: document | history | snapshot | job
  release(id: ChunkId, owner: OwnerRef): void;
  bytes(): { byOwnerKind: Record<OwnerKind, number>; total: number };  // C3 accounting; Σ byOwnerKind = total
}
function copyIncoming(packet: IncomingPacket): IncomingPacket;  // explicit defensive copy (rule 5)
```
An `IncomingPacket` is a C3 manifest plus the six section arrays (`Uint8Array` verbs, `Float64Array` coords, four `Uint32Array`s).

**Commit sequence (normative).** `commit` runs these steps in order. On any failure it throws a typed error and the store is unchanged.
1. **Shape check (`ownership`).** Each of the six arrays must:
   - view an `ArrayBuffer`: not a `SharedArrayBuffer`, not resizable, not detached;
   - span its whole buffer (`byteOffset === 0` and `byteLength === buffer.byteLength`);
   - use a buffer distinct from the other five.

   Views into WASM linear memory, a file buffer or any shared buffer fail this check. They are never committed directly.
2. **Move.** The store takes exclusive ownership with `structuredClone(buffers, { transfer: buffers })`.
   - This **detaches every source buffer**. Every caller alias then reports `byteLength === 0` and can neither read nor write committed bytes. Aliases include the input arrays, any other typed array or DataView over those buffers, and references kept by message listeners.
   - No bytes are expected to be copied. Measured at G-0 closure on Node 24.22.1 (V8): median 0.03 ms to transfer a 52 MiB buffer, against 1.24 ms to copy it. G-DOC measures the move in each target browser.
   - From this step on, the packet is **consumed whether commit succeeds or fails**.
3. **Validate the owned bytes.** C3 validation runs on the store-owned buffers, after the move, and computes the derived metadata in the same pass.
   - Commit has **no pre-validated fast path**: a packet validated earlier is validated again here.
   - Validate, then mutate, then commit is therefore impossible.
   - This validation **is** the trust-boundary validation for worker → main and file → store (RFC §6).
4. **Publish.** Only now is the chunk inserted, assigned `chk_<nextChunkId>`, and readable through `view`. A chunk that has no owner at the end of the enclosing transaction is freed.
5. **Explicit defensive copy.** A caller holding arrays that fail rule 1 calls `copyIncoming()`.
   - It makes one fresh buffer per array (one `slice` each). Copies are counted in diagnostics (`defensiveCopies`, bytes).
   - The caller then commits the copy.
   - **`commit` never copies implicitly.** The WASM adapter copies out per array (C4), and the container loader decodes each section into fresh arrays (C7), so neither path needs `copyIncoming`.

**Startup check (fail closed).** Before the editor starts, it verifies two properties and refuses to start with an unsupported-browser message if either fails:
- the host is little-endian;
- a probe `structuredClone(…, { transfer })` detaches its source buffer.

No browser version numbers are frozen here; the browser baseline is decided from evidence (ROADMAP).

**Access and copy-out.**
- **Derived data (AM-1, A1).** `derived(id)` returns a frozen `DerivedView`: `anchors`, `pathCount`, `subpathCount`, `pathAnchors(i)`, `subpathStart(k)` and `bounds(i)`. It never returns the store's typed arrays, which a caller could detach. Callers that need arrays copy them explicitly.
6. **Private buffers.** `ChunkView` is a frozen object whose methods close over the store's arrays (closures or `#private` fields). It exposes element reads, counts and iteration only.
   - TypeScript `readonly` is **not** relied on.
   - A runtime test walks every own and inherited property of a view and of its method results, and fails if any is an `ArrayBuffer`, typed array or DataView.
7. **Transfer lists.** The only route to a transfer list is `jobCopy` or `renderCopy`, which return new buffers.

**Lifetime.**
8. **Refcounts per owner kind.** A chunk is freed exactly when every count reaches 0, at the end of the transaction or job settle that drops the last owner.
9. **Structural commands never copy geometry.**
   - Transform, recolour, visibility, lock, rename, reorder, reparent, group/ungroup and duplicate never call `commit`, `copyIncoming`, `jobCopy` or `renderCopy`. Duplicate references the same `{chunkId, pathIndex}` under new node IDs.
   - **Carve-out:** render copies are driven by the **renderer host, not by commands**. `renderCopy` is legitimately called for:
     - initial cache population of chunks the render worker does not hold;
     - render-worker recovery, which re-sends every chunk of the current snapshot;
     - a newly committed chunk entering a snapshot.

     A structural edit of chunks the worker already holds causes **zero** `renderCopy` calls; this is a G-R0 test.
10. **One chunk per result.** Each trace commit, bake or geometry-operation result yields exactly one new chunk containing only the affected objects' paths.
11. **Ledger reporting.** `bytes()` follows the exact C3 accounting, and `Σ byOwnerKind = total`.

**Tests (G-DOC):**
- after commit, the six input arrays and an extra alias created before commit all report `byteLength === 0`, and writing through any of them leaves `view` reads unchanged;
- a validate–mutate–commit sequence stores exactly the moved bytes, and rejects them if the mutation made them invalid;
- each rule-1 violation returns `ownership` with the store unchanged: offset view, two sections sharing one buffer, `SharedArrayBuffer`, resizable, detached;
- the runtime property walk finds no buffer exposure;
- a committed buffer is never detached after any number of jobs and terminations;
- refcount property tests over random command, undo and redo sequences;
- an instrumented store with no renderer attached sees zero `commit`, `copyIncoming`, `jobCopy` and `renderCopy` calls during structural commands;
- commit time at 1M anchors within the G-DOC budget, reported per step (move, validate and derive, publish). `copyIncoming` cost is reported separately.

## C3 — GeometryPacket v1
**Manifest** (JSON-compatible object; carried alongside the buffers in messages and stored as canonical JSON in files):
```text
{ packetVersion: 1,
  width: f64 (0 < w ≤ 16384), height: f64 (0 < h ≤ 16384),
  pathCount: u32, verbCount: u32, coordCount: u32,
  styles: [ { fill: u32 RGBA8888 | null, paletteId: string | null,
              stroke: { color: u32 RGBA8888, width: f64 (0 < w ≤ 1000) } | null,
              evenOdd: bool } ],                // ≤ 65,536 entries
  groups: [ { id: string, clip: { x, y, width, height } | null } ]   // ≤ 65,536 entries
}
```
- `paletteId` and group `id` follow the scene-v1 id rule: 1–64 bytes of ASCII `[A-Za-z0-9_-]`.
- Counts are integers in `[0, 2³²−1]`.
- An empty packet (`pathCount = 0`) is valid.

**Sections**, in this order:

| # | Section | Element | Count | Byte length | Constraint |
|---|---|---|---|---|---|
| 1 | verbs | u8 | V = verbCount | V | 0=M, 1=L, 2=C, 3=Z |
| 2 | coords | f64 IEEE-754 | C = coordCount | 8C | finite, \|v\| ≤ 1e6 |
| 3 | verbOffsets | u32 | P+1 | 4(P+1) | [0]=0, [P]=V, strictly increasing per path (no empty path) |
| 4 | coordOffsets | u32 | P+1 | 4(P+1) | [0]=0, [P]=C, non-decreasing |
| 5 | styleIndex | u32 | P = pathCount | 4P | < styles.length |
| 6 | groupIndex | u32 | P | 4P | < groups.length, non-decreasing |

**In memory**, each section is its own typed array over its own buffer (C2 rule 1), in platform byte order: little-endian on every supported target. Big-endian hosts are refused at startup (C2).

### C3.0 — Byte serialisation (files and any byte stream)
**Packet block.**
- Sections appear in table order. Section k starts at offset `o_k` from the start of the block: `o_1 = 0` and `o_(k+1) = align8(o_k + L_k)`, where `align8(x) = x + ((8 − x mod 8) mod 8)`.
- The block length is `B = align8(o_6 + L_6)`. Every element is little-endian, and every padding byte is zero.
- **Offsets are not stored.** They are computed from the manifest counts, which serve as the header. A reader rejects a block whose length differs from `B` (`length`) or whose padding is non-zero (`padding`, a byte-decoding-only code).
- `B − M_mem = 8 + ((8 − V mod 8) mod 8)`, which lies in `[8, 15]`: the four u32 sections always contribute exactly 8 padding bytes, for either parity of P. `M_mem` is the in-memory size defined below.

**Geometry record** (the uncompressed content of a container `geometry` section, C7):
```text
u32 LE   Lm = manifest length in bytes        (Lm ≤ 16 MiB, checked before reading the manifest)
Lm bytes canonical manifest JSON (RFC 8785, UTF-8)
zero padding to the next multiple of 8 from the record start
B bytes  packet block
```
The record length is `G = align8(4 + Lm) + B`. It must equal the section's `uncompressedLength`, or the reader returns `length`.

### C3.2 — Resource accounting (exact, checked)
**Symbols:**
- P, V, C: the declared counts;
- S: the number of M verbs (subpaths);
- A: anchors, meaning M, L and C verbs with Z excluded, exactly as `Scene::validate`;
- `manifestBytes`: the UTF-8 length of the canonical manifest JSON.

| Quantity | Exact definition | Used for |
|---|---|---|
| In-memory packet `M_mem` | `V + 8C + 16P + 8` (sum of the six section byte lengths; separate buffers, no padding) | ledger; cap |
| Derived metadata `D` | `36P + 4S`: bounds f64[4P] = 32P, pathAnchors u32[P] = 4P, subpathStart u32[S] = 4S | ledger |
| Derived upper bound `D_max` | `36P + 4V` (S ≤ V), known before validation | pre-allocation cap |
| Serialized block `B` | C3.0 | messages and files (transient; not a ledger cost) |
| Geometry record `G` | `align8(4 + Lm) + B` | container section size |
| Chunk ledger cost | `M_mem + manifestBytes + D` | store accounting |

This corrects the earlier declared-bytes formula, `verbCount + 8·coordCount + 16·(pathCount+1)`, which overstated the size by 8 bytes.

**Caps checked before any allocation** (validation step 2; defaults, which a profile may lower):

| Check | Bound | Why it is sound |
|---|---|---|
| P | ≤ 1,000,000 paths and ≤ the anchor cap | every path begins with M, so P ≤ A |
| V | ≤ 2 × anchor cap | grammar: every Z closes a subpath opened by an M, so #Z ≤ #M ≤ A |
| C | ≤ 6 × anchor cap | an anchor verb carries at most 6 coordinates; Z carries none |
| Anchor cap | 1,000,000 product (5,000,000 engine engineering ceiling) | — |
| `M_mem + D_max` | ≤ 512 MiB | covers every array the validator allocates |
| styles, groups | ≤ 65,536 entries each; string fields per the id rule | — |
| `manifestBytes` (byte streams) | ≤ 16 MiB, from `Lm`, before parsing | — |

**Checked arithmetic.**
- **Rust.** All size arithmetic runs in `u64` with `checked_mul` and `checked_add`; overflow returns `budget`. A size is converted to `usize` (`usize::try_from`) only after its cap check passes, because `usize` is 32-bit on wasm32.
- **TypeScript.**
  - Every manifest number is checked before any arithmetic: `Number.isInteger` and the `[0, 2³²−1]` range for counts; finiteness and range for dimensions. A failure returns `manifest`.
  - Every computed size is then asserted with `Number.isSafeInteger`; the largest is below 2³⁹.
- The validator allocates the bounds and pathAnchors arrays (sized from P) after step 2. It allocates `subpathStart` at exact size once S is known; an implementation may rescan the verbs array to fill it.

**Store aggregation** (C2 `bytes()`).
- `total` is the sum of chunk ledger costs over live chunks, **each chunk counted once** (deduplicated storage).
- `byOwnerKind` attributes each live chunk to exactly one kind: its highest-precedence current owner, in the order document > snapshot > job > history. Hence `Σ byOwnerKind = total`.
- **(r3, AM-2) The RFC §7 history byte budget** is the sum of three terms. Each counts an allocation only when no higher-precedence owner holds it, and counts it once:
  1. **chunk bytes:** `byOwnerKind.history` (unchanged; this paragraph's store rules);
  2. **history-only source bytes:** source assets that only history states reference;
  3. **document-structure bytes:** the *accounted* bytes of every structural allocation that history states retain and the current document does not. These include node-map roots, bucket directories, buckets and entries; persistent parent-index structures; node objects and child lists; style, palette and asset maps and entries; retained provenance; derived indexes and summaries kept for historical states; and any other retained structural resource.
- **Exclusions.** Chunk bytes and source bytes are never counted again in term 3.
- **Shared allocations.** An allocation shared with the current document is not history-only. One shared only among several history states is counted once.
- **Cost model.** Document-structure bytes come from a deterministic integer cost model, with `Number.isSafeInteger` checked. They are **accounted bytes, not a measurement** of JavaScript heap consumption. The model and its calibration against measured retained heap are documented in the G-DOC-R report.
- Copies (`jobCopy`, `renderCopy`, `copyIncoming`) are separate allocations and are **not** in the store `total`. Job copies are charged to the job's ledger entry until settle; render copies are charged to the render-worker entry (RFC §8.8, §11.3).

**Anchor accounting with shared geometry.**
- **Document anchors** are the sum, over every PathObject in the document (all layers, visible or hidden), of `pathAnchors[pathIndex]` of its referenced chunk.
- A path referenced by k PathObjects counts **k times**. Storage deduplication reduces bytes, never anchors.
- **Enforcement.** Any command that can raise document anchors checks the cap **before commit** and is rejected with an actionable `budget` error if the result would exceed it. Such commands include trace commit, duplicate, paste, bake and geometry operations.
- **Jobs and exports.** A job's input anchors and an export's evaluated scene are counted per draw-list reference, so they cannot exceed the document count. `bake_draw_list` re-validates the result with `Scene::validate(cap)`.
- Chunks retained only by history do not count towards anchors. They count towards the history byte budget.

**Validation order** (identical in TS and Rust; first failure wins; error codes shared):

| Step | Check | Code |
|---|---|---|
| 1 | packetVersion | `version` |
| 2 | Manifest fields, string rules, integer ranges, and the pre-allocation caps above | `manifest`, `budget` |
| 3 | Array types and lengths | `type`, `length` |
| 4 | Sentinels | `offsets` |
| 5 | Per path: increasing offsets, in bounds before iteration | `offsets` |
| 6 | Per path: style and group references, group order | `ref` |
| 7 | Per verb: opcode | `opcode` |
| 8 | Per verb: grammar | `grammar` |
| 9 | Per verb: arity | `arity` |
| 10 | Per verb: coordinate range | `coord` |
| 11 | Surplus coordinates | `arity` |
| 12 | Running anchor budget | `budget` |

**Byte streams (AM-1, AR-1).** Steps 1–2 run on the manifest first, because the block length depends on the validated counts. The block is then decoded (`length`, `padding`) before step 3. Within step 2 the sub-order is: key set, artboard, counts, styles (table cap, then entries), groups (table cap, then entries), then the caps P, V, C and `M_mem + D_max`. Steps 5–12 run per path, in path order.

### C3.1 — Authority after commit (packet vs document)
A packet's `styles`, `evenOdd`, `styleIndex`, `groups` and `groupIndex` are **commit-time inputs and provenance**. The commit command (G-DOC) maps them deterministically:

| Packet | Document |
|---|---|
| The whole packet (one chunk) | One new **Layer** (or the replaced layer, on explicit replace), identity transform |
| `groups[g]` | One **Group** node per group, in group order, identity transform; `name` = group id; `clip` → rect `clipRef` (C8) |
| Path `i` in group `g` | One **PathObject** `{ chunkId, pathIndex: i }` under that Group, in path order |
| `styles[styleIndex[i]]` | A document style (`styleRef`): fill, stroke, `paletteId` → palette entry. `fillRule` = `evenOdd ? "evenodd" : "nonzero"` on the PathObject |

After commit, the **document is authoritative** for style, fill rule, transform, visibility, lock, order and clip. Renderers (C8) and exporters (C5 `export`) receive **effective** values in a draw list and must not treat packet style tables as authority. The container (C7) stores chunks unchanged, including their provenance tables, and stores authoritative values in the document section.

**Derived metadata** (from the same pass; never transported):
- `bounds: f64[4·pathCount]` (control-point bounds);
- `pathAnchors: u32[pathCount]` (anchors per path, for per-reference accounting);
- `subpathStart: u32[S]` (verb index of each M);
- `anchors: u32` (total).

**Determinism and conformance.**
- **(AM-1, AR-3)** Identical validated scenes produce byte-identical geometry packets and C3.0 blocks across Rust (native), WASM and TypeScript. This is proved over identical canonical scene inputs (`tests/fixtures/packet-determinism/` and the local corpus run).
- **Native/WASM *tracing* identity is a separate, unresolved requirement: TD-PLATFORM-007.** Identical pixels do not yet always trace to identical scenes on the two targets.
- `Scene → Packet → Scene` round-trips **losslessly** for every scene v1 in the regression corpus (with `SceneMeta`: background, palette, metadata).
- The shared adversarial suite lives in one fixture directory, created in G-ENG and seeded from the review's 27 cases plus byte-serialisation cases. Both validators must return identical codes per case.

## C4 — Engine API (r2: signatures finalised at AM-1)
**Rust (`vector-engine`).** The public, documented API exposes no VTracer or visioncortex types:
```text
vectorize(rgba, w, h, &TraceRequest, clock) -> Result<Output>            // unchanged (scene v1), byte-identical
GeometryPacket::from_scene(&Scene) -> GeometryPacket                     // lossless for scene v1
Scene::from_packet(&GeometryPacket, &SceneMeta) -> Result<Scene>
validate_packet(&GeometryPacket, &Limits) -> Result<Derived, PacketError>  // codes and accounting = C3
GeometryPacket::to_bytes / from_bytes                                    // C3.0 block; caps before allocation
bake_draw_list(&DrawList, &[GeometryPacket], &SceneMeta, &Limits) -> Result<Scene>   // export (C8 export draw list): effective transforms (f64), styles, fill rules, clip runs; identity + unchanged style ⇒ original coordinates bit-identical
SceneMeta::from_json(&str)                                               // re-types metadata.params through Settings when it parses as one (C10 number formatting)
segment(rgba, w, h, &TraceRequest, clock) -> Result<Segmentation>        // opaque Vectra-owned handle; carries the request
estimate(&Segmentation) -> Estimate::{Range{anchors_low, anchors_high, basis} | Unavailable{reason}}
fit(Segmentation, clock) -> Result<Output>                                // == vectorize output, byte-identical
```
- Limited and halftone modes get staged estimators, or an explicit "no estimate", in G-ENG.
- `segment_layers` and `vectorize_with_precision_options` move behind a `diagnostics` cargo feature (TD-ARCH-004).

**WASM (`vector-engine-wasm`, worker only).**
```text
vectorizePacket(rgba, w, h, requestJson) -> { manifestJson, verbs, coords, verbOffsets, coordOffsets,
                                             styleIndex, groupIndex, sceneMetaJson, reportJson }   // one copy out per array: each a fresh, whole-buffer array (C2 rule 1)
validatePacket(manifestJson, ...arrays) -> derived | throws {code, message}
PacketSet.add(manifestJson, ...arrays) -> index                            // packets referenced by the draw list's `chunk`
exportDrawListSvg / exportDrawListPdf / exportDrawListScene(drawListJson, sceneMetaJson, [optionsJson,] set)   // bake_draw_list → scene v1 → writers
sceneToPacket(sceneJson) -> PacketResult                                  // GeometryPacket::from_scene (interchange; determinism proof)
packetToSvg / packetToPdf (single-packet convenience, used for the byte-identity regression)
segment/estimate (handle-scoped to the worker instance)
```
- The existing `vectorize`, `sceneToSvg` and `sceneToPdf` stay until G-EXP shows byte-identical packet-route exports over the regression corpus.

## C5 — Worker protocol v2
**Handshake (both workers; startup and every recreation).**
- When its module has loaded, the worker posts `ready` unsolicited:
  - compute worker: `{protocolVersion: 2, buildId, engineVersion, packetVersion: 1}`;
  - render worker: `{protocolVersion: 2, buildId, packetVersion: 1, workerRaf}`.
- Main binds `generation` to the worker instance. Every request carries it and every response echoes it (common rules). The render worker receives it in `init`.
- **No job, `init` or snapshot is posted before the handshake passes.** This is the ordering of the review's R03 prototype (`bench/scheduler.mjs` posts only after `ready`), so the 16/16 WebKit start-up evidence applies to it unchanged.
- **Identity mismatch is fatal build skew.** A mismatch in `protocolVersion`, `buildId`, `packetVersion` or (compute only) `engineVersion` means:
  - the worker is discarded, with no requeue;
  - accepted explicit jobs end as `failed{code: "build_mismatch"}`;
  - the user is prompted to reload (RFC §15.3).
- A `generation` mismatch identifies a stale worker: its messages are dropped and the worker is terminated.
- The same checks run when a worker is recreated after a start-up timeout, after recycling, and during render-worker recovery.

**Common rules.**
- Every request carries `{jobId, generation, kind, documentRevision, operationVersion}`. Every response echoes `jobId` and `generation`.
- Unmatched responses are dropped, and the drops are counted in diagnostics.

**Compute worker.**
- **Requests:** `trace{rgba(transfer), width, height, request, quality: "preview"|"final", sourceDigest}`, `estimate{...}`, `op{opId, opVersion, params, inputs: TransferPacket[], sideInputs}`, `export{format: "svg"|"pdf", drawList (the C8 **export draw list**, AM-1 AR-2), chunks: TransferPacket[] (job copies, indexed by the draw list's `chunk`), sceneMeta (C10 export metadata semantics), options}`.
- **Responses:**
  - `status{state}`;
  - `progress{stage: "segment"|"estimate"|"fit"|"validate"|"serialize"}`, staged only; **no fabricated percentages**;
  - `result{packet(transfer)|bytes(transfer), metrics, warnings, memoryBytes}`;
  - `error{code, message, fatal}`.

**Render worker.**
- **Requests:** `init{generation, canvas(OffscreenCanvas transfer), dpr, cssWidth, cssHeight}`, `snapshot{renderRevision, documentRevision, drawList, packets(transfer, new chunks only), releaseChunks}`, `camera{...}`, `gesture{phase: "start"|"end"}`, `resize{...}`, `release`.
- **Responses:** `ready{…as above}` (on load, before `init`), `frame{generation, renderRevision, kind: "interaction"|"exact", ms}`, `error{generation, code, fatal}`.

**Scheduling semantics** (normative in RFC §10.3; summary):
- **Supersession applies to previews and thumbnails only.** At most one pending job per `(kind, scope)` for those kinds: a newer one replaces the pending one and may pre-empt a running one.
- **Explicit operations** (final trace, Apply, export) are **accepted or rejected at submission, never silently dropped**:
  - **Acceptance:** `accepted{jobId}`; the job enters a bounded queue (priority, then FIFO; capacity 4 explicit jobs, provisional, measured in G-JOB).
  - **Rejection** happens before acceptance, with a typed, actionable `busy{queued}` result.
  - An accepted explicit job ends only in a **user-visible outcome**: `committed`, `delivered` (export bytes), `failed{code}`, `stale{reason}` (RFC §10.3 rule 3b), or `cancelled` by an explicit user action.
- A worker is never deliberately terminated during start-up before its handshake passes and its job is posted, except by the start-up timeout. After that timeout, a job that never ran is requeued once.
- Explicit cancel only for apply, final and export.

**Persistence worker (r3, AM-3.5; approved, not yet implemented: G-PRJ-1).** A third dedicated worker of the same build, under the same handshake, generation and build-isolation rules as the two above. Its message set is specified with its implementation. Normative boundaries ([G-PRJ-ARCHITECTURE §4.1](../g-prj/G-PRJ-ARCHITECTURE.md)):
- it is **never a second authoritative document engine**: it holds no `DocState`, session or history, only a container's bytes for the duration of one job;
- on save it receives transferred canonical sections and returns digests, sizes and a result code; on open it returns parsed sections that the main thread adopts without re-parsing, and the main thread runs `validateState` once;
- only the main thread publishes: it marks a state saved, or flips a library or recovery pointer, after the worker reports a verified write;
- the whole hand-off is measured, so work moved off the main thread cannot reappear there unmeasured.

## C6 — Geometry and algorithm versions
| Version | Owner | Rule |
|---|---|---|
| `fit.mode` (`spline`=Artistic, `polygon`, `pixel`, `precision`) | engine | Unchanged. Artistic is the default |
| `PRECISION_FIT_VERSION` | maintainer, **only at a release qualification** | v1 frozen (hash-protected). Development uses provisional IDs (`precision-next-geo`, `precision-next-sb`), never persisted and not user-selectable. **G-GEO acceptance allocates no version.** Plan: v2 = G-GEO fixes + G-SB graph, allocated at G-SB acceptance; the fresh holdout is spent once, by that joint qualification. If G-SB defers, the maintainer decides explicitly (RFC §12.2) |
| `presetVersion` (`TraceRequest`) | engine | Bumped on any default change; old versions keep working |
| `packetVersion` | C3 | 1 |
| scene version | engine | v1 for export and interchange; v2 only for a needed capability, with dual-format regression |
| `documentSchemaVersion` | G-DOC | **2** written since G-PRJ-0 (AM-3.2, the compact encoding; C10 r2), **1** still read; both unreleased. Reading v1 and saving writes v2 (a deterministic migration). Forward-only deterministic migrations after first release |
| `provenanceVersion` | C10 | 1 |
| container `formatVersion` | C7 | 1 |
| operation versions (recipes) | per operation | Migrations in Rust |

Recipes and projects record every version they depend on; nothing is migrated silently.

## C7 — `.vectra` container v1
The layout is in RFC §14. Normative limits:

| Item | Limit |
|---|---|
| Header JSON | ≤ 1 MiB |
| Sections | ≤ 4,096, unique `id`. **(AM-1)** `offset` is relative to the first byte after the header; sections are **contiguous** in the fixed order, with no gaps or overlaps, and the file ends at the last section (otherwise `section`; past EOF, `truncated`) |
| Section kinds | `manifest` (1), `document` (1), `geometry` (≥ 0, one per chunk, `id` = chunkId), `source` (≥ 0, opt-in, `id` = assetId) |
| Codecs | `none`, `deflate-raw` (native `CompressionStream`/`DecompressionStream`) |
| Total declared `uncompressedLength` | ≤ the profile session budget (default 512 MiB) |
| Document section | ≤ 64 MiB |
| Source section | ≤ 20 MiB |
| Geometry section | the C3.0 geometry record, within the C3 caps |

**Integrity.**
- SHA-256 over the **uncompressed** section bytes, verified before parsing.
- This gives integrity, not authentication.

**Loading.**
- Inflation is streamed and aborted beyond `uncompressedLength`.
- Unknown fields are rejected.
- Each geometry section is decoded into **fresh, whole-buffer** arrays and committed through C2. The store's validation is the file → store trust boundary.
- Loading is atomic: the new document is built off to the side and swapped in only on success.
- An unknown or newer `formatVersion`, `documentSchemaVersion` or `packetVersion` is refused with a typed error.
- **(r3)** The manifest's `documentSchemaVersion` is 1 or 2 and must equal the document section's (otherwise `manifest`). Writers write 2 (C10 r2).

### Persistability (r3, AM-3.3)
**Every committed document state is persistable:** the complete container it would write satisfies every limit above. A command whose result would not is refused **before anything is published**, atomically, with the typed error `persist_limit` naming the limit, the size needed and the cap. The session holds the initial state, and every later one, to these rules:

| Limit | How it is held |
|---|---|
| Document section ≤ 64 MiB | Exact incremental accounting of the v2 canonical bytes: one number per state (`body`, the section without the two high-water marks' digits), updated from the transaction's write log; no traversal of unchanged nodes |
| High-water marks | `nextId` and `nextChunkId` live outside the state and only grow (C1). Each is **charged at its maximum width, 16 digits**, so a state accepted at the exact limit still saves after later edits widen the marks and the artist undoes back to it. The usable document capacity is therefore up to 30 bytes below 64 MiB |
| Sections ≤ 4,096 | 2 + referenced chunks + embedded sources, checked per transaction |
| Header ≤ 1 MiB | Implied by the section count: the worst case (4,096 entries, every number at the 16-digit maximum, the longest ids) is 962,592 bytes |
| Total declared bytes ≤ the session budget | Manifest + document (marks at maximum width) + referenced geometry records (exact, `GeometryStore.recordBytes`) + embedded sources, per transaction. The loader passes its session budget to the session it builds |
| Source section ≤ 20 MiB; geometry section ≤ the C3.0 record cap | Rechecked per transaction; an embedded asset whose bytes the session does not hold is refused |
| Compression | No limit applies to compressed lengths; inflation stays bounded by the declared lengths |

No independent path-count limit exists. Messages near or at the document-section cap speak of document complexity or section capacity, never of a maximum total file size.

**Pre-flight.** A save checks the exact sizes from this accounting against the limits **before** serializing, hashing or compressing, and checks that what it built matches the accounting (a mismatch is a defect: nothing is returned).

### Canonical content
Every section's **uncompressed** bytes are a pure function of the saved state. Canonical JSON is produced **only by the TypeScript container code** (G-DOC). The Rust engine never emits container JSON, so it needs no ECMAScript number formatting; serde_json, for example, prints the f64 `1280` as `1280.0`, which RFC 8785 forbids.
- **JSON** (header, manifest section, document section, packet manifests): canonical JSON per **RFC 8785 (JCS)**.
  - UTF-8 with no BOM and no insignificant whitespace.
  - Object members are sorted by UTF-16 code units.
  - Numbers use the ECMAScript serialisation, so `-0` is written as `0`.
  - Non-finite numbers and lone surrogates are rejected at the boundary.
  - Absent optional members are omitted; `null` appears only where the schema declares a field nullable.
- **Maps and lists.**
  - ID-keyed maps (`nodesById`, `paletteById`, `sourceAssetsById`) are JSON objects in JCS order, so `lay_10` precedes `lay_9`.
  - Ordered collections (`orderedRootIds`, `orderedChildIds`) are arrays in document order.
- **Geometry** sections hold the C3.0 geometry record. **Source** sections hold the original bytes unchanged.
- **Section order is fixed:** manifest, document, geometry by chunk number, source by asset number. Neither clocks nor file names are written.

### Determinism (scope)
Native `deflate-raw` takes no parameters, and engines may emit different streams for identical input. Compressed bytes, and therefore header `offset`/`length` and whole-file bytes, are **not** canonical. `sha256` and `uncompressedLength` are canonical.
1. **Across supported browsers:**
   - identical saved state yields identical uncompressed section bytes and identical `sha256` values;
   - a file saved in any supported browser loads in every other to a **semantically equal** document: equal canonical document JSON, and equal uncompressed bytes for every chunk.
2. **Whole-container save → load → save is byte-identical within one qualified serialization environment:** the same build on the same engine and version.
   - G-DOC qualifies Node 24.22.1 for unit tests and Playwright Chromium for browser tests.
   - Firefox and WebKit are checked for property 1.
3. **With codec `none`** for every section, containers are byte-identical across all environments. The cross-environment test uses this mode.
4. If byte-identical **compressed** containers across browsers become a requirement, a Vectra-owned deterministic codec (for example, a pinned Rust deflate in WASM) is added under a new codec id and container version. Native `CompressionStream` output is never assumed deterministic.

### Persisted state, high-water marks and dirty state
- The document section persists `nextId` and `nextChunkId`. Load invariants require:
  - `nextId` to be greater than every node-ID number in the file;
  - `nextChunkId` to be greater than every chunk-ID number in the file.
- `documentRevision`, history, camera and selection are not persisted.
- **Dirty state uses state identity.**
  - Every committed transaction produces an immutable document state, and undo and redo restore earlier states **by reference**.
  - `dirty = currentState !== savedState`: O(1), with no hashing per edit. Loading sets `savedState = currentState`.
  - **(r3, AM-3.4) Serialization is not a save.** Producing container bytes never changes `savedState`. It is set only after the bytes were written and verified by reload (G-PRJ-1), or by an explicit decision about the serialized state (a confirmed download, D-PRJ-4), and always to **the state that was serialized**, never to a newer one.
  - Undo or redo back to the saved state is clean.
  - A different edit sequence that happens to reproduce equal content is conservatively dirty.
  - High-water marks sit outside the undoable state (C1), so duplicate followed by undo is clean.
  - If history truncation evicts the saved state, the document stays dirty until the next save.
- **Content digests** (C1) are computed at save time over canonical uncompressed sections, with chunk digests cached because chunks are immutable. They serve integrity, relink and "unchanged since save" checks, never per-edit dirty detection.

**Tooling.** `vectra-dump` (a G-DOC deliverable) prints the header, sections, hashes, the manifest and packet summaries.

## C8 — Renderer boundary, snapshots and P1 clipping
```text
RenderSnapshot { renderRevision, documentRevision, dpr, cssWidth, cssHeight, camera {s, tx, ty},
                 runs: [ { id: string /* scene-v1 id rule */, clip: {x,y,w,h} | null /* effective, document space */ } ],
                 drawList: [ { chunkId, pathIndex, transform /* 2×3 f64, effective */,
                               fill: u32|null, stroke?, evenOdd /* from the document fillRule */, groupRun: u32 /* index into runs */ } ],  // paint order; effective values per C3.1
                 selection?: { runs: [ [startIndex, endIndex) ] } }
```
**Export draw list (AM-1, AR-2).** The export job (C5) carries:
```text
ExportDrawList { width, height,                                   // artboard
                 runs: [ { id, clip: {x,y,width,height} | null } ],
                 items: [ { chunk /* index into the job's packet set */, pathIndex, transform,
                            fill: u32 | null, paletteId: string | null, stroke: {color, width} | null,
                            evenOdd, groupRun } ] }
```
- It is the render draw list plus each item's effective **`paletteId`** (C3.1, part of the effective style) and the artboard size.
- The worker maps chunk IDs to packet-set indices.
- Render items are unchanged.

- Snapshots are immutable once sent. The renderer receives packet render copies only for chunks it does not hold, and is told when to release chunks (C2 rule 9).
- **Imports:** `src/renderer/**` may import only `src/renderer/**`, the snapshot and packet **read** types, and the standard library. An architectural test fails on any import of document mutation modules (`src/document/commands`, `store` writers) or export modules.
- **Frame kinds** (`interaction` | `exact`) are reported per frame. Tests and owner review use `exact` frames only.

### P1 rectangular clipping (normative)
1. **Where.** P1 supports one rect `clipRef` per **Layer or Group** node. A `clipRef` on a PathObject is rejected (`clip_unsupported`).
2. **Coordinate space.**
   - The rect `{x, y, width, height}` (finite, width and height > 0) is expressed in the node's **local coordinate system**: the space of its children.
   - It maps to document space through the node's **composed transform** (root × … × node). The clip moves with the node; children's transforms do not move it.
   - Committed packet groups get identity transforms, so their effective clip equals the packet clip, and the P0 route is unchanged.
3. **Axis-preserving transforms only.**
   - Every clipped node's composed transform `[a c e; b d f]` must satisfy `(b = 0 ∧ c = 0) ∨ (a = 0 ∧ d = 0)`, compared **exactly**, with no tolerance. This allows translation, scale, reflection and 90° rotations.
   - The effective clip is then an axis-aligned rectangle computed in f64 **(AM-1, A3)**: its origin is the minimum of the transformed corners, and its extent is `|scale| × size` on each axis. Computing the extent as `max − min` is not bit-exact; `(x + w) − x ≠ w` in general.
   - In an intersection, an interval contained in the other keeps its exact extent. Unedited packet clips therefore pass through bit for bit (rule 2).
   - **Command validation rejects** anything that would break the rule, with the typed error `clip_transform_unsupported`, before the command is published. This covers a transform or reparent of a clipped node or any of its ancestors, and adding a clip under a non-axis-preserving composed transform.
   - The UI offers **Release clip** (undoable).
   - The rotate-by-90° command emits exact matrices (entries 0 and ±1).
   - Clip geometry is **never** approximated, by bounding boxes or otherwise.
4. **Nesting.**
   - An item's effective clip is the intersection of the effective clips of all its clipped ancestors: axis-aligned, computed with f64 max/min.
   - If the intersection is empty (width ≤ 0 or height ≤ 0), the item is **fully clipped**: it is omitted from the draw list, the hit index and the export. It is listed in the layer panel only.
   - This matches how SVG and PDF render fully clipped content, and it avoids zero-area clips, which scene v1 rejects.
5. **One computation.**
   - A single document evaluation (G-DOC) produces composed transforms, effective visibility, effective style, effective clips and the runs.
   - It feeds the render snapshot, the hit-test service (RFC §9; clip test closed on the boundary) and the export draw list (C5).
   - Preview, hit testing and export therefore agree by construction. A G-EDIT test asserts agreement on nested, transformed, reflected, 90°-rotated and empty-intersection cases.
6. **Export mapping.**
   - `bake_draw_list` emits one scene-v1 group per run, in order, with `clip` = the run's effective clip.
   - A run is a maximal sequence of consecutive items sharing the same nearest Group or Layer and the same effective clip.
   - **Empty runs (AM-1, A2).** A visible, not fully clipped Group or Layer whose **whole subtree emits nothing** yields one run with no items, so an unedited empty packet group round-trips. A container whose children all emit their own runs adds no run of its own. An unedited trace's runs therefore equal its packet groups 1:1.
   - A run whose effective clip is empty is omitted entirely, because scene v1 rejects zero-area clips.
   - **Run ids.** The run `id` is the Group's `name` when it is a valid scene-v1 id not used by an earlier run. Otherwise it is `run-<k>`, and if that is taken too, `run-<k>-<n>` with the smallest free `n`. Run ids are unique, so an unedited P0 trace keeps its original group ids and hashes.
7. **Outside P1.**
   - Arbitrary path clips and rotated or skewed rect clips require scene v2 (RFC §6.1), with dual-format regression. They come in P2-A, or earlier only after qualification.
   - P1 presets emit no clips. Halftone (P2) emits an artboard rect clip, so the rotated-clip decision (scene v2, or keeping the rejection rule) must be taken before Halftone ships.

## C10 — Document schema and TraceProvenance (new at AM-1; r2 at AM-3.2)
**r2 (AM-3.2, G-PRJ-0): writers write `documentSchemaVersion` 2, the compact encoding (§Document v2 below); readers accept 1 and 2.** The document model and its semantics are unchanged: v2 changes only how the same state is written. History at AM-1:
- `documentSchemaVersion` 1 was finalised at AM-1, before any release, instead of being bumped, and the test golden files were regenerated then.
- At AM-3.2 the historical v1 golden and frozen hashes are **kept as they are** and re-derived by a test-only v1 writer; the v2 golden and hashes are re-baselined explicitly beside them.
- Any change after the first release needs a version bump and a forward-only migration (C6).

**Document section** (canonical JSON, C7). Every member listed here is required unless it is marked `?`. Unknown members are rejected.
```text
Document { documentSchemaVersion: 1, documentId, nextId, nextChunkId,
           artboard: { width, height, background: u32 RGBA8888 | null },
           orderedRootIds, nodesById, stylesById, paletteById, sourceAssetsById }
Node common    { id, kind, name, visible, locked, localTransform: [a,b,c,d,e,f], clipRef?: {x,y,width,height} }
Layer          + orderedChildIds, traceProvenance?: TraceProvenance
Group          + orderedChildIds
PathObject     + geometry: { chunkId, pathIndex }, styleRef, fillRule: "nonzero" | "evenodd"
SourceReference+ assetId, sourceToDocument: [a,b,c,d,e,f]
Style          { id: sty_n, fill: u32 | null, paletteRef: pal_n | null, stroke: { color: u32, width } | null }
PaletteEntry   { id: pal_n, name (scene-v1 id rule), color: u32 }
SourceAsset    { id: ast_n, digest (SHA-256, 64 lowercase hex), mime: image/png | image/jpeg | image/webp,
                 width, height, embedded, decodePolicy, provenance?: { kind: "local-file" } }
```
- **Styles.** `fill` and `paletteRef` are mutually exclusive: one colour authority. A style needs a fill, a palette reference or a stroke, because scene v1 cannot export a path with none of them.
- **Palette.** Each trace commit creates its own palette entries, and `name` keeps the packet `paletteId`.
- **Artboard.** The artboard `background` is document data: it is the export background in document form (see below).
- **Transforms.** Every transform entry satisfies `|v| ≤ 1e9`, and the linear part must be non-singular with condition number `σmax/σmin ≤ 1e8`.
- **Tree shape.** The root holds Layers and SourceReferences; Layers and Groups hold Groups and PathObjects.
- **Effect stacks** (`effectStack`) are **not part of v1 or v2**. They must be absent. Their introduction (P2-B) is a later `documentSchemaVersion` change (3 or above; 2 was taken by AM-3.2), with the deterministic migration "absent → empty stack".
- **Source provenance.** The supported v1 subset is `{ kind: "local-file" }`, or the member is absent. Provider provenance (for example image-library attribution) is a later, versioned extension.
- **`decodePolicy`** is a closed enum. In v1 it has two values:
  - `"browser-canvas-v1"`: the P1 app path, browser decode to straight RGBA through canvas (TD-GEO-007);
  - `"external"`: the pixels were supplied by a caller outside the app's decoder, such as engine tools or tests.

  A new decoder needs a new enum value, and P0 defaults are never switched silently.

### Document v2: the compact canonical encoding (r2, AM-3.2)
`documentSchemaVersion` 2 writes the same document as v1 with every member that the key or a default already determines left out. The section stays RFC 8785 canonical JSON (C7). **Every document has exactly one v2 encoding, and the reader rejects any other.**

| Where | Rule | Reconstructed on read |
|---|---|---|
| Every entry of `nodesById`, `stylesById`, `paletteById`, `sourceAssetsById` | `id` is **never written**: the entry's key is its id | `id` = key |
| Every node | `kind` is **never written**: the key's prefix is the kind (`lay_` layer, `grp_` group, `pth_` path, `src_` source). A key with any other prefix is rejected | `kind` from the prefix |
| Node `name` | written **only when not ""**; `"name":""` is rejected | `""` |
| Node `visible` | written **only when false**; `true` is rejected | `true` |
| Node `locked` | written **only when true**; `false` is rejected | `false` |
| Node `localTransform` | written **only when not the identity** `[1,0,0,1,0,0]`, compared by value; an explicit identity is rejected | the shared identity matrix |
| Style `fill`, `paletteRef`, `stroke` | each written **only when not null**; an explicit `null` is rejected | `null` |
| Everything else | as in v1: the top-level members (all required, `artboard.background` nullable), `clipRef?`, `orderedChildIds`, `traceProvenance?`, `geometry`, `styleRef`, `fillRule`, `assetId`, `sourceToDocument`, palette `name` and `color`, every asset member and `provenance?` | — |

```text
Document v2  { documentSchemaVersion: 2, documentId, nextId, nextChunkId, artboard, orderedRootIds,
               nodesById, stylesById, paletteById, sourceAssetsById }          // all required
Node         { name?, visible?: false, locked?: true, localTransform?, clipRef? } + by key prefix:
  lay_       + orderedChildIds, traceProvenance?
  grp_       + orderedChildIds
  pth_       + geometry: { chunkId, pathIndex }, styleRef, fillRule
  src_       + assetId, sourceToDocument
Style        { fill?: u32, paletteRef?: pal_n, stroke?: { color, width } }
PaletteEntry { name, color }
SourceAsset  { digest, mime, width, height, embedded, decodePolicy, provenance? }
```
- **Strictness.** Unknown members, missing required members, explicitly written defaults or nulls, an `id` or `kind` member, and an unknown key prefix are schema errors (`document`). Semantic rules (references, tree, transforms, limits) stay with `validateState`, exactly as for v1.
- **v1 stays readable** with its own strict schema (C10 r1). A v1 member set inside a v2 document, or the reverse, is rejected.
- **Migration.** A v1 file loads into the same document a v2 file of that document loads into; saving it writes v2. Semantic equality is checked through the independent v1 writer (G-PRJ-0 qualification).
- **Measured effect** (G-PRJ-0 qualification): the v2 section is 0.529–0.533 of the v1 size for synthetic artwork and 0.586–0.595 for photographic traces and palette-heavy documents. The 996k-anchor workload is 36.9 MiB (58 % of the cap) and the 1M-anchor limit case 56.0 MiB (87 %).

### TraceProvenance v1
**Shape:**
```text
TraceProvenance { provenanceVersion: 1,
  chunkId,                                   // the commit-time chunk (historical geometry reference)
  source: { digest, width, height },         // content identity of the traced pixels (no file names)
  decodePolicy,                              // as above
  traceRequest: { presetVersion, seed, maxPixels, maxAnchors, settings },   // the engine request, ≤ 64 KiB canonical
  engineVersion,                             // ≤ 64 bytes of [0-9A-Za-z.+-]
  fitMode: "spline" | "polygon" | "pixel" | "precision" | null,           // null for halftone
  precisionFitVersion: positive integer | null,
  presetVersion, seed,                       // equal to traceRequest.presetVersion / .seed
  originalScene: { width, height, background: u32 | null,
                   palette: [ { id, color: u32 } ],                      // ≤ 65,536, in scene order
                   metadata: { generator, engineVersion, mode, presetVersion, seed,
                               sourceWidth, sourceHeight, params } } }
```

**Storage and validity:**
- **Where it lives.** Provenance is stored on the **Layer** that a trace commit creates or replaces, and `commitTrace` requires it. Duplicating a traced layer copies the provenance; an explicit replace installs the new trace's provenance.
- **Historical and immutable.** No command ever modifies provenance. It describes the trace at commit time and **is never authoritative** for current styles, transforms, palette, artboard or geometry; the document is (C3.1).
- **Load invariants:**
  - `originalScene.metadata` agrees with `engineVersion`, `presetVersion`, `seed` and `source.width`/`source.height`;
  - `chunkId` is a well-formed chunk ID below `nextChunkId`.
- **The chunk reference may become historical.** After a bake or deletion, `chunkId` may no longer resolve. It never resolves to a different chunk, because chunk IDs are never reused (C1).
- **The source reference is by content.** `source.digest` identifies the traced pixels. Relinking matches digests, and removing the source asset never invalidates provenance.
- **"Unedited" is computed, never stored.** Layer L is *export-unedited* when the export items and runs contributed by L equal the C3.1 identity draw list of the chunk `L.traceProvenance.chunkId`. That draw list has identity transforms, the packet's styles with palette ids and colours, its fill rules, and one run per packet group with the packet's id and clip, covering every path in order. This survives save and load and edit-then-undo, because it compares current state.

### Export metadata semantics (deterministic)
| Document | Export `SceneMeta` |
|---|---|
| **Unedited single trace:** the whole export draw list equals one export-unedited layer's identity draw list, *and* the artboard equals `originalScene` (width, height, background) | `originalScene.background`, `.palette` and `.metadata`, verbatim. The export is byte-identical to the original trace export |
| **Edited trace**, **multiple traced layers**, **baked geometry**, or any other content | **Document form** (below) |
| **Missing source assets** | No effect. Exports use committed geometry, and provenance keeps the source digest |

**Document form:**
- `background` = the artboard background.
- `palette` = the palette entries referenced by exported items, in first-use (paint) order. Each entry's scene id is the entry's `name` if that is not already used, else the first unused `p<k>`.
- `metadata`:
  ```text
  { generator: "vectra", engineVersion: <exporting engine>, mode: "document", presetVersion: 0, seed: 0,
    sourceWidth: ceil(artboard.width), sourceHeight: ceil(artboard.height),
    params: { documentSchemaVersion: 1,
              derivedFrom: [ { sourceDigest, mode, presetVersion, seed, fitMode, precisionFitVersion, edited } ] } }
  ```
  - `derivedFrom` lists each traced layer that contributes exported items, in paint order.
  - `edited` is the negation of export-unedited for that layer.
  - Document form never presents an original trace's parameters as describing the edited artwork. They appear only as labelled provenance entries.
  - **(r2)** `params.documentSchemaVersion` stays the literal **1**. It is part of the frozen export format, not the version of any `.vectra` file, so AM-3.2 leaves every export byte unchanged.
- No clocks, file names or node IDs are written.

**Number formatting.** The document stores `traceRequest` and `originalScene.metadata.params` as canonical JSON, so a whole-number f64 such as `pitch: 8.0` is written as `8`. The Rust export path re-types `metadata.params` through the engine's `Settings` type before writing it, which restores the engine's own serialisation (`8.0`). Unedited exports are therefore byte-identical.

## C9 — Measurement boundaries (RFC §17)
| Measure | Start | End | Context |
|---|---|---|---|
| Native execution | engine call entry | return | Rust release, single thread, recorded load |
| Worker execution | job posted (main) | result received (main) | production build, headed browser |
| Import → visible | file chosen (input event) | first meaningful frame presented | production build |
| First meaningful frame | validated packet on main | first complete frame of the snapshot (all visible paths drawn once) reported by the host | render worker (or disclosed fallback) |
| Exact settled frame | gesture end or edit commit | `frame{kind:"exact"}` presented | render worker |
| Interaction frame time | — | rAF interval during a gesture | host rAF; Chromium validated by `DrawFrame` tracing |
| Attributable main-thread blocking | — | longest main-thread task or rAF gap attributable to Vectra work | rAF probe plus Long Tasks |
| Hit test (warm / cold) | query entry | return | main thread; warm excludes first-touch flattening |
| Cancellation acknowledgement | cancel invoked | UI state cancelled | main thread |
| Store commit (G-DOC) | `commit` entry | return | main thread; move, validate-and-derive and publish reported separately |

**Every report states:** browser and version, headed or headless, DPR, viewport, workload hash, rep count, machine, and **machine load**. Clean runs must show no unrelated CPU-bound processes.

## AM-1 — Amendment record (P1-A corrective review)
Approved by the maintainer on 2026-11-25. These revisions are shared by the G-ENG, G-DOC and integration branches.

| Item | Source | Contract change | Wire impact |
|---|---|---|---|
| AR-1 | G-ENG | C3 r2: byte-stream decoding order and step-2 sub-order | none |
| AR-2 | G-ENG | C5 r2, C8 r2: export draw list with `paletteId`, artboard size and packet-set indices | none (worker protocol unreleased; `protocolVersion` 2) |
| AR-3 (qualified) | G-ENG | C3 r2: determinism over identical validated scenes across Rust, WASM and TS; native/WASM tracing identity tracked by TD-PLATFORM-007 | none |
| A1 | G-DOC | C2 r2: `derived()` returns a frozen accessor view | none |
| A2 | G-DOC | C8 r2: empty-run rule and run-id collisions | none |
| A3 | G-DOC | C8 r2: bit-exact clip arithmetic | none |
| Schema | G-DOC | C10 r1: `stylesById`, palette names, artboard background, TraceProvenance, export metadata semantics, defined subsets | `documentSchemaVersion` 1 finalised before release |
| Container | G-DOC | C7 r2: header-relative offsets, contiguous sections | `formatVersion` 1 (unreleased) |
| Tolerance | G-DOC | C10: transform entries `|v| ≤ 1e9`, condition number ≤ 1e8 | none |
| C4 | G-ENG | C4 r2: finalised signatures, `sceneToPacket`, `exportDrawListScene` | none |

## AM-2 — Amendment record (G-DOC-R history accounting)
Approved by the maintainer on 2026-11-26 ("G-DOC-R Stage B/C Acceptance and AM-2 Authorization"; [decision register §11](G0-DECISION-REGISTER.md); draft: [AM-2-DRAFT](../g-doc-r/AM-2-DRAFT.md)).

| Item | Contract | Change | Wire impact |
|---|---|---|---|
| AM-2.1 | **C3 r2 → r3** (C3.2, store aggregation) | The history byte budget adds document-structure bytes (term 3 above), from a deterministic, checked integer cost model. Accounted bytes are distinguished from measured heap | none |
| AM-2.2 | **RFC-002 §7** (history budget) | Bytes are counted by chunk, source and document-structure owner. Limits retained: 100 transactions, 128 MiB standard, 64 MiB constrained. Earlier oldest-first eviction is authorised; the visible truncation behaviour is kept | none |
| Attribution | C3.2 | The highest-precedence ownership rule (document > history) applies to structural allocations; shared allocations are counted once | none |
| Ordering | RFC §5.1 (in-memory `nodesById`; not persisted) | Deterministic bucket iteration replaces insertion order. No insertion-order index is kept. Canonical persistence, export, rendering, layer order and user-visible behaviour are unchanged. For a document with several defects, the full validator may name a different defect first; single-defect rejections are equivalent | none |
| — | C2, C7, C10 | **Unchanged.** GeometryStore ownership, the container and the document schema keep their texts and serialized versions | none |

**AM-2 accounting closure (2026-11-26). Explanatory note only: no normative text, specification revision or serialized version changed. Approved by the maintainer on 2026-11-26 (G-DOC-R M-10; [decision register §13](G0-DECISION-REGISTER.md)); no C3 r4 amendment is required.**
- **The store's per-chunk record is counted in term 3.** It covers the typed-array and buffer headers, accessor views, and the manifest object beyond its JSON length (a fixed part of about 3.1 KB, plus the style and group tables; measured). All of it lies outside the C3.2 chunk ledger cost. G-DOC-R counts it as a retained structural resource under term 3, for chunks attributed to history by the C3.2 precedence.
- **No double counting.** The chunk ledger cost (`M_mem + manifestBytes + D`), `bytes()` by owner and C2 are unchanged.
- **The accepted model** (frozen at `729e63a`): per history-attributed chunk, `3,136 + max(0, deepCost(manifest) − manifestBytes)`, with the C3.2 owner precedence. Typed-array headers are costed at 216 bytes in the structure model.
- **Evidence:** [G-DOC-R report §7.1](../g-doc-r/G-DOC-R-REPORT.md).

## AM-3 — Amendment record (G-PRJ project persistence)
Approved by the maintainer on 2026-11-27 ("G-PRJ-R Acceptance and G-PRJ-0 Authorization"; [decision register §14](G0-DECISION-REGISTER.md); proposals and refinements: [G-PRJ-DECISIONS](../g-prj/G-PRJ-DECISIONS.md) §4–§7). Recorded through change control in G-PRJ-0: contract revisions above, the [RFC-002](../../RFC-002.md) §14 amendment, maintainer approval.

| Item | Contract | Change | Wire impact | Status |
|---|---|---|---|---|
| AM-3.1 | **RFC-002 §14, D08**; PRD-002 VS-12 and the G-0 plan's exclusions | Autosave and recovery, a local project library, recent projects and OPFS/IndexedDB persistence are admitted under the three tiers ([G-PRJ-ARCHITECTURE §2](../g-prj/G-PRJ-ARCHITECTURE.md)). An explicit save overwrites in place only through a granted File System Access handle; elsewhere a save is a download. Persistent undo history and cloud storage stay excluded | none | Approved; **not yet implemented** (G-PRJ-1 to G-PRJ-3) |
| AM-3.2 | **C10 r1 → r2**, **C6 r2 → r3** | The compact canonical encoding, `documentSchemaVersion` 2, with strict v1 read support (§C10 Document v2). Historical v1 fixtures and hashes preserved; v2 hashes re-baselined explicitly. Export metadata keeps `params.documentSchemaVersion: 1` | `documentSchemaVersion` 1 → **2** (unreleased) | **Implemented** (G-PRJ-0) |
| AM-3.3 | **C7 r2 → r3** (§Persistability) | Exact persistable-size enforcement over the complete container, per transaction, before publication; high-water marks charged at maximum width; the 64 MiB document-section cap retained | none | **Implemented** (G-PRJ-0) |
| AM-3.4 | **C7 r3** (dirty state) | Serialization is separate from verified-save semantics: producing container bytes never marks a state saved | none | **Implemented** (G-PRJ-0): `saveContainer` no longer calls `markSaved` |
| AM-3.5 | **C5 r2 → r3** | A dedicated persistence worker under C5 build isolation, never a second authoritative document engine | none (protocol specified with its implementation) | Approved; **not yet implemented** (G-PRJ-1) |
| AM-3.6 | C7 r4 (sectioned document, streaming) | — | — | **Deferred** |
| — | C1–C4, C8, C9 | **Unchanged** | none | — |

**AM-2 interaction (accounting, not a contract change).** G-PRJ-0 keeps one number per document state (the persistable `body`) as a fourth field of the session's per-state derived record, and one number per geometry chunk (`recordBytes`) in the store's chunk record. Both are counted in the AM-2 model: the derived record's cost now counts its fields (`objectCost(4)` instead of `objectCost(3)`), and the chunk record's measured fixed part is re-checked against the frozen 3,136 bytes ([G-PRJ-0 report](../g-prj-0/G-PRJ-0-REPORT.md) §6). No COSTS constant changes.
