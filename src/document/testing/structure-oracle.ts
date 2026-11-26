// TEST-ONLY reference oracle for AM-2 structure accounting (G-DOC-R stage D). It recomputes
// history-only accounted bytes by full traversal: every allocation of every retained state,
// keyed by identity (and by node key for per-key records), minus those the current state
// holds. It shares the cost model with structure-accounting.ts but none of its incremental
// bookkeeping (deltas, chain order, contiguity).
import { parents } from "../commands.ts";
import type { StateDerived } from "../invariants.ts";
import type { DocState } from "../model.ts";
import { NodeMap } from "../node-map.ts";
import {
  arrayCost,
  artboardCost,
  chunkParts,
  deepCost,
  derivedCost,
  entryMapCost,
  entryParts,
  mapHeaderCost,
  nodeCost,
  nodeRecords,
  provenances,
  stateRecordCost,
} from "../structure-accounting.ts";

type Items = Map<object, Map<string, number>>;

/** Every accounted allocation of `s`: identity → (scope → cost). Scope "" is global. */
export function stateItems(s: DocState, d?: StateDerived): Items {
  const items: Items = new Map();
  const add = (o: object, scope: string, cost: number) => {
    let m = items.get(o);
    if (!m) items.set(o, (m = new Map()));
    m.set(scope, cost);
  };
  add(s, "", stateRecordCost);
  add(s.orderedRootIds, "", arrayCost(s.orderedRootIds.length));
  add(s.artboard, "", artboardCost);
  if (d) add(d, "", derivedCost(d));
  for (const m of [s.nodesById, parents(s)] as ReadonlyMap<string, unknown>[])
    if (m instanceof NodeMap) {
      add(m, "", mapHeaderCost(m));
      for (const [o, c] of chunkParts(m)) add(o, "", c);
    } else add(m, "", entryMapCost(m));
  for (const [k, n] of s.nodesById) {
    if (!n) continue;
    add(n, "", nodeCost(n));
    for (const [r, c] of nodeRecords(n)) add(r, k, c);
  }
  for (const p of provenances(s)) add(p, "", deepCost(p));
  for (const m of [s.stylesById, s.paletteById, s.sourceAssetsById] as ReadonlyMap<
    string,
    object
  >[]) {
    add(m, "", entryMapCost(m));
    for (const [k, e] of m) {
      const ep = entryParts(e);
      add(e, "", ep.cost);
      if (ep.record) add(ep.record[0], k, ep.record[1]);
    }
  }
  return items;
}

/** History-only accounted bytes: allocations of any history state not held by `current`. */
export function referenceHistoryBytes(
  current: DocState,
  history: readonly DocState[],
  derivedOf: (s: DocState) => StateDerived | undefined,
): number {
  const cur = stateItems(current, derivedOf(current));
  const seen: Items = new Map();
  for (const h of history)
    for (const [o, scopes] of stateItems(h, derivedOf(h)))
      for (const [scope, cost] of scopes) {
        if (cur.get(o)?.has(scope)) continue;
        let m = seen.get(o);
        if (!m) seen.set(o, (m = new Map()));
        m.set(scope, cost);
      }
  let n = 0;
  for (const m of seen.values()) for (const c of m.values()) n += c;
  return n;
}
