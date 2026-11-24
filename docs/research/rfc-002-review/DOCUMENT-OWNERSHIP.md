# RFC-002 review R01 (part 1) — document ownership and minimum contracts

Companion: [GEOMETRY-TRANSPORT-BENCHMARK](GEOMETRY-TRANSPORT-BENCHMARK.md) (measurements), [WORKER-SCHEDULING-AND-RECOVERY](WORKER-SCHEDULING-AND-RECOVERY.md) (termination evidence).

**Recommendation.** Option 1, the main-thread authoritative document with immutable geometry chunks (RFC D01), with the contracts in §4. Options 2 and 3 add contexts and round trips without solving a measured problem. Option 4 (a render worker) is a recorded escape hatch, not a P1 design.

## 1. Options compared
| Consideration | 1. Main-thread document + immutable chunks (RFC) | 2. Persistent document worker + disposable compute worker | 3. Worker-owned geometry + recoverable snapshots | 4. (narrow) Option 1 + an OffscreenCanvas render worker holding a cache copy |
|---|---|---|---|---|
| React overhead | Narrow selectors over a plain TS store; no per-anchor state | Every inspector, layer or selection read is async | Same as 2, plus snapshot sync | Same as 1 |
| Hit test and selection | Synchronous, on-thread index (0.0004–0.002 ms warm p95 [measured]) | Round trip per pointer event, or a duplicated index | Round trip | Same as 1 (index on main) |
| Main-thread memory | Chunks (~45 B/anchor) + index + Path2D cache | Small | Small | Same as 1, plus a worker copy (2× geometry) |
| WASM linear memory | Compute worker only; recyclable | Document worker WASM can never be recycled without serializing | Same as 2 | Same as 1 |
| Buffer ownership and detachment | Committed buffers never transferred; job copies only (adversarial demo: a transfer detaches the committed buffer [measured]) | Two-hop transfers; ownership ping-pong | Snapshots must be complete copies | Copy per scene to the render worker |
| Structured clone / transfer | One transfer per job result (<1 ms) | Two per result, plus per-read messages | Two | One extra transfer per scene |
| wasm-bindgen copies | One copy out of linear memory per result array | Same, plus document-worker copies | Same | Same |
| Immutable storage, undo sharing | Chunk refcounts in one heap; trivial sharing | Lives in the document worker; UI mirrors needed | Snapshots duplicate history | Same as 1 |
| Crash recovery | Compute crash loses only the job (R03: 16/16 in 3 engines) | A document-worker crash loses everything unless it is also snapshotted | Recover from the last snapshot; edits since are lost | Render worker crash: re-send the cache copy |
| Offline cancellation | Terminate and recreate the compute worker (SW-served; R03 offline 16/16) | Must never terminate the document worker, so cancellation needs a second worker anyway | Termination destroys authority unless snapshotted | Same as 1 |
| Persistence | Serialize the main-thread store directly | Message the worker to serialize | Serialize the snapshot | Same as 1 |
| Multiple sources | Assets in one store with aggregate accounting | Split accounting | Split | Same as 1 |
| Complexity | Lowest | High (three contexts, a protocol for every read) | High; reduces to option 1 once snapshots are complete | Medium; only if main-thread rendering misses budget |

## 2. Copy chain: today vs proposed [source inspection; costs measured where noted]
**Today: trace result to preview** (`packages/vector-engine-wasm/src/lib.rs`, generated glue `pkg/vector_engine_wasm.js`, `src/workers/vectorize.worker.ts`, `useWorkbench.ts`):
1. Rust `Scene` → `serde_json` `String` (A), and `to_svg` `String` (A′).
2. `#[wasm_bindgen(getter_with_clone)]`: every getter clones the `String` in linear memory (B, B′).
3. `getStringFromWasm0` → `TextDecoder.decode` into a JS string (C, C′). Measured equivalent: 1.9–2.9 ms for 40–58 MB in Node (warm p50).
4. `postMessage` structured-clones both strings to the main thread (D, D′): 5.0–7.3 ms for 40–58 MB in Node `structuredClone`; 0–11 ms delivery in browsers.
5. Main thread: the scene JSON string is retained (for PDF) and never parsed. The SVG string is copied into a Blob (E′), then the browser parses and rasterizes it (F′). This is the TD-PERF-001 freeze.
6. An editor would add `JSON.parse` (G): 104–169 ms at ~1M anchors in Node and 97–198 ms on browser main threads, with a resident heap of 1.06–1.37× the JSON bytes.

**Today: PDF export.**
1. JSON string → `passStringToWasm0` (UTF-8 copy into linear memory) → `serde` parse.
2. PDF `Vec<u8>` → `getArrayU8FromWasm0().slice()` (copy) → `bytes.buffer.slice(...)` in the worker (copy) → transfer.

**Proposed.**
1. Rust builds `Vec<u8>` verbs, `Vec<f64>` coordinates and `Vec<u32>` offsets while constructing the scene (A).
2. Each array returned as a typed array: one copy out of linear memory per array. Measured equivalent `Float64Array.slice`: 1.5–1.6 ms for 42–46 MB.
3. Transfer: zero copies.
4. Single-pass validation: reads only.
5. Committed into the GeometryStore by reference: zero copies.
6. For export, a `jobCopy()` (one copy) is transferred to the worker, then `passArrayF64ToWasm0` copies it into linear memory and a Rust adapter builds a scene v1 for the writers.
7. No SVG string is produced unless exporting.

## 3. What termination can and cannot destroy [measured]
- R03: across 3 engines, online and offline, the compute worker was terminated 3 (v2) to 8 (v1) times per run (cancel, crash, fatal abort, recycle).
  - The committed layer stayed byte-identical: SHA-256 over scene JSON and all packet buffers.
  - Undo and redo restored identical layers afterwards.
- R01 adversarial: transferring a **job copy** leaves the committed packet intact, while transferring the **committed** packet by mistake detaches it (`coords.byteLength` 0).
- The safety property therefore depends on one API rule, and must be enforced by construction, not by review: committed buffers are never placed in a transfer list.

## 4. Minimum viable contracts (proposed for RFC-002 §4/§6)
**GeometryPacket v1** (wire and disk; little-endian on disk):
```text
manifest: { version: 1, width, height, pathCount, verbCount, coordCount,
            styles: [{ fill: RGBA8888|null, paletteId|null, stroke: {color, width}|null, evenOdd }],
            groups: [{ id, clip: {x,y,width,height}|null }] }      // scene-v1 representable
verbs:        Uint8Array(verbCount)        M=0 L=1 C=2 Z=3
coords:       Float64Array(coordCount)     |v| ≤ 1e6, finite
verbOffsets:  Uint32Array(pathCount + 1)   sentinel = verbCount
coordOffsets: Uint32Array(pathCount + 1)   sentinel = coordCount
styleIndex:   Uint32Array(pathCount)       < styles.length
groupIndex:   Uint32Array(pathCount)       < groups.length, non-decreasing (paint order)
```
- **Derived on receipt, never transported:** per-path bounds, subpath starts, anchor count. All come from one validation pass.
- **Validation:**
  - manifest budget check **before allocation** (file and project path);
  - types and lengths; offsets monotonic, in bounds, with a correct sentinel;
  - opcode range and grammar (a segment needs an open subpath); exact arity;
  - finite and range-checked coordinates; reference ranges; the anchor budget.
  - The same adversarial suite (27 cases, `adversarial.mjs`) applies to the TS and Rust validators.
- Ink plates, path clips and object IDs are **not** in the packet: they belong to the document.

**GeometryStore (main thread).**
```text
commit(packet) -> chunkId                 // takes ownership of a freshly received, validated packet
view(chunkId)  -> read-only wrapper       // no raw ArrayBuffer access
jobCopy(chunkIds) -> { packet, transfer } // fresh copies for workers; never committed buffers
retain/release(chunkId)                   // refcount by document + history + pending jobs
bytes()                                   // for aggregate memory accounting
```
Objects reference `(chunkId, pathIndex)`:
- A traced commit creates one chunk.
- A geometry edit or bake creates a new small chunk for the edited objects only.
- Transforms, styles, visibility and order never copy geometry.

**Document v1** (logical schema, RFC §4, with these amendments):
- `PathObject.geometry = { chunkId, pathIndex }`.
- `nextId` high-water mark.
- `SourceAsset.digest` is required (SHA-256), not optional: relink and persistence depend on it.
- No renderer types, no packet internals, no worker handles.

**Protocol v2.** Every job carries `{ jobId, generation, kind, documentRevision, sourceDigest?, operationVersion }`. Every result and error echoes `jobId` and `generation`. Errors are typed, with `fatal`. Acceptance is fail-closed (R03 §2).
