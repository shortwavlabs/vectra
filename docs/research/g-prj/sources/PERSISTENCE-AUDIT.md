# G-PRJ-R persistence inventory (read-only audit)

- Tree: `.claude/worktrees/g-prj-r`, branch `gate/g-prj-r`, HEAD `276c1ec` (= main). No repository file was edited.
- All `file:line` refs are to that tree. "Measured here" means computed by this audit with `node -e` over the committed golden file. Nothing was benchmarked.
- **Excluded:** `scripts/g-prj/` (`compact-document.mjs`, `inspect-workloads.mjs`, `persistence-limits.mjs`). These files are **untracked** (`git status`: `??`), were created 21:00–21:02 today by concurrent work, and are not part of `276c1ec`.

---

## 0. One-paragraph answer
A complete, strict, bounded `.vectra` v1 serializer and loader exist and are well tested: unit tests, golden bytes, a frozen hash, a three-engine Playwright suite, real Safari and a document export regression (636 hash checks = scenes × 3 files × 2 codecs; 576/576 after privacy exclusions, per the G-DOC-R report). Session dirty tracking by state identity also exists. **None of it is reachable from the product UI.**
- There is no Open, Save or Save As, and no `.vectra` input.
- `loadContainer` is reachable only through `?debug=1` qualification hooks.
- In the product shell, `saveContainer` is reachable nowhere. In the workbench it is called by a debug digest probe.
- There is no browser storage of any kind (IndexedDB, OPFS, File System Access, localStorage, `navigator.storage`, BroadcastChannel, locks, `beforeunload`). The only exception is the service worker's Cache API for build assets.
- The product import path never attaches a source asset. Source sections, embedding and relink are therefore implemented, but unreachable from the workspace.

---

## 1. `.vectra` container — `src/persistence/container.ts`

### 1.1 Format
- Layout comment (`:3-8`): `magic "VECTRA\0\x01" | u32 LE header length H | header JSON (canonical, H ≤ 1 MiB) | sections`.
  - Section `offset` is relative to the first byte after the header.
  - Sections are contiguous, in the fixed order manifest, document, geometry by chunk number, source by asset number.
  - `sha256` is computed over the **uncompressed** bytes. Compressed bytes are not canonical.
- `MAGIC` = `56 45 43 54 52 41 00 01` (`:20`); `FORMAT_VERSION = 1` (`:21`).
- `Codec = "none" | "deflate-raw"` (`:22`); `SectionKind = "manifest" | "document" | "geometry" | "source"` (`:23`).
- Header shape: `ContainerHeader { formatVersion: 1; sections: SectionEntry[]; dataStart }`. `dataStart` (12 + H) is computed, not stored (`:71-76`).
- `SectionEntry { id, kind, codec, offset, length, uncompressedLength, sha256 }` (`:62-70`).
- Manifest section content, a constant (`:243`): `{ app: "vectra", formatVersion: 1, documentSchemaVersion: 1, packetVersion: 1 }`.

### 1.2 `CONTAINER_LIMITS` (`:26-33`, frozen)
| Field | Value | Note |
|---|---|---|
| `maxHeaderBytes` | `2 ** 20` (1 MiB) | C7 |
| `maxSections` | `4096` | C7 |
| `maxManifestBytes` | `2 ** 20` | comment: "not in C7's table" (`:29`) |
| `maxDocumentBytes` | `64 * 2 ** 20` (64 MiB) | C7 |
| `maxSourceBytes` | `20 * 2 ** 20` (20 MiB) | C7 |
| `sessionBudget` | `512 * 2 ** 20` (512 MiB) | C7 "profile session budget (default 512 MiB)" |

- **Geometry section cap** (`checkLimits`, `:151`): `packetLimits.maxBytes + MAX_MANIFEST_BYTES + 24`.
  - With defaults this is 512 MiB + 16 MiB + 24 B: `PRODUCT_LIMITS.maxBytes = 512 * 2 ** 20` (`src/geometry/packet/types.ts:107-111`) and `MAX_MANIFEST_BYTES = 16 * 2 ** 20` (`types.ts:8`).
- **Related caps enforced elsewhere:**
  - `MAX_EMBEDDED_SOURCE_BYTES = 20 * 2 ** 20`, checked at `attachSource` (`src/document/session.ts:96`, `:444-448`).
  - `DEFAULT_DOC_LIMITS`: `maxAnchors 1_000_000`, `maxNodes 2_000_000`, `maxDepth 64`, `maxNameLength 256` (`src/document/invariants.ts:35-40`).
  - Packet `PRODUCT_LIMITS`: `maxPaths 1_000_000`, `maxAnchors 1_000_000` (`types.ts:107-111`).

### 1.3 Error codes
- `ContainerErrorCode` (`:35-48`) has 13 values: `truncated`, `magic`, `header`, `version`, `section`, `codec`, `limit`, `inflate`, `sha256`, `manifest`, `document`, `packet`, `source`.
- `ContainerError` carries `code` and an optional `detail` holding the underlying packet, document or intake code (`:50-60`).
- Packet failures are mapped by `packetFail` (`:256-259`): a packet `version` code becomes container `version`; any other code becomes `packet` with `detail` = the packet code.
- A `SchemaError` becomes `version` when it is a version refusal, otherwise `document` (`:289`).
- A `DocumentError` from the session constructor becomes `document`, with `detail` = the DocumentError code (`:348`).

### 1.4 What `readHeader` validates (`:91-146`; allocates nothing per section)
- Length ≥ 12, else `truncated` (`:92`). Magic, else `magic` (`:93`).
- H ≤ 1 MiB, else `header` (`:95`). 12 + H within the file, else `truncated` (`:96`).
- The header is **strict canonical JSON** (`:97-98`). `formatVersion === 1`, else `version`, checked before the key check (`:100-101`).
- The header holds exactly `{formatVersion, sections}` (`:102-103`); ≤ 4,096 sections (`:105`).
- Each entry:
  - has exactly the 7 keys (`:88`, `:111`) and a unique `id` (`:115`);
  - has a known `kind` (`:117`) and a known `codec`, else `codec` (`:119-120`);
  - has safe non-negative integer sizes (`:121`) and `sha256` matching `^[0-9a-f]{64}$` (`:86`, `:123`).
- Order: entry 0 is `manifest`/`manifest`, entry 1 is `document`/`document`, then only geometry or source (`:126-128`).
- Geometry ids match `^chk_[0-9]{1,15}$`; source ids match `^ast_[0-9]{1,15}$` (`:87`, `:130`).
- No geometry after a source (`:131`); strictly ascending id numbers per kind (`:132-134`).
- `codec none` ⇒ `length === uncompressedLength` (`:136-137`).
- Each `offset` equals the previous section's end: no gap, overlap or reorder (`:138`). A section past EOF is `truncated` (`:140`).
- ≥ 2 sections (`:143`); no trailing bytes (`:144`).

### 1.5 `checkLimits` (`:149-167`)
- Runs on **declared** `uncompressedLength`s before any section is allocated or inflated.
- It applies the per-kind cap (manifest, document, source or geometry) and the total against `sessionBudget`. A failure is `limit`.

### 1.6 Decompression (`inflate`, `:169-213`)
- Input is fed in `INFLATE_CHUNK = 64 * 1024` slices (`:169`, `:174-185`) through native `DecompressionStream("deflate-raw")` (`:188`).
- The output buffer is preallocated to exactly the declared `uncompressedLength` (`:194`).
- A chunk that would exceed it cancels the reader and throws `inflate` "inflates beyond its uncompressedLength" (`:200-203`). This is the bomb guard.
- A corrupt stream is `inflate` (`:207-209`); short output is `inflate` (`:211`).
- `deflate` (`:215-225`): `Blob.stream()` → `CompressionStream("deflate-raw")` → `Response.arrayBuffer()`. It takes no parameters, and its output is not deterministic across engines (C7).

### 1.7 `readSection` (`:231-241`)
- Inflates if needed, then verifies SHA-256 **before any parse**, else `sha256`.
- With `codec none` the result is a view into the input bytes; consumers copy.

### 1.8 `loadContainer(bytes, o: LoadOptions)` (`:275-355`)
- `LoadOptions { packetLimits?, limits?, history?, sessionBudget? }` (`:261-266`).
- The doc comment (`:270-274`) says it is atomic: a new `GeometryStore` and `DocumentSession` are built off to the side and returned only on success.

Order of operations, exactly as coded:
1. `readHeader` (`:277`), then `checkLimits` with `o.sessionBudget ?? 512 MiB` (`:278`).
2. **Every** section is read, inflated and hashed into memory before anything is parsed (`:279-280`). The whole input file is one `Uint8Array`; nothing is streamed from disk. A newer `documentSchemaVersion` or `packetVersion` in the manifest is therefore detected only after every section has been inflated and hashed.
3. `checkManifest`, a canonical JSON check (`:245-253`):
   - each of `formatVersion`, `documentSchemaVersion` and `packetVersion` must be 1, else `version`;
   - the keys must be exactly the `MANIFEST` keys, and `app === "vectra"`, else `manifest`.
4. Document section:
   - `parseCanonicalJson`, else `document` (`:283-284`);
   - then `parseDocumentJson`, whose `SchemaError` is mapped to `version` or `document` (`:285-291`).
5. A new `GeometryStore({ limits: packetLimits })` (`:293`).
6. For each geometry section:
   - `decodeRecord(data, packetLimits)`, with failures through `packetFail` (`:299-300`);
   - its chunk number must be below `nextChunkId`, else `document` (`:302-303`);
   - it must not go backwards, else `section` (`:304`);
   - `store.advanceChunkCounter(n)` (`:305`), then `store.commit(r.packet)`, commented "C2: the file → store trust boundary" (`:307`).
7. For each source section:
   - the asset must exist with `embedded: true`, else `document` (`:314-315`);
   - its bytes are copied (`:316`);
   - `sniffImage` must agree with the asset's `mime`, `width` and `height`, else `source`, with the `IntakeError` code as detail (`:317-328`);
   - its SHA-256 must equal `asset.digest`, else `source` (`:329`).
8. Every embedded asset must have a source section, else `document` (`:333-335`).
9. `store.advanceChunkCounter(parsed.nextChunkId)` (`:336`).
10. `new DocumentSession(store, { state, nextId, sources, limits?, history? })` (`:338-350`). The constructor runs the **full** `validateState` (`session.ts:148`); `incremental-validate.test.ts:44` asserts that load always takes the full pass.
11. Every geometry section must still be referenced, because the constructor freed unreferenced chunks; else `document` (`:351-353`).

- The new session starts **clean, with no history, at revision 1** (§3).
- Product callers: none. Debug callers only (§4.6).

### 1.9 `saveContainer(session, { codec? })` (`:364-436`)
- The default codec is `deflate-raw` (`:368`). One codec applies to **all** sections, including source sections that already hold PNG, JPEG or WebP bytes (`:403`).
- It captures `state = session.state` (`:369`). All plain section bytes are built **synchronously** before the first `await` (`:377-391`):
  - the manifest: `canonicalJsonBytes(MANIFEST)`;
  - the document: `canonicalJsonBytes(documentJson(state, session.nextId, store.nextChunkId))` (`:382`);
  - the geometry: `store.encodeRecord(id)` (`geometry-store.ts:342-344`) for each chunk referenced by the **current state only**, sorted by number (`:372`, using `session.derivedOf(state).chunks`). Chunks retained only by history are not written;
  - the sources: `session.sourceBytes(id)` for assets with `embedded: true` only, sorted by number (`:373-376`, `:385-390`). A missing embedded source throws `ContainerError("source")` (`:387-388`).
- SHA-256 runs per section. Geometry digests are cached in a module-level `WeakMap<GeometryStore, Map<ChunkId, string>>` (`:357`, `:392-402`), keyed by immutable chunk.
- Pre-write checks happen **after** all hashing and deflating (`:416-424`):
  - ≤ 4,096 sections, header ≤ 1 MiB;
  - `checkLimits` with `DEFAULT_PACKET_LIMITS` and `CONTAINER_LIMITS.sessionBudget`, not the session's or loader's options;
  - the comment reads "Never write a file the strict loader would refuse" (`:417`). This is how the 72.7 MB document section is refused with `limit` (TD-PERF-009).
- Output is one contiguous `Uint8Array` built from the stored bodies (`:425-433`). Peak memory holds the plain sections, the stored bodies and the output at once.
- **`session.markSaved(state)` (`:434`) runs inside `saveContainer`**, as soon as the bytes exist: before any write to disk or download, and with no verify-by-reload. The caller cannot separate "serialized" from "saved".
- An edit during the async part does not change what is saved, and the session stays dirty, because `markSaved` receives the older captured state. This is tested at `container.test.ts:247-259`.
- Product callers: none. The workbench debug probe `documentDigest` (`src/workspace/qualification.ts:164`) calls it, so that probe also marks the workbench document clean.

### 1.10 Strict document schema — `src/persistence/document-json.ts`
**Reader** `parseDocumentJson` (`:167-254`):
- `documentSchemaVersion === DOCUMENT_SCHEMA_VERSION` (1, `model.ts:105`) is checked first; a mismatch is `SchemaError(version = true)` (`:168-170`).
- Exact required top-level keys, none optional (`:171-182`): `documentSchemaVersion, documentId, nextId, nextChunkId, artboard, orderedRootIds, nodesById, stylesById, paletteById, sourceAssetsById`.
- `obj()` rejects missing **and unknown** members (`:40-53`).
- Artboard: `{width, height, background: number|null}` (`:187-192`).
- Style: `{id, fill: number|null, paletteRef: string|null, stroke: {color, width}|null}` (`:193-204`).
- Palette: `{id, name, color}` (`:205-208`).
- SourceAsset: required `id, digest, mime, width, height, embedded, decodePolicy`, optional `provenance` (`:209-228`).
- Nodes (`parseNode`, `:93-139`):
  - `COMMON = id, kind, name, visible, locked, localTransform` (`:79`);
  - layer and group add `orderedChildIds`; path adds `geometry, styleRef, fillRule`; source adds `assetId, sourceToDocument` (`:80-91`);
  - optional `clipRef` is parsed for every kind, `traceProvenance` for layers only (`:101`).
- `nextChunkId` is a positive safe integer ≤ `MAX_CHUNK_NUMBER + 1` (`:230-232`; `MAX_CHUNK_NUMBER = 999_999_999_999_999`, `model.ts:183`). `nextId` is a positive safe integer (`:251`).
- `traceProvenance.chunkId` must be below `nextChunkId` (`:233-240`).
- Entries are frozen; maps become `NodeMap` or sealed maps (`:241-250`).
- **The parse level is shallow by design:**
  - `mime` and `decodePolicy` are only `as`-cast (`:219`, `:223`), and `digest` is a plain string (`:218`). Their semantic checks are in `validateState` (§1.11).
  - A `clipRef` on a path or source passes the parse and is rejected later with `clip_unsupported` (`invariants.ts:146-151`).
- **Open (not strict) JSON inside provenance:**
  - `traceRequest.settings` must be an object with a string `mode`; the whole `traceRequest` is ≤ 64 KiB canonical (`provenance.ts:127-130`);
  - `originalScene.metadata.params` is any object (`provenance.ts:182`).
  - These are the only exceptions to "unknown fields rejected".

**Writer** `documentJson(s, nextId, nextChunkId)` (`:256-272`):
- Each node is written as `{ ...n, localTransform: [...n.localTransform] }` (`:259`), i.e. **every own property** of the in-memory node.
- An optional member is omitted only when it is absent or undefined, because the canonical writer skips `undefined` (`canonical-json.ts:44`).
- Styles, palette and assets are written with `Object.fromEntries` (`:268-270`).

### 1.11 Load-time semantic checks — `validateState` (`src/document/invariants.ts:78-211`)
Run by the session constructor:
- **Document:** `documentId` matches the scene-v1 id regex `^[A-Za-z0-9_-]{1,64}$` (`:83`; `model.ts:131`). The artboard is `0 < w,h ≤ 16,384`, with `background` u32 or null (`:84-87`).
- **IDs** (`claimId`, `:91-98`):
  - the map key must equal the `id` (`:92`), and the id must match `^[a-z]{3}_[0-9]{1,15}$` with the prefix of its kind (`:93`);
  - id numbers are unique **across all kinds**: `pal`, `sty`, `ast` and the node kinds (`:95`);
  - `maxIdNumber` is tracked so that `nextId` must exceed it (`session.ts:149-151`).
- **Palette:** `name` follows the scene id rule; the colour is u32 (`:100-104`).
- **Style:** u32 fill; the palette reference resolves; `fill` and `paletteRef` are exclusive; at least one of fill, palette or stroke; stroke width in `0 < w ≤ 1000` (`:105-119`).
- **Asset:** digest `^[0-9a-f]{64}$`; MIME in `{image/png, image/jpeg, image/webp}`; integer dimensions 1–16,384; boolean `embedded`; `decodePolicy` in `{"browser-canvas-v1","external"}`; provenance `{kind:"local-file"}` (`:120-130`).
- **Nodes:**
  - ≤ `maxNodes` (`:132`);
  - name ≤ 256 chars and no lone surrogates (`:137-142`); boolean flags (`:143`);
  - `transformProblem`: finite, |v| ≤ 1e9, non-singular, κ ≤ 1e8 (`:144-145`; `model.ts:221-240`);
  - clip rules (`:146-154`);
  - path chunk exists, `pathIndex` in range, `styleRef` resolves, `fillRule` valid (`:155-164`);
  - source `assetId` resolves and `sourceToDocument` is valid (`:165-168`);
  - `checkTraceProvenance` on layers (`:170-171`).
- **Tree:** root holds layer or source, containers hold group or path; depth ≤ 64; no cycle or second parent; no orphan; composed transforms finite; clip under an axis-preserving transform (`:176-203`).
- **Anchors:** ≤ `maxAnchors`, counted per reference; else `budget` (`:205-209`).

### 1.12 Canonical JSON — `src/persistence/canonical-json.ts`
- Rules (`:1-6`): RFC 8785 (JCS); members sorted by UTF-16 code units; ECMAScript number form (`-0` written as `0`); `JSON.stringify` escaping; no whitespace; `undefined` omitted. Non-finite numbers and lone surrogates throw.
- Writer: `write` (`:21-51`), `canonicalJsonBytes` (`:58-59`).
- Strict reader `parseCanonicalJson` (`:87-98`):
  - fatal UTF-8 with `ignoreBOM: true`, so a BOM is kept and then fails the equality check;
  - then `JSON.parse`, and the text must equal `JSON.stringify(value)`;
  - no surrogate escapes (`:75`), and every object's keys strictly sorted (`:62-72`);
  - array-index member names are refused, as documented (`:83-84`);
  - returns `null` on any failure, which callers map to their own code.
- This reader is the linear-time version credited in P1A §7.2 (line 147).

### 1.13 What is serialized vs not
**Serialized:**
- **Document section:** `documentSchemaVersion`, `documentId` (a `crypto.randomUUID()` by default, `model.ts:192`), `nextId`, `nextChunkId`, `artboard`, `orderedRootIds`, `nodesById`, `stylesById`, `paletteById`, `sourceAssetsById`.
- **Nodes:** layers, groups, paths and sources with names, visibility, lock, transforms, clips and order (arrays in document order). Each path has `geometry {chunkId, pathIndex}`, `styleRef` and `fillRule`.
- **Styles:** fill (u32), palette reference and stroke. **Palette:** `{id, name, color}`.
- **Provenance:** `traceProvenance` per traced layer (C10 shape, `provenance.ts:41-61`). It carries `engineVersion`, `presetVersion`, `seed`, `fitMode`, `precisionFitVersion`, `traceRequest` and `originalScene` (palette and metadata).
- **Sources:**
  - embedded (`embedded: true`): original bytes in a `source` section;
  - referenced (`embedded: false`): metadata only (`digest`, `mime`, dimensions, `decodePolicy`, provenance), with no section. Tested at `container.test.ts:227-245`.
- **ID high-water marks:** `nextId` (`session.nextId`) and `nextChunkId` (`store.nextChunkId`) (`document-json.ts:263-264`, `container.ts:382`).
- **Geometry:** one C3.0 record per chunk referenced by the current state.
- **Metadata:** only the manifest's app name and versions, plus each layer's provenance. No clocks, file names, build id or app version are stored at container level.
  - Observation, not resolved here: the shell names a traced layer after the imported file's basename (`src/shell/jobs.ts:134` → `commands.ts:429`). That `name` is document data and is serialized.

**Not serialized:**
- **Session state:** `revision` (`session.ts:129`, reset to 1 per session); undo and redo stacks (`#past`, `#future`, `:126-127`); `#saved`; `historyTruncated`; coalescing state; `#deltas` and `#derived` caches; validation counters.
- **Store state:** owner counts (document, history, snapshot, job), the digest cache, and chunks referenced only by history.
- **Bytes not embedded:** source bytes of non-embedded assets.
- **UI state:** selection (React state, `Workspace.tsx:265`), camera and zoom (`:307`), tool and preset (`:279`, `:301`), panel layout (no persistence hook used), export dialog name and size (`:1047-1050`).
- **Document title:** none exists. The title is the literal "Untitled artwork" (`:588`); the schema has no document-name field.
- **Runtime state:** renderer caches, Path2D, render copies, job queue, reservations and worker state.
- C7 (`:404`): "`documentRevision`, history, camera and selection are not persisted." RFC §14 (`:783`): "Not stored: history, camera, selection, caches, decoded pixels, URLs, clocks, file names."

### 1.14 Fields always written, whatever their value (input for compact encoding)
No contract defines "canonical defaults". C10 (`:478`) makes every listed member required. The table lists what is written unconditionally and the value commands create, which is what dominates real documents.

| Entity | Always written | Value at creation (source) |
|---|---|---|
| every node | `id` (duplicates the map key; enforced equal, `invariants.ts:92`) | — |
| every node | `kind` (implied by the id prefix; enforced, `invariants.ts:93,136`; `model.ts:132`) | — |
| every node | `name` | path `""` (`commands.ts:400`); group = packet group id (`:414`); layer `c.name ?? "Trace"` (`:429`), the file basename from the shell; `group` command `"Group"` (`:632`); source `"Source"` (`:463`) |
| every node | `visible` | `true` (`commands.ts:401,415,430,464,633`) |
| every node | `locked` | `false` for path, group and layer (`:402,416,431,634`); **`true` for source** (`:465`) |
| every node | `localTransform` (6 numbers) | `IDENTITY` `[1,0,0,1,0,0]` (`:403,417,432,466,635`); also reset to identity on bake (`:677`) and on replace (`:424`) |
| path | `geometry {chunkId, pathIndex}`, `styleRef`, `fillRule` | `chunkId` is the same for every path of a trace; `fillRule` comes from the packet (`:406`) |
| group / layer | `orderedChildIds` | — |
| source node | `assetId`, `sourceToDocument` | `sourceToDocument` = `IDENTITY` (`:468`) |
| style | `id`, `fill`, `paletteRef`, `stroke`, all written even when `null` | trace: `fill` null when palette-referenced, `paletteRef` null when literal, `stroke` null when absent (`:380-385`) |
| palette | `id`, `name`, `color` | — |
| asset | `id`, `digest`, `mime`, `width`, `height`, `embedded`, `decodePolicy` (+ `provenance` when set) | `provenance {kind:"local-file"}` from `attachSource` (`session.ts:463`) |
| artboard | `background`, written as `null` when absent | `createDocument`: `background ?? null` (`model.ts:193`) |
| traceProvenance | nullable `fitMode`, `precisionFitVersion`, `originalScene.background` always written | the settings object appears twice, in `traceRequest.settings` and `originalScene.metadata.params` (visible in the golden) |

- **Optional members omitted when absent:** `clipRef` (only when the packet group has a clip, `commands.ts:418`), `traceProvenance`, asset `provenance`.
- **Measured here** on the golden `circle-bw.none.vectra.b64` (`pth_5`, 5-character ids): the path entry is **192 B**.
  - The members equal to their creation value are `visible` 15 B, `locked` 15 B, `name` 10 B and `localTransform` 31 B: **71 B (37 %)**.
  - The redundant members are `id` 13 B and `kind` 14 B: **27 B (14 %)**.
  - The reports cite about **220 B per PathObject** at 250k paths, with longer ids (G-DOC report `:159`; P1A §7.2 `:145`).
  - The 71 B do not grow with id length. Against about 220 B they are about 32 %, which matches the recorded −32 % scratch result. This is a golden-only measurement.
- **Prior evidence:** a scratch "omit default-valued members" experiment cut the document by 32 % and `JSON.parse` time by 21 % (P1A `:148`). TD-PERF-009 (`:993`) notes that its artefacts were not retained.

---

## 2. Contracts and RFC

### 2.1 G0 contracts — `docs/research/g0/G0-ARCHITECTURE-CONTRACTS.md`
- **Change control** (`:11-16`): a contract version bump, an RFC-002 amendment and maintainer approval. "Additive fields are allowed only where a contract says so" (`:16`).
- **Two kinds of version** (`:18`): spec revision `rN` vs serialized version (`packetVersion`, `protocolVersion`, `formatVersion`, `documentSchemaVersion`).
- **Contract table:**
  - C7 is r2, `formatVersion` 1 ("unchanged; unreleased") (`:28`);
  - C10 is r1, `documentSchemaVersion` 1 ("unchanged; unreleased"), `provenanceVersion` 1 (`:31`).
- **C1** (`:33-47`):
  - `nextId` is shared by all kinds and never reused across undo, redo, save and load (`:37`);
  - `nextChunkId` is never reused; both high-water marks are persisted (`:38`);
  - high-water marks are not undoable and take no part in dirty detection (`:39`);
  - `documentRevision` is session-scoped and not persisted (`:42`);
  - content identity is SHA-256 over canonical uncompressed serializations, computed at save time and cached per chunk (`:47`).
- **C7** (`:350-414`):
  - **Limits table** (`:353-362`): header ≤ 1 MiB; sections ≤ 4,096, contiguous, header-relative offsets (AM-1); kinds `manifest` (1), `document` (1), `geometry` (≥ 0, id = chunkId), `source` (≥ 0, **opt-in**, id = assetId); codecs `none` and `deflate-raw`; total declared `uncompressedLength` ≤ the profile session budget (default 512 MiB); **document section ≤ 64 MiB**; **source section ≤ 20 MiB**; geometry section = the C3.0 record within C3 caps.
  - **Integrity** (`:364-366`): integrity, not authentication.
  - **Loading** (`:368-373`): streamed inflation aborted past the declared length; **unknown fields rejected** (`:370`); fresh whole-buffer arrays committed through C2; atomic (`:372`); "An unknown or newer `formatVersion`, `documentSchemaVersion` or `packetVersion` is refused with a typed error" (`:373`).
  - **Forward compatibility:** there is no forward-compatible reading. Newer versions are refused, and unknown fields are rejected.
  - **Canonical content** (`:375-387`): only the TS container code emits container JSON; JCS; ID maps as JCS-ordered objects ("`lay_10` precedes `lay_9`"); fixed section order; no clocks or file names (`:387`).
  - **Determinism** (`:389-398`):
    - `sha256` and `uncompressedLength` are canonical; compressed bytes are not;
    - byte identity holds within one serialization environment, and across all environments with codec `none`;
    - a deterministic codec would need a new codec id and container version.
  - **Persisted state** (`:400-412`):
    - load requires `nextId` > every node-ID number and `nextChunkId` > every chunk number;
    - not persisted: revision, history, camera and selection (`:404`);
    - `dirty = currentState !== savedState`, and "Saving or loading sets `savedState = currentState`" (`:407`);
    - an evicted saved state stays dirty (`:411`).
  - **Tooling** (`:414`): `vectra-dump`, which exists as `scripts/vectra-dump.mjs` and reuses `readHeader` and `readSection`.
- **C6** (`:335-348`):
  - `documentSchemaVersion` gets "Forward-only deterministic migrations after first release" (`:343`); container `formatVersion` is 1 (`:345`);
  - "Recipes and projects record every version they depend on; nothing is migrated silently" (`:348`).
- **C10** (`:472-532`):
  - `documentSchemaVersion` stays 1 because no file has been released; any change after first release needs a version bump and a forward-only migration (`:473-476`);
  - every member is required unless marked `?`, and unknown members are rejected (`:478`); the schema block is at `:479-492`;
  - effect stacks are absent in v1, and their introduction is v2 with "absent → empty stack" (`:498`);
  - source provenance in v1 is `{kind:"local-file"}` or absent (`:499`); `decodePolicy` is a closed enum (`:500-504`);
  - TraceProvenance: shape `:506-522`, storage and validity `:524-532`.
- **AM-2** (`:590-605`): "C2, C7, C10 — Unchanged" (`:599`).

### 2.2 RFC-002 — `docs/RFC-002.md`
- **D08** (`:40`): "Bounded `.vectra` container v1; serializer in P1-A, Save/Open UI in P1-C; no autosave (§14)".
- **Loss handling** (`:111`): "Losing the page loses unsaved work. Explicit Save (§14) is the only persistence in P1."
- **§5.1** (`:133-203`): logical schema; invariants validated on every commit and on load (`:154-161`); "`revision` is session-scoped and not persisted" (`:163`).
- **§7** (`:306-342`):
  - stale preview vs explicit results (`:319-322`);
  - dirty: "computed as **state identity**: `currentState !== savedState`, O(1)… Undo back to the saved state is clean" (`:332`);
  - history budget: 100 transactions and 128 MiB, 64 MiB constrained (`:334-339`);
  - visible truncation (`:340`);
  - "A command that cannot fit is either rejected, or committed without history after explicit confirmation" (`:341`).
- **§10.3** rule 3b (`:510-513`):
  - a final trace into a new layer commits at the current revision if its source digest still matches;
  - a replace or Apply with changed targets is `stale`;
  - exports never go stale (rule 7, `:520`).
- **§11.4** profiles (`:591-603`): history 128 MiB reference, 64 MiB constrained.
- **§14** Project persistence (`:758-815`):
  - layout (`:761-772`; source sections "optional; original compressed bytes only, with explicit user opt-in");
  - preserves (`:774-781`, including "recipe and effect descriptors");
  - not stored (`:783`); loading (`:785-791`);
  - "History is not persisted, and the user is told so on reopen" (`:796`);
  - "Saving never overwrites the original file automatically; each save is a new download" (`:797`);
  - missing sources and relink (`:800`); determinism (`:802-807`);
  - placement: "Save/Open UI in **G-PRJ (P1-C)**" (`:811`);
  - browser APIs: "File input and Blob download… File System Access is an optional, Chromium-only enhancement. OPFS and IndexedDB are only for future opt-in work" (`:813`);
  - "**Excluded from P1:** autosave, persistent undo history, project libraries, recent-file databases, automatic OPFS or IndexedDB artwork persistence, cloud storage" (`:815`).
- **§15.1** (`:818-823`): offline after install. **§15.3** (`:837-855`):
  - single-build sessions; updates activate only when no old-version tab needs the old cache; old tabs keep their cache;
  - "A project `formatVersion` newer than the app is refused (§14)" (`:847`).
- **§17** (`:913-929`):
  - "Attributable main-thread blocking ≤ 50 ms … during processing, **load**, gestures and settle" (`:921`).
  - **The ≤ 1 s project-open target is not in RFC-002.** It lives in:
    - `docs/research/rfc-002-review/REVISED-P1-SEQUENCE.md:44` (G-PRJ: "Open of a 1M-anchor project ≤ 1 s on reference");
    - `docs/research/g0/G0-P1-IMPLEMENTATION-PLAN.md:343` and `docs/research/g0/G0-NEXT-GATE-BRIEF.md:148`;
    - `docs/research/g0/G0-DECISION-REGISTER.md:168,190`;
    - TD-PERF-009 and TD-PERF-010.
- **Autosave and recovery:** RFC-002 has none (excluded at `:815`).
- **Service worker:** §15 covers update compatibility only; it says nothing about saving.

### 2.3 Documented conflicts (verbatim; not resolved here)
1. **G-PRJ scope vs RFC.**
   - RFC §14 excludes the items at `:815` and says "each save is a new download" (`:797`).
   - Decision register A14 (`G0-DECISION-REGISTER.md:28`): "No autosave, libraries, recent files, OPFS/IndexedDB or cloud".
   - **vs** ROADMAP `:31-47` and decision register `:385-398` (2026-11-26). The G-PRJ scope there includes "local autosave and crash recovery", "recent projects", "browser storage quotas and eviction handling" and "safe, atomic file writes where the platform supports them".
   - ROADMAP `:68`: "Scope changes require RFC update."
2. **Recipes and effects.** RFC §14 `:779` lists "recipe and effect descriptors" as preserved. C10 `:498` says effect stacks are absent in v1. Document v1 has no recipe or operation-descriptor field (`document-json.ts:171-182`).
3. **History notice.** RFC `:796` "the user is told so on reopen": no reopen UI exists.
4. **Visible truncation.** RFC §7 `:340` calls truncation visible. `historyTruncated` is in the snapshot (`session.ts:73,207`), but no non-test code reads it, and the shell does not show it.
5. **Service worker text.** `scripts/generate-sw.mjs:154` (recovery page): "Other open Vectra tabs keep working. Save your work there first." No save UI exists.
6. **Source opt-in.** C7 and RFC require opt-in source embedding. The product import never attaches a source (`src/shell/jobs.ts:84`, "The source image is not attached"; `:126`, `assetId: null`), so no `source` section is produced from the workspace.

---

## 3. Session — `src/document/session.ts`
- **Saved-state field:** `#saved: DocState | null` (`:128`).
  - The constructor sets `#saved = o.state`; the doc comment reads "The initial state is validated, owned as `document`, and counts as saved (clean)" (`:140`, `:162`).
  - A loaded document therefore starts clean, at `#revision = 1` (`:129`), with empty `#past`/`#future` (`:126-127`) and `historyTruncated: false`.
- **Dirty:** `SessionSnapshot.dirty = this.#state !== this.#saved` (`:69`, `:204`); selector `selectDirty` (`:581`). There is no `isDirty()` method and no saved revision.
- **`markSaved(state = this.#state)`** (`:430-435`):
  - sets `#saved`, rebuilds the snapshot and notifies;
  - **does not increment `revision`**, because it uses `#makeSnapshot` plus `#notify`, not `#emit`;
  - does not check that `state` is still reachable in history. Its only caller is `saveContainer` (`container.ts:434`).
- **`#saved` is set to null** (permanently dirty until the next save) when:
  - the commit coalesces into, or is `withoutHistory` over, the saved state (`:297`);
  - `#dropHistory` clears it (`:379`);
  - budget eviction removes it (`:393`).
- **`withoutHistory`** (`DispatchOptions`, `:101-102`):
  - it skips the budget check (`:270`) and drops all history (`:293`, `#dropHistory` `:376-384`, which sets `#truncated` when any history existed);
  - shell callers: none in product code; only the debug `dispatch` (`src/shell/qualification.ts:151-152`).
- **History budget:**
  - `DEFAULT_HISTORY_LIMITS = { maxEntries: 100, maxBytes: 128 * 2 ** 20 }` (`:41-44`);
  - throws `DocumentError("history_budget", "this change would retain … history bytes (budget …); confirm to commit without history")` (`:277-282`);
  - `#entryBytes` (`:357-374`); `#enforceBudget` evicts oldest first (`:387-396`);
  - `historyBytes()` = chunk history bytes + history-only source bytes + `historyStructureBytes()` + `historyChunkRecordBytes()` (AM-2) (`:557-567`).
- **Revision:** a monotonic `#revision`, incremented by `#emit` on every commit, undo and redo (`:211-215`). Not persisted.
- **High-water marks:** `get nextId` (`:180`); the store's `nextChunkId`. Both sit outside `DocState` (`model.ts:2-3`).
- **Sources:**
  - session-owned `#sources` map (`:137`), copied on construction (`:152`); `sourceBytes()` returns a copy (`:196-198`);
  - `attachSource` (`:439-473`) enforces the 20 MiB embed cap and sets `provenance: {kind:"local-file"}` and default `decodePolicy: "browser-canvas-v1"`;
  - `relinkSource` (`:481-501`) is digest, signature and dimension verified, "not a document edit: no transaction, no revision change, no history entry";
  - `missingSources()` (`:503-505`); `#gcSources` (`:514-518`).
  - Non-test callers: `attachSource` only in the workbench (`src/workspace/useWorkbench.ts:266`, `embedded: false`). `relinkSource` and `missingSources`: **none outside tests**.
- **No `dispose()`** on `DocumentSession`. Replacing a document drops the reference; nothing tears it down explicitly.

---

## 4. Workspace shell — `src/shell/`

### 4.1 File actions today
- **Import:**
  - hidden `<input type="file" accept="image/png,image/jpeg,image/webp">` (`Workspace.tsx:110`, `:628-641`), opened from the top-bar "Import" button (`:642-649`) and the empty-state button (`:737-740`);
  - **drop** on the canvas section (`:689-694`), with no type filter; every dropped file goes to `importFile` → `decodeImage`.
- **Export SVG / PDF:**
  - the top-bar "Export" button opens `ExportDialog` (`:650-656`, `:1040-1150`); the default name is `"artwork"` (`:1048`);
  - the handler `exportDocument` → `downloadBlob(new Blob([bytes], { type }), \`${name}.${format}\`)` (`:989-1005`). `downloadBlob` uses an object URL and a temporary `<a download>` (`src/export/download.ts:2-12`).
- **Not present:** Open, Save, Save As, New document, `.vectra` file input, recent files, `beforeunload` guard.
- **Title:** the fixed "Untitled artwork", plus " · Edited" when `snap.dirty` (`:586-593`). This is the only dirty consumer in product code.

### 4.2 Document creation and replacement
- With no document, the import's `startTrace` creates a new `DocumentSession(new GeometryStore(), { state: createDocument({width, height}) })` sized to the image (`jobs.ts:117-122`).
  - The workspace adopts it **only if the trace commits** (`Workspace.tsx:353-356`).
  - Later imports add a layer to the current document (`jobs.ts:118-119`).
- **`adopt(s)`** (`Workspace.tsx:270-278`):
  - clears the selection, then sets `sessionRef`, `associate(jobs, s)` (→ `JobController.replaceSession`, `jobs.ts:49-52`) and `setSession`;
  - performs **no** dirty check, confirmation, busy check or disposal of the old session;
  - callers: import commit (`:356`) and debug hooks only.
- **Placeholder** document when there is none: `documentId: "none"`, 1×1 (`jobs.ts:33-36`).
- **Concurrent imports** are refused synchronously (`Workspace.tsx:283-287`, `:329-333`).
- **Replacement during import preparation** → `JobError("document_replaced")` (`jobs.ts:99-108`, `:114-116`), reported at `Workspace.tsx:372`.

### 4.3 `run` and TD-UI-006
- `run` (`Workspace.tsx:380-393`) calls `session.dispatch(c, o)` and catches **any** error as `"Edit rejected: …"`, including `history_budget`.
- `DispatchOptions` is passed through, but no product caller passes `withoutHistory`. This matches TD-UI-006 (`docs/TECHNICAL-DEBT.md:859-870`).
- The M-8 requirements for the future confirmation:
  - it discloses that undo and redo history is cleared;
  - Cancel is the safe default;
  - the user may save a project copy first.

### 4.4 Keyboard shortcuts registered
- `window` `keydown` (`Workspace.tsx:469-495`):
  - Mod+Z undo; Mod+Shift+Z redo; Ctrl+Y redo (not on Mac);
  - V, T, R for tools; Escape clears the selection; Delete or Backspace deletes the selection;
  - `+`/`=` zoom in, `-`/`_` zoom out; Shift+1 (`!`) fits; `?` shows shortcuts.
- `isMac` and `MOD` are defined at `:146-147`; `shortcutsBlocked` and `isRange` at `:150-155`. The displayed list `SHORTCUTS` is at `:244-255`.
- Canvas host: Space pans and Escape cancels a gesture (`src/canvas-host/CanvasHost.tsx:440-441`).
- **Mod+S, Mod+O, Mod+Shift+S and Mod+N are not registered.** Browser defaults are not prevented.

### 4.5 Status bar and offline
- Live status region (`Workspace.tsx:828-848`).
- "Update ready: it is used once every Vectra tab has closed" (`:952-956`).
- `offline-status` shows "Offline ready", "Offline unavailable: another version is installed" or "Offline not ready" (`:957-976`), from `watchOfflineStatus` (`:326`).

### 4.6 Debug-only qualification hooks
- **Installed only with `?debug=1`** (`Workspace.tsx:120`, `:419-431`), via `src/shell/qualification.ts`:
  - `workspace.loadContainerUrl(url)` (`:99-108`): fetch, then `loadContainer(bytes, {})` (dynamic import), then `adopt`. Returns `{fetchMs, loadValidateMs, loadedAt}`.
  - `workspace.loadContainer(b64)` (`:132-137`): decode, `loadContainer(bytes, {})`, `adopt`; returns the revision.
  - A stray doc comment at `:97` belongs to this hook but sits above `loadContainerUrl`.
  - `workspace.buildDetached({width, height, commands})` (`:114-130`): replays commands into a session that is not shown. The comment says it exists because "the 996k-anchor workload exceeds the container's 64 MiB document cap, so the loader cannot open it".
  - `workspace.replaceDocument(w, h)` (`:138-141`); `workspace.dispatch(c, {withoutHistory})` (`:151-152`); `workspace.historyBytes()` (`:154-157`).
  - **The shell has no save hook.** All loads use default `LoadOptions`.
- **Workbench** (`index.html`, `src/workspace/`), debug only:
  - `canvas.showContainer(b64)` (`useWorkbench.ts:587-594`); `loadContainer` is statically imported (`:38`);
  - `documentDigest` = `sha256(saveContainer(session, {codec:"none"}))` (`src/workspace/qualification.ts:162-164`), which has the `markSaved` side effect noted in §1.9.

---

## 5. Jobs and offline

### 5.1 `src/jobs/controller.ts`
- **Document replacement:**
  - the controller holds `#session` (`:127`), and `replaceSession` is a plain swap (`:158-161`; its comment reads "Replaces the document (e.g. Open). Results requested for the old one become `stale`");
  - a final trace result commits only if `this.#session === session` at completion; otherwise it is `{status:"stale", reason:"document_replaced"}` (`:200-201`).
- **Stale checks:**
  - source digest changed → `source_changed` (`:202-205`);
  - replace target chunks changed → `target_changed` (`:206-210`);
  - a new-layer commit is **not** revision-checked (RFC 3b).
- **Commit:**
  - one `commitTrace` dispatch on the main thread (`:232-238`);
  - any error, including `history_budget` and invariants, → `status: "failed"`, document unchanged (`:253-262`).
- **Exports:**
  - frozen at request time: `deepFreeze(buildExport(session.state, …))` (`:373`);
  - chunks are retained with owner `snapshot` until settle (`:380-391`);
  - reservation before allocation (`:375-379`).
- **Save during a job:** nothing in the job system interacts with saving. A save captures `session.state` at call time (`container.ts:369`), so a trace committed afterwards makes the document dirty by identity.
  - A save does not include job-only or snapshot-only chunks, because it writes the current state's chunks only (`container.ts:372`).

### 5.2 `src/jobs/scheduler.ts`
- Lifecycle (`:1-15`):
  - explicit jobs (final, apply, export) are never cancelled implicitly;
  - previews and thumbnails are superseded per `(kind, scope)`;
  - `ready` handshake; start-up timeout with one requeue;
  - a worker from another build is refused (`build_mismatch`, `:206`).

### 5.3 Build identity and offline status
- `BUILD_IDENTITY {protocolVersion, buildId, engineVersion, packetVersion}` (`src/jobs/build-info.ts:9-14`).
- `watchOfflineStatus` (`src/jobs/offline-status.ts:41-69`):
  - `ready` means the controller's `buildId` equals the page's; `updateWaiting = reg.waiting !== null`;
  - it asks the service worker with `postMessage("vectra-sw-version")` (`:24-38`).
- **Service worker registration:** PROD only (`src/shell/main.tsx:10-11`, `src/main.tsx:8-9`).

### 5.4 `scripts/generate-sw.mjs`
- **Precache and versioning:**
  - precaches every `dist` file except `_headers`, `_redirects` and `sw.js` (`:33-45`);
  - `VERSION` is a SHA-256 of the template plus every file name and content, first 16 hex characters (`:210-218`); the cache name is `"vectra-" + VERSION` (`:94`).
- **Install** (`:101-114`): `cache.addAll(..., {cache:"reload"})`. A partial cache is deleted only if it did not already exist. No `skipWaiting`.
- **Activate** (`:116-130`): deletes the other `vectra-*` caches and `clients.claim()`s only on first install.
- **Fetch:**
  - only same-origin `GET` (`:188`);
  - navigations to precached shells use `serveShell`, which serves from the controlling cache, repairs only from an identical build on the network, and otherwise returns a static 503 recovery page (`:166-183`, `:139-164`);
  - other navigations and assets are cache-first with network fallback and `ignoreVary` (`:196-207`).
- **What it caches:** build assets only; no documents and no runtime data. There is no handling of `launchQueue` or file handlers.
- **Manifest:** `public/manifest.webmanifest` has no `file_handlers`, `share_target` or `launch_handler`; `start_url` is `./workspace.html`.

---

## 6. Tests and evidence

### 6.1 Unit tests (`vp test`)
- **CI:** `.github/workflows/ci.yml:157-159` runs `vp test`, only when code paths changed, then the production build. **No Playwright or Safari suite runs in CI.**
- `src/persistence/container.test.ts` (677 lines):
  - round trip byte-identical for both codecs, clean after save and load, `canUndo false`, high-water marks keep allocating (`:132-163`);
  - codec-independent `sha256` and `uncompressedLength` (`:166-179`);
  - **golden**, codec `none`: `src/persistence/golden/circle-bw.none.vectra.b64` (`:181-196`). Decoded here: 3,104 B, H = 561, manifest 78 B, document 1,853 B, `chk_1` 600 B;
  - layout (`:198-225`); embedded vs referenced sources (`:227-245`); save from the captured state (`:247-259`);
  - adversarial suite (`:261-…`): truncation, magic and header, section table, caps before allocation, bomb, corrupt stream, short output, SHA, manifest versions, document schema, geometry sections, source sections, multi-group packets (`:667`).
- `src/persistence/canonical-json.test.ts`: 7 tests, including RFC 8785 number examples and a randomized check that the strict reader agrees with the writer.
- **Frozen serialization hash:**
  - `src/document/session-validation.test.ts:172-180`: `FROZEN = "e60fa32756cdcf1dd6ed42ffff9fc65fe4432492b58f727dc4132fff77538e36"`, a codec-`none` save in every validation mode, frozen at `8913cfb`;
  - also `src/document/property.test.ts:146-148` (save → load → save byte-identical on random sequences), `review-regressions.test.ts` and `commands-writelog.test.ts:133`.

### 6.2 Browser persistence suite (`tests/browser/persistence/`)
- **Run manually:** `pnpm exec playwright test -c tests/browser/persistence/playwright.config.ts`.
  - It uses a Vite **dev** server on 127.0.0.1:4180 (`playwright.config.ts:23-29`) and runs the production modules through a harness page, **not through the UI**.
  - Last recorded result: 28 passed, 2 skipped on `42b67d4` (P1A report `:79`).
- Coverage in `persistence.pw.ts`, per engine (Chromium, Firefox, WebKit) against Node:
  - semantic round trip and resave identity (`:42-54`);
  - section table equal to Node's, and bytes identical with `none` (`:56-65`);
  - malformed inputs give typed errors atomically (`:67-92`);
  - bomb and caps, including session budget, give typed `limit` and `inflate` errors (`:95-115`);
  - C2 ownership with Worker round trips (`:117-140`);
  - digest-verified relink is not an edit (`:142-159`);
  - cross-engine interchange, written to `tests/output/persistence/interchange-findings.json` (`:163-241`).
- "Atomic" here means that a failed `loadContainer` leaves the caller's previously loaded session untouched (`harness.ts:195-224`). There is no UI path.

### 6.3 Real Safari, export regression and tooling
- **Real Safari:** `node tests/safari/persistence.mjs`, manual. It checks Safari ↔ Node ↔ the three Playwright engines for both codecs: round trip, typed and atomic malformed and limits cases. Recorded 23/23 checks at G-R0 (`docs/research/g-r0/G-R0-REPORT.md:83-88`).
- **Export regression:** `scripts/document-export-regression.mjs` runs scene → packet → commit → `.vectra` save (both codecs) → strict load → export (scene JSON, SVG, PDF) against `a4cf172.sha256`. The script reports a count of hash checks: scenes × 3 files × 2 codecs.
  - The full count is 636. G-DOC-R records **576/576** as "636 minus 60", with every `concert-*` input excluded (`docs/research/g-doc-r/G-DOC-R-REPORT.md:118,367,380`).
  - Not re-run by this audit.
- **Dump tool:** `scripts/vectra-dump.mjs` (C7 tooling).
- **UI specs** use the debug load hooks only for setup: `workspace-integration`, `workspace-lifecycle`, `ui-document`, `drag-correctness`, `g-doc-r-memory` (`loadContainerUrl`) and `workspace-perf` (`loadContainerUrl`).
- **No test exercises a product Save or Open path,** because none exists. The G-PRJ exit criteria in `REVISED-P1-SEQUENCE.md:44` ask for "the security fuzz suite through the UI path".

### 6.4 Performance evidence
- **P1A §7.2** (`P1A-INTEGRATION-REPORT.md:124-151`): open is `loadContainer` end to end, 15 repetitions, on a machine that was **not quiet**. Median / p95 in ms:
  - A, 50k paths × 20: `none` 179 / 189, `deflate-raw` 300 / 332 — **met**;
  - B, 250k paths × 4: `none` **1,048 / 1,135**, `deflate-raw` **1,108 / 1,242** — **missed**;
  - I, 41,666 paths: `none` 118 / 128, `deflate-raw` 165 / 170.
  - Phase profile at B, `none` (single pass, 823 ms total): strict JSON 350, schema 258, session and invariants 157, inflate and SHA 32, packet decode and commit 26.
  - "Load cost follows the **node count**" (`:145`). The recommendation is the compact node encoding before release (`:151`).
- **Blocking:** open at I (118–165 ms) is over the 50 ms blocking budget as one main-thread task (`:160-162`); G-PRJ owns this.
- **Save timings** (G-DOC report `:145`; Node, heavily loaded, test-only validator, one run): A 2,501 / 269 ms and B 3,818 / 1,327 ms (`deflate-raw` / `none`). No browser save benchmark exists.
- **TD-PERF-009** (`TECHNICAL-DEBT.md:989-995`): the open target miss.
  - Approved follow-up: compact Document v1 that "omit[s] canonical default-valued node properties without changing the in-memory model", with frozen-contract amendment and preservation requirements.
  - G-DOC-R finding: the 330k-path workload has a **72.7 MB document section, over the 64 MiB cap**, so it cannot be saved. The 250k-path workload saves as an 80.2 MB container (`none`).
- **TD-PERF-010** (`:998-1023`): job handling blocks the main thread over 50 ms. G-PRJ "qualifies responsive project opening (≤ 1 s open and ≤ 50 ms blocking are separate requirements)" (`:1023`).
- **Primitives** (`PROJECT-PERSISTENCE-REVIEW.md:119`): a 1M-anchor geometry section takes about 0.1–0.15 s to open.

---

## 7. Browser storage and file APIs in `src/` (grep)
- Searched for: `indexedDB`, `IDBFactory`, `getDirectory`, `showSaveFilePicker`, `showOpenFilePicker`, `FileSystem*Handle`, `localStorage`, `sessionStorage`, `caches.open`/`caches.`, `navigator.storage`, `persist()`/`estimate()`, `BroadcastChannel`, `navigator.locks`, `beforeunload`, `pagehide`, `visibilitychange`, `launchQueue`, `file_handlers`, OPFS.
- **No match in `src/`, `index.html`, `workspace.html` or `vite.config.ts`.**
- **Only matches:**
  - the service worker's Cache API in `scripts/generate-sw.mjs:105,124,168`;
  - service worker registration and messaging (`src/main.tsx:8-9`, `src/shell/main.tsx:10-11`, `src/jobs/offline-status.ts`).
- The dependency `react-resizable-panels@4.24.1` has layout-persistence hooks that default to `localStorage`. `src/` does not use them: no `useDefaultLayout`, `autoSaveId` or `defaultLayout` match.

---

## 8. Unconfirmed / not checked
- Whether `markSaved` on an evicted state retains meaningful memory. It holds only a `DocState` reference; chunks are released by ownership. Not measured.
- The real-world document-section size of traced artwork relative to 64 MiB. TD-PERF-009 states it was not measured.
- Browser save time and save blocking: no benchmark exists.
- The persistence Playwright and Safari suites were **not run** by this audit. Results above are the recorded ones.
