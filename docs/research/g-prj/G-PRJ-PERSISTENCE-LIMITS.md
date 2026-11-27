# G-PRJ-R — Persistence limits (TD-PERF-009, the C7 64 MiB document-section cap)

**Status:** research, **accepted (maintainer, 2026-11-27)**. AM-3.2 (compact C10 v2) and AM-3.3 (exact persistable-size enforcement) are approved; AM-3.6 is deferred and the 64 MiB document-section cap is retained ([decisions](G-PRJ-DECISIONS.md) §4). The refinement that the invariant covers the complete container (decisions §7.5) is reconciled in §9. No canonical encoding, C7, C10 or serialized version is changed in this research; the amendments go through change control in G-PRJ-0.

## 1. The problem
- C7 caps a `.vectra` document section at **64 MiB** uncompressed (`CONTAINER_LIMITS.maxDocumentBytes`, `src/persistence/container.ts:26-33`, checked before parsing in `checkLimits`). Source sections are capped at 20 MiB, and the declared total at 512 MiB.
- The designated 996k-anchor workload (330k paths) serializes to a **72.7 MB** (69.3 MiB) document section. `saveContainer` refuses it, so **today the app can hold, edit and export a document it cannot save**.
- The section is canonical JSON (RFC 8785) of the whole document state. Its size scales with **node count** and with the style, palette and provenance tables, not with anchors: geometry lives in separate C3.1 geometry sections.
- **The invariant this gate must establish:** every successfully saved project is reopenable under the supported limits, and the app never lets a document grow past what it can persist without saying so.

## 2. Method
- **Node (persistence engine):** `node --expose-gc scripts/g-prj/persistence-limits.mjs --reps 3` on `8b6c451` → [`bench/persistence-limits-8b6c451.json`](bench/persistence-limits-8b6c451.json).
  - Node v24.22.1, Apple M5 Max, 128 GiB; load 1.3–2.9; no `ngspice`. A shared machine, not a quiet run.
  - Per workload, it measures:
    - the canonical document section and its composition;
    - a lossless compact encoding ([`scripts/g-prj/compact-document.mjs`](../../../scripts/g-prj/compact-document.mjs), round trip asserted byte-for-byte);
    - deflate-raw sizes;
    - geometry and source payloads;
    - real `saveContainer`/`loadContainer` with codec `none` and `deflate-raw` (medians of 3);
    - a worker hand-off copy;
    - peak RSS of one save and one load, each in a fresh process started from the saved container.
- **Browsers (production build):** `node scripts/g-prj/browser-load.mjs` → [`bench/browser-load.json`](bench/browser-load.json).
  - Build: `BUILD_ID` `84a902d7cb59cba9`, which is `276c1ec`'s sources with the WASM package rebuilt in this worktree.
  - It loads each saved container through the existing debug hook `loadContainerUrl`, which uses the production loader. Load and validate are timed before the session is shown, so rendering is excluded.
  - It records the longest main-thread frame gap during the load.
  - Engines: Chromium 159, Firefox 159, Playwright WebKit 27.2. Medians of 3.

**Workloads.**

| Name | What it is |
|---|---|
| small | A real, edited small document (renderer fixture `edited-styles-visibility`) |
| bark-1224, bark-2350 | Registered G-R1 real photographic traces |
| halftone | A registered halftone trace: one path, 977k anchors |
| palette-provenance | 20k paths, 20k styles and a 30k-entry provenance palette |
| interactive-43k, synthetic-250k | The interactive target: the benchmark workload, and the registered G-R1 one |
| w756k, w996k | 250k and 330k paths: the 756k- and the designated 996k-anchor workloads |
| limit-500k | 500k two-anchor paths, exactly the 1M anchor cap |

## 3. Results (Node)
Sizes in MiB. "Per node" is canonical bytes ÷ nodes. Save is codec none / deflate-raw; load is deflate-raw. Peak is peak RSS above the pre-operation RSS.

| Workload | Paths | Anchors | Styles | **Document** | Per node (B) | **Compact** (ratio) | Doc deflated: canonical / compact | Geometry | Container: none / deflate | Save ms | Load ms | Peak save / load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| small | 5 | 37 | 6 | 0.003 | 485 | (0.84) | — | 0.001 | 0.01 / 0.004 | 0.2 / 1 | 0.9 | 8 / 3 |
| bark-1224 | 16,056 | 270k | 13,662 | **5.70** | 372 | 4.35 (0.764) | 0.60 / 0.55 | 13.28 | 18.98 / 4.33 | 63 / 464 | 141 | 114 / 169 |
| bark-2350 | 43,621 | 812k | 30,595 | **14.47** | 348 | 10.81 (0.747) | 1.47 / 1.32 | 39.30 | 53.77 / 12.54 | 187 / 1,370 | 363 | 166 / 382 |
| halftone | 1 | 978k | 1 | 0.001 | 607 | (0.87) | — | 39.90 | 39.90 / 9.57 | 4 / 1,238 | 102 | 98 / 138 |
| palette-provenance | 20,000 | 80k | 20,000 | **7.35** | 385 | 5.67 (0.772) | 0.85 / 0.78 | 3.85 | 11.20 / 2.78 | 86 / 183 | 147 | 104 / 157 |
| interactive-43k | 44,000 | 264k | 8 | **9.07** | 216 | 5.39 (0.594) | 0.49 / 0.35 | 8.35 | 17.42 / 6.39 | 102 / 323 | 171 | 133 / 172 |
| synthetic-250k | 41,853 | 250k | 16 | **8.66** | 217 | 5.16 (0.596) | 0.48 / 0.34 | 10.84 | 19.51 / 3.30 | 100 / 453 | 165 | 143 / 185 |
| w756k | 251,000 | 756k | 8 | **52.48** | 219 | 31.28 (0.596) | 2.77 / 1.97 | 24.04 | 76.52 / 18.76 | 749 / 1,326 | **943** | **490 / 719** |
| **w996k** | 331,000 | 996k | 8 | **69.34 (over cap)** | 220 | **41.36 (0.596)** | 3.66 / 2.60 | 31.68 | **refused** | — | — | — |
| **limit-500k** | 500,000 | 1.00M | 4 | **104.96 (over cap)** | 220 | **62.63 (0.597)** | 5.51 / 3.92 | 31.94 | **refused** | — | — | — |

**Document composition.** For bark-2350: nodes 9.20 MiB, styles 2.38, palette 1.89, provenance 1.01. The synthetic workloads are all nodes.

**Serialization time** (canonical, then compact): 798 ms then 479 ms at w996k; 1,200 ms then 744 ms at limit-500k.

**Worker hand-off** (a structured copy of the container bytes): ≤ 0.6 ms. A transfer is O(1).

### Browsers (load and validate, rendering excluded; ms; longest frame gap in brackets)
| Workload | Chromium 159 | Firefox 159 | WebKit 27.2 |
|---|---|---|---|
| small | 0.3 (17) | 1 (19) | 1 (26) |
| bark-1224 | 114 (18) | 137 (28) | 125 (46) |
| bark-2350 | 276 (34) | 335 (57) | 305 (113) |
| halftone | 67 (24) | 74 (54) | 55 (101) |
| palette-provenance | 109 (18) | 159 (27) | 145 (44) |
| interactive-43k | 133 (29) | 183 (41) | 171 (60) |
| synthetic-250k | 118 (24) | 165 (36) | 158 (39) |
| **w756k** | **717 (160)** | **931 (219)** | **1,039 (333)** |

## 4. Findings
1. **The cap is reached by node count, not by anchors.**
   - Synthetic traces cost about 217–220 bytes per node. Real photographic traces cost 348–385, because each path has its own style and palette entry, and the layer carries the provenance.
   - So the 64 MiB cap holds about **305k nodes** of synthetic artwork and about **180–190k paths** of photographic artwork. Both are far below the 1M anchor cap and the 1M path cap.
   - The 996k-anchor workload fails (69.3 MiB). The 756k one passes with 11.5 MiB to spare.
2. **About 40 % of the synthetic document section is default values.**
   - Every node writes:
     - its `id`, which is equal to its map key;
     - `name: ""`;
     - `visible: true`;
     - `locked: false`;
     - an identity `localTransform`.

     All five are true of every path in every measured trace.
   - Omitting them losslessly gives **0.594–0.597** of the canonical size for synthetic artwork, and **0.747–0.772** for photographic artwork, whose styles and palette are untouched.
   - The 996k-anchor workload then drops to **41.4 MiB**. Even the 1M-anchor limit case drops to **62.6 MiB**, but that leaves only 1.4 MiB of margin.
   - **A further 13 bytes or so per node** are also implied: `kind` follows from the key's prefix (`invariants.ts:92-93`), and so does `id`. Style entries write null members such as `stroke: null`. The prototype keeps `kind` and the style nulls, so these ratios are conservative.
3. **Compact encoding alone does not establish the invariant.** In the worst case within the anchor cap, about 500k paths each with a unique style and palette entry, the compact section is still about 125 + 146 B per path, roughly **129 MiB**. That is twice the cap, with no warning to the user.
4. **Compression is not the issue.** Deflate takes the document to 5–10 % of its size: 69.3 → 3.7 MiB at w996k. But C7 caps the *uncompressed* length, deliberately, as a decompression-bomb limit. Raising it raises the memory a hostile file can demand.
5. **Large documents already strain memory and the main thread.**
   - Memory: loading w756k peaks at about **719 MiB RSS**, and saving it at 490 MiB (Node).
   - Main thread: in browsers its load blocks for **160–333 ms**, against the RFC ≤ 50 ms blocking target, and takes 0.72–1.04 s, against the ≤ 1 s open target (WebKit over).
   - These are the open problems of TD-PERF-009 and TD-PERF-010. Higher limits would make them worse before they improve.
6. **Saving is dominated by deflate on geometry.** halftone: 4 ms with codec none, 1,238 ms with deflate. bark-2350: 187 ms, then 1,370 ms. The codec choice is a product decision: file size against save latency.

## 5. Options compared
| Option | Effect on the invariant | Cost and risk | Contract impact |
|---|---|---|---|
| **1. Existing canonical** | Fails today at about 305k synthetic nodes or 190k photographic paths | — | — |
| **2. Compact canonical JSON**: defaults omitted, `id` implied by its key | The 996k workload fits (41.4 MiB) and the 1M-anchor synthetic case just fits (62.6). Not sufficient alone: style-heavy documents above about 245k paths still exceed the cap | Small: a deterministic rewrite at the boundary; v1 files remain readable | **C10 v2** (`documentSchemaVersion` 2) with a defined v1 reader; canonical bytes and frozen export hashes stay intact, since exports do not read the document JSON |
| **3. Streaming or section-oriented processing**: the document split into several sections, for example nodes in chunks of 64k, or parsed in a worker | Lifts the single-section ceiling without raising per-section memory; parsing moves off the main thread | Moderate: the container writer and reader, the incremental hash, ordering rules | **C7 r3** (a section list and its order), `formatVersion` 2 |
| **4. A revised section limit**, e.g. 128 MiB | Lets w996k and limit-500k save today | Raises the decompression-bomb ceiling and the parse memory (already 719 MiB at 52 MiB) | C7 amendment; needs a memory budget per profile |
| **5. Alternative encodings** (binary, columnar) | Large reductions possible | New format; rejected while 2 and 3 are unexhausted (brief §6) | New `formatVersion`; out of scope without approval |

## 6. Recommendation (for G-PRJ-0; needs approval)
1. **Adopt compact canonical JSON (option 2) as C10 v2.**
   - Default-valued node fields are omitted, and `id` is implied by its key. Readers accept v1 and v2; writers write v2.
   - The canonical form stays RFC 8785. The same document then has one canonical v2 byte string.
   - The frozen document-export hashes are unaffected (exports never read the section), but the frozen canonical-serialization hash is re-baselined under change control.
2. **Make persistability a document limit (the invariant)**, over the **complete container**, not only the document section (§9):
   - Account the **exact** compact document-section size incrementally, at transaction time.
   - Nodes are written through the transaction log, and a node's canonical bytes are a pure function of the node, so the delta is computed per written key: the AM-2 delta pattern, with no whole-document pass.
   - Enforce it like the anchor cap: a command whose result would exceed the section limit is **rejected before commit** with an actionable error that names the limit (as implemented in G-PRJ-0: "This change would make the document too complex to save: its document section would need N bytes, and the document section cap is M bytes"; never a "maximum file size", refinement 7.5), and imports and trace commits are pre-flighted.
   - Load keeps refusing over-cap files (`limit`), so a file the app wrote is always within what it reads.
3. **Keep 64 MiB** until option 3 is qualified. With compact encoding it covers the designated stress workloads and the 1M-anchor synthetic case.
4. **Move parse and validate into a worker** (option 3's first half, no format change) to meet the ≤ 50 ms blocking target.
   - The container bytes transfer in O(1); the validated document and geometry come back as transferred buffers.
   - Measured: w756k blocks the main thread for 160–333 ms today.
5. **Revisit option 3's sectioned document (C7 r3)** only if the product supports documents beyond the compact ceiling. That ceiling is about 500k synthetic nodes or about 245k photographic paths.
6. **Codec:**
   - `deflate-raw` for explicit saves, where size matters and the user waits for a save;
   - **`none` for recovery snapshots**, which are frequent, local and latency-sensitive (4 ms against 1,238 ms on the halftone). The recovery store's quota accounting covers it.

## 7. User-facing resolution of an unpersistable state
- **Before commit (the default):** the command is refused with the size limit named, in the status bar's error region. Nothing changes and history is untouched. The message suggests splitting the artwork, removing hidden layers, or simplifying the trace.
- **Warning band:** at about 85 % of the document-section limit, the save-status control shows **"Complex document: n % of the document capacity"** (or of the section capacity it is near, §9). It is a word and a number, not a colour alone, and it is shown only near the limit. It never speaks of a "maximum file size": the limit is on document complexity in one section, and a project's total file size can be far larger, or far smaller after compression (refinement 7.5).
- **Legacy documents already over the limit** (none can be saved today, so none exists on disk): a session that reaches this state through a pre-v2 build is offered **Export SVG / PDF** and **Save a copy with hidden layers removed**, never a silent truncation.

## 8. Not measured
- Lower-end hardware.
- Real Safari load timing: the Safari harness serves `dist/` without request routing; it is planned for G-PRJ-Q.
- Firefox/WebKit memory, which has no comparable reading.
- Compressed-stream (DecompressionStream) memory in browsers.

## 9. Complete-container persistability (refinement 7.5, approved 2026-11-27)
The persistence invariant covers **every limit the strict loader applies**, not only the document section. Each limit is either enforced at transaction time (a command whose result would exceed it is rejected before commit) or implied by one that is. The figures are C7's (`CONTAINER_LIMITS`) and C3's (`DEFAULT_PACKET_LIMITS`).

| Loader limit | Value | How the invariant holds it |
|---|---|---|
| **Document section** (uncompressed) | ≤ 64 MiB | **Enforced per transaction** by exact incremental accounting of the v2 canonical bytes (G-PRJ-0) |
| **Manifest section** | ≤ 1 MiB | A constant: the fixed four-member manifest, under 100 bytes |
| **Geometry section** (one per referenced chunk) | ≤ the C3.0 record cap: packet `maxBytes` (512 MiB) + manifest cap (16 MiB) + 24 | Implied: every chunk is validated against the packet limits when it is committed (C2), so its record fits. G-PRJ-0 confirms this with the store's exact record length |
| **Source section** (one per embedded asset) | ≤ 20 MiB | Enforced when a source is embedded (`attachSource`); D-PRJ-10's oversized-source resolution happens before that point (§6.6 of the decisions) |
| **Section count** | ≤ 4,096 | **Enforced per transaction**: 2 + referenced chunks + embedded sources. Today it is checked only at save |
| **Header** | ≤ 1 MiB | **Implied by the section count.** The worst-case header, 4,096 entries with every number at the 16-digit safe-integer maximum and the longest ids, is 962,592 bytes (computed in this research) |
| **Total declared uncompressed bytes** | ≤ the profile session budget (default 512 MiB) | **Enforced per transaction**: manifest + document + every referenced geometry record + every embedded source. Today it is checked only at save |
| **Compression** | Caps apply to uncompressed lengths; inflation is bounded by the declared length (bomb guard) | Deflate output can exceed its input only by its stored-block overhead (5 bytes per 65,535); no limit is defined on compressed lengths, so compression cannot make a persistable document unpersistable. Codec `none` stores the uncompressed bytes |

**No new arbitrary limit.** No independent path-count limit is introduced. The document limits that already exist (1M anchors, 2M nodes, depth 64) are unchanged.

**Profiles.** A file is persistable under the writing profile's session budget. A file written under the standard profile (512 MiB) can exceed a constrained profile's budget; the constrained reader refuses it with `limit`, never a partial load. G-PRJ-1 discloses this when a constrained profile exists.
