// G-DOC-R stage D, AM-2 (C3.2 r3): accounted bytes of document structure retained by history.
//
// These are ACCOUNTED bytes from a deterministic integer cost model (COSTS), not a measurement
// of JavaScript heap memory. The model is calibrated against measured retained heap (G-DOC-R
// report §7).
//
// Allocation model. Each allocation is counted once, by identity:
//   per state:   the state record, its root array, its artboard, its derived data, its
//                node-map header and directory, its parent-index header and directory;
//   shared:      node-map and parent-index chunks (chunk object, numbers, keys and values
//                arrays, each separately, because updates share numbers and keys);
//   per node:    the node object, including its id and name strings;
//   per key:     the node's transform arrays, geometry record, clip record and child list.
//                These are scoped per key: a record that `duplicate` shares between two keys is
//                counted once per key, a conservative over-count bounded by the duplicated
//                records' size;
//   global:      a layer's trace provenance, exact across keys (layers are roots);
//   entry maps:  each style, palette or asset map table, and per entry its object (with its
//                strings) and its per-key stroke or provenance record.
// Geometry chunks and source bytes are excluded: they have their own accounting (C3.2 terms
// 1 and 2).
//
// History-only bytes come from one delta per history step (`structureDelta`): the accounted
// bytes in the step's predecessor but not in its successor (removed), and the reverse
// (added). No command revives an allocation once a later state has dropped it, so each
// allocation lives in one contiguous run of states. History-only bytes are then the removed
// bytes of the steps before the current state plus the added bytes of the steps after it
// (DocumentSession.historyStructureBytes). testing/structure-oracle.ts recomputes the same
// quantity by full traversal.

import { parents } from "./commands.ts";
import type { StateDerived } from "./invariants.ts";
import { type DocNode, type DocState, IDENTITY } from "./model.ts";
import { type Chunk, changedKeys, NodeMap, unsharedChunks } from "./node-map.ts";

/** V8 64-bit object layout estimates (bytes), calibrated in the G-DOC-R report §7. */
export const COSTS = Object.freeze({
  object: 24, // header: map, properties, elements
  field: 8,
  heapNumber: 16, // a number field outside the small-integer range is boxed
  array: 48, // JSArray header and FixedArray header
  element: 8,
  // JSTypedArray and JSArrayBuffer headers. Measured 198–200 off-heap and 216 (+8 payload)
  // on-heap; was 160 until the G-DOC-R accounting closure (report §7.1).
  typedArray: 216,
  typedElement: 8, // Float64
  string: 16, // sequential string header
  mapTable: 64, // JSMap and hash-table headers
  mapSlot: 28, // per table slot (capacity = next power of two ≥ size): 3 entry words + ½ bucket
  clonedProperties: 16, // structured-clone objects keep their fields in a property array
  stateBookkeeping: 320, // per retained state: session records (derived, delta, index entries)
  // Per history-attributed geometry chunk: the store's record outside the C3.2 chunk ledger
  // cost. Nine typed-array and buffer headers (1,800), accessor views and their closures, the
  // manifest object, the owner counts. Measured 3,688–3,767 per chunk at every size from 1 to
  // 4,000 paths (scripts/measure-chunk-overhead.mjs); the largest median rounded up to 64.
  chunkRecord: 3_776,
});

const C = COSTS;
const checked = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`accounted bytes out of range: ${n}`);
  return n;
};
const align8 = (n: number) => Math.ceil(n / 8) * 8;
export const objectCost = (fields: number) => C.object + C.field * fields;
export const arrayCost = (n: number) => C.array + C.element * n;
const typedCost = (n: number) => C.typedArray + C.typedElement * n;
const stringCost = (s: string) => {
  if (s.length === 0) return 0; // the empty string is shared
  let wide = false;
  for (let i = 0; i < s.length && !wide; i++) wide = s.charCodeAt(i) > 255;
  return C.string + align8(s.length * (wide ? 2 : 1));
};
const SMI = 2 ** 31;
/** Extra bytes for a number stored in an object field or a generic array (boxed if not Smi). */
const numberCost = (v: number) => (Number.isInteger(v) && v >= -SMI && v < SMI ? 0 : C.heapNumber);
/** A hash table grows by doubling: its capacity is the next power of two at or above `n`. */
const mapTableCost = (n: number) =>
  C.mapTable + C.mapSlot * Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, n))));

const deepMemo = new WeakMap<object, number>();
/** Structural cost of a JSON-like value tree (provenance records). Cached per object. */
export function deepCost(v: unknown): number {
  if (typeof v === "string") return stringCost(v);
  if (typeof v === "number") return numberCost(v);
  if (v === null || typeof v !== "object") return 0; // inline in its slot
  const hit = deepMemo.get(v);
  if (hit !== undefined) return hit;
  let n: number;
  if (Array.isArray(v)) n = arrayCost(v.length) + v.reduce<number>((s, x) => s + deepCost(x), 0);
  else {
    // Provenance records are structured clones: fields in a separate property array.
    const vals = Object.values(v);
    n =
      objectCost(vals.length) +
      C.clonedProperties +
      C.field * vals.length +
      vals.reduce<number>((s, x) => s + deepCost(x), 0);
  }
  deepMemo.set(v, n);
  return n;
}

/** The node object with its id and name strings. */
export const nodeCost = (n: DocNode) =>
  objectCost(Object.keys(n).length) + stringCost(n.id) + stringCost(n.name);
/** A node's per-key records: [record, cost]. IDENTITY is a shared constant, never counted. */
export function nodeRecords(n: DocNode): [object, number][] {
  const out: [object, number][] = [];
  if (n.localTransform !== IDENTITY) out.push([n.localTransform, arrayCost(6)]);
  if (n.clipRef) {
    const r = n.clipRef;
    out.push([
      r,
      objectCost(4) + [r.x, r.y, r.width, r.height].reduce((t, v) => t + numberCost(v), 0),
    ]);
  }
  if (n.kind === "path") out.push([n.geometry, objectCost(2)]);
  else if (n.kind === "source") {
    if (n.sourceToDocument !== IDENTITY) out.push([n.sourceToDocument, arrayCost(6)]);
  } else out.push([n.orderedChildIds, arrayCost(n.orderedChildIds.length)]);
  return out;
}
/** A NodeMap's own allocations: header and directory. */
export const mapHeaderCost = (m: NodeMap<unknown>) =>
  objectCost(5) + 2 * arrayCost(m.chunks.length) + typedCost(m.chunks.length);
/** Each chunk's allocations: [identity, cost]. */
export const chunkParts = (m: NodeMap<unknown>) => partsOf(m.chunks as readonly Chunk<unknown>[]);
function partsOf(chunks: readonly Chunk<unknown>[]): [object, number][] {
  const out: [object, number][] = [];
  for (const c of chunks) {
    const n = c.keys.length;
    if (n === 0) continue; // the shared empty-chunk constant, like IDENTITY, is never counted
    out.push(
      [c, objectCost(3)],
      [c.nums, typedCost(n)],
      [c.keys, arrayCost(n)],
      [c.vals, arrayCost(n)],
    );
  }
  return out;
}
export const stateRecordCost = objectCost(7) + C.stateBookkeeping;
export const artboardCost = objectCost(3);
export const derivedCost = (d: StateDerived | undefined) =>
  d ? objectCost(3) + mapTableCost(d.chunks.size) : 0;

/** An entry of a style, palette or asset map, with its strings, and its per-key record. */
export function entryParts(e: object | undefined): {
  cost: number;
  record: [object, number] | null;
} {
  if (!e) return { cost: 0, record: null };
  let cost = objectCost(Object.keys(e).length);
  for (const v of Object.values(e))
    if (typeof v === "string") cost += stringCost(v);
    else if (typeof v === "number") cost += numberCost(v);
  const rec =
    (e as { stroke?: object | null; provenance?: object }).stroke ??
    (e as { provenance?: object }).provenance;
  return { cost, record: rec ? [rec, deepCost(rec)] : null };
}
export const entryMapCost = (m: ReadonlyMap<string, unknown>) =>
  m instanceof NodeMap ? mapHeaderCost(m) : mapTableCost(m.size);

/** Trace provenance records of a (valid) state: layers are roots. */
export function provenances(s: DocState): Set<object> {
  const out = new Set<object>();
  for (const id of s.orderedRootIds) {
    const n = s.nodesById.get(id);
    if (n?.kind === "layer" && n.traceProvenance) out.add(n.traceProvenance);
  }
  return out;
}

export interface Delta {
  /** Accounted bytes in the predecessor and not in the successor. */
  readonly removed: number;
  /** Accounted bytes in the successor and not in the predecessor. */
  readonly added: number;
}

/**
 * Accounted structural bytes that `a` holds and `b` does not (removed), and the reverse
 * (added). O(chunks + changed entries): unshared chunks and changed node keys only.
 */
export function structureDelta(
  a: DocState,
  b: DocState,
  da?: StateDerived,
  db?: StateDerived,
  /** Node keys that may differ (a superset; the transaction's complete write log), or null. */
  writes: ReadonlySet<string> | null = null,
): Delta {
  let removed = 0;
  let added = 0;
  if (a !== b) {
    removed += stateRecordCost;
    added += stateRecordCost;
  }
  if (a.orderedRootIds !== b.orderedRootIds) {
    removed += arrayCost(a.orderedRootIds.length);
    added += arrayCost(b.orderedRootIds.length);
  }
  if (a.artboard !== b.artboard) {
    removed += artboardCost;
    added += artboardCost;
  }
  if (da !== db) {
    removed += derivedCost(da);
    added += derivedCost(db);
  }
  // Node map and parent index: headers, and chunks the other state does not share.
  const maps: [ReadonlyMap<string, unknown>, ReadonlyMap<string, unknown>][] = [
    [a.nodesById, b.nodesById],
    [parents(a), parents(b)],
  ];
  for (const [x, y] of maps) {
    if (x === y) continue;
    if (x instanceof NodeMap && y instanceof NodeMap) {
      removed += mapHeaderCost(x);
      added += mapHeaderCost(y);
      // Only chunks the other map does not share; their parts may still be shared (an update
      // shares numbers and keys).
      const [ux, uy] = unsharedChunks(
        x.chunks as readonly Chunk<unknown>[],
        y.chunks as readonly Chunk<unknown>[],
      );
      const px = partsOf(ux);
      const py = partsOf(uy);
      const ix = new Set(px.map((p) => p[0]));
      const iy = new Set(py.map((p) => p[0]));
      for (const [o, c] of px) if (!iy.has(o)) removed += c;
      for (const [o, c] of py) if (!ix.has(o)) added += c;
    } else {
      // Not both NodeMaps (a state built by hand): nothing is shared; each side counts in
      // full (review C1: the NodeMap side's chunks were omitted).
      const whole = (m: ReadonlyMap<string, unknown>) =>
        m instanceof NodeMap
          ? mapHeaderCost(m) + chunkParts(m).reduce((t, [, c]) => t + c, 0)
          : entryMapCost(m);
      removed += whole(x);
      added += whole(y);
    }
  }
  // Nodes and their per-key records (identity per key).
  for (const k of writes ?? changedKeys(a.nodesById, b.nodesById)) {
    const o = a.nodesById.get(k);
    const n = b.nodesById.get(k);
    if (o === n && a.nodesById.has(k) === b.nodesById.has(k)) continue; // a superset key
    if (o) removed += nodeCost(o);
    if (n) added += nodeCost(n);
    const ro = o ? nodeRecords(o) : [];
    const rn = n ? nodeRecords(n) : [];
    const so = new Set(ro.map((r) => r[0]));
    const sn = new Set(rn.map((r) => r[0]));
    for (const [r, c] of ro) if (!sn.has(r)) removed += c;
    for (const [r, c] of rn) if (!so.has(r)) added += c;
  }
  // Trace provenance, exact across keys.
  const pa = provenances(a);
  const pb = provenances(b);
  for (const p of pa) if (!pb.has(p)) removed += deepCost(p);
  for (const p of pb) if (!pa.has(p)) added += deepCost(p);
  // Style, palette and asset maps (shared when unchanged, stage C).
  for (const [x, y] of [
    [a.stylesById, b.stylesById],
    [a.paletteById, b.paletteById],
    [a.sourceAssetsById, b.sourceAssetsById],
  ] as [ReadonlyMap<string, object>, ReadonlyMap<string, object>][]) {
    if (x === y) continue;
    removed += entryMapCost(x);
    added += entryMapCost(y);
    for (const k of changedKeys(x, y)) {
      const eo = entryParts(x.get(k));
      const en = entryParts(y.get(k));
      removed += eo.cost;
      added += en.cost;
      if (eo.record && eo.record[0] !== en.record?.[0]) removed += eo.record[1];
      if (en.record && en.record[0] !== eo.record?.[0]) added += en.record[1];
    }
  }
  return { removed: checked(removed), added: checked(added) };
}
