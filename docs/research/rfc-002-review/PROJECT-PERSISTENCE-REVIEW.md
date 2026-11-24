# RFC-002 review R05-B — local project persistence (D08)

**Question.** RFC-002 §11 proposes moving explicit local Save/Open from P4 to P1-C. An artist must be able to save editable work and reopen it without retracing.

**Disposition.** ACCEPT WITH AMENDMENTS. The format and serializer move to P1-A, where they serve as the document model's round-trip oracle. The Save/Open UI stays in P1-C. The minimum format is a bounded custom container, chosen over a zip archive.

Evidence types are marked: **[measured]** (this review's harness), **[source]** (code inspection), **[analysis]**.

## 1. Is P1-C Save/Open appropriate?
Yes, and the format should be fixed earlier than the UI. Four reasons:
- **The alternatives lose too much.** Without a project file, closing the tab destroys all document state: IDs, layers, transforms, palette references, trace provenance and source. SVG export does not preserve these, and RFC-002 deliberately excludes arbitrary SVG import. A studio that cannot save editable work is a demo, not a tool. P1 testers will lose work.
- **It is an oracle for the document model.** The invariants P1-A must prove (unique IDs, acyclic tree, valid references, the `nextId` high-water mark, immutable geometry) are exactly what a loader must re-validate. Writing the serializer and strict loader in P1-A turns every document test into a save → load → compare round trip at almost no extra cost.
- **Lock-in risk is bounded.** The format carries `formatVersion` and `documentSchemaVersion` with forward-only migrations from the first release. Builds before the first public release may label it "v1 (experimental)", but migrations are committed from v1 on.
- **What stays out of P1:** autosave, project library, OPFS or IndexedDB storage, history persistence and recent-files lists. Consistent with the brief, none of these is implemented or required.

## 2. Browser APIs [source + analysis]
| API | Chromium | Firefox | Safari / WebKit | P1 role |
|---|---|---|---|---|
| `<input type="file">` open | yes | yes | yes | **Open** (R05-A tested a local file input in 3 engines, zero network requests [measured]) |
| Blob + `<a download>` save | yes | yes | yes | **Save** (P0 already exports this way: `src/export/download.ts`) |
| File System Access (`showSaveFilePicker`, write in place) | yes | no | no | Optional later enhancement ("save in place"); never required |
| OPFS | yes | yes | yes | Future opt-in autosave or library only, after an explicit consent design |
| IndexedDB | yes | yes | yes | Same; storage is evictable unless `navigator.storage.persist()` is granted |
| `CompressionStream` / `DecompressionStream` (`deflate-raw`) | yes | yes | yes | Container compression with no dependency (see §4 measurements) |
| `crypto.subtle.digest` SHA-256 | yes | yes | yes | Section integrity, source relink by digest |

Everything in the P1 column works offline under the existing CSP, without a server or a new origin.

## 3. Archive vs bounded container [analysis]
| | Zip archive (allowlisted subset) | Bounded custom container (recommended) |
|---|---|---|
| Inspectability | Standard tools | Needs a small dump script |
| Reader complexity | Local and central headers, possible mismatches, zip64, flags, data descriptors | One JSON header with a section table, then raw sections |
| Path traversal and names | Must reject `..`, absolute paths, backslashes, duplicates, directories, symlinks | **No file names exist**: sections are typed records (`manifest`, `document`, `geometry:<chunkId>`, `source:<assetId>`) |
| Decompression bombs | Declared sizes are untrusted; needs streaming caps | Declared uncompressed length is checked against caps **before** allocation, and inflation is streamed with a hard cap equal to the declared length |
| Integrity | CRC-32 only | SHA-256 per section, verified before use |
| Dependency | Writer and reader library, or ~300 LOC owned | ~150 LOC owned for the TS reader and writer, using native `DecompressionStream` |
| Future interop | Better | Add "export as zip/folder" later if users ask |

The custom container removes whole classes of archive attacks by construction and needs no dependency. Zip's advantage, inspection with standard tools, does not outweigh that for a v1 that only Vectra reads. **Revisit** if third-party tools must read projects, or if a project-folder workflow is requested.

## 4. Minimum safe P1 format (`.vectra`, container v1)
```text
magic "VECTRA\0\x01" | u32 LE headerLength | header JSON (≤ 1 MiB) | sections...
header = { formatVersion: 1, sections: [{ id, kind, codec: "none"|"deflate-raw",
           offset, length, uncompressedLength, sha256 }] }
kinds:
  manifest  JSON  { formatVersion, documentSchemaVersion, packetVersion, engineVersion,
                    precisionFitVersion, app: "vectra", createdWith }   (no clock, no filenames, no user data)
  document  JSON  Document v1 per RFC §4: IDs + nextId high-water, ordered tree, names, visible/locked,
                  2×3 f64 transforms, palette + styles, artboard, SourceReference{assetId, sourceToDocument},
                  trace provenance {TraceRequest, engineVersion, precisionFitVersion, sourceDigest}
  geometry  GeometryPacket v1, little-endian, one section per geometry chunk (objects reference
            (chunkId, pathIndex)); validated with the same validator as worker transport
  source    optional original compressed bytes (PNG/JPEG/WebP as imported), only with explicit opt-in;
            never decoded RGBA
```
Not stored:
- undo history (reopen with empty history and say so);
- camera, selection, caches, worker state;
- decoded pixels;
- remote URLs (the schema has no URL field).

### Loading is atomic and bounded
1. **Header.** Check magic and `formatVersion`; header ≤ 1 MiB.
2. **Section table.** Count ≤ 4,096. Ranges must lie inside the file, must not overlap, and must have unique IDs.
3. **Size caps before any allocation.** Total `uncompressedLength` ≤ the session budget (default 512 MiB, lower on constrained devices). Per-section caps: document ≤ 64 MiB, source ≤ 20 MiB as at import, geometry ≤ the packet byte budget.
4. **Read each section.** Stream the inflation and abort if output exceeds `uncompressedLength`, then verify the SHA-256.
5. **Parse.** Manifest, then document JSON with **unknown fields rejected** (as `deny_unknown_fields` does for scene v1). Every `geometry` packet goes through `validatePacket` (offsets, arity, finite values, budgets).
6. **Cross-validate the document.**
   - Acyclic tree, unique IDs, `nextId` greater than every ID.
   - Every chunk and source reference resolves, and no section is left unreferenced.
   - Transforms are finite and non-singular.
   - Styles are valid, with palette references matching (as in scene v1).
7. **Source assets.** Re-run the existing intake checks (signature, dimensions, animation) before any decode.
8. **Swap.** Build a complete new document off to the side and swap it in only on success. On any failure, the open document stays untouched and the error is typed.

### Migrations
Two integer versions:
- `documentSchemaVersion`: forward-only, deterministic migration functions; tests keep v1 fixtures forever.
- `packetVersion`: same rule.

A newer, unknown version is refused with a message; no partial load. Saving always writes the current version as a new download, so the original file is never overwritten.

### Missing or excluded source
Traced geometry stays editable and exportable. Source-dependent operations (retrace, raster effects) are disabled with an explanation. Relinking is by user file choice plus a SHA-256 match against `sourceDigest`.

### Determinism
The same document saves to identical bytes: no clocks, sections in a fixed order, and deflate parameters fixed by the implementation. Two tests follow:
- save → open → save gives byte-identical output;
- open → export gives SVG/PDF identical to the pre-save export.

## 5. Sizes and timings [measured]
- **Geometry size** (`artifacts/transport/node-transport.json`): a packet is about 42–47 bytes per anchor. That is ~45 MB at 1M anchors; deflated with zlib it is ~11 MB, roughly the same as deflated JSON.
- **Open path, Node** (reference machine, under background load):
  - binary packet: load plus single-pass validation in ~17–20 ms at ~1M anchors;
  - scene JSON: parse 104–169 ms, then 8–46 ms to re-encode into the editor representation.
  - So binary geometry sections are the faster open path, at equal size.
- **Native compression in the browser:** see `artifacts/persistence/compression.json` and the table below.

<!-- persistence-table -->

## 6. Security checklist (gate G-PRJ)
Fuzzed malformed containers: truncation, bad magic, oversized header, overlapping or out-of-range sections, duplicate IDs, a declared length smaller than the inflated output (bomb), SHA mismatch, unknown kind, unknown fields, unknown versions, invalid packets (the R01 adversarial set), dangling references, ID cycles, a non-finite transform, a source with a bad signature. Every case must produce a typed error with the document unchanged.

Not run in this review: a container implementation (by design; the brief excludes persistence infrastructure).
