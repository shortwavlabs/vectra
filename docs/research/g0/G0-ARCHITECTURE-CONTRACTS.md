# G-0 — Architecture contracts (frozen for G-ENG and G-DOC)

**Status:** FROZEN at G-0 closure. The maintainer approved C1–C9 subject to the G-0 closure clarifications (C2, C3, C5, C7, C8). Those clarifications are integrated below and landed **before** the freeze, so every contract version stays at its initial value.

This file holds the **byte-level and API details** that RFC-002 defers to. Architecture, rationale and evidence stay in [RFC-002](../../RFC-002.md); this file does not restate them.

**Change control.** A change to a frozen contract requires three things:
1. a contract version bump;
2. an RFC-002 amendment;
3. maintainer approval.

Additive fields are allowed only where a contract says so. A gate that needs a change stops the affected work and raises an amendment ([G0-NEXT-GATE-BRIEF](G0-NEXT-GATE-BRIEF.md)).

| ID | Contract | Version | Authoritative here | Architecture in |
|---|---|---|---|---|
| C1 | Identifiers and revisions | 1 | yes | RFC §5.1 |
| C2 | GeometryStore ownership and lifetime | 1 | yes | RFC §5.2 |
| C3 | GeometryPacket and resource accounting | 1 | yes | RFC §6 |
| C4 | Engine API (Rust and WASM) | 1 | yes (shape); signatures finalised in G-ENG | RFC §6, §11.2 |
| C5 | Worker protocol | 2 | yes | RFC §10 |
| C6 | Geometry and algorithm versions | 1 | yes | RFC §12.2 |
| C7 | `.vectra` container | 1 | yes | RFC §14 |
| C8 | Renderer boundary, snapshots and P1 clipping | 1 | yes | RFC §8, §12.3 |
| C9 | Measurement boundaries | 1 | yes | RFC §17 |

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
  derived(id: ChunkId): DerivedMetadata;          // C3 derived metadata, computed by commit
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
- "History-only bytes" (the RFC §7 budget) are `byOwnerKind.history`.
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

Byte decoding (C3.0) precedes step 1 and may additionally return `length` or `padding`.

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
- Native and WASM builds produce byte-identical packets and identical serialized blocks.
- `Scene → Packet → Scene` round-trips **losslessly** for every scene v1 in the regression corpus (with `SceneMeta`: background, palette, metadata).
- The shared adversarial suite lives in one fixture directory, created in G-ENG and seeded from the review's 27 cases plus byte-serialisation cases. Both validators must return identical codes per case.

## C4 — Engine API (shape; exact signatures finalised and reviewed in G-ENG)
**Rust (`vector-engine`).** The public, documented API exposes no VTracer or visioncortex types:
```text
vectorize(rgba, w, h, &TraceRequest, clock) -> Result<Output>            // unchanged (scene v1), byte-identical
GeometryPacket::from_scene(&Scene) -> GeometryPacket                     // lossless for scene v1
Scene::from_packet(&GeometryPacket, &SceneMeta) -> Result<Scene>
validate_packet(&GeometryPacket, &Limits) -> Result<Derived, PacketError>  // codes and accounting = C3
GeometryPacket::to_bytes / from_bytes                                    // C3.0 block; caps before allocation
bake_draw_list(&DrawList, &[GeometryPacket]) -> Result<Scene>            // export: applies effective transforms (f64), styles, fill rules, clips (C8); visible items only; identity + unchanged style ⇒ original coordinates bit-identical
segment(rgba, w, h, &TraceRequest) -> Result<Segmentation>               // opaque Vectra-owned handle
estimate(&Segmentation, &TraceRequest) -> Estimate { anchors_low, anchors_high, basis }
fit(Segmentation, &TraceRequest, clock) -> Result<Output>                 // == vectorize output, byte-identical
```
- Limited and halftone modes get staged estimators, or an explicit "no estimate", in G-ENG.
- `segment_layers` and `vectorize_with_precision_options` move behind a `diagnostics` cargo feature (TD-ARCH-004).

**WASM (`vector-engine-wasm`, worker only).**
```text
vectorizePacket(rgba, w, h, requestJson) -> { manifestJson, verbs, coords, verbOffsets, coordOffsets,
                                             styleIndex, groupIndex, sceneMetaJson, reportJson }   // one copy out per array: each a fresh, whole-buffer array (C2 rule 1)
validatePacket(manifestJson, ...arrays) -> derived | throws {code, message}
exportDrawList(format, drawListJson, sceneMetaJson, optionsJson, ...packets) -> string | Uint8Array  // via bake_draw_list → scene v1 → writers
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
- **Requests:** `trace{rgba(transfer), width, height, request, quality: "preview"|"final", sourceDigest}`, `estimate{...}`, `op{opId, opVersion, params, inputs: TransferPacket[], sideInputs}`, `export{format: "svg"|"pdf", drawList (C8: effective transform, style, fillRule, effective clip; visible, unclipped-or-non-empty items in paint order), chunks: TransferPacket[] (job copies), sceneMeta, options}`.
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

## C6 — Geometry and algorithm versions
| Version | Owner | Rule |
|---|---|---|
| `fit.mode` (`spline`=Artistic, `polygon`, `pixel`, `precision`) | engine | Unchanged. Artistic is the default |
| `PRECISION_FIT_VERSION` | maintainer, **only at a release qualification** | v1 frozen (hash-protected). Development uses provisional IDs (`precision-next-geo`, `precision-next-sb`), never persisted and not user-selectable. **G-GEO acceptance allocates no version.** Plan: v2 = G-GEO fixes + G-SB graph, allocated at G-SB acceptance; the fresh holdout is spent once, by that joint qualification. If G-SB defers, the maintainer decides explicitly (RFC §12.2) |
| `presetVersion` (`TraceRequest`) | engine | Bumped on any default change; old versions keep working |
| `packetVersion` | C3 | 1 |
| scene version | engine | v1 for export and interchange; v2 only for a needed capability, with dual-format regression |
| `documentSchemaVersion` | G-DOC | 1, forward-only deterministic migrations |
| container `formatVersion` | C7 | 1 |
| operation versions (recipes) | per operation | Migrations in Rust |

Recipes and projects record every version they depend on; nothing is migrated silently.

## C7 — `.vectra` container v1
The layout is in RFC §14. Normative limits:

| Item | Limit |
|---|---|
| Header JSON | ≤ 1 MiB |
| Sections | ≤ 4,096, non-overlapping, in bounds, unique `id` |
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
  - `dirty = currentState !== savedState`: O(1), with no hashing per edit. Saving or loading sets `savedState = currentState`.
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
   - The effective clip is then an axis-aligned rectangle, computed in f64 from the transformed corners (min/max).
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
   - **Runs may be empty.** A visible Group or Layer with no visible PathObject children yields one run with no items, so an unedited empty packet group round-trips. (The regression corpus has no empty groups, checked at G-0 closure.)
   - A run whose effective clip is empty is omitted entirely, because scene v1 rejects zero-area clips.
   - The run `id` is the Group's `name` when it is a valid scene-v1 id not used by an earlier run; otherwise it is `run-<k>`. So an unedited P0 trace keeps its original group id and hashes.
7. **Outside P1.**
   - Arbitrary path clips and rotated or skewed rect clips require scene v2 (RFC §6.1), with dual-format regression. They come in P2-A, or earlier only after qualification.
   - P1 presets emit no clips. Halftone (P2) emits an artboard rect clip, so the rotated-clip decision (scene v2, or keeping the rejection rule) must be taken before Halftone ships.

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
