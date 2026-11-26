# G-DOC-R — Document-store performance (scope and authorisation)

**Status:** authorised by the maintainer on 2026-11-25 ([decision register §10](../g0/G0-DECISION-REGISTER.md)).
- **In progress on branch `gate/g-doc-r` (2026-11-26).** Stages B and C are implemented and qualified ([report](G-DOC-R-REPORT.md)).
- **Stages B and C were accepted as checkpoints on 2026-11-26.** AM-2 is approved ([decision register §11](../g0/G0-DECISION-REGISTER.md)), and stage D is in progress ([design](STAGE-D-DESIGN.md)).

G-DOC-R is a dedicated follow-up gate, kept separate from visual refinement. It addresses TD-PERF-007 (structural transactions cost O(nodes)) and TD-PERF-011 (each history entry retains a full node-map table). It builds on the G-R1 investigation: [TD-PERF-007-INVESTIGATION.md](../g-r1/TD-PERF-007-INVESTIGATION.md).

## Authorised work, in order
1. **B.** Integrate the incremental validator, with a full-pass fallback and a comparison mode.
2. **C.** Implement Draft-recorded write keys and the qualified command optimisations.
3. **D.** Implement the proposed chunked copy-on-write node map and a persistent parent index.

## Constraints
- No new dependency is authorised.
- Changes to the authoritative document architecture use the frozen-contract amendment process.
- Canonical serialisation and every document and export semantic are preserved.
- Deterministic persisted ordering must not depend on the map's internal iteration order.
- History resource accounting covers retained node maps, node objects, indexes, geometry and source assets.
  - Shared allocations are counted appropriately, not double-counted per reference.
- Investigate per-subtree summaries for expensive container-transform checks. The investigation measured about 56 ms for the whole-layer recheck at 250k.

## Targets retained
- Median structural dispatch ≤ 16.7 ms at the interactive target.
- p95 ≤ 33 ms at the interactive target.
- ≤ 50 ms at the designated stress workloads.
- At least 10,000 randomized differential transactions against the full validator, which stays the oracle.
- Full invariant validation for untrusted loaded documents.
- The approved history resource limits.

## Test coverage required
- Invalid transactions.
- Resource limits.
- History eviction.
- Reference accounting.
- Undo/redo.
- Immutable ownership.

## Document-wide traversal costs recorded for G-DOC-R
- **`paletteLabels()`** (`src/shell/document.ts`; G-UI-R report §18) walks every path under every traced layer once per new document state. It runs when the inspector shows a Fill note or Recolor (the result is cached per state). Measured with `scripts/bench-palette-labels.mjs` (Apple M5 Max, Node 24.22.1, not quiet), median per new state:
  - bark-1224 (16,056 paths, 13,662 entries): 6.1 ms;
  - bark-2350 (43,621 paths, 30,595 entries): 16.5 ms;
  - synthetic-many-250k (41,853 paths): 1.5 ms.

  That is linear but still whole-document. Per-subtree summaries or the persistent indexes of option D could make it incremental.
- Not measured here: the Recolor panel and the picker render one control per palette entry (13,662 or 30,595 for Full Colour traces). This is a UI rendering cost (virtualisation), not a document traversal. It is noted for the gate that next touches those panels.

## Measurement
- Measure the integrated implementation; do not extrapolate the prototype microbenchmarks.
- Record the machine, the load and the exact versions.
- Run on a quiet machine only if it is genuinely quiet. Lower-end hardware is required for qualification.
