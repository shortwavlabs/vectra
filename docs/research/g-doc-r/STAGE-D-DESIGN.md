# G-DOC-R stage D — design (persistent storage and history accounting)

**Status:** design for implementation under AM-2, approved by the maintainer on 2026-11-26. This file is the reference the implementation and its independent review check against.

## 1. `NodeMap`: chunked copy-on-write node map
**Shape.**
- `ReadonlyMap<NodeId, DocNode>`-compatible and immutable: no mutators.
- All internals in private fields, so there are no own enumerable properties.
- Buckets are JavaScript `Map`s reachable only through the class.

**Hash and order.**
- `h = fmix32(fnv1a32(key))`: deterministic, no seed. Any string key is accepted, including invalid IDs in forged states.
- With `2^bits` buckets, a key's bucket is `h >>> (32 - bits)` (the top bits).
- Inside a bucket, entries are inserted in **(h, key) order** (unsigned hash, then code-unit order on ties).
- So iteration order is sorted by (h, key) **whatever the bucket count or edit history**. Two maps with the same contents iterate identically, and a loaded map iterates exactly like an edited one.

**Bucket count.** `2^bits`, aiming at about √n entries per bucket.
- Grow when the average exceeds `2·√(target)`; shrink with hysteresis.
- A resize copies every bucket (O(n)). It happens only when the size changes by a large factor, as in a trace commit or a whole-layer delete, which are already O(n).
- A doubling splits each sorted bucket at a hash threshold; a halving concatenates neighbours.

**Values.** A key may hold `undefined`, as in a `Map`: `has(k)` is true and `get(k)` is undefined. The Draft's deletion marker is a private sentinel, never `undefined`. This keeps review defect C1's distinction between a missing key and a key holding `undefined`.

**Draft integration (`NodeMapDraft`).**
- An overlay `Map` over the base: `get`, `has`, `set`, `delete`, `size` and iteration see base plus overlay.
- Constructing a Draft is O(1); there is no copy.
- `publish()` groups the written keys by bucket and rebuilds each touched bucket once, as a sorted merge of base and overlay, O(b + w log w). It shares untouched buckets and resizes if needed.
- The base is never mutated, so a failed transaction drops the overlay and nothing else.
- The written keys are the overlay's keys, which go to the transaction's `DraftLog` (stage C) and are not retained afterwards.

## 2. Persistent parent index
- `parents(s)` returns a `NodeMap<NodeId, NodeId | null>` (null for roots), cached in a `WeakMap<DocState, …>`. The index references no state, so there is **no ancestry retention**.
- **Derivation at `Draft.finish`** from the base's index and the written keys.
  - Only the child lists of written containers whose list reference changed are rescanned (old and new), plus the root list when it changed.
  - A child that loses its parent and is listed nowhere new is removed: it was deleted, or it is an orphan the validator will reject.
  - Cost: O(changed child lists).
- **Seeding.** If the base has no index, it is built once by a full traversal. The session constructor builds it for the initial (loaded) state. After that, every published state's index is incremental.
- **Checkable.** `parentIndexMatches(s)` compares the index with a full tree traversal.
  - `compare` mode runs it after every accepted transaction.
  - The differential harness and the unit tests run it too.
  - For invalid states the index is unspecified; they are never published.

## 3. Structure ledger: AM-2 accounting
**Model.** Reference counts per allocation and per owner kind (`document`, `history`), as the GeometryStore does for chunks.
- An allocation is **history-only** when its document count is 0 and its history count is above 0.
- Each allocation is counted once.

**Allocation graph per state.**
- The state record, the root array and the artboard.
- The `nodesById` map header, its bucket directory and its buckets.
- Node objects. Each of their child arrays, transforms, geometry and clip records, and retained provenance is a **separate** allocation, because node copies share them; for example, `setVisible` on a group keeps its child array.
- The parent index's header, directory and buckets.
- The style, palette and asset maps, their entries, and nested strokes and provenance.
- The state's cached derived data.
- **Not here:** geometry chunks and source bytes, which keep their own accounting. Strings are counted with their owning node or entry. Allocations shared with the current document are not history-only (the highest-precedence rule).

**Incremental, with no whole-history traversal.**
- `retain(state, kind)` and `release(state, kind)` walk the graph but descend into an allocation only on a 0↔1 transition of that kind's count.
- An ordinary edit costs O(√n) per transition: the directory, plus the one new bucket's entries.
- Running totals are updated on each membership change.
- `entryBytes` (RFC §7 "cannot fit") is computed after `next` is retained as `document`, by walking `prev`'s allocations that `next` and history do not hold. It is rolled back if the transaction throws.

**Cost model.** Deterministic checked integers (`Number.isSafeInteger` asserted): a fixed cost per kind of allocation, plus a cost per element, entry or code unit.
- The constants are calibrated against **measured retained heap** of this implementation. The model is reported as **accounted bytes**, never as a measurement of JavaScript memory.

**Reference oracle.** `referenceStructureBytes(current, history)` does a full traversal into sets and returns the cost of `H \ D`. Tests compare it with the ledger after random edits, undo, redo, branching, eviction, `withoutHistory` and disposal.

**Budget.** `historyBytes()` = chunk history bytes + history-only source bytes + ledger history-only bytes. The limits are unchanged (100 entries; 128 MiB standard, 64 MiB constrained). Eviction stays oldest-first, with visible truncation.

## 4. What stays as it is
- The validators: the full pass is the oracle and the load path. For node changes, the proof still uses the write log when it is complete, else the identity diff. A structural diff over shared buckets is available, and `compare` mode uses it to assert that the log covers every changed key.
- `stylesById`, `paletteById` and `sourceAssetsById` remain `SealedMap`s, shared when unchanged (stage C).
- Serialization: `documentJson` iterates `nodesById` and canonical JSON sorts the keys, so bytes are unchanged.
- C2 (GeometryStore) ownership is unchanged.
