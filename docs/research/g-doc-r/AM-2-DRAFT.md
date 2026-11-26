# AM-2 (draft) — History accounting of document structure

**Status: DRAFT. Not approved.** This amendment is raised under change control ([G0-ARCHITECTURE-CONTRACTS](../g0/G0-ARCHITECTURE-CONTRACTS.md), "Change control"). Stage D of G-DOC-R stops until the maintainer decides. No stage D code has been written.

## 1. Why an amendment is needed
- **TD-PERF-011.** Each history state retains its own full node-map table: about 7 MiB per state at 251k nodes, measured by the [TD-PERF-007 investigation](../g-r1/TD-PERF-007-INVESTIGATION.md). One hundred entries would hold about 700 MiB. None of it is counted.
- **The frozen text counts only chunks and sources.**
  - C3.2 (C3 r2): "History-only bytes" (the RFC §7 budget) are `byOwnerKind.history`.
  - RFC-002 §7: "Bytes are counted by chunk and source owner (§5.2)."
  - The session implements exactly this: `historyBytes()` is chunk history bytes plus history-only source bytes.
- **The maintainer decided the substance on 2026-11-25** (TECHNICAL-DEBT TD-PERF-011, owner action; [G-DOC-R-SCOPE](G-DOC-R-SCOPE.md)): history accounting covers retained node maps, node objects, indexes, geometry and source assets, and counts shared allocations once.
- That decision changes the meaning of a frozen budget. It therefore needs all three change-control steps: a contract revision, an RFC-002 amendment and maintainer approval of the text.

## 2. Proposed text changes
| Item | Contract | Change | Serialized versions |
|---|---|---|---|
| AM-2.1 | **C3 r2 → r3** (C3.2, "Store aggregation") | "History-only bytes" becomes the sum of three terms. Each term counts an allocation only when no higher-precedence owner holds it (document > history; snapshots and jobs hold chunks, not document states): (a) chunk bytes, `byOwnerKind.history` (unchanged); (b) history-only source bytes (unchanged); (c) **document-structure bytes**: the cost-model bytes (§3) of node-map buckets, parent-index buckets, node objects, and palette, style and asset entries with their maps, reachable from a history state but not from the current document | none |
| AM-2.2 | **RFC-002 §7**, "History budget" | "Bytes are counted by chunk, source and document-structure owner (§5.2, C3.2 r3)." The limits are unchanged: 100 transactions and 128 MiB (64 MiB constrained) | none |
| — | C2 (GeometryStore) | **Unchanged.** Store accounting and `bytes()` keep their meaning; the new term is computed by the session | none |
| — | C7 and C10 | **Unchanged.** Persisted documents are canonical JSON with sorted keys, so persisted order cannot depend on the in-memory map | none |

## 3. Decisions requested from the maintainer
1. **Cost model** (needed because C3.2 is headed "exact, checked", and JavaScript heap bytes are neither exact nor observable per object).
   - **Proposal.** A deterministic integer formula per allocation kind: a fixed cost per map bucket, per entry, per node object by kind, per child-list element and per string code unit.
   - The constants are calibrated against **measured retained heap** of the integrated implementation (V8, Node, `--expose-gc`, at 43k and 250k paths) and chosen so that the model never under-counts the measurement on the calibration workloads.
   - The formula is exact and checked, in the C3.2 sense; what it models is approximate. The report would state the measured model-to-heap ratio for each workload.
2. **Attribution of shared allocations.**
   - **Proposal.** The chunk rule: each allocation is counted once and attributed to its highest-precedence owner (document > history).
   - A bucket shared by the current state and a history state therefore costs history nothing. A bucket shared only among history states is counted once.
3. **Earlier eviction (user-visible).**
   - Counting structure under the unchanged 128 MiB limit can evict history sooner. Eviction stays oldest-first, with the existing visible truncation.
   - **With** stage D's structural sharing, the investigation's micro-benchmark gave about 0.015–0.03 MiB of structure per state at 250k. That is a prototype figure, not a production result, and must be measured in the integrated implementation.
   - **Without** stage D, counting full maps (about 7 MiB per state) would cap history at about 18 states at 250k. This is why stage D's storage must land before the accounting is switched on.
   - **Approval requested** for the behaviour change, not for a number.
4. **Node-map iteration order** (part of stage D's storage, recorded here because it is visible).
   - The chunked copy-on-write map iterates in bucket order, not insertion order. The order is deterministic, derived from the keys.
   - Persistence is unaffected (sorted keys), and so are export and the renderer (both walk the tree).
   - One visible effect: on a load with **several** defects, the full validator may name a different defect first. The file is still rejected with a typed error.
   - Decide: accept bucket order, or require insertion order (an extra index; slower iteration).

## 4. What stage D would implement after approval
The investigation's option D, as authorised in the scope. It adds no dependency.
- **A chunked copy-on-write `nodesById`.** About √n buckets, `ReadonlyMap`-compatible, sealed on publication. A Draft copies only the buckets it writes.
- **A persistent parent index.** Chunked in the same way, maintained by the Draft from its write log. It replaces cold `parents()` in the commands and the proof, and could serve the renderer's own parent maps (`render-host.ts`, `CanvasHost.tsx`).
- **History accounting** per §2 and §3, with tests for eviction, resource bounds, shared-allocation reference accounting and immutable snapshot ownership. Retained memory would be **measured** in the integrated implementation, not extrapolated.
- **Re-qualification:** the differential harness, the frozen regressions and serialization hash, the browser suites, real Safari, and dispatch at 43k, 250k and 996k anchors.

**Measured motivation** ([G-DOC-R report](G-DOC-R-REPORT.md) §2.3): after stage C, the 996k-anchor workload still misses ≤ 50 ms for 6 of 12 transaction types (56–66 ms median). The remaining cost is the Draft's O(nodes) map copy (about 22 ms) and cold `parents()` (about 18 ms), which stage D removes.
