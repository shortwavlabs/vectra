# G-0 — Architecture contracts (frozen for G-ENG and G-DOC)

**Status:** FROZEN on maintainer approval of G-0.

This file holds the **byte-level and API details** that RFC-002 defers to. Architecture, rationale and evidence stay in [RFC-002](../../RFC-002.md); this file does not restate them.

**Change control.** A change to a frozen contract requires three things:
1. a contract version bump;
2. an RFC-002 amendment;
3. maintainer approval.

Additive fields are allowed only where a contract says so.

| ID | Contract | Version | Authoritative here | Architecture in |
|---|---|---|---|---|
| C1 | Identifiers and revisions | 1 | yes | RFC §5.1 |
| C2 | GeometryStore ownership and lifetime | 1 | yes | RFC §5.2 |
| C3 | GeometryPacket | 1 | yes | RFC §6 |
| C4 | Engine API (Rust and WASM) | 1 | yes (shape); signatures finalised in G-ENG | RFC §6, §11.2 |
| C5 | Worker protocol | 2 | yes | RFC §10 |
| C6 | Geometry and algorithm versions | 1 | yes | RFC §12.2 |
| C7 | `.vectra` container | 1 | yes | RFC §14 |
| C8 | Renderer boundary and snapshots | 1 | yes | RFC §8 |
| C9 | Measurement boundaries | 1 | yes | RFC §17 |

## C1 — Identifiers and revisions
- **Node IDs.**
  - Format: ASCII `<prefix>_<decimal>`. Prefixes: `lay` (layer), `grp` (group), `pth` (path object), `src` (source reference), `ast` (source asset), `sty` (style), `pal` (palette entry).
  - At most 64 bytes; regex `^[a-z]{3}_[0-9]{1,15}$`.
  - Allocated from `Document.nextId`, a positive safe integer shared by all kinds, monotonic and **never reused**, including across undo and redo.
- **Chunk IDs.** `chk_<decimal>`, allocated by the GeometryStore from its own monotonic counter. Never reused within a document; persisted in `.vectra`.
- **Geometry reference.** `{ chunkId, pathIndex }`, where `pathIndex` is the 0-based path index inside the chunk's packet. It is immutable, because chunks are immutable.
- **Revisions.**
  - `documentRevision`: a positive safe integer that increments on **every** committed transaction, including undo and redo. Session-scoped; it is not persisted.
  - `renderRevision`: increments on every snapshot sent to the renderer.
  - `jobId`: increments per submitted job.
  - `generation`: increments per worker instance.
  - All are positive safe integers, compared for equality only.
- **Content identity** (for "dirty" and relink): SHA-256 over canonical serialisations. A document is dirty when the content digest differs from the last saved digest.

## C2 — GeometryStore (ownership and lifetime)
```ts
interface GeometryStore {
  commit(packet: ReceivedPacket): ChunkId;        // takes ownership; ReceivedPacket must be validated (C3) and freshly received
  view(id: ChunkId): ChunkView;                   // read-only accessors; NO ArrayBuffer/TypedArray exposure
  derived(id: ChunkId): DerivedMetadata;          // bounds, subpath starts, anchor count (from validation)
  jobCopy(ids: ChunkId[]): { packets: TransferPacket[]; transfer: ArrayBuffer[] };    // fresh copies
  renderCopy(ids: ChunkId[]): { packets: TransferPacket[]; transfer: ArrayBuffer[] }; // fresh copies
  retain(id: ChunkId, owner: OwnerRef): void;     // owner kinds: document | history | snapshot | job
  release(id: ChunkId, owner: OwnerRef): void;
  bytes(): { byOwnerKind: Record<OwnerKind, number>; total: number };
}
```
1. **Private buffers.** `ChunkView` exposes element reads and iteration only. Attempting to obtain the underlying buffer is a type error, and a runtime assertion fails in tests.
2. **The only route to a transfer list** is `jobCopy` or `renderCopy`, which return new buffers.
3. **Refcounts per owner kind.** A chunk is freed exactly when every count reaches 0, at the end of the transaction or job settle that drops the last owner.
4. **No copies for cheap edits.** Transforms, recolours, visibility, lock, rename, reorder, reparent and group/ungroup never call `commit`, `jobCopy` or `renderCopy`.
5. **One chunk per result.** Each trace commit, bake or geometry-operation result yields exactly one new chunk containing only the affected objects' paths.
6. **Ledger reporting.** `bytes()` feeds the resource ledger (RFC §11.3). Byte counts are the exact sums of buffer lengths.
7. **Tests (G-DOC):**
   - a committed buffer is never detached after any number of jobs and terminations;
   - refcount property tests over random command, undo and redo sequences;
   - zero copies for structural commands, measured by counting buffer allocations.

## C3 — GeometryPacket v1
**Manifest** (JSON-compatible object; carried alongside the buffers in messages and stored as a JSON header in files):
```text
{ packetVersion: 1,
  width: f64 (0 < w ≤ 16384), height: f64 (0 < h ≤ 16384),
  pathCount: u32, verbCount: u32, coordCount: u32,
  styles: [ { fill: u32 RGBA8888 | null, paletteId: string | null,
              stroke: { color: u32 RGBA8888, width: f64 (0 < w ≤ 1000) } | null,
              evenOdd: bool } ],                // ≤ 65,536 entries
  groups: [ { id: string (scene-v1 id rules), clip: { x, y, width, height } | null } ]   // ≤ 65,536
}
```
**Sections**, in this order:

| # | Section | Element | Count | Constraint |
|---|---|---|---|---|
| 1 | verbs | u8 | verbCount | 0=M, 1=L, 2=C, 3=Z |
| 2 | coords | f64 IEEE-754 | coordCount | finite, \|v\| ≤ 1e6 |
| 3 | verbOffsets | u32 | pathCount+1 | [0]=0, [n]=verbCount, strictly increasing per path (no empty path) |
| 4 | coordOffsets | u32 | pathCount+1 | [0]=0, [n]=coordCount, non-decreasing |
| 5 | styleIndex | u32 | pathCount | < styles.length |
| 6 | groupIndex | u32 | pathCount | < groups.length, non-decreasing |

**Byte serialisation** (files, any byte stream):
- each section is little-endian;
- each section starts at an 8-byte-aligned offset from the start of the packet byte block;
- offsets are recorded in the header;
- padding bytes are zero.

**In memory**, typed arrays use platform byte order, which is little-endian on all supported targets. Big-endian hosts are unsupported and must be rejected at startup.

**Caps** (defaults; the profile may lower them; checked **before allocation** from the manifest):

| Cap | Default |
|---|---|
| pathCount | ≤ 1,000,000 |
| Anchors | ≤ 1,000,000 product (5,000,000 engine engineering ceiling) |
| Declared bytes, `verbCount + 8·coordCount + 16·(pathCount+1)` | ≤ 512 MiB |

**Validation order** (identical in TS and Rust; first failure wins; error codes shared):

| Step | Check | Code |
|---|---|---|
| 1 | packetVersion | `version` |
| 2 | Manifest fields and caps | `manifest`, `budget` |
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

The anchor count is M, L and C verbs (Z excluded), exactly as `Scene::validate`.

### C3.1 — Authority after commit (packet vs document)
A packet's `styles`, `evenOdd`, `styleIndex`, `groups` and `groupIndex` are **commit-time inputs and provenance**. The commit command (G-DOC) maps them deterministically:

| Packet | Document |
|---|---|
| The whole packet (one chunk) | One new **Layer** (or the replaced layer, on explicit replace) |
| `groups[g]` | One **Group** node per group, in group order; `name` = group id; `clip` → rect `clipRef` |
| Path `i` in group `g` | One **PathObject** `{ chunkId, pathIndex: i }` under that Group, in path order |
| `styles[styleIndex[i]]` | A document style (`styleRef`): fill, stroke, `paletteId` → palette entry. `fillRule` = `evenOdd ? "evenodd" : "nonzero"` on the PathObject |

After commit, the **document is authoritative** for style, fill rule, transform, visibility, lock, order and clip. Renderers (C8) and exporters (C5 `export`) receive **effective** values in a draw list and must not treat packet style tables as authority. The container (C7) stores chunks unchanged, including their provenance tables, and stores authoritative values in the document section.

**Derived metadata** (from the same pass; never transported):
- `bounds: f64[4·pathCount]` (control-point bounds);
- `subpathStart: u32[]` (verb index of each M);
- `anchors: u32`.

**Determinism and conformance.**
- Native and WASM builds produce byte-identical packets.
- `Scene → Packet → Scene` round-trips **losslessly** for every scene v1 in the regression corpus (with `SceneMeta`: background, palette, metadata).
- The shared adversarial suite lives in one fixture directory, created in G-ENG and seeded from the review's 27 cases. Both validators must return identical codes per case.

## C4 — Engine API (shape; exact signatures finalised and reviewed in G-ENG)
**Rust (`vector-engine`).** The public, documented API exposes no VTracer or visioncortex types:
```text
vectorize(rgba, w, h, &TraceRequest, clock) -> Result<Output>            // unchanged (scene v1), byte-identical
GeometryPacket::from_scene(&Scene) -> GeometryPacket                     // lossless for scene v1
Scene::from_packet(&GeometryPacket, &SceneMeta) -> Result<Scene>
validate_packet(&GeometryPacket, &Limits) -> Result<Derived, PacketError>  // codes = C3
bake_draw_list(&DrawList, &[GeometryPacket]) -> Result<Scene>            // export: applies effective transforms (f64), styles, fill rules, clips; visible items only; identity + unchanged style ⇒ original coordinates bit-identical
segment(rgba, w, h, &TraceRequest) -> Result<Segmentation>               // opaque Vectra-owned handle
estimate(&Segmentation, &TraceRequest) -> Estimate { anchors_low, anchors_high, basis }
fit(Segmentation, &TraceRequest, clock) -> Result<Output>                 // == vectorize output, byte-identical
```
- Limited and halftone modes get staged estimators, or an explicit "no estimate", in G-ENG.
- `segment_layers` and `vectorize_with_precision_options` move behind a `diagnostics` cargo feature (TD-ARCH-004).

**WASM (`vector-engine-wasm`, worker only).**
```text
vectorizePacket(rgba, w, h, requestJson) -> { manifestJson, verbs, coords, verbOffsets, coordOffsets,
                                             styleIndex, groupIndex, sceneMetaJson, reportJson }   // one copy out per array
validatePacket(manifestJson, ...arrays) -> derived | throws {code, message}
exportDrawList(format, drawListJson, sceneMetaJson, optionsJson, ...packets) -> string | Uint8Array  // via bake_draw_list → scene v1 → writers
packetToSvg / packetToPdf (single-packet convenience, used for the byte-identity regression)
segment/estimate (handle-scoped to the worker instance)
```
- The existing `vectorize`, `sceneToSvg` and `sceneToPdf` stay until G-EXP shows byte-identical packet-route exports over the regression corpus.

## C5 — Worker protocol v2
**Common rules.**
- The handshake `ready` message carries `{protocolVersion: 2, buildId, engineVersion, packetVersion: 1}`. A mismatch is fatal.
- Every request carries `{jobId, generation, kind, documentRevision, operationVersion}`. Every response echoes `jobId` and `generation`.
- Unmatched responses are dropped, and the drops are counted in diagnostics.

**Compute worker.**
- **Requests:** `trace{rgba(transfer), width, height, request, quality: "preview"|"final", sourceDigest}`, `estimate{...}`, `op{opId, opVersion, params, inputs: TransferPacket[], sideInputs}`, `export{format: "svg"|"pdf", drawList (effective transform, style, fillRule, clip; visible items in paint order), chunks: TransferPacket[] (job copies), sceneMeta, options}`.
- **Responses:**
  - `status{state}`;
  - `progress{stage: "segment"|"estimate"|"fit"|"validate"|"serialize"}`, staged only; **no fabricated percentages**;
  - `result{packet(transfer)|bytes(transfer), metrics, warnings, memoryBytes}`;
  - `error{code, message, fatal}`.

**Render worker.**
- **Requests:** `init{canvas(OffscreenCanvas transfer), dpr, cssWidth, cssHeight}`, `snapshot{renderRevision, documentRevision, drawList, packets(transfer, new chunks only), releaseChunks}`, `camera{...}`, `gesture{phase: "start"|"end"}`, `resize{...}`, `release`.
- **Responses:** `ready{workerRaf}`, `frame{renderRevision, kind: "interaction"|"exact", ms}`, `error{code, fatal}`.

**Scheduling semantics** are normative in RFC §10.3. In summary:
- only previews and thumbnails are pre-emptible;
- a worker is never terminated before its job is posted;
- start-up timeout, then requeue once;
- explicit cancel only for apply, final and export.

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
| Geometry section | ≤ packet caps (C3) |

**Integrity.**
- SHA-256 over the **uncompressed** section bytes, verified before parsing.
- This gives integrity, not authentication.

**Loading.**
- Inflation is streamed and aborted beyond `uncompressedLength`.
- Unknown fields are rejected.
- Loading is atomic: the new document is built off to the side and swapped in only on success.
- An unknown or newer `formatVersion`, `documentSchemaVersion` or `packetVersion` is refused with a typed error.

**Determinism.** Fixed section order (manifest, document, geometry by chunkId, source by assetId), no clocks or file names, fixed codec parameters. save → load → save is byte-identical.

**Tooling.** `vectra-dump` (a G-DOC deliverable) prints the header, sections, hashes, the manifest and packet summaries.

## C8 — Renderer boundary and snapshots
```text
RenderSnapshot { renderRevision, documentRevision, dpr, cssWidth, cssHeight, camera {s, tx, ty},
                 drawList: [ { chunkId, pathIndex, transform /* 2×3 f64, effective */,
                               fill: u32|null, stroke?, evenOdd /* from the document fillRule */, clip?: {x,y,w,h}, groupRun: u32 } ],  // paint order; effective values per C3.1
                 selection?: { runs: [ [startIndex, endIndex) ] } }
```
- Snapshots are immutable once sent. The renderer receives packet render copies only for chunks it does not hold, and is told when to release chunks.
- **Imports:** `src/renderer/**` may import only `src/renderer/**`, the snapshot and packet **read** types, and the standard library. An architectural test fails on any import of document mutation modules (`src/document/commands`, `store` writers) or export modules.
- **Frame kinds** (`interaction` | `exact`) are reported per frame. Tests and owner review use `exact` frames only.

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

**Every report states:** browser and version, headed or headless, DPR, viewport, workload hash, rep count, machine, and **machine load**. Clean runs must show no unrelated CPU-bound processes.
